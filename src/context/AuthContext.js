import * as AppleAuthentication from 'expo-apple-authentication';
import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { logger } from '../utils/logger';
import { translate } from '../i18n/core';
import { createPhoneValue } from '../utils/phone';

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
    (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      const rawUser = await SecureStore.getItemAsync(USER_KEY);
      if (token) setAccessToken(token);
      if (rawUser) setUser(JSON.parse(rawUser));
      setLoading(false);
    })();
  }, []);

  const persist = async (nextUser, token) => {
    setUser(nextUser);
    setAccessToken(token);
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextUser));
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
      GoogleSignin.configure();
      await GoogleSignin.hasPlayServices?.();
      const result = await GoogleSignin.signIn();
      await persist({ id: result.user.id, name: result.user.name, email: result.user.email, provider: 'google' }, result.idToken || 'google-token');
    } catch (error) {
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
