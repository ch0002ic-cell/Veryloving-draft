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
  createMockPhoneVerification,
  isValidMockPhoneVerification
} from '../utils/mock-phone-auth';
import {
  createOnboardingMarker,
  isOnboardingMarkerValid
} from '../utils/onboarding-state';
import { exchangeProviderIdentity, refreshApplicationSession } from '../services/auth-session';
import { secureStorage } from '../services/secure-storage';
import { isExpoGoRuntime } from '../utils/runtime-environment';
import {
  createAuthenticationNonce,
  isSessionTokenUsable,
  sessionTokenClaims
} from '../utils/session-token';
const AuthContext = createContext(null);
const TOKEN_KEY = 'veryloving.auth.token';
const REFRESH_TOKEN_KEY = 'veryloving.auth.refreshToken';
const USER_KEY = 'veryloving.auth.user';
const ONBOARDING_KEY = 'veryloving.auth.onboarding';

export const AUTH_STORAGE_KEYS = {
  token: TOKEN_KEY,
  refreshToken: REFRESH_TOKEN_KEY,
  user: USER_KEY,
  onboarding: ONBOARDING_KEY
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [sessionStatus, setSessionStatus] = useState('loading');
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const phoneVerificationsRef = useRef(new Map());
  const refreshInFlightRef = useRef(null);
  const refreshRetryTimerRef = useRef(null);
  const refreshSessionRef = useRef(null);
  const authGenerationRef = useRef(0);

  const scheduleRefreshRetry = useCallback(() => {
    if (refreshRetryTimerRef.current) return;
    refreshRetryTimerRef.current = setTimeout(() => {
      refreshRetryTimerRef.current = null;
      refreshSessionRef.current?.().catch(() => {});
    }, 60000);
  }, []);

  const refreshSession = useCallback((providedRefreshToken) => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const authGeneration = authGenerationRef.current;
    let operation;
    operation = (async () => {
      try {
        const [persistedRefreshToken, persistedAccessToken] = await Promise.all([
          secureStorage.getItemAsync(REFRESH_TOKEN_KEY),
          secureStorage.getItemAsync(TOKEN_KEY)
        ]);
        const refreshToken = providedRefreshToken || persistedRefreshToken;
        if (!refreshToken || !isSessionTokenUsable(refreshToken, { skewSeconds: 60 })) {
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
        // Store the rotated refresh token before publishing the new access
        // token so a process death cannot strand the account on an old pair.
        try {
          await secureStorage.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken);
          await secureStorage.setItemAsync(TOKEN_KEY, session.accessToken);
        } catch (storageError) {
          // SecureStore has no multi-key transaction. Restore the previous pair
          // if either write fails so startup never observes mismatched tokens.
          await Promise.allSettled([
            persistedRefreshToken
              ? secureStorage.setItemAsync(REFRESH_TOKEN_KEY, persistedRefreshToken)
              : secureStorage.deleteItemAsync(REFRESH_TOKEN_KEY),
            persistedAccessToken
              ? secureStorage.setItemAsync(TOKEN_KEY, persistedAccessToken)
              : secureStorage.deleteItemAsync(TOKEN_KEY)
          ]);
          throw storageError;
        }
        setAccessToken(session.accessToken);
        setSessionStatus('active');
        if (refreshRetryTimerRef.current) {
          clearTimeout(refreshRetryTimerRef.current);
          refreshRetryTimerRef.current = null;
        }
        return session;
      } catch (error) {
        if (error?.code === 'AUTH_REFRESH_STALE') throw error;
        const rejected = [
          'AUTH_HTTP_400',
          'AUTH_HTTP_401',
          'AUTH_HTTP_403',
          'AUTH_REFRESH_UNAVAILABLE'
        ].includes(error?.code);
        setAccessToken(null);
        if (rejected) {
          await Promise.allSettled([
            secureStorage.deleteItemAsync(TOKEN_KEY),
            secureStorage.deleteItemAsync(REFRESH_TOKEN_KEY),
            secureStorage.deleteItemAsync(USER_KEY),
            secureStorage.deleteItemAsync(ONBOARDING_KEY)
          ]);
          setUser(null);
          setOnboardingComplete(false);
          setSessionStatus('reauthentication-required');
        } else {
          // Keep the account-bound offline safety state available while the
          // network is down, and retry without treating an outage as logout.
          setSessionStatus('offline');
          scheduleRefreshRetry();
        }
        throw error;
      }
    })().finally(() => {
      if (refreshInFlightRef.current === operation) refreshInFlightRef.current = null;
    });
    refreshInFlightRef.current = operation;
    return operation;
  }, [scheduleRefreshRetry]);
  refreshSessionRef.current = refreshSession;

  useEffect(() => {
    let active = true;
    Promise.all([
      secureStorage.getItemAsync(TOKEN_KEY),
      secureStorage.getItemAsync(REFRESH_TOKEN_KEY),
      secureStorage.getItemAsync(USER_KEY),
      secureStorage.getItemAsync(ONBOARDING_KEY)
    ]).then(async ([token, refreshToken, rawUser, rawOnboarding]) => {
      if (!active) return;
      let savedUser = null;
      try {
        savedUser = rawUser ? JSON.parse(rawUser) : null;
      } catch (error) {
        logger.warn('[Auth] Ignoring an invalid stored profile', error);
      }
      if (token && savedUser && (
        (config.enableMockPhoneAuth && savedUser.provider === 'phone')
        || isSessionTokenUsable(token)
      )) {
        setAccessToken(token);
        setUser(savedUser);
        setSessionStatus('active');
        setOnboardingComplete(isOnboardingMarkerValid(rawOnboarding, savedUser.id));
      } else if (refreshToken && savedUser && isSessionTokenUsable(refreshToken, { skewSeconds: 60 })) {
        setUser(savedUser);
        setOnboardingComplete(isOnboardingMarkerValid(rawOnboarding, savedUser.id));
        try {
          await refreshSession(refreshToken);
        } catch {
          // refreshSession distinguishes a rejected session from a temporary
          // outage and preserves offline state only for the latter.
        }
      } else if (token || refreshToken || rawUser || rawOnboarding) {
        Promise.allSettled([
          secureStorage.deleteItemAsync(TOKEN_KEY),
          secureStorage.deleteItemAsync(REFRESH_TOKEN_KEY),
          secureStorage.deleteItemAsync(USER_KEY),
          secureStorage.deleteItemAsync(ONBOARDING_KEY)
        ]).catch(() => {});
        setSessionStatus('reauthentication-required');
      } else {
        setSessionStatus('signed-out');
      }
    }).catch((error) => {
      logger.warn('[Auth] Could not restore the secure session', error);
      setSessionStatus('signed-out');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [refreshSession]);

  useEffect(() => {
    if (!accessToken || (config.enableMockPhoneAuth && user?.provider === 'phone')) return undefined;
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
  }, [accessToken, refreshSession, user?.provider]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && sessionStatus === 'offline') refreshSession().catch(() => {});
    });
    return () => subscription.remove();
  }, [refreshSession, sessionStatus]);

  useEffect(() => () => {
    if (refreshRetryTimerRef.current) clearTimeout(refreshRetryTimerRef.current);
  }, []);

  const persist = async (nextUser, session) => {
    // A new authentication ceremony always starts fail-closed. The user-bound
    // completion marker is written only after the onboarding flow finishes.
    authGenerationRef.current += 1;
    try {
      await secureStorage.deleteItemAsync(ONBOARDING_KEY);
      if (session.refreshToken) {
        await secureStorage.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken);
      } else {
        await secureStorage.deleteItemAsync(REFRESH_TOKEN_KEY);
      }
      await secureStorage.setItemAsync(TOKEN_KEY, session.accessToken);
      await secureStorage.setItemAsync(USER_KEY, JSON.stringify(nextUser));
    } catch (error) {
      await Promise.allSettled([
        secureStorage.deleteItemAsync(TOKEN_KEY),
        secureStorage.deleteItemAsync(REFRESH_TOKEN_KEY),
        secureStorage.deleteItemAsync(USER_KEY),
        secureStorage.deleteItemAsync(ONBOARDING_KEY)
      ]);
      setUser(null);
      setAccessToken(null);
      setOnboardingComplete(false);
      setSessionStatus('signed-out');
      throw error;
    }
    setUser(nextUser);
    setAccessToken(session.accessToken);
    setSessionStatus('active');
    setOnboardingComplete(false);
  };

  const completeOnboarding = useCallback(async () => {
    if (!user?.id) throw new Error('A signed-in user is required to complete onboarding.');
    const marker = createOnboardingMarker(user.id);
    await secureStorage.setItemAsync(ONBOARDING_KEY, JSON.stringify(marker));
    setOnboardingComplete(true);
  }, [user?.id]);

  const signInWithApple = async () => {
    // Apple Authentication is part of Expo Go. Keep the import lazy so a
    // missing native implementation becomes a handled sign-in error rather
    // than a startup crash; Expo Go identities are not release evidence.
    const AppleAuthentication = require('expo-apple-authentication');
    if (Platform.OS !== 'ios' || !await AppleAuthentication.isAvailableAsync()) {
      throw new Error('Apple Sign-In is not available on this device.');
    }
    const nonce = createAuthenticationNonce();
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce
    });
    if (!credential.identityToken) throw new Error('Apple Sign-In did not return an identity token.');
    const displayName = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ') || null;
    const session = await exchangeProviderIdentity({
      provider: 'apple',
      idToken: credential.identityToken,
      nonce,
      displayName
    });
    await persist(session.user, session);
  };

  const signInWithGoogle = async () => {
    if (isExpoGoRuntime()) {
      const error = new Error('Google Sign-In requires a VeryLoving development build.');
      error.code = 'GOOGLE_AUTH_REQUIRES_DEVELOPMENT_BUILD';
      throw error;
    }
    if (!config.googleWebClientId) {
      throw new Error('Google Sign-In is not configured for this build.');
    }
    const GoogleSignin = require('@react-native-google-signin/google-signin').GoogleSignin;
    GoogleSignin.configure({
      webClientId: config.googleWebClientId,
      ...(config.googleIOSClientId ? { iosClientId: config.googleIOSClientId } : {})
    });
    await GoogleSignin.hasPlayServices?.({ showPlayServicesUpdateDialog: true });
    const identity = googleIdentityFromResponse(await GoogleSignin.signIn());
    if (!identity) throw googleSignInCancellationError();
    if (!identity.identityToken) throw new Error('Google Sign-In did not return an identity token.');
    const session = await exchangeProviderIdentity({
      provider: 'google',
      idToken: identity.identityToken,
      displayName: identity.user.name
    });
    await persist(session.user, session);
  };

  const signInWithPhone = async ({ e164, countryCode }) => {
    if (!config.enableMockPhoneAuth) throw new Error(translate('auth.signInFailedMessage'));
    const phone = createPhoneValue(e164, countryCode);
    if (!phone.isValid) throw new Error(translate(`phone.${phone.validationError || 'invalid'}`));
    const now = Date.now();
    for (const [verificationId, challenge] of phoneVerificationsRef.current) {
      if (challenge.expiresAt <= now) phoneVerificationsRef.current.delete(verificationId);
    }
    const challenge = createMockPhoneVerification({
      phone: phone.e164,
      countryCode: phone.countryCode
    });
    phoneVerificationsRef.current.set(challenge.verificationId, challenge);
    return {
      verificationId: challenge.verificationId,
      phone: challenge.phone,
      countryCode: challenge.countryCode
    };
  };
  const verifyCode = async (verificationId, code) => {
    if (!config.enableMockPhoneAuth) throw new Error(translate('auth.signInFailedMessage'));
    const challenge = phoneVerificationsRef.current.get(verificationId);
    const normalizedCode = String(code || '').trim();
    if (!isValidMockPhoneVerification(challenge, { verificationId, code: normalizedCode })) {
      throw new Error(translate('auth.invalidCode'));
    }
    phoneVerificationsRef.current.delete(verificationId);
    await persist({
      id: `phone:${challenge.phone}`,
      name: null,
      phone: challenge.phone,
      countryCode: challenge.countryCode,
      provider: 'phone'
    }, { accessToken: 'dev-access-token' });
  };

  const signOut = async () => {
    authGenerationRef.current += 1;
    if (refreshRetryTimerRef.current) {
      clearTimeout(refreshRetryTimerRef.current);
      refreshRetryTimerRef.current = null;
    }
    const results = await Promise.allSettled([
      secureStorage.deleteItemAsync(TOKEN_KEY),
      secureStorage.deleteItemAsync(REFRESH_TOKEN_KEY),
      secureStorage.deleteItemAsync(USER_KEY),
      secureStorage.deleteItemAsync(ONBOARDING_KEY)
    ]);
    phoneVerificationsRef.current.clear();
    setUser(null);
    setAccessToken(null);
    setOnboardingComplete(false);
    setSessionStatus('signed-out');
    const failures = results.filter((result) => result.status === 'rejected').length;
    if (failures) throw new Error('The local secure session could not be fully removed.');
  };

  const value = useMemo(() => ({
    user,
    accessToken,
    sessionStatus,
    onboardingComplete,
    loading,
    signInWithApple,
    signInWithGoogle,
    signInWithPhone,
    verifyCode,
    completeOnboarding,
    signOut
  }), [user, accessToken, sessionStatus, onboardingComplete, loading, completeOnboarding]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
