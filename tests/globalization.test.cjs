'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  getTranslationKeys,
  isRTLLanguage,
  normalizeLanguageCode,
  resolveLanguage,
  supportedLanguages,
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
const { DEFAULT_SETTINGS, mergeSettings } = require('../src/services/settings-store');

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
  assert.equal(normalizeLanguageCode('ar-SA'), 'ar');
  assert.equal(normalizeLanguageCode('de-DE'), 'de');
  assert.equal(resolveLanguage('system', [{ languageTag: 'es-ES' }]), 'es');
  assert.equal(resolveLanguage('system', [{ languageTag: 'zh-Hans' }]), 'zh');
  assert.equal(resolveLanguage('system', [{ languageTag: 'ja-JP' }]), 'ja');
  assert.equal(resolveLanguage('system', [{ languageTag: 'ae-AF' }]), 'en');
  assert.equal(resolveLanguage('en', [{ languageTag: 'es-ES' }]), 'en');
  assert.equal(translateForLocale('es', 'auth.createAccount'), 'Crear cuenta');
  assert.equal(translateForLocale('fr', 'auth.createAccount'), 'Créer un compte');
  assert.equal(translateForLocale('zh', 'auth.createAccount'), '创建账户');
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

test('RTL language resolution is driven by catalog metadata', () => {
  assert.equal(isRTLLanguage('ar-SA'), true);
  assert.equal(isRTLLanguage('he-IL'), true);
  assert.equal(isRTLLanguage('ur-PK'), true);
  assert.equal(isRTLLanguage('de-DE'), false);
  assert.equal(isRTLLanguage('ae'), true);
  assert.equal(isRTLLanguage('zz'), false);
});

test('Expo config derives native locale declarations from the language catalog', () => {
  const config = require('../app.config')();
  const localizationPlugin = config.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-localization');
  assert.deepEqual(localizationPlugin[1].supportedLocales.ios, supportedLanguages);
  assert.deepEqual(localizationPlugin[1].supportedLocales.android, supportedLanguages);
  assert.equal(supportedLanguages.length, 155);
  assert.match(config.locales.es.ios.NSMicrophoneUsageDescription, /micrófono/i);
  assert.match(config.locales.fr.ios.NSMicrophoneUsageDescription, /microphone/i);
  assert.match(config.locales.zh.ios.NSMicrophoneUsageDescription, /麦克风/);
});

test('language preference is retained by settings merges', () => {
  const settings = mergeSettings(DEFAULT_SETTINGS, { language: 'es' });
  assert.equal(settings.language, 'es');
  assert.equal(mergeSettings(settings, { offlineMode: true }).language, 'es');
});
