import { I18n } from 'i18n-js';
import languageCatalog from './languages';

export const DEFAULT_LANGUAGE = 'en';
export const SYSTEM_LANGUAGE = 'system';
export const translations = Object.fromEntries(
  languageCatalog.filter((language) => language.messages).map((language) => [language.code, language.messages])
);
export const languageOptions = languageCatalog
  .filter((language) => language.code === SYSTEM_LANGUAGE || language.messages)
  .map(({ messages, ...language }) => language);
export const supportedLanguages = languageCatalog
  .filter((language) => language.messages)
  .map((language) => language.code);

const i18n = new I18n(translations);
i18n.defaultLocale = DEFAULT_LANGUAGE;
i18n.enableFallback = true;
i18n.locale = DEFAULT_LANGUAGE;

export function normalizeLanguageCode(languageTag) {
  if (!languageTag) return null;
  const normalized = String(languageTag).trim().replace(/_/g, '-').toLowerCase();
  if (supportedLanguages.includes(normalized)) return normalized;
  const baseLanguage = normalized.split('-')[0];
  return supportedLanguages.includes(baseLanguage) ? baseLanguage : null;
}

export function resolveLanguage(preference = SYSTEM_LANGUAGE, locales = []) {
  const preferred = preference === SYSTEM_LANGUAGE ? null : normalizeLanguageCode(preference);
  if (preferred) return preferred;

  for (const locale of locales || []) {
    const resolved = normalizeLanguageCode(locale?.languageTag || locale?.languageCode || locale);
    if (resolved) return resolved;
  }
  return DEFAULT_LANGUAGE;
}

export function isRTLLanguage(languageTag) {
  if (!languageTag) return false;
  const code = String(languageTag).trim().replace(/_/g, '-').toLowerCase().split('-')[0];
  return Boolean(languageCatalog.find((language) => language.code === code)?.isRTL);
}

export function setI18nLocale(locale) {
  i18n.locale = normalizeLanguageCode(locale) || DEFAULT_LANGUAGE;
  return i18n.locale;
}

export function translate(key, options = {}) {
  return i18n.t(key, options);
}

export function translateForLocale(locale, key, options = {}) {
  return i18n.t(key, { ...options, locale: normalizeLanguageCode(locale) || DEFAULT_LANGUAGE });
}

export function getTranslationKeys(value, prefix = '') {
  return Object.entries(value || {}).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      return getTranslationKeys(child, path);
    }
    return [path];
  }).sort();
}
