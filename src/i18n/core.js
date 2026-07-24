import { I18n } from 'i18n-js';
import languageCatalog from './languages';

export const DEFAULT_LANGUAGE = 'en';
export const SYSTEM_LANGUAGE = 'system';
export const TRANSLATION_FALLBACK_ENABLED = false;
export const RTL_QA_LANGUAGE_CODES = Object.freeze(['ar', 'he']);
export const RTL_QA_LANGUAGES_ENABLED = process.env.EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES === 'true';
export const ALL_CATALOG_LANGUAGES_REQUESTED = process.env.EXPO_PUBLIC_SHOW_ALL_LANGUAGES === 'true';
const DEVELOPMENT_CATALOG_AUDIT_ENABLED = typeof __DEV__ !== 'undefined' && __DEV__ === true;
// Interactive development always exposes the complete catalog so a normal
// `npx expo start` session cannot silently look like a five-language product.
// Signed TestFlight audit bundles run with __DEV__ false and therefore still
// require the reviewed profile flag. Public production remains gated to
// native-speaker-approved catalogs.
export const ALL_CATALOG_LANGUAGES_ENABLED = ALL_CATALOG_LANGUAGES_REQUESTED
  || DEVELOPMENT_CATALOG_AUDIT_ENABLED;
export const catalogLanguages = languageCatalog
  .filter((language) => language.messages)
  .map((language) => language.code);
export const maintainedLanguages = languageCatalog
  .filter((language) => language.messages && language.reviewRequired === false)
  .map((language) => language.code);

export function selectRuntimeLanguageCodes({
  enableRTLQA = RTL_QA_LANGUAGES_ENABLED,
  showAllCatalogs = ALL_CATALOG_LANGUAGES_ENABLED
} = {}) {
  // Full-catalog selection is an explicitly configured QA surface. Public
  // production remains fail-closed in app.config.js, the environment
  // validator, and the committed EAS profiles.
  if (showAllCatalogs) return [...catalogLanguages];
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
    .map((language) => [language.code, language.messages])
);
export const languageOptions = languageCatalog
  .filter((language) => language.code === SYSTEM_LANGUAGE || supportedLanguages.includes(language.code))
  .map(({ messages, ...language }) => language);
const languageRecordsByCode = new Map(
  languageCatalog.map((language) => [language.code, language])
);

function normalizeLanguageSearchValue(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    // Search results must not change with the device's current casing locale
    // (notably Turkish/Azeri dotted and dotless I behavior).
    .toLowerCase();
}

export function filterLanguageOptions(options, query, systemLabel = '') {
  const normalized = normalizeLanguageSearchValue(query).trim();
  const safeOptions = Array.isArray(options) ? options : [];
  if (!normalized) return safeOptions;
  return safeOptions.filter((language) => [
    language.code,
    language.nativeLocaleTag,
    language.nativeName,
    language.englishName,
    language.code === SYSTEM_LANGUAGE ? systemLabel : ''
  ].filter(Boolean).some((value) => normalizeLanguageSearchValue(value).includes(normalized)));
}

export function selectLanguageOption(options, preference, resolvedLocale = DEFAULT_LANGUAGE) {
  const safeOptions = Array.isArray(options) ? options : [];
  return safeOptions.find((language) => language?.code === preference)
    || safeOptions.find((language) => language?.code === resolvedLocale)
    || safeOptions.find((language) => language?.code === DEFAULT_LANGUAGE)
    || safeOptions[0]
    || null;
}

const i18n = new I18n(translations);
i18n.defaultLocale = DEFAULT_LANGUAGE;
i18n.enableFallback = TRANSLATION_FALLBACK_ENABLED;
i18n.locale = DEFAULT_LANGUAGE;

const TRADITIONAL_CHINESE_REGIONS = new Set(['tw', 'hk', 'mo']);
const SORANI_KURDISH_REGIONS = new Set(['iq', 'ir']);
const LANGUAGE_CODE_ALIASES = Object.freeze({
  // Modern platform/BCP-47 identifiers whose catalog uses the corresponding
  // assigned ISO 639-1 identifier.
  fil: 'tl',
  // The shipped Kurdish catalog is specifically Sorani rather than the
  // unrelated Latin-script Kurmanji catalog implied by generic `ku`.
  ckb: 'ku',
  // Deprecated identifiers still returned by older Android/ICU versions.
  in: 'id',
  iw: 'he',
  ji: 'yi',
  jw: 'jv',
  mo: 'ro'
});

function requestsUnsupportedTraditionalChinese(normalized) {
  const subtags = normalized.split('-');
  if (subtags[0] !== 'zh') return false;
  const script = subtags.find((subtag) => /^[a-z]{4}$/.test(subtag));
  if (script === 'hans') return false;
  if (script === 'hant') return true;
  return subtags.some((subtag) => TRADITIONAL_CHINESE_REGIONS.has(subtag));
}

const catalogScriptCache = new Map();

function catalogScript(language) {
  if (!language) return null;
  if (typeof language.localeScript === 'string' && language.localeScript.trim()) {
    return language.localeScript.trim().toLowerCase();
  }
  if (catalogScriptCache.has(language.code)) return catalogScriptCache.get(language.code);
  let script = null;
  try {
    const Locale = globalThis.Intl?.Locale;
    script = typeof Locale === 'function'
      ? new Locale(language.nativeLocaleTag || language.code).maximize().script?.toLowerCase() || null
      : null;
  } catch {
    script = null;
  }
  catalogScriptCache.set(language.code, script);
  return script;
}

function requestedScriptForTag(normalized, subtags) {
  const explicit = subtags.find((subtag) => /^[a-z]{4}$/.test(subtag));
  if (explicit) return explicit;
  const hasRegion = subtags.slice(1).some((subtag) => (
    /^[a-z]{2}$/.test(subtag) || /^\d{3}$/.test(subtag)
  ));
  if (!hasRegion) return null;
  try {
    const Locale = globalThis.Intl?.Locale;
    return typeof Locale === 'function'
      ? new Locale(normalized).maximize().script?.toLowerCase() || null
      : null;
  } catch {
    return null;
  }
}

function catalogRecordForLanguageTag(languageTag) {
  if (!languageTag) return null;
  let normalized;
  try {
    normalized = String(languageTag).trim().replace(/_/g, '-').toLowerCase();
  } catch {
    return null;
  }
  if (!normalized || normalized.length > 100) return null;
  // The only maintained Chinese catalog is explicitly Simplified Chinese.
  // Falling back from a Traditional script/region tag would present the wrong
  // writing system while claiming to honor the device locale.
  if (requestsUnsupportedTraditionalChinese(normalized)) return null;
  const subtags = normalized.split('-');
  // Bare `ku` is the language-family identifier most platforms use for
  // Latin-script Kurmanji, while this app's `ku` catalog is specifically
  // Arabic-script Sorani. External/system locale boundaries must therefore be
  // explicit (`ckb`, `ckb-Arab`, `ku-Arab`, or a Sorani region such as
  // `ku-IQ`) rather than silently relabeling Kurmanji as Sorani.
  if (subtags[0] === 'ku') {
    const explicitScript = subtags.find((subtag) => /^[a-z]{4}$/.test(subtag));
    const region = subtags.slice(1).find((subtag) => (
      /^[a-z]{2}$/.test(subtag) || /^\d{3}$/.test(subtag)
    ));
    if (!explicitScript && !SORANI_KURDISH_REGIONS.has(region)) return null;
  }
  const alias = LANGUAGE_CODE_ALIASES[subtags[0]];
  if (alias) {
    subtags[0] = alias;
    normalized = subtags.join('-');
  }
  const language = languageRecordsByCode.get(subtags[0]);
  if (!language) return null;
  const requestedScript = requestedScriptForTag(normalized, subtags);
  const expectedScript = catalogScript(language);
  if (requestedScript && expectedScript && requestedScript !== expectedScript) return null;
  return language;
}

export function normalizeLanguageCode(languageTag) {
  const language = catalogRecordForLanguageTag(languageTag);
  return language && supportedLanguages.includes(language.code) ? language.code : null;
}

function supportedCatalogCode(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().toLowerCase();
  return supportedLanguages.includes(candidate) ? candidate : null;
}

function catalogRecordForResolvedLanguage(value) {
  if (typeof value === 'string') {
    const direct = languageRecordsByCode.get(value.trim().toLowerCase());
    if (direct?.messages) return direct;
  }
  return catalogRecordForLanguageTag(value);
}

/**
 * Return the unambiguous BCP-47 tag for a trusted, resolved catalog language.
 *
 * Picker values use compact internal codes, including `ku` for the Sorani
 * catalog. Provider and Intl boundaries must receive that catalog's native
 * tag (`ckb-Arab`) so it cannot be interpreted as Kurmanji.
 */
export function nativeLocaleTagForLanguage(language) {
  const record = catalogRecordForResolvedLanguage(language);
  return record?.messages ? record.nativeLocaleTag || record.code : null;
}

function localeTagFromRecord(locale) {
  if (typeof locale === 'string') return locale;
  if (!locale || typeof locale !== 'object') return null;
  if (typeof locale.languageTag === 'string' && locale.languageTag.trim()) {
    return locale.languageTag;
  }
  const languageCode = typeof locale.languageCode === 'string'
    ? locale.languageCode.trim()
    : '';
  if (!languageCode) return null;
  const scriptCode = typeof locale.scriptCode === 'string'
    ? locale.scriptCode.trim()
    : '';
  const regionCode = typeof locale.regionCode === 'string'
    ? locale.regionCode.trim()
    : '';
  return [languageCode, scriptCode, regionCode].filter(Boolean).join('-');
}

export function resolveLanguage(preference = SYSTEM_LANGUAGE, locales = []) {
  const usesSystemLanguage = (
    typeof preference === 'string'
    && preference.trim().toLowerCase() === SYSTEM_LANGUAGE
  );
  if (!usesSystemLanguage) {
    // An explicit but unavailable preference must fail closed to English. It
    // must never silently switch to an unrelated OS language.
    return supportedCatalogCode(preference)
      || normalizeLanguageCode(preference)
      || DEFAULT_LANGUAGE;
  }

  for (const locale of Array.isArray(locales) ? locales : []) {
    const resolved = normalizeLanguageCode(localeTagFromRecord(locale));
    if (resolved) return resolved;
  }
  return DEFAULT_LANGUAGE;
}

export function isRTLLanguage(languageTag) {
  const language = catalogRecordForResolvedLanguage(languageTag);
  return Boolean(language?.messages && language.isRTL);
}

const pluralRulesCache = new Map();

export function selectPluralizationKeys(locale, count) {
  const language = catalogRecordForResolvedLanguage(locale);
  const pluralLocale = language?.messages
    ? language.nativeLocaleTag || language.code
    : DEFAULT_LANGUAGE;
  const numericCount = Number(count);
  let category = 'other';
  if (Number.isFinite(numericCount)) {
    try {
      let rules = pluralRulesCache.get(pluralLocale);
      if (!rules) {
        rules = new Intl.PluralRules(pluralLocale);
        pluralRulesCache.set(pluralLocale, rules);
      }
      category = rules.select(numericCount);
    } catch {
      category = numericCount === 1 ? 'one' : 'other';
    }
  }
  return category === 'other' ? ['other'] : [category, 'other'];
}

for (const language of supportedLanguages) {
  i18n.pluralization.register(
    language,
    (_instance, count) => selectPluralizationKeys(language, count)
  );
}

export function setI18nLocale(locale) {
  i18n.locale = supportedCatalogCode(locale)
    || normalizeLanguageCode(locale)
    || DEFAULT_LANGUAGE;
  return i18n.locale;
}

export function translate(key, options = {}) {
  return i18n.t(key, options);
}

export function translateForLocale(locale, key, options = {}) {
  return i18n.t(key, {
    ...options,
    locale: supportedCatalogCode(locale) || normalizeLanguageCode(locale) || DEFAULT_LANGUAGE
  });
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
