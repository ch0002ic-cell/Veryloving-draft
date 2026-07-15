import { I18n } from 'i18n-js';
import languageCatalog from './languages';
import releaseCriticalMessages from './release-critical-messages';

export const DEFAULT_LANGUAGE = 'en';
export const SYSTEM_LANGUAGE = 'system';
export const TRANSLATION_FALLBACK_ENABLED = false;
export const RTL_QA_LANGUAGE_CODES = Object.freeze(['ar', 'he']);
export const RTL_QA_LANGUAGES_ENABLED = process.env.EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES === 'true';
export const catalogLanguages = languageCatalog
  .filter((language) => language.messages)
  .map((language) => language.code);
export const maintainedLanguages = languageCatalog
  .filter((language) => language.messages && language.reviewRequired === false)
  .map((language) => language.code);

export function selectRuntimeLanguageCodes({ enableRTLQA = RTL_QA_LANGUAGES_ENABLED } = {}) {
  const allowed = new Set([
    ...maintainedLanguages,
    ...(enableRTLQA ? RTL_QA_LANGUAGE_CODES : [])
  ]);
  return languageCatalog
    .filter((language) => language.messages && allowed.has(language.code))
    .map((language) => language.code);
}

export const supportedLanguages = selectRuntimeLanguageCodes();
export const translations = Object.fromEntries(
  languageCatalog
    .filter((language) => supportedLanguages.includes(language.code))
    .map((language) => [language.code, {
      ...language.messages,
      releaseCritical: releaseCriticalMessages[language.code]
    }])
);
export const languageOptions = languageCatalog
  .filter((language) => language.code === SYSTEM_LANGUAGE || supportedLanguages.includes(language.code))
  .map(({ messages, ...language }) => language);

const i18n = new I18n(translations);
i18n.defaultLocale = DEFAULT_LANGUAGE;
i18n.enableFallback = TRANSLATION_FALLBACK_ENABLED;
i18n.locale = DEFAULT_LANGUAGE;

const TRADITIONAL_CHINESE_REGIONS = new Set(['tw', 'hk', 'mo']);

function requestsUnsupportedTraditionalChinese(normalized) {
  const subtags = normalized.split('-');
  if (subtags[0] !== 'zh') return false;
  const script = subtags.find((subtag) => /^[a-z]{4}$/.test(subtag));
  if (script === 'hans') return false;
  if (script === 'hant') return true;
  return subtags.some((subtag) => TRADITIONAL_CHINESE_REGIONS.has(subtag));
}

export function normalizeLanguageCode(languageTag) {
  if (!languageTag) return null;
  const normalized = String(languageTag).trim().replace(/_/g, '-').toLowerCase();
  // The only maintained Chinese catalog is explicitly Simplified Chinese.
  // Falling back from a Traditional script/region tag would present the wrong
  // writing system while claiming to honor the device locale.
  if (requestsUnsupportedTraditionalChinese(normalized)) return null;
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
