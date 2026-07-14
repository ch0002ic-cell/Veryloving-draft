import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { logger } from '../utils/logger';
import { translate } from '../i18n/core';
import { createPhoneValue } from '../utils/phone';
import { config } from '../utils/config';
import {
  googleIdentityFromResponse,
  googleSignInCancellationError
} from '../utils/google-auth';
import {
  createOnboardingMarker,
  isOnboardingMarkerValid
} from '../utils/onboarding-state';
import {
  confirmPhoneVerification,
  exchangeProviderIdentity,
  refreshApplicationSession,
  requestPhoneVerification
} from '../services/auth-session';
import { secureStorage } from '../services/secure-storage';
import { storage } from '../services/storage';
import {
  authenticationRuntime,
  isExpoGoRuntime
} from '../utils/runtime-environment';
import {
  authenticationCapabilities,
  createAuthError,
  createSimulatorAuthenticationError,
  isAuthenticationCancellation,
  isTransientAuthenticationError,
  userFacingAuthenticationError
} from '../utils/auth-configuration';
import {
  createAuthenticationNonce,
  isSessionTokenUsable,
  sessionTokenClaims
} from '../utils/session-token';
import {
  createSessionEnvelope,
  migrateLegacySession,
  parseSessionEnvelope
} from '../utils/session-envelope';
const AuthContext = createContext(null);
const SESSION_KEY = 'veryloving.auth.session.v1';
const SIGNED_OUT_KEY = 'veryloving.auth.signedOut';
const LEGACY_TOKEN_KEY = 'veryloving.auth.token';
const LEGACY_REFRESH_TOKEN_KEY = 'veryloving.auth.refreshToken';
const LEGACY_USER_KEY = 'veryloving.auth.user';
const ONBOARDING_KEY = 'veryloving.auth.onboarding';
const LEGACY_SESSION_KEYS = [LEGACY_TOKEN_KEY, LEGACY_REFRESH_TOKEN_KEY, LEGACY_USER_KEY];
const DEVELOPMENT_DEMO_USER = Object.freeze({
  id: 'demo:local',
  provider: 'demo',
  name: 'Demo User',
  email: 'demo@veryloving.invalid',
  isDemo: true
});

export const AUTH_STORAGE_KEYS = {
  session: SESSION_KEY,
  signedOut: SIGNED_OUT_KEY,
  token: LEGACY_TOKEN_KEY,
  refreshToken: LEGACY_REFRESH_TOKEN_KEY,
  user: LEGACY_USER_KEY,
  onboarding: ONBOARDING_KEY
};

async function removeLegacySessionKeys() {
  return Promise.allSettled(LEGACY_SESSION_KEYS.map((key) => secureStorage.deleteItemAsync(key)));
}

async function invalidatePersistedSession() {
  let tombstoneStored = false;
  let tombstoneError;
  try {
    await storage.setJSON(SIGNED_OUT_KEY, { version: 1, signedOutAt: Date.now() });
    tombstoneStored = true;
  } catch (error) {
    tombstoneError = error;
  }
  const results = await Promise.allSettled([
    secureStorage.deleteItemAsync(SESSION_KEY),
    secureStorage.deleteItemAsync(ONBOARDING_KEY),
    ...LEGACY_SESSION_KEYS.map((key) => secureStorage.deleteItemAsync(key))
  ]);
  if (!tombstoneStored && results[0].status === 'rejected') {
    throw tombstoneError || results[0].reason;
  }
  return {
    protectedFromRestore: tombstoneStored || results[0].status === 'fulfilled',
    residualFailures: results.filter((result) => result.status === 'rejected').length
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [sessionStatus, setSessionStatus] = useState('loading');
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [pendingPhoneVerification, setPendingPhoneVerification] = useState(null);
  const [isIOSSimulator, setIsIOSSimulator] = useState(null);
  const [demoModeAvailable, setDemoModeAvailable] = useState(false);
  const refreshInFlightRef = useRef(null);
  const refreshRetryTimerRef = useRef(null);
  const refreshSessionRef = useRef(null);
  const authGenerationRef = useRef(0);
  const sessionMutationRef = useRef(Promise.resolve());
  const authCapabilities = useMemo(() => authenticationCapabilities(config, {
    platform: Platform.OS,
    expoGo: isExpoGoRuntime()
  }), []);
  const isDemoMode = sessionStatus === 'demo' && user?.provider === 'demo';

  useEffect(() => {
    let active = true;
    Promise.all([
      authenticationRuntime.isIOSSimulator(),
      authenticationRuntime.isDemoModeAvailable()
    ])
      .then(([simulator, demoAvailable]) => {
        if (!active) return;
        setIsIOSSimulator(simulator);
        setDemoModeAvailable(demoAvailable);
      })
      .catch(() => {
        if (!active) return;
        setIsIOSSimulator(false);
        setDemoModeAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const scheduleRefreshRetry = useCallback(() => {
    if (refreshRetryTimerRef.current) return;
    refreshRetryTimerRef.current = setTimeout(() => {
      refreshRetryTimerRef.current = null;
      refreshSessionRef.current?.().catch(() => {});
    }, 60000);
  }, []);

  const runSessionMutation = useCallback((mutation) => {
    const operation = sessionMutationRef.current
      .catch(() => {})
      .then(mutation);
    // Keep the queue usable after a failed mutation without changing the
    // promise returned to its caller.
    sessionMutationRef.current = operation.catch(() => {});
    return operation;
  }, []);

  const refreshSession = useCallback((providedRefreshToken) => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const authGeneration = authGenerationRef.current;
    let operation;
    operation = (async () => {
      try {
        const persistedEnvelope = parseSessionEnvelope(
          await secureStorage.getItemAsync(SESSION_KEY),
          { allowExpiredAccess: true, skewSeconds: 60 }
        );
        const refreshToken = providedRefreshToken || persistedEnvelope?.refreshToken;
        if (
          !refreshToken
          || !persistedEnvelope?.user
          || !isSessionTokenUsable(refreshToken, { skewSeconds: 60 })
        ) {
          const error = new Error('The refresh session is unavailable or expired.');
          error.code = 'AUTH_REFRESH_UNAVAILABLE';
          throw error;
        }
        setSessionStatus('refreshing');
        const session = await refreshApplicationSession(refreshToken);
        if (authGeneration !== authGenerationRef.current) {
          const error = new Error('A stale refresh response was ignored.');
          error.code = 'AUTH_REFRESH_STALE';
          throw error;
        }
        const nextEnvelope = createSessionEnvelope({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          user: persistedEnvelope.user
        });
        if (!nextEnvelope) {
          const error = new Error('The authentication server returned a mismatched session.');
          error.code = 'AUTH_RESPONSE_INVALID';
          throw error;
        }
        await runSessionMutation(async () => {
          if (authGeneration !== authGenerationRef.current) {
            throw createAuthError('AUTH_REFRESH_STALE', 'A stale refresh response was ignored.');
          }
          // One Keychain item makes a rotated access/refresh/profile snapshot
          // atomic from the next process's point of view.
          await secureStorage.setItemAsync(SESSION_KEY, JSON.stringify(nextEnvelope));
          await removeLegacySessionKeys();
          if (authGeneration !== authGenerationRef.current) {
            throw createAuthError('AUTH_REFRESH_STALE', 'A stale refresh response was ignored.');
          }
          setAccessToken(session.accessToken);
          setSessionStatus('active');
          if (refreshRetryTimerRef.current) {
            clearTimeout(refreshRetryTimerRef.current);
            refreshRetryTimerRef.current = null;
          }
        });
        return session;
      } catch (error) {
        if (error?.code === 'AUTH_REFRESH_STALE') throw error;
        const rejected = !isTransientAuthenticationError(error);
        if (authGeneration !== authGenerationRef.current) {
          throw createAuthError('AUTH_REFRESH_STALE', 'A stale refresh response was ignored.');
        }
        if (rejected) {
          await runSessionMutation(async () => {
            if (authGeneration !== authGenerationRef.current) return;
            await invalidatePersistedSession();
            if (authGeneration !== authGenerationRef.current) return;
            setAccessToken(null);
            setUser(null);
            setOnboardingComplete(false);
            setSessionStatus('reauthentication-required');
          });
        } else {
          // Keep the account-bound offline safety state available while the
          // network is down, and retry without treating an outage as logout.
          if (authGeneration === authGenerationRef.current) {
            setAccessToken(null);
            setSessionStatus('offline');
            scheduleRefreshRetry();
          }
        }
        throw error;
      }
    })().finally(() => {
      if (refreshInFlightRef.current === operation) refreshInFlightRef.current = null;
    });
    refreshInFlightRef.current = operation;
    return operation;
  }, [runSessionMutation, scheduleRefreshRetry]);
  refreshSessionRef.current = refreshSession;

  useEffect(() => {
    let active = true;
    const authGeneration = authGenerationRef.current;
    Promise.all([
      storage.getRaw(SIGNED_OUT_KEY),
      secureStorage.getItemAsync(SESSION_KEY),
      secureStorage.getItemAsync(ONBOARDING_KEY),
      secureStorage.getItemAsync(LEGACY_TOKEN_KEY),
      secureStorage.getItemAsync(LEGACY_REFRESH_TOKEN_KEY),
      secureStorage.getItemAsync(LEGACY_USER_KEY)
    ]).then(async ([signedOutMarker, rawEnvelope, rawOnboarding, legacyToken, legacyRefresh, legacyUser]) => {
      if (!active || authGeneration !== authGenerationRef.current) return;
      if (signedOutMarker) {
        await runSessionMutation(() => Promise.allSettled([
          secureStorage.deleteItemAsync(SESSION_KEY),
          secureStorage.deleteItemAsync(ONBOARDING_KEY),
          ...LEGACY_SESSION_KEYS.map((key) => secureStorage.deleteItemAsync(key))
        ]));
        if (active && authGeneration === authGenerationRef.current) {
          setSessionStatus('signed-out');
        }
        return;
      }

      let envelope = parseSessionEnvelope(rawEnvelope, {
        allowExpiredAccess: true,
        skewSeconds: 60
      });
      if (!envelope && (legacyToken || legacyRefresh || legacyUser)) {
        envelope = migrateLegacySession({
          accessToken: legacyToken,
          refreshToken: legacyRefresh,
          user: legacyUser
        }, { allowExpiredAccess: true, skewSeconds: 60 });
        if (envelope) {
          await runSessionMutation(async () => {
            await secureStorage.setItemAsync(SESSION_KEY, JSON.stringify(envelope));
            await removeLegacySessionKeys();
          });
        }
      }

      if (envelope && isSessionTokenUsable(envelope.accessToken)) {
        setAccessToken(envelope.accessToken);
        setUser(envelope.user);
        setSessionStatus('active');
        setOnboardingComplete(isOnboardingMarkerValid(rawOnboarding, envelope.user.id));
      } else if (envelope) {
        setUser(envelope.user);
        setOnboardingComplete(isOnboardingMarkerValid(rawOnboarding, envelope.user.id));
        try {
          await refreshSession(envelope.refreshToken);
        } catch {
          // refreshSession distinguishes a rejected session from a temporary
          // outage and preserves offline state only for the latter.
        }
      } else if (rawEnvelope || legacyToken || legacyRefresh || legacyUser || rawOnboarding) {
        await runSessionMutation(() => invalidatePersistedSession());
        if (active && authGeneration === authGenerationRef.current) {
          setSessionStatus('reauthentication-required');
        }
      } else {
        // A fresh Expo Go process always reaches this branch because its
        // deliberately volatile secure-storage backend resets on reload.
        setSessionStatus('signed-out');
      }
    }).catch((error) => {
      // Volatile Expo Go storage has no previous session by design. It should
      // never turn that expected signed-out state into a tester-facing warning.
      if (!secureStorage.isVolatile) {
        logger.warn('[Auth] Could not restore the secure session', error);
      }
      setSessionStatus('signed-out');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [refreshSession, runSessionMutation]);

  useEffect(() => {
    if (!accessToken) return undefined;
    const claims = sessionTokenClaims(accessToken);
    const expiresInMs = Number(claims?.exp) * 1000 - Date.now() - 30000;
    const renewSession = () => refreshSession().catch((error) => logger.warn('[Auth] Session refresh is pending', {
      errorCode: error?.code || error?.name || 'AUTH_REFRESH_FAILED'
    }));
    if (!Number.isFinite(expiresInMs) || expiresInMs <= 0) {
      renewSession();
      return undefined;
    }
    const timer = setTimeout(renewSession, Math.min(expiresInMs, 2147483647));
    return () => clearTimeout(timer);
  }, [accessToken, refreshSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && sessionStatus === 'offline') refreshSession().catch(() => {});
    });
    return () => subscription.remove();
  }, [refreshSession, sessionStatus]);

  useEffect(() => () => {
    if (refreshRetryTimerRef.current) clearTimeout(refreshRetryTimerRef.current);
  }, []);

  useEffect(() => {
    if (!pendingPhoneVerification?.expiresAt) return undefined;
    const remaining = pendingPhoneVerification.expiresAt - Date.now();
    if (remaining <= 0) {
      setPendingPhoneVerification(null);
      return undefined;
    }
    const timer = setTimeout(() => setPendingPhoneVerification(null), remaining);
    return () => clearTimeout(timer);
  }, [pendingPhoneVerification]);

  const persist = useCallback(async (nextUser, session) => {
    // A new authentication ceremony always starts fail-closed. The user-bound
    // completion marker is written only after the onboarding flow finishes.
    authGenerationRef.current += 1;
    const authGeneration = authGenerationRef.current;
    const nextEnvelope = createSessionEnvelope({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: nextUser
    });
    if (!nextEnvelope) {
      throw createAuthError('AUTH_RESPONSE_INVALID', 'The authentication server returned an invalid session.');
    }
    const serializedEnvelope = JSON.stringify(nextEnvelope);
    await runSessionMutation(async () => {
      if (authGeneration !== authGenerationRef.current) {
        throw createAuthError('AUTH_OPERATION_CANCELLED', 'Authentication was superseded.');
      }
      try {
        await secureStorage.deleteItemAsync(ONBOARDING_KEY);
        await secureStorage.setItemAsync(SESSION_KEY, serializedEnvelope);
        await storage.remove(SIGNED_OUT_KEY);
        await removeLegacySessionKeys();
      } catch (error) {
        await invalidatePersistedSession().catch(() => {});
        if (authGeneration === authGenerationRef.current) {
          setUser(null);
          setAccessToken(null);
          setOnboardingComplete(false);
          setSessionStatus('signed-out');
        }
        throw error;
      }
      if (authGeneration !== authGenerationRef.current) {
        throw createAuthError('AUTH_OPERATION_CANCELLED', 'Authentication was superseded.');
      }
      setUser(nextEnvelope.user);
      setAccessToken(nextEnvelope.accessToken);
      setSessionStatus('active');
      setOnboardingComplete(false);
      setAuthError(null);
    });
  }, [runSessionMutation]);

  const completeOnboarding = useCallback(async () => {
    if (!user?.id) throw new Error('A signed-in user is required to complete onboarding.');
    const authGeneration = authGenerationRef.current;
    const marker = createOnboardingMarker(user.id);
    await runSessionMutation(async () => {
      if (authGeneration !== authGenerationRef.current) {
        throw createAuthError('AUTH_OPERATION_CANCELLED', 'Authentication was superseded.');
      }
      await secureStorage.setItemAsync(ONBOARDING_KEY, JSON.stringify(marker));
      if (authGeneration === authGenerationRef.current) setOnboardingComplete(true);
    });
  }, [runSessionMutation, user?.id]);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const reportAuthenticationFailure = useCallback((provider, error) => {
    if (isAuthenticationCancellation(error)) {
      setAuthError(null);
      logger.info(`[Auth] ${provider} sign-in cancelled`);
      return error;
    }
    const safeError = userFacingAuthenticationError(provider, error);
    setAuthError(safeError.userMessage);
    if (safeError.code?.endsWith('_AUTH_SIMULATOR_UNAVAILABLE')) {
      logger.info(`[Auth] ${provider} sign-in skipped for this simulator build`);
      return safeError;
    }
    logger.error(`[Auth] ${provider} sign-in failed`, {
      errorCode: error?.code || error?.name || 'AUTH_FAILED',
      error
    });
    return safeError;
  }, []);

  const requireCapability = useCallback((provider) => {
    const capability = authCapabilities[provider];
    if (!capability?.enabled) {
      throw createAuthError(capability?.code || 'AUTH_UNAVAILABLE', capability?.message || 'Sign-in is unavailable.');
    }
  }, [authCapabilities]);

  const requireProviderRuntime = useCallback(async (provider) => {
    if (!await authenticationRuntime.isIOSSimulator()) return;
    throw createSimulatorAuthenticationError(provider, {
      demoAvailable: await authenticationRuntime.isDemoModeAvailable()
    });
  }, []);

  const signInWithApple = useCallback(async () => {
    setAuthError(null);
    try {
      requireCapability('apple');
      await requireProviderRuntime('apple');
      // The package is evaluated only in a configured native development or
      // signed build. Expo Go never enters this branch.
      const appleModule = await import('expo-apple-authentication');
      const AppleAuthentication = typeof appleModule.signInAsync === 'function'
        ? appleModule
        : appleModule.default;
      if (!AppleAuthentication || !await AppleAuthentication.isAvailableAsync()) {
        throw createAuthError('APPLE_AUTH_UNAVAILABLE', 'Apple Sign-In is not available on this device.');
      }
      const nonce = createAuthenticationNonce();
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL
        ],
        nonce
      });
      if (!credential.identityToken) throw new Error('Apple Sign-In did not return an identity token.');
      const displayName = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter(Boolean)
        .join(' ') || null;
      const session = await exchangeProviderIdentity({
        provider: 'apple',
        idToken: credential.identityToken,
        nonce,
        displayName
      });
      await persist(session.user, session);
    } catch (error) {
      throw reportAuthenticationFailure('apple', error);
    }
  }, [persist, reportAuthenticationFailure, requireCapability, requireProviderRuntime]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      requireCapability('google');
      await requireProviderRuntime('google');
      const googleModule = await import('@react-native-google-signin/google-signin');
      const GoogleSignin = googleModule.GoogleSignin || googleModule.default?.GoogleSignin;
      if (!GoogleSignin) throw new Error('The native Google Sign-In module is unavailable.');
      GoogleSignin.configure({
        webClientId: config.googleWebClientId,
        ...(Platform.OS === 'ios' ? { iosClientId: config.googleIOSClientId } : {})
      });
      if (Platform.OS === 'android') {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      }
      const identity = googleIdentityFromResponse(await GoogleSignin.signIn());
      if (!identity) throw googleSignInCancellationError();
      if (!identity.identityToken) throw new Error('Google Sign-In did not return an identity token.');
      const session = await exchangeProviderIdentity({
        provider: 'google',
        idToken: identity.identityToken,
        displayName: identity.user.name
      });
      await persist(session.user, session);
    } catch (error) {
      throw reportAuthenticationFailure('google', error);
    }
  }, [persist, reportAuthenticationFailure, requireCapability, requireProviderRuntime]);

  const continueAsDemo = useCallback(async () => {
    if (!await authenticationRuntime.isDemoModeAvailable()) {
      throw createAuthError(
        'DEMO_AUTH_UNAVAILABLE',
        'Demo mode is available only in a VeryLoving development build running on the iOS Simulator.'
      );
    }
    authGenerationRef.current += 1;
    if (refreshRetryTimerRef.current) {
      clearTimeout(refreshRetryTimerRef.current);
      refreshRetryTimerRef.current = null;
    }
    setPendingPhoneVerification(null);
    setAccessToken(null);
    setUser(DEVELOPMENT_DEMO_USER);
    setOnboardingComplete(true);
    setSessionStatus('demo');
    setAuthError(null);
    return DEVELOPMENT_DEMO_USER;
  }, []);

  const signInWithPhone = useCallback(async ({ e164, countryCode }) => {
    setAuthError(null);
    setPendingPhoneVerification(null);
    try {
      requireCapability('phone');
      const phone = createPhoneValue(e164, countryCode);
      if (!phone.isValid) {
        throw createAuthError(
          'PHONE_NUMBER_INVALID',
          translate(`phone.${phone.validationError || 'invalid'}`)
        );
      }
      const challenge = await requestPhoneVerification({
        phone: phone.e164,
        countryCode: phone.countryCode
      });
      setPendingPhoneVerification(challenge);
      return { phone: challenge.phone, countryCode: challenge.countryCode };
    } catch (error) {
      throw reportAuthenticationFailure('phone', error);
    }
  }, [reportAuthenticationFailure, requireCapability]);

  const verifyCode = useCallback(async (code) => {
    setAuthError(null);
    try {
      requireCapability('phone');
      const normalizedCode = String(code || '').trim();
      if (
        !pendingPhoneVerification?.verificationId
        || pendingPhoneVerification.expiresAt <= Date.now()
        || !/^\d{6}$/.test(normalizedCode)
      ) {
        throw createAuthError('PHONE_AUTH_CODE_INVALID', translate('auth.invalidCode'));
      }
      const session = await confirmPhoneVerification({
        verificationId: pendingPhoneVerification.verificationId,
        code: normalizedCode
      });
      await persist(session.user, session);
      setPendingPhoneVerification(null);
    } catch (error) {
      throw reportAuthenticationFailure('phone', error);
    }
  }, [pendingPhoneVerification, persist, reportAuthenticationFailure, requireCapability]);

  const signOut = useCallback(async () => {
    const signedInProvider = user?.provider;
    authGenerationRef.current += 1;
    const authGeneration = authGenerationRef.current;
    if (refreshRetryTimerRef.current) {
      clearTimeout(refreshRetryTimerRef.current);
      refreshRetryTimerRef.current = null;
    }
    if (signedInProvider === 'demo') {
      setUser(null);
      setAccessToken(null);
      setOnboardingComplete(false);
      setSessionStatus('signed-out');
      setAuthError(null);
      setPendingPhoneVerification(null);
      return;
    }
    // Publish the non-sensitive signed-out marker before waiting behind any
    // in-flight Keychain mutation. A process restart must never resurrect the
    // session the user just left.
    await storage.setJSON(SIGNED_OUT_KEY, {
      version: 1,
      signedOutAt: Date.now()
    }).catch(() => {});
    const cleanup = await runSessionMutation(() => invalidatePersistedSession());
    if (authGeneration === authGenerationRef.current) {
      setUser(null);
      setAccessToken(null);
      setOnboardingComplete(false);
      setSessionStatus('signed-out');
      setAuthError(null);
      setPendingPhoneVerification(null);
    }
    if (signedInProvider === 'google' && !isExpoGoRuntime()) {
      import('@react-native-google-signin/google-signin').then((googleModule) => {
        const GoogleSignin = googleModule.GoogleSignin || googleModule.default?.GoogleSignin;
        return GoogleSignin?.signOut?.();
      }).catch((error) => logger.info('[Auth] Google provider sign-out is pending', {
        errorCode: error?.code || error?.name || 'GOOGLE_SIGN_OUT_FAILED'
      }));
    }
    if (cleanup.residualFailures) {
      logger.info('[Auth] Signed-out tombstone is protecting residual secure data', {
        residualFailures: cleanup.residualFailures
      });
    }
  }, [runSessionMutation, user?.provider]);

  const value = useMemo(() => ({
    user,
    accessToken,
    sessionStatus,
    onboardingComplete,
    loading,
    authError,
    authCapabilities,
    isIOSSimulator,
    demoModeAvailable,
    isDemoMode,
    pendingPhoneNumber: pendingPhoneVerification?.phone || null,
    hasPendingPhoneVerification: Boolean(pendingPhoneVerification?.verificationId),
    clearAuthError,
    signInWithApple,
    signInWithGoogle,
    signInWithPhone,
    continueAsDemo,
    verifyCode,
    completeOnboarding,
    signOut
  }), [
    user,
    accessToken,
    sessionStatus,
    onboardingComplete,
    loading,
    authError,
    authCapabilities,
    isIOSSimulator,
    demoModeAvailable,
    isDemoMode,
    pendingPhoneVerification,
    clearAuthError,
    signInWithApple,
    signInWithGoogle,
    signInWithPhone,
    continueAsDemo,
    verifyCode,
    completeOnboarding,
    signOut
  ]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
