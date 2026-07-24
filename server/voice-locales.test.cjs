'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const languageRegistry = require('../src/i18n/language-registry.js');
const {
  VOICE_LOCALES,
  UNSUPPORTED_VOICE_LOCALES,
  normalizeVoiceLocale,
  providerVoiceLocaleTag
} = require('./voice-locales.cjs');

test('server locale contract exhaustively covers every assigned app language', () => {
  const shipped = languageRegistry
    .filter((language) => language.messages)
    .map((language) => language.code)
    .sort();
  const unavailable = languageRegistry
    .filter((language) => !language.messages)
    .map((language) => language.code)
    .sort();

  assert.equal(VOICE_LOCALES.length, 155);
  assert.equal(UNSUPPORTED_VOICE_LOCALES.length, 28);
  assert.deepEqual([...VOICE_LOCALES].sort(), shipped);
  assert.deepEqual([...UNSUPPORTED_VOICE_LOCALES].sort(), unavailable);
  for (const locale of VOICE_LOCALES.filter((locale) => locale !== 'ku')) {
    assert.equal(normalizeVoiceLocale(locale), locale);
  }
  assert.equal(normalizeVoiceLocale('ku'), undefined);
  assert.equal(normalizeVoiceLocale('ku', { allowCatalogCode: true }), 'ku');
  for (const language of languageRegistry.filter((entry) => entry.messages)) {
    assert.equal(
      providerVoiceLocaleTag(language.code, { allowCatalogCode: true }),
      language.nativeLocaleTag || language.code,
      language.code
    );
  }
  for (const locale of UNSUPPORTED_VOICE_LOCALES) {
    assert.equal(normalizeVoiceLocale(locale), undefined);
    assert.equal(normalizeVoiceLocale(`${locale}-US`), undefined);
  }
});

test('server locale normalization canonicalizes platform aliases and safe regions', () => {
  assert.equal(normalizeVoiceLocale('EN_us'), 'en');
  assert.equal(normalizeVoiceLocale('fil-PH'), 'tl');
  assert.equal(normalizeVoiceLocale('ckb'), 'ku');
  assert.equal(normalizeVoiceLocale('ckb-Arab'), 'ku');
  assert.equal(normalizeVoiceLocale('ckb-IQ'), 'ku');
  assert.equal(normalizeVoiceLocale('ku-Arab'), 'ku');
  assert.equal(normalizeVoiceLocale('ku-IQ'), 'ku');
  assert.equal(normalizeVoiceLocale('ku-IR'), 'ku');
  assert.equal(normalizeVoiceLocale('in-ID'), 'id');
  assert.equal(normalizeVoiceLocale('iw-IL'), 'he');
  assert.equal(normalizeVoiceLocale('ji'), 'yi');
  assert.equal(normalizeVoiceLocale('jw-ID'), 'jv');
  assert.equal(normalizeVoiceLocale('mo-MD'), 'ro');
  assert.equal(providerVoiceLocaleTag('ckb-IQ'), 'ckb-Arab');
  assert.equal(
    providerVoiceLocaleTag('ku', { allowCatalogCode: true }),
    'ckb-Arab'
  );
  assert.equal(providerVoiceLocaleTag('tl'), 'fil');
  assert.equal(providerVoiceLocaleTag('zh-CN'), 'zh-Hans');
});

test('server locale normalization rejects unavailable scripts and malformed tags', () => {
  for (const locale of [
    'az-Arab', 'ff-Adlm', 'ha-Arab', 'ks-Deva', 'ku-Latn', 'mn-Mong',
    'pa-Arab', 'sr-Latn', 'uz-Cyrl', 'zh-Hant', 'zh-TW'
  ]) {
    assert.equal(normalizeVoiceLocale(locale), undefined, locale);
  }
  for (const locale of [
    '', ' ', 'en<script>', 'en-u-ca-gregory', 'en-US-extra', 'english',
    'en--US', '123', null, {}, 'x'.repeat(36)
  ]) {
    assert.equal(normalizeVoiceLocale(locale), undefined, String(locale));
  }
});
