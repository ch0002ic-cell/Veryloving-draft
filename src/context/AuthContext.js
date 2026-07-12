import * as AppleAuthentication from 'expo-apple-authentication';
import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { logger } from '../utils/logger';
import { translate } from '../i18n/core';
import { createPhoneValue } from '../utils/phone';
import { config } from '../utils/config';
import {
  googleIdentityFromResponse,
  googleSignInCancellationError,
  isGoogleSignInCancellation
} from '../utils/google-auth';

const AuthContext = createContext(null);
const TOKEN_KEY = 'veryloving.auth.token';
const USER_KEY = 'veryloving.auth.user';

export const AUTH_STORAGE_KEYS = {
  token: TOKEN_KEY,
  user: USER_KEY
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      SecureStore.getItemAsync(USER_KEY)
    ]).then(([token, rawUser]) => {
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
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    try {
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextUser));
    } catch (error) {
      await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
      throw error;
    }
    setUser(nextUser);
    setAccessToken(token);
  };

  const signInWithApple = async () => {
    if (Platform.OS !== 'ios') {
      return persist({ id: 'dev-apple', name: 'Grace', provider: 'apple' }, 'dev-access-token');
    }
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL]
    });
    await persist({ id: credential.user, name: credential.fullName?.givenName || null, provider: 'apple' }, credential.identityToken || 'apple-token');
  };

  const signInWithGoogle = async () => {
    try {
      const GoogleSignin = require('@react-native-google-signin/google-signin').GoogleSignin;
      GoogleSignin.configure(config.googleWebClientId ? { webClientId: config.googleWebClientId } : {});
      await GoogleSignin.hasPlayServices?.({ showPlayServicesUpdateDialog: true });
      const identity = googleIdentityFromResponse(await GoogleSignin.signIn());
      if (!identity) throw googleSignInCancellationError();
      if (!identity.identityToken && !__DEV__) {
        throw new Error('Google Sign-In did not return an identity token.');
      }
      await persist(identity.user, identity.identityToken || 'dev-google-token');
    } catch (error) {
      if (isGoogleSignInCancellation(error)) throw error;
      if (!__DEV__) throw error;
      logger.warn('[Auth] Google Sign-In fallback', error);
      Alert.alert(translate('auth.googleUnavailableTitle'), translate('auth.googleUnavailableMessage'));
      await persist({ id: 'dev-google', name: 'Grace', provider: 'google' }, 'dev-access-token');
    }
  };

  const signInWithPhone = async ({ e164, countryCode }) => {
    const phone = createPhoneValue(e164, countryCode);
    if (!phone.isValid) throw new Error(translate(`phone.${phone.validationError || 'invalid'}`));
    return { verificationId: `dev-${phone.e164}`, phone: phone.e164, countryCode: phone.countryCode };
  };
  const verifyCode = async (_verificationId, code, phoneDetails = {}) => {
    if (!code || code.length < 4) throw new Error(translate('auth.invalidCode'));
    await persist({
      id: 'phone-user',
      name: null,
      phone: phoneDetails.phone,
      countryCode: phoneDetails.countryCode,
      provider: 'phone'
    }, 'dev-access-token');
  };

  const signOut = async () => {
    setUser(null);
    setAccessToken(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
  };

  const value = useMemo(() => ({ user, accessToken, loading, signInWithApple, signInWithGoogle, signInWithPhone, verifyCode, signOut }), [user, accessToken, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
