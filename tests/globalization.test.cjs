'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  catalogLanguages,
  getTranslationKeys,
  isRTLLanguage,
  maintainedLanguages,
  normalizeLanguageCode,
  resolveLanguage,
  RTL_QA_LANGUAGE_CODES,
  selectRuntimeLanguageCodes,
  supportedLanguages,
  TRANSLATION_FALLBACK_ENABLED,
  translateForLocale,
  translations
} = require('../src/i18n/core');
const {
  changePhoneCountry,
  countryCodes,
  createPhoneValue,
  filterCountryOptions,
  getCountryOptions,
  getDefaultCountry,
  phoneValueFromE164
} = require('../src/utils/phone');
const { ENGLISH_COUNTRY_NAMES } = require('../src/data/country-names-en');
const { DEFAULT_SETTINGS, mergeSettings } = require('../src/services/settings-store');
const releaseCriticalMessages = require('../src/i18n/release-critical-messages').default;

function valueAtPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function interpolationTokens(value) {
  return [...String(value).matchAll(/%\{([^}]+)\}/g)]
    .map((match) => match[1])
    .sort();
}

test('phone metadata covers the global E.164 country set', () => {
  assert.ok(countryCodes.length > 200);
  assert.ok(countryCodes.includes('US'));
  assert.ok(countryCodes.includes('ES'));
  assert.ok(countryCodes.includes('CN'));
  assert.ok(countryCodes.includes('GB'));
});

test('phone input formats and validates numbers across regions', () => {
  const cases = [
    ['4155552671', 'US', '+14155552671'],
    ['02079460018', 'GB', '+442079460018'],
    ['612345678', 'ES', '+34612345678'],
    ['13812345678', 'CN', '+8613812345678']
  ];

  for (const [input, country, expected] of cases) {
    const phone = createPhoneValue(input, country);
    assert.equal(phone.isValid, true, `${country} sample should be valid`);
    assert.equal(phone.e164, expected);
    assert.equal(phone.countryCode, country);
  }
});

test('international paste detects the country and stores only canonical E.164', () => {
  const phone = createPhoneValue('+34 612 34 56 78', 'US');
  assert.equal(phone.countryCode, 'ES');
  assert.equal(phone.formatted, '612 34 56 78');
  assert.equal(phone.e164, '+34612345678');
  assert.equal(phone.isValid, true);
});

test('phone validation distinguishes incomplete and invalid values', () => {
  const incomplete = createPhoneValue('415', 'US');
  assert.equal(incomplete.isValid, false);
  assert.equal(incomplete.e164, '');
  assert.equal(incomplete.validationError, 'tooShort');

  const invalid = createPhoneValue('000000000', 'ES');
  assert.equal(invalid.isValid, false);
  assert.equal(invalid.e164, '');
  assert.equal(invalid.validationError, 'invalid');
});

test('country changes re-interpret national digits under the new dialing plan', () => {
  const usPhone = createPhoneValue('4155552671', 'US');
  const spanishPhone = changePhoneCountry(usPhone, 'ES');
  assert.equal(spanishPhone.countryCode, 'ES');
  assert.equal(spanishPhone.callingCode, '34');
  assert.equal(phoneValueFromE164('+442079460018').countryCode, 'GB');
});

test('country options are complete, localized, and searchable by dialing code', () => {
  const options = getCountryOptions('es');
  assert.equal(options.length, countryCodes.length);
  const matches = filterCountryOptions(options, '+34');
  assert.ok(matches.some((country) => country.code === 'ES'));
  assert.equal(getDefaultCountry([{ regionCode: 'SG' }]), 'SG');
  assert.equal(getDefaultCountry([{ regionCode: null }]), 'US');
});

test('English country-name fallback covers every supported phone region', () => {
  assert.deepEqual(
    Object.keys(ENGLISH_COUNTRY_NAMES).sort(),
    [...countryCodes].sort()
  );
  for (const countryCode of countryCodes) {
    assert.ok(
      ENGLISH_COUNTRY_NAMES[countryCode]?.trim(),
      `${countryCode} must have a human-readable English fallback name`
    );
  }
});

test('country options remain human-readable and searchable without Intl.DisplayNames', () => {
  const originalDisplayNames = Intl.DisplayNames;
  try {
    Intl.DisplayNames = undefined;
    const options = getCountryOptions('en-SG');
    const singapore = options.find((country) => country.code === 'SG');

    assert.equal(singapore?.name, 'Singapore');
    assert.ok(filterCountryOptions(options, 'singapore').some((country) => country.code === 'SG'));
  } finally {
    Intl.DisplayNames = originalDisplayNames;
  }
});

test('country options use fallback names when Intl.DisplayNames returns a code', () => {
  const originalDisplayNames = Intl.DisplayNames;
  try {
    Intl.DisplayNames = class CodeOnlyDisplayNames {
      of(countryCode) {
        return countryCode;
      }
    };
    const options = getCountryOptions('en-ES');
    const spain = options.find((country) => country.code === 'ES');

    assert.equal(spain?.name, 'Spain');
    assert.ok(filterCountryOptions(options, 'spain').some((country) => country.code === 'ES'));
  } finally {
    Intl.DisplayNames = originalDisplayNames;
  }
});

test('translated strings preserve every interpolation placeholder', () => {
  for (const key of getTranslationKeys(translations.en)) {
    const englishTokens = interpolationTokens(valueAtPath(translations.en, key));
    for (const locale of supportedLanguages.filter((language) => language !== 'en')) {
      assert.deepEqual(
        interpolationTokens(valueAtPath(translations[locale], key)),
        englishTokens,
        `${locale}.${key} must preserve English placeholders`
      );
    }
  }
});

test('language resolution supports regional tags, system preference, and fallback', () => {
  assert.equal(normalizeLanguageCode('es-MX'), 'es');
  assert.equal(normalizeLanguageCode('fr-CA'), 'fr');
  assert.equal(normalizeLanguageCode('zh-Hans-CN'), 'zh');
  assert.equal(normalizeLanguageCode('zh-CN'), 'zh');
  assert.equal(normalizeLanguageCode('zh-SG'), 'zh');
  assert.equal(normalizeLanguageCode('zh-Hant'), null);
  assert.equal(normalizeLanguageCode('zh-Hant-TW'), null);
  assert.equal(normalizeLanguageCode('zh-TW'), null);
  assert.equal(normalizeLanguageCode('zh-HK'), null);
  assert.equal(normalizeLanguageCode('zh-MO'), null);
  assert.equal(normalizeLanguageCode('zh-Hans-TW'), 'zh');
  assert.equal(normalizeLanguageCode('ar-SA'), null);
  assert.equal(normalizeLanguageCode('de-DE'), null);
  assert.equal(resolveLanguage('system', [{ languageTag: 'es-ES' }]), 'es');
  assert.equal(resolveLanguage('system', [{ languageTag: 'zh-Hans' }]), 'zh');
  assert.equal(resolveLanguage('system', [{ languageTag: 'zh-Hant-TW' }]), 'en');
  assert.equal(resolveLanguage('system', [{ languageTag: 'zh-HK' }]), 'en');
  assert.equal(resolveLanguage('system', [{ languageTag: 'ja-JP' }]), 'en');
  assert.equal(resolveLanguage('system', [{ languageTag: 'ae-AF' }]), 'en');
  assert.equal(resolveLanguage('en', [{ languageTag: 'es-ES' }]), 'en');
  assert.equal(translateForLocale('es', 'auth.createAccount'), 'Crear cuenta');
  assert.equal(translateForLocale('fr', 'auth.createAccount'), 'Créer un compte');
  assert.equal(translateForLocale('zh', 'auth.createAccount'), '创建账户');
  assert.equal(translateForLocale('zh-Hant-TW', 'auth.createAccount'), 'Create account');
  assert.equal(translateForLocale('en', 'auth.createAccount'), 'Create account');
  assert.equal(
    translateForLocale('es', 'safetyCall.messagesWaiting', { count: 2 }),
    '2 mensajes pendientes de envío'
  );
  assert.equal(
    translateForLocale('fr', 'safetyCall.messagesWaiting', { count: 2 }),
    "2 messages en attente d'envoi"
  );
  assert.equal(
    translateForLocale('zh', 'safetyCall.messagesWaiting', { count: 2 }),
    '2条消息等待发送'
  );
});

test('selectable catalogs never use a hidden English per-string fallback', () => {
  assert.equal(TRANSLATION_FALLBACK_ENABLED, false);
  assert.equal(translateForLocale('en', 'settings.showCompanion'), 'Show companion button');
  assert.equal(translateForLocale('es', 'settings.showCompanion'), 'Mostrar el botón del compañero');
  assert.equal(translateForLocale('fr', 'settings.showCompanion'), 'Afficher le bouton du compagnon');
  assert.equal(translateForLocale('zh', 'settings.showCompanion'), '显示伙伴按钮');
  assert.equal(
    translateForLocale('es', 'quickShare.subtitle'),
    'Comparte una instantánea única de tu ubicación. No se actualizará después de enviarla.'
  );
  assert.equal(
    translateForLocale('fr', 'quickShare.subtitle'),
    'Partagez un instantané unique de votre position. Il ne sera pas actualisé après l’envoi.'
  );
  assert.equal(translateForLocale('zh', 'quickShare.subtitle'), '分享一次性位置快照。发送后不会更新。');
  assert.match(translateForLocale('es', 'releaseCritical.sosDialerOpened'), /llamada no está confirmada/i);
  assert.match(translateForLocale('fr', 'releaseCritical.locationShareFailed'), /partager votre position/i);
  assert.match(translateForLocale('zh', 'releaseCritical.authCodeInvalid'), /验证码/);
});

test('release language gating keeps generated catalogs out of production and adds only RTL QA targets', () => {
  assert.equal(catalogLanguages.length, 155);
  assert.deepEqual([...maintainedLanguages].sort(), ['en', 'es', 'fr', 'zh']);
  assert.deepEqual([...supportedLanguages].sort(), ['en', 'es', 'fr', 'zh']);
  assert.deepEqual([...RTL_QA_LANGUAGE_CODES].sort(), ['ar', 'he']);
  assert.deepEqual(
    selectRuntimeLanguageCodes({ enableRTLQA: true }).sort(),
    ['ar', 'en', 'es', 'fr', 'he', 'zh']
  );
  const releaseKeys = Object.keys(releaseCriticalMessages.en).sort();
  for (const locale of ['en', 'es', 'fr', 'zh', 'ar', 'he']) {
    assert.deepEqual(Object.keys(releaseCriticalMessages[locale]).sort(), releaseKeys);
    for (const key of releaseKeys) {
      assert.deepEqual(
        interpolationTokens(releaseCriticalMessages[locale][key]),
        interpolationTokens(releaseCriticalMessages.en[key]),
        `${locale}.releaseCritical.${key} must preserve placeholders`
      );
    }
  }
});

test('RTL language resolution is driven by catalog metadata', () => {
  assert.equal(isRTLLanguage('ar-SA'), true);
  assert.equal(isRTLLanguage('he-IL'), true);
  assert.equal(isRTLLanguage('ur-PK'), true);
  assert.equal(isRTLLanguage('de-DE'), false);
  assert.equal(isRTLLanguage('ae'), true);
  assert.equal(isRTLLanguage('zz'), false);
});

test('Expo config derives native locale declarations from the language catalog', () => {
  const appConfig = require('../app.config');
  const config = appConfig();
  const localizationPlugin = config.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-localization');
  assert.deepEqual(localizationPlugin[1].supportedLocales.ios, supportedLanguages);
  assert.deepEqual(localizationPlugin[1].supportedLocales.android, supportedLanguages);
  assert.deepEqual(Object.keys(config.locales), supportedLanguages);
  assert.deepEqual(
    appConfig.selectSupportedLocales({ EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES: 'true' }).sort(),
    ['ar', 'en', 'es', 'fr', 'he', 'zh']
  );
  assert.match(config.locales.es.ios.NSMicrophoneUsageDescription, /micrófono/i);
  assert.match(config.locales.fr.ios.NSMicrophoneUsageDescription, /microphone/i);
  assert.match(config.locales.zh.ios.NSMicrophoneUsageDescription, /麦克风/);
});

test('language preference is retained by settings merges', () => {
  const settings = mergeSettings(DEFAULT_SETTINGS, { language: 'es' });
  assert.equal(settings.language, 'es');
  assert.equal(mergeSettings(settings, { offlineMode: true }).language, 'es');
});

test('language selector persists before publishing and visibly marks the current choice', () => {
  const selector = readFileSync(path.resolve(process.cwd(), 'src/components/LanguageSelector.js'), 'utf8');
  const appContext = readFileSync(path.resolve(process.cwd(), 'src/context/AppContext.js'), 'utf8');
  const i18nContext = readFileSync(path.resolve(process.cwd(), 'src/context/I18nContext.js'), 'utf8');

  assert.match(selector, /await setLanguage\(languageCode\)/);
  assert.match(selector, /const selected = item\.code === languagePreference/);
  assert.match(selector, /accessibilityState=\{\{ checked: selected/);
  assert.match(selector, /selected \? <Ionicons name="checkmark-circle"/);
  assert.match(i18nContext, /const locale = resolveLanguage\(languagePreference, locales\)/);
  assert.match(i18nContext, /await updateSettings\(\{ language \}\)/);

  const updateSettings = appContext.slice(
    appContext.indexOf('const updateSettings'),
    appContext.indexOf('const addContact')
  );
  const persisted = updateSettings.indexOf('await persistSettings(next)');
  const published = updateSettings.indexOf('setSettings(next)');
  assert.ok(persisted >= 0 && persisted < published, 'Language/settings must persist before context publishes them');
});

test('TestFlight RTL runtime resolves Arabic and Hebrew with localized critical copy', () => {
  const probe = spawnSync(process.execPath, [
    '--require',
    '@babel/register',
    '-e',
    `const core = require('./src/i18n/core'); process.stdout.write(JSON.stringify({
      supported: [...core.supportedLanguages].sort(),
      arabic: core.resolveLanguage('ar-SA'),
      hebrew: core.resolveLanguage('he-IL'),
      rtl: core.isRTLLanguage(core.resolveLanguage('ar-SA')),
      copy: core.translateForLocale('ar', 'releaseCritical.sosDialerOpened')
    }));`
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES: 'true' }
  });
  assert.equal(probe.status, 0, probe.stderr);
  const result = JSON.parse(probe.stdout);
  assert.deepEqual(result.supported, ['ar', 'en', 'es', 'fr', 'he', 'zh']);
  assert.equal(result.arabic, 'ar');
  assert.equal(result.hebrew, 'he');
  assert.equal(result.rtl, true);
  assert.match(result.copy, /[\u0600-\u06FF]/);
});
