import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useLocales } from 'expo-localization';
import { useAppState } from './AppContext';
import {
  languageOptions,
  resolveLanguage,
  setI18nLocale,
  supportedLanguages,
  SYSTEM_LANGUAGE,
  translateForLocale
} from '../i18n/core';

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const locales = useLocales();
  const { settings, updateSettings } = useAppState();
  const languagePreference = settings.language || SYSTEM_LANGUAGE;
  const locale = resolveLanguage(languagePreference, locales);

  useEffect(() => {
    setI18nLocale(locale);
  }, [locale]);

  const t = useCallback(
    (key, options) => translateForLocale(locale, key, options),
    [locale]
  );

  const setLanguage = useCallback((language) => {
    const valid = language === SYSTEM_LANGUAGE || supportedLanguages.includes(language);
    if (!valid) throw new Error(`Unsupported interface language: ${language}`);
    return updateSettings({ language });
  }, [updateSettings]);

  const value = useMemo(() => ({
    languageOptions,
    languagePreference,
    locale,
    setLanguage,
    t
  }), [languagePreference, locale, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}
