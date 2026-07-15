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
  COMPLETION_ONBOARDING_ROUTE,
  createOnboardingProgress,
  createOnboardingMarker,
  INITIAL_ONBOARDING_ROUTE,
  isOnboardingMarkerValid,
  nextOnboardingProgress,
  parseOnboardingProgress
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
  authenticationErrorTranslationKey,
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
import { withTimeout } from '../utils/async';
import {
  createPhoneVerificationState,
  parsePhoneVerificationState,
  restorePhoneVerificationState
} from '../utils/phone-verification-state';
import { ensureAccountDataOwner } from '../services/account-data-boundary';
const AuthContext = createContext(null);
const SESSION_KEY = 'veryloving.auth.session.v1';
const SIGNED_OUT_KEY = 'veryloving.auth.signedOut';
const LEGACY_TOKEN_KEY = 'veryloving.auth.token';
const LEGACY_REFRESH_TOKEN_KEY = 'veryloving.auth.refreshToken';
const LEGACY_USER_KEY = 'veryloving.auth.user';
const ONBOARDING_KEY = 'veryloving.auth.onboarding';
const ONBOARDING_PROGRESS_KEY = 'veryloving.auth.onboardingProgress.v1';
const PHONE_VERIFICATION_KEY = 'veryloving.auth.phoneVerification.v1';
const AUTH_RESTORE_TIMEOUT_MS = 12000;
const PROVIDER_SIGN_OUT_TIMEOUT_MS = 5000;
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
  onboarding: ONBOARDING_KEY,
  onboardingProgress: ONBOARDING_PROGRESS_KEY,
  phoneVerification: PHONE_VERIFICATION_KEY
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
    secureStorage.deleteItemAsync(ONBOARDING_PROGRESS_KEY),
    secureStorage.deleteItemAsync(PHONE_VERIFICATION_KEY),
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
  const [onboardingRoute, setOnboardingRoute] = useState(INITIAL_ONBOARDING_ROUTE);
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
  const onboardingProgressRef = useRef(null);
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
            onboardingProgressRef.current = null;
            setOnboardingRoute(INITIAL_ONBOARDING_ROUTE);
            setAuthError('releaseCritical.authSessionExpired');
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
    withTimeout(Promise.all([
      storage.getRaw(SIGNED_OUT_KEY),
      secureStorage.getItemAsync(SESSION_KEY),
      secureStorage.getItemAsync(ONBOARDING_KEY),
      secureStorage.getItemAsync(ONBOARDING_PROGRESS_KEY),
      secureStorage.getItemAsync(PHONE_VERIFICATION_KEY),
      secureStorage.getItemAsync(LEGACY_TOKEN_KEY),
      secureStorage.getItemAsync(LEGACY_REFRESH_TOKEN_KEY),
      secureStorage.getItemAsync(LEGACY_USER_KEY)
    ]), AUTH_RESTORE_TIMEOUT_MS, 'Secure session restoration timed out.').then(async ([
      signedOutMarker,
      rawEnvelope,
      rawOnboarding,
      rawOnboardingProgress,
      rawPhoneVerification,
      legacyToken,
      legacyRefresh,
      legacyUser
    ]) => {
      if (!active || authGeneration !== authGenerationRef.current) return;
      if (signedOutMarker) {
        const postSignOutPhoneVerification = restorePhoneVerificationState(
          rawPhoneVerification,
          { signedOutMarker }
        );
        await runSessionMutation(() => Promise.allSettled([
          secureStorage.deleteItemAsync(SESSION_KEY),
          secureStorage.deleteItemAsync(ONBOARDING_KEY),
          secureStorage.deleteItemAsync(ONBOARDING_PROGRESS_KEY),
          ...(postSignOutPhoneVerification
            ? []
            : [secureStorage.deleteItemAsync(PHONE_VERIFICATION_KEY)]),
          ...LEGACY_SESSION_KEYS.map((key) => secureStorage.deleteItemAsync(key))
        ]));
        if (active && authGeneration === authGenerationRef.current) {
          onboardingProgressRef.current = null;
          setOnboardingRoute(INITIAL_ONBOARDING_ROUTE);
          setPendingPhoneVerification(postSignOutPhoneVerification);
          setSessionStatus('signed-out');
        }
        return;
      }

      const restoredPhoneVerification = parsePhoneVerificationState(rawPhoneVerification);
      setPendingPhoneVerification(restoredPhoneVerification);
      if (rawPhoneVerification && !restoredPhoneVerification) {
        secureStorage.deleteItemAsync(PHONE_VERIFICATION_KEY).catch(() => {});
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

      // Never publish an authenticated profile until every device-local data
      // surface is either owned by this account or has been cleared. This also
      // handles a process that was killed after writing the sign-out tombstone
      // but before Settings finished its best-effort local cleanup.
      if (envelope?.user?.id) {
        const boundary = await ensureAccountDataOwner(envelope.user.id);
        if (boundary.warnings) logger.warn('[Auth] Local account isolation completed with cleanup warnings', {
          warningCount: boundary.warnings
        });
      }

      if (envelope && isSessionTokenUsable(envelope.accessToken)) {
        const complete = isOnboardingMarkerValid(rawOnboarding, envelope.user.id);
        const progress = complete
          ? createOnboardingProgress(envelope.user.id, COMPLETION_ONBOARDING_ROUTE)
          : parseOnboardingProgress(rawOnboardingProgress, envelope.user.id)
            || createOnboardingProgress(envelope.user.id);
        setAccessToken(envelope.accessToken);
        setUser(envelope.user);
        setSessionStatus('active');
        onboardingProgressRef.current = progress;
        setOnboardingRoute(progress.route);
        setOnboardingComplete(complete);
      } else if (envelope) {
        const complete = isOnboardingMarkerValid(rawOnboarding, envelope.user.id);
        const progress = complete
          ? createOnboardingProgress(envelope.user.id, COMPLETION_ONBOARDING_ROUTE)
          : parseOnboardingProgress(rawOnboardingProgress, envelope.user.id)
            || createOnboardingProgress(envelope.user.id);
        setUser(envelope.user);
        onboardingProgressRef.current = progress;
        setOnboardingRoute(progress.route);
        setOnboardingComplete(complete);
        try {
          await refreshSession(envelope.refreshToken);
        } catch {
          // refreshSession distinguishes a rejected session from a temporary
          // outage and preserves offline state only for the latter.
        }
      } else if (rawEnvelope || legacyToken || legacyRefresh || legacyUser || rawOnboarding || rawOnboardingProgress) {
        await runSessionMutation(() => invalidatePersistedSession());
        if (active && authGeneration === authGenerationRef.current) {
          onboardingProgressRef.current = null;
          setOnboardingRoute(INITIAL_ONBOARDING_ROUTE);
          setAuthError('releaseCritical.authSessionExpired');
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
      onboardingProgressRef.current = null;
      setOnboardingRoute(INITIAL_ONBOARDING_ROUTE);
      setAuthError('auth.signInFailedMessage');
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
      secureStorage.deleteItemAsync(PHONE_VERIFICATION_KEY).catch(() => {});
      return undefined;
    }
    const timer = setTimeout(() => {
      setPendingPhoneVerification(null);
      secureStorage.deleteItemAsync(PHONE_VERIFICATION_KEY).catch(() => {});
    }, remaining);
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
    const initialProgress = createOnboardingProgress(nextEnvelope.user.id);
    const serializedEnvelope = JSON.stringify(nextEnvelope);
    const boundary = await ensureAccountDataOwner(nextEnvelope.user.id);
    if (boundary.warnings) logger.warn('[Auth] Local account isolation completed with cleanup warnings', {
      warningCount: boundary.warnings
    });
    if (authGeneration !== authGenerationRef.current) {
      throw createAuthError('AUTH_OPERATION_CANCELLED', 'Authentication was superseded.');
    }
    await runSessionMutation(async () => {
      if (authGeneration !== authGenerationRef.current) {
        throw createAuthError('AUTH_OPERATION_CANCELLED', 'Authentication was superseded.');
      }
      try {
        await secureStorage.deleteItemAsync(ONBOARDING_KEY);
        await secureStorage.setItemAsync(SESSION_KEY, serializedEnvelope);
        await secureStorage.setItemAsync(ONBOARDING_PROGRESS_KEY, JSON.stringify(initialProgress));
        await secureStorage.deleteItemAsync(PHONE_VERIFICATION_KEY);
        await storage.remove(SIGNED_OUT_KEY);
        await removeLegacySessionKeys();
      } catch (error) {
        await invalidatePersistedSession().catch(() => {});
        if (authGeneration === authGenerationRef.current) {
          setUser(null);
          setAccessToken(null);
          setOnboardingComplete(false);
          onboardingProgressRef.current = null;
          setOnboardingRoute(INITIAL_ONBOARDING_ROUTE);
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
      onboardingProgressRef.current = initialProgress;
      setOnboardingRoute(initialProgress.route);
      setOnboardingComplete(false);
      setPendingPhoneVerification(null);
      setAuthError(null);
    });
  }, [runSessionMutation]);

  const advanceOnboarding = useCallback(async (nextRoute) => {
    if (!user?.id) throw new Error('A signed-in user is required to continue onboarding.');
    const authGeneration = authGenerationRef.current;
    return runSessionMutation(async () => {
      if (authGeneration !== authGenerationRef.current) {
        throw createAuthError('AUTH_OPERATION_CANCELLED', 'Authentication was superseded.');
      }
      const nextProgress = nextOnboardingProgress(
        onboardingProgressRef.current,
        user.id,
        nextRoute
      );
      if (nextProgress !== onboardingProgressRef.current) {
        await secureStorage.setItemAsync(ONBOARDING_PROGRESS_KEY, JSON.stringify(nextProgress));
      }
      if (authGeneration === authGenerationRef.current) {
        onboardingProgressRef.current = nextProgress;
        setOnboardingRoute(nextProgress.route);
      }
      return nextProgress.route;
    });
  }, [runSessionMutation, user?.id]);

  const completeOnboarding = useCallback(async () => {
    if (!user?.id) throw new Error('A signed-in user is required to complete onboarding.');
    if (onboardingProgressRef.current?.route !== COMPLETION_ONBOARDING_ROUTE) {
      const error = new Error('Complete the required onboarding steps before continuing.');
      error.code = 'ONBOARDING_INCOMPLETE';
      throw error;
    }
    const authGeneration = authGenerationRef.current;
    const marker = createOnboardingMarker(user.id);
    await runSessionMutation(async () => {
      if (authGeneration !== authGenerationRef.current) {
        throw createAuthError('AUTH_OPERATION_CANCELLED', 'Authentication was superseded.');
      }
      await secureStorage.setItemAsync(ONBOARDING_KEY, JSON.stringify(marker));
      await secureStorage.deleteItemAsync(ONBOARDING_PROGRESS_KEY).catch((error) => {
        logger.warn('[Auth] Completed onboarding progress cleanup is pending', {
          errorCode: error?.code || error?.name || 'ONBOARDING_PROGRESS_CLEANUP_FAILED'
        });
      });
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
    setAuthError(authenticationErrorTranslationKey(safeError));
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
    const authGeneration = authGenerationRef.current;
    if (refreshRetryTimerRef.current) {
      clearTimeout(refreshRetryTimerRef.current);
      refreshRetryTimerRef.current = null;
    }
    const boundary = await ensureAccountDataOwner(DEVELOPMENT_DEMO_USER.id);
    if (boundary.warnings) logger.warn('[Auth] Local account isolation completed with cleanup warnings', {
      warningCount: boundary.warnings
    });
    if (authGenerationRef.current !== authGeneration) {
      throw createAuthError('AUTH_OPERATION_CANCELLED', 'Authentication was superseded.');
    }
    setPendingPhoneVerification(null);
    await secureStorage.deleteItemAsync(PHONE_VERIFICATION_KEY).catch(() => {});
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
      await secureStorage.deleteItemAsync(PHONE_VERIFICATION_KEY);
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
      const persistedChallenge = createPhoneVerificationState(challenge);
      if (!persistedChallenge) {
        throw createAuthError('AUTH_RESPONSE_INVALID', 'The phone verification server returned an invalid challenge.');
      }
      await secureStorage.setItemAsync(PHONE_VERIFICATION_KEY, JSON.stringify(persistedChallenge));
      setPendingPhoneVerification(persistedChallenge);
      return { phone: persistedChallenge.phone, countryCode: persistedChallenge.countryCode };
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
      onboardingProgressRef.current = null;
      setOnboardingRoute(INITIAL_ONBOARDING_ROUTE);
      setSessionStatus('signed-out');
      setAuthError(null);
      setPendingPhoneVerification(null);
      await secureStorage.deleteItemAsync(PHONE_VERIFICATION_KEY).catch(() => {});
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
      onboardingProgressRef.current = null;
      setOnboardingRoute(INITIAL_ONBOARDING_ROUTE);
      setSessionStatus('signed-out');
      setAuthError(null);
      setPendingPhoneVerification(null);
    }
    if (signedInProvider === 'google' && !isExpoGoRuntime()) {
      try {
        await withTimeout(
          import('@react-native-google-signin/google-signin').then((googleModule) => {
            const GoogleSignin = googleModule.GoogleSignin || googleModule.default?.GoogleSignin;
            return GoogleSignin?.signOut?.();
          }),
          PROVIDER_SIGN_OUT_TIMEOUT_MS,
          'Google provider sign-out timed out.'
        );
      } catch (error) {
        // Local credentials and account-bound data are already cleared. A
        // native provider failure must not resurrect the app session, but
        // awaiting it here prevents an immediate re-login from racing a late
        // Google SDK sign-out.
        logger.info('[Auth] Google provider sign-out could not be confirmed', {
          errorCode: error?.code || error?.name || 'GOOGLE_SIGN_OUT_FAILED'
        });
      }
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
    onboardingRoute,
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
    advanceOnboarding,
    completeOnboarding,
    signOut
  }), [
    user,
    accessToken,
    sessionStatus,
    onboardingComplete,
    onboardingRoute,
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
    advanceOnboarding,
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
