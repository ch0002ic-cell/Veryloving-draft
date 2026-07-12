'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const english = require('../src/i18n/locales/en.json');
const french = require('../src/i18n/locales/fr.json');
const chinese = require('../src/i18n/locales/zh.json');

function flattenCatalog(value, prefix = '', output = {}) {
  for (const [key, child] of Object.entries(value || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenCatalog(child, path, output);
    } else {
      output[path] = child;
    }
  }
  return output;
}

const reference = flattenCatalog(english);

for (const [locale, catalog] of [['fr', french], ['zh', chinese]]) {
  test(`${locale} catalog exactly covers every English translation key`, () => {
    const translated = flattenCatalog(catalog);
    assert.deepEqual(Object.keys(translated).sort(), Object.keys(reference).sort());
    for (const [key, value] of Object.entries(translated)) {
      assert.equal(typeof value, 'string', `${locale}.${key} must be a string`);
      assert.ok(value.trim(), `${locale}.${key} must not be empty`);
    }
  });
}
