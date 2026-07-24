'use strict';

// Keep the gateway deployable as a standalone container. This allowlist is
// mirrored against the mobile catalog by globalization tests, without making
// the production server import or ship the React Native source tree.
const VOICE_LOCALES = Object.freeze([
  'aa', 'ab', 'af', 'ak', 'am', 'ar', 'as', 'av', 'ay', 'az', 'ba', 'be', 'bg', 'bm', 'bn', 'bo', 'br', 'bs', 'ca', 'ce', 'ch', 'co', 'cs', 'cv', 'cy', 'da', 'de', 'dv', 'dz', 'ee', 'el', 'en', 'eo', 'es', 'et', 'eu', 'fa', 'ff', 'fi', 'fj', 'fo', 'fr', 'fy', 'ga', 'gd', 'gl', 'gn', 'gu', 'gv', 'ha', 'he', 'hi', 'hr', 'ht', 'hu', 'hy', 'id', 'ig', 'is', 'it', 'iu', 'ja', 'jv', 'ka', 'kg', 'kk', 'kl', 'km', 'kn', 'ko', 'kr', 'ks', 'ku', 'kv', 'ky', 'la', 'lb', 'lg', 'li', 'ln', 'lo', 'lt', 'lv', 'mg', 'mh', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my', 'nb', 'ne', 'nl', 'no', 'nr', 'ny', 'oc', 'om', 'or', 'os', 'pa', 'pl', 'ps', 'pt', 'qu', 'rn', 'ro', 'ru', 'rw', 'sa', 'sd', 'se', 'sg', 'si', 'sk', 'sl', 'sm', 'sn', 'so', 'sq', 'sr', 'ss', 'st', 'su', 'sv', 'sw', 'ta', 'te', 'tg', 'th', 'ti', 'tk', 'tl', 'tn', 'to', 'tr', 'ts', 'tt', 'tw', 'ty', 'ug', 'uk', 'ur', 'uz', 've', 'vi', 'wo', 'xh', 'yi', 'yo', 'zh', 'zu'
]);

// These assigned ISO 639-1 identifiers are intentionally unavailable because
// no catalog is shipped for them. Keeping the boundary explicit makes it
// possible to prove that every assigned language is either accepted or
// rejected rather than silently falling through to a provider default.
const UNSUPPORTED_VOICE_LOCALES = Object.freeze([
  'ae', 'an', 'bi', 'cr', 'cu', 'ho', 'hz', 'ia', 'ie', 'ii', 'ik', 'io', 'ki', 'kj',
  'kw', 'lu', 'na', 'nd', 'ng', 'nn', 'nv', 'oj', 'pi', 'rm', 'sc', 'vo', 'wa', 'za'
]);

const VOICE_LOCALE_SET = new Set(VOICE_LOCALES);
const LANGUAGE_CODE_ALIASES = Object.freeze({
  ckb: 'ku',
  fil: 'tl',
  in: 'id',
  iw: 'he',
  ji: 'yi',
  jw: 'jv',
  mo: 'ro'
});
const CATALOG_SCRIPTS = Object.freeze({
  az: 'latn',
  bm: 'latn',
  ff: 'latn',
  ha: 'latn',
  kr: 'latn',
  ks: 'arab',
  ku: 'arab',
  mn: 'cyrl',
  pa: 'guru',
  sd: 'arab',
  sr: 'cyrl',
  tl: 'latn',
  uz: 'latn',
  zh: 'hans'
});
const SIMPLE_LOCALE_PATTERN = /^([A-Za-z]{2,3})(?:-([A-Za-z]{4}))?(?:-([A-Za-z]{2}|\d{3}))?$/;
const TRADITIONAL_CHINESE_REGIONS = new Set(['hk', 'mo', 'tw']);
const SORANI_KURDISH_REGIONS = new Set(['iq', 'ir']);
const inferredScriptCache = new Map();

function inferScript(language, region) {
  const cacheKey = `${language}-${region || ''}`;
  if (inferredScriptCache.has(cacheKey)) return inferredScriptCache.get(cacheKey);
  let script;
  try {
    const Locale = globalThis.Intl?.Locale;
    script = typeof Locale === 'function'
      ? new Locale(region ? `${language}-${region}` : language).maximize().script?.toLowerCase()
      : undefined;
  } catch {
    script = undefined;
  }
  inferredScriptCache.set(cacheKey, script);
  return script;
}

/**
 * Normalize a bounded language/script/region tag to the shipped catalog code.
 *
 * Provider variables receive only this canonical result. Variants, extensions,
 * unavailable languages, and script variants for which no matching catalog is
 * shipped are rejected instead of being forwarded as raw user input.
 */
function normalizeVoiceLocale(value, { allowCatalogCode = false } = {}) {
  if (typeof value !== 'string') return undefined;
  const candidate = value.trim().replace(/_/g, '-');
  if (!candidate || candidate.length > 35) return undefined;
  const match = SIMPLE_LOCALE_PATTERN.exec(candidate);
  if (!match) return undefined;

  const requestedLanguage = match[1].toLowerCase();
  // A bare external `ku` normally identifies Latin-script Kurmanji, but the
  // app's compact internal `ku` catalog code means Arabic-script Sorani.
  // Authentication/provider boundaries must use `ckb` or an explicit Sorani
  // script/region. Trusted, already-resolved catalog values may opt in.
  if (requestedLanguage === 'ku' && !match[2]) {
    const region = match[3]?.toLowerCase();
    if ((!region && !allowCatalogCode)
      || (region && !SORANI_KURDISH_REGIONS.has(region))) return undefined;
  }
  const language = LANGUAGE_CODE_ALIASES[requestedLanguage] || requestedLanguage;
  if (!VOICE_LOCALE_SET.has(language)) return undefined;

  const requestedScript = match[2]?.toLowerCase();
  const region = match[3]?.toLowerCase();
  const expectedScript = CATALOG_SCRIPTS[language] || inferScript(language);

  // The only Chinese catalog is Simplified Chinese. Region-only Traditional
  // tags must not be relabeled as Simplified Chinese.
  if (language === 'zh'
    && requestedScript !== 'hans'
    && (requestedScript === 'hant' || TRADITIONAL_CHINESE_REGIONS.has(region))) {
    return undefined;
  }

  const effectiveScript = requestedScript
    || (region ? inferScript(requestedLanguage, region) || inferScript(language, region) : undefined);
  if (effectiveScript && expectedScript && effectiveScript !== expectedScript) return undefined;
  return language;
}

function providerVoiceLocaleTag(value, options) {
  const language = normalizeVoiceLocale(value, options);
  if (!language) return undefined;
  if (language === 'tl') return 'fil';
  const providerLanguage = language === 'ku' ? 'ckb' : language;
  const script = CATALOG_SCRIPTS[language];
  return script
    ? `${providerLanguage}-${script[0].toUpperCase()}${script.slice(1)}`
    : providerLanguage;
}

module.exports = {
  VOICE_LOCALES,
  UNSUPPORTED_VOICE_LOCALES,
  normalizeVoiceLocale,
  providerVoiceLocaleTag
};
