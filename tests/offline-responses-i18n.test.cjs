'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  chooseOfflineResponse,
  offlineResponses,
  offlineResponsesByLocale,
  resolveOfflineResponseLocale
} = require('../src/mocks/offlineResponses');

test('offline companion maintains the same bounded response contract in reviewed locales', () => {
  assert.deepEqual(Object.keys(offlineResponsesByLocale).sort(), ['en', 'es', 'fr', 'zh']);
  for (const [locale, responses] of Object.entries(offlineResponsesByLocale)) {
    assert.equal(responses.length, offlineResponses.length, locale);
    assert.deepEqual(
      responses.map(({ id }) => id),
      offlineResponses.map(({ id }) => id),
      locale
    );
    for (const response of responses) {
      assert.ok(Object.isFrozen(response));
      assert.ok(Object.isFrozen(response.keywords));
      assert.ok(response.text.length > 10);
      assert.ok(response.text.length < 400);
    }
  }
});

test('offline companion selects localized intents for all reviewed public locales', () => {
  assert.equal(chooseOfflineResponse('Necesito un consejo de seguridad', 'es-MX').id, 'safety-tips-1');
  assert.match(chooseOfflineResponse('Necesito un consejo de seguridad', 'es-MX').text, /lugar público/i);

  assert.equal(chooseOfflineResponse('Je ressens de la panique', 'fr-FR').id, 'support-1');
  assert.match(chooseOfflineResponse('Je ressens de la panique', 'fr-FR').text, /Respirez/);

  assert.equal(chooseOfflineResponse('我现在感觉不安全', 'zh-Hans-SG').id, 'safety-1');
  assert.match(chooseOfflineResponse('我现在感觉不安全', 'zh-Hans-SG').text, /紧急联系人/);
});

test('unreviewed, malformed, unsupported, and mismatched-script locales use reviewed English', () => {
  for (const locale of [
    'ar',
    'de-DE',
    'ks-Arab',
    'zh-Hant-TW',
    'zh-HK',
    { languageCode: 'zh', scriptCode: 'Hant', regionCode: 'TW' },
    '',
    null,
    {},
    { languageCode: 'ja' }
  ]) {
    assert.equal(resolveOfflineResponseLocale(locale), 'en');
    assert.equal(chooseOfflineResponse('Could you give me a safety tip?', locale).id, 'safety-tips-1');
    assert.match(chooseOfflineResponse('Could you give me a safety tip?', locale).text, /well-lit public place/i);
  }
  assert.equal(resolveOfflineResponseLocale({ languageTag: 'fr-CA' }), 'fr');
});

test('non-string offline input fails safely to the localized generic response', () => {
  assert.equal(chooseOfflineResponse({ hostile: true }, 'es').id, 'generic-1');
  assert.match(chooseOfflineResponse(null, 'zh').text, /离线陪伴模式/);
});
