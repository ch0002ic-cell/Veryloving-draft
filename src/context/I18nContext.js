import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { reloadAppAsync } from 'expo';
import Constants from 'expo-constants';
import { useLocales } from 'expo-localization';
import { I18nManager, Platform } from 'react-native';
import { useAppState } from './AppContext';
import {
  isRTLLanguage,
  languageOptions,
  resolveLanguage,
  setI18nLocale,
  supportedLanguages,
  SYSTEM_LANGUAGE,
  translateForLocale
} from '../i18n/core';
import { logger } from '../utils/logger';

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const locales = useLocales();
  const { isHydrated, settings, updateSettings } = useAppState();
  const languagePreference = settings.language || SYSTEM_LANGUAGE;
  const locale = resolveLanguage(languagePreference, locales);
  const isRTL = isRTLLanguage(locale);

  useEffect(() => {
    setI18nLocale(locale);
    if (!isHydrated || Platform.OS === 'web' || I18nManager.isRTL === isRTL) return;
    if (Constants.executionEnvironment === 'storeClient') {
      logger.warn('[I18n] RTL direction changes require a development build or standalone app');
      return;
    }
    I18nManager.allowRTL(true);
    I18nManager.swapLeftAndRightInRTL(true);
    I18nManager.forceRTL(isRTL);
    reloadAppAsync(`Interface direction changed to ${isRTL ? 'RTL' : 'LTR'}`).catch((error) => {
      logger.warn('[I18n] Layout direction will update on the next app launch', error);
    });
  }, [isHydrated, isRTL, locale]);

  const t = useCallback(
    (key, options) => translateForLocale(locale, key, options),
    [locale]
  );

  const setLanguage = useCallback(async (language) => {
    const valid = language === SYSTEM_LANGUAGE || supportedLanguages.includes(language);
    if (!valid) throw new Error(`Unsupported interface language: ${language}`);
    await updateSettings({ language });
  }, [updateSettings]);

  const value = useMemo(() => ({
    languageOptions,
    languagePreference,
    locale,
    isRTL,
    setLanguage,
    t
  }), [isRTL, languagePreference, locale, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}
