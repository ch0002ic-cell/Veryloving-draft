'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  formatLocalizedDateTime,
  formatLocalizedNumber,
  formatLocalizedPercent
} = require('../src/utils/localized-format');

test('localized formatters honor locale-specific number and percent presentation', () => {
  assert.equal(formatLocalizedNumber(12345, 'ar'), new Intl.NumberFormat('ar').format(12345));
  assert.equal(
    formatLocalizedNumber(12345, 'ku'),
    new Intl.NumberFormat('ckb-Arab').format(12345)
  );
  assert.equal(
    formatLocalizedPercent(82, 'fr'),
    new Intl.NumberFormat('fr', { style: 'percent', maximumFractionDigits: 0 }).format(0.82)
  );
});

test('localized date formatting never leaks an Invalid Date label', () => {
  const instant = Date.UTC(2026, 6, 25, 12, 30);
  assert.equal(
    formatLocalizedDateTime(instant, 'es'),
    new Date(instant).toLocaleString('es')
  );
  assert.equal(formatLocalizedDateTime(Number.POSITIVE_INFINITY, 'en'), null);
  assert.equal(formatLocalizedDateTime(10 ** 20, 'en'), null);
  assert.equal(formatLocalizedDateTime('not-a-date', 'en'), null);
  assert.equal(formatLocalizedDateTime(null, 'en'), null);
});

test('invalid values do not become user-visible NaN or invalid percentages', () => {
  assert.equal(formatLocalizedNumber(Number.NaN, 'en'), null);
  assert.equal(formatLocalizedNumber(null, 'en'), null);
  assert.equal(formatLocalizedPercent(undefined, 'en'), null);
});
