'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { hasUsableMapboxAccessToken } = require('../src/utils/mapbox-config');

test('Mapbox native rendering requires a non-empty runtime token', () => {
  assert.equal(hasUsableMapboxAccessToken(), false);
  assert.equal(hasUsableMapboxAccessToken(''), false);
  assert.equal(hasUsableMapboxAccessToken('   '), false);
  assert.equal(hasUsableMapboxAccessToken('pk.public-token'), true);
});
