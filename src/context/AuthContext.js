import * as AppleAuthentication from 'expo-apple-authentication';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
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

const AuthContext = createContext(null);
const TOKEN_KEY = 'veryloving.auth.token';
const USER_KEY = 'veryloving.auth.user';
const ONBOARDING_KEY = 'veryloving.auth.onboarding';

export const AUTH_STORAGE_KEYS = {
  token: TOKEN_KEY,
  user: USER_KEY,
  onboarding: ONBOARDING_KEY
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const phoneVerificationsRef = useRef(new Map());

  useEffect(() => {
    let active = true;
    Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      SecureStore.getItemAsync(USER_KEY),
      SecureStore.getItemAsync(ONBOARDING_KEY)
    ]).then(([token, rawUser, rawOnboarding]) => {
      if (!active) return;
      let savedUser = null;
      try {
        savedUser = rawUser ? JSON.parse(rawUser) : null;
      } catch (error) {
        logger.warn('[Auth] Ignoring an invalid stored profile', error);
      }
      if (token && savedUser) {
        setAccessToken(token);
        setUser(savedUser);
        setOnboardingComplete(isOnboardingMarkerValid(rawOnboarding, savedUser.id));
      }
    }).catch((error) => {
      logger.warn('[Auth] Could not restore the secure session', error);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const persist = async (nextUser, token) => {
    // A new authentication ceremony always starts fail-closed. The user-bound
    // completion marker is written only after the onboarding flow finishes.
    await SecureStore.deleteItemAsync(ONBOARDING_KEY);
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    try {
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextUser));
    } catch (error) {
      await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
      throw error;
    }
    setUser(nextUser);
    setAccessToken(token);
    setOnboardingComplete(false);
  };

  const completeOnboarding = useCallback(async () => {
    if (!user?.id) throw new Error('A signed-in user is required to complete onboarding.');
    const marker = createOnboardingMarker(user.id);
    await SecureStore.setItemAsync(ONBOARDING_KEY, JSON.stringify(marker));
    setOnboardingComplete(true);
  }, [user?.id]);

  const signInWithApple = async () => {
    if (Platform.OS !== 'ios' || !await AppleAuthentication.isAvailableAsync()) {
      throw new Error('Apple Sign-In is not available on this device.');
    }
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL]
    });
    if (!credential.identityToken) throw new Error('Apple Sign-In did not return an identity token.');
    await persist({
      id: credential.user,
      name: credential.fullName?.givenName || null,
      email: credential.email || null,
      provider: 'apple'
    }, credential.identityToken);
  };

  const signInWithGoogle = async () => {
    const GoogleSignin = require('@react-native-google-signin/google-signin').GoogleSignin;
    GoogleSignin.configure(config.googleWebClientId ? { webClientId: config.googleWebClientId } : {});
    await GoogleSignin.hasPlayServices?.({ showPlayServicesUpdateDialog: true });
    const identity = googleIdentityFromResponse(await GoogleSignin.signIn());
    if (!identity) throw googleSignInCancellationError();
    if (!identity.identityToken) throw new Error('Google Sign-In did not return an identity token.');
    await persist(identity.user, identity.identityToken);
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
    }, 'dev-access-token');
  };

  const signOut = async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
      SecureStore.deleteItemAsync(ONBOARDING_KEY)
    ]);
    phoneVerificationsRef.current.clear();
    setUser(null);
    setAccessToken(null);
    setOnboardingComplete(false);
  };

  const value = useMemo(() => ({
    user,
    accessToken,
    onboardingComplete,
    loading,
    signInWithApple,
    signInWithGoogle,
    signInWithPhone,
    verifyCode,
    completeOnboarding,
    signOut
  }), [user, accessToken, onboardingComplete, loading, completeOnboarding]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
