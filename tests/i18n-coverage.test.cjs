'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const languageCatalog = require('../src/i18n/languages');
const english = require('../src/i18n/locales/en.json');

const localeDirectory = path.resolve('src/i18n/locales');
const assignedLanguages = languageCatalog.filter((language) => language.code !== 'system');
const availableLanguages = assignedLanguages.filter((language) => language.messages);
const protectedTerms = [
  'VeryLoving',
  'NorthStar',
  'Capybear',
  'Mapbox',
  'Expo Go',
  'Bluetooth',
  'Google',
  'Apple',
  'Hume',
  'VL01',
  'SOS',
  'AI'
];

function flattenCatalog(value, prefix = '', output = {}) {
  for (const [key, child] of Object.entries(value || {})) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenCatalog(child, keyPath, output);
    } else {
      output[keyPath] = child;
    }
  }
  return output;
}

function interpolationTokens(value) {
  return [...String(value).matchAll(/%\{([^}]+)\}/g)]
    .map((match) => match[1])
    .sort();
}

const reference = flattenCatalog(english);
const referenceKeys = Object.keys(reference).sort();

test('language registry represents every assigned ISO 639-1 code once', () => {
  const codes = assignedLanguages.map((language) => language.code);
  assert.equal(codes.length, 183);
  assert.equal(new Set(codes).size, 183);
  for (const language of assignedLanguages) {
    assert.match(language.code, /^[a-z]{2}$/);
    assert.ok(language.englishName.trim(), `${language.code} must have an English name`);
    assert.ok(language.nativeName.trim(), `${language.code} must have a native name`);
    assert.equal(typeof language.isRTL, 'boolean');
  }
});

test('every selectable catalog exactly covers English with non-empty strings', () => {
  assert.equal(availableLanguages.length, 155);
  for (const language of availableLanguages) {
    const translated = flattenCatalog(language.messages);
    let englishIdenticalValues = 0;
    assert.deepEqual(Object.keys(translated).sort(), referenceKeys, `${language.code} keys differ from English`);
    for (const [key, value] of Object.entries(translated)) {
      assert.equal(typeof value, 'string', `${language.code}.${key} must be a string`);
      assert.ok(value.trim(), `${language.code}.${key} must not be empty`);
      assert.deepEqual(
        interpolationTokens(value),
        interpolationTokens(reference[key]),
        `${language.code}.${key} must preserve English placeholders`
      );
      assert.doesNotMatch(value, /__?VL[_\s]*(?:PH|TERM)[_\s]*\d+/i, `${language.code}.${key} contains a generator token`);
      assert.doesNotMatch(value, /%\s*\p{Decimal_Number}\s*\$\s*@|%\s*#*\s*@|%\d+\$s|[\uE000-\uE1FF]/u, `${language.code}.${key} contains a generator token`);
      assert.doesNotMatch(value, /�|&(?:#\d+|#x[0-9a-f]+|amp|quot|apos|lt|gt|nbsp);|<\/?vl\b/i, `${language.code}.${key} contains corrupted translation output`);
      if (value === reference[key]) englishIdenticalValues += 1;
    }
    if (language.code !== 'en') {
      assert.ok(englishIdenticalValues < referenceKeys.length / 2, `${language.code} appears to be an English fallback`);
    }
  }
});

test('catalog files and selectable language metadata stay in sync', () => {
  const fileCodes = fs.readdirSync(localeDirectory)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => path.basename(fileName, '.json'))
    .sort();
  const selectableCodes = availableLanguages.map((language) => language.code).sort();
  assert.deepEqual(fileCodes, selectableCodes);
  assert.ok(['ar', 'de', 'hi', 'it', 'ja', 'ko', 'pt', 'ru'].every((code) => selectableCodes.includes(code)));
  assert.deepEqual(
    assignedLanguages.filter((language) => !language.messages).map((language) => language.code).sort(),
    ['ae', 'an', 'bi', 'cr', 'cu', 'ho', 'hz', 'ia', 'ie', 'ii', 'ik', 'io', 'ki', 'kj', 'kw', 'lu', 'na', 'nd', 'ng', 'nn', 'nv', 'oj', 'pi', 'rm', 'sc', 'vo', 'wa', 'za'].sort()
  );
});

test('machine-generated catalogs are explicitly marked for native-speaker review', () => {
  const generated = availableLanguages.filter((language) => language.translationStatus === 'machine-generated');
  assert.equal(generated.length, 151);
  assert.ok(generated.every((language) => language.reviewRequired === true));
  for (const language of generated) {
    const translated = flattenCatalog(language.messages);
    for (const [key, sourceValue] of Object.entries(reference)) {
      for (const term of protectedTerms) {
        assert.equal(
          translated[key].split(term).length,
          sourceValue.split(term).length,
          `${language.code}.${key} must preserve ${term}`
        );
      }
    }
  }
  assert.ok(assignedLanguages.filter((language) => !language.messages).every((language) => (
    language.translationStatus === 'pending-provider-support' && language.reviewRequired === true
  )));
});

test('RTL metadata includes every selectable right-to-left catalog', () => {
  const rtlCodes = availableLanguages.filter((language) => language.isRTL).map((language) => language.code).sort();
  assert.deepEqual(rtlCodes, ['ar', 'dv', 'fa', 'he', 'ks', 'ku', 'ps', 'sd', 'ug', 'ur', 'yi']);
});
