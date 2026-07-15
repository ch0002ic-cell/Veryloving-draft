'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { secureStorage } = require('../src/services/secure-storage');
const {
  clearSavedPlaces,
  loadSavedPlaces,
  MAX_SAVED_PLACES,
  removeSavedPlace,
  SAVED_PLACES_KEY,
  saveCurrentPlace
} = require('../src/services/saved-place-store');

let stored = null;
secureStorage.getItemAsync = async (key) => {
  assert.equal(key, SAVED_PLACES_KEY);
  return stored;
};
secureStorage.setItemAsync = async (key, value) => {
  assert.equal(key, SAVED_PLACES_KEY);
  stored = value;
};
secureStorage.deleteItemAsync = async (key) => {
  assert.equal(key, SAVED_PLACES_KEY);
  stored = null;
};

test('saved places are validated, bounded, account-bound, and removable', async () => {
  stored = null;
  for (let index = 0; index < MAX_SAVED_PLACES + 2; index += 1) {
    await saveCurrentPlace('account-a', {
      coords: { latitude: 1 + index, longitude: 2 + index },
      timestamp: 1000 + index
    }, { createId: () => `place-${index}`, now: () => 1000 + index });
  }
  const places = await loadSavedPlaces('account-a');
  assert.equal(places.length, MAX_SAVED_PLACES);
  assert.equal(places[0].id, 'place-2');
  assert.deepEqual(await loadSavedPlaces('account-b'), []);

  const remaining = await removeSavedPlace('account-a', 'place-2');
  assert.equal(remaining.some((place) => place.id === 'place-2'), false);
  await clearSavedPlaces();
  assert.equal(stored, null);
});

test('saved places reject invalid coordinates without modifying secure storage', async () => {
  stored = null;
  await assert.rejects(saveCurrentPlace('account-a', {
    coords: { latitude: 91, longitude: 2 },
    timestamp: 1000
  }, { createId: () => 'invalid' }), /valid current location/);
  assert.equal(stored, null);
});

test('saved places participate in privacy export, deletion, and account isolation', () => {
  const privacy = readFileSync(path.resolve('src/services/privacy.js'), 'utf8');
  const boundary = readFileSync(path.resolve('src/services/account-data-boundary.js'), 'utf8');
  assert.match(privacy, /loadSavedPlaces\(account\.id\)/);
  assert.match(privacy, /savedPlaces,/);
  assert.match(privacy, /clearSavedPlaces\(\)/);
  assert.match(boundary, /clearSavedPlacesImpl/);
});
