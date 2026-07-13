'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');
const { storage } = require('../src/services/storage');

const secureMemory = new Map();
const legacyMemory = new Map();
const originalLoad = Module._load;
Module._load = function loadSecureStore(request, parent, isMain) {
  if (request === 'expo-secure-store') {
    return {
      getItemAsync: async (key) => secureMemory.get(key) || null,
      setItemAsync: async (key, value) => secureMemory.set(key, value),
      deleteItemAsync: async (key) => secureMemory.delete(key)
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const {
  EMERGENCY_CONTACT_CACHE_KEY,
  LEGACY_EMERGENCY_CONTACTS_KEY,
  clearEmergencyContactCache,
  loadEmergencyContactCache,
  persistEmergencyContactCache
} = require('../src/services/emergency-contact-store');
Module._load = originalLoad;

storage.getJSON = async (key, fallback) => legacyMemory.has(key) ? structuredClone(legacyMemory.get(key)) : fallback;
storage.remove = async (key) => legacyMemory.delete(key);

test('legacy emergency-contact PII migrates once into an account-bound secure cache', async () => {
  secureMemory.clear();
  legacyMemory.clear();
  const contacts = [{ id: 'legacy-contact', name: 'Grace', phone: '+6591234567', countryCode: 'SG' }];
  legacyMemory.set(LEGACY_EMERGENCY_CONTACTS_KEY, contacts);

  assert.deepEqual(await loadEmergencyContactCache('google:account-a'), contacts);
  assert.equal(legacyMemory.has(LEGACY_EMERGENCY_CONTACTS_KEY), false);
  const snapshot = JSON.parse(secureMemory.get(EMERGENCY_CONTACT_CACHE_KEY));
  assert.equal(snapshot.accountId, 'google:account-a');
  assert.deepEqual(snapshot.contacts, contacts);

  // A different account cannot see the previous account's cached contacts.
  assert.deepEqual(await loadEmergencyContactCache('apple:account-b'), []);
  assert.equal(JSON.parse(secureMemory.get(EMERGENCY_CONTACT_CACHE_KEY)).accountId, 'apple:account-b');
});

test('secure contact persistence validates account ownership and supports privacy clearing', async () => {
  secureMemory.clear();
  await assert.rejects(persistEmergencyContactCache('', []), /authenticated account/);
  await persistEmergencyContactCache('google:account', [{ id: 'contact' }]);
  assert.equal(secureMemory.has(EMERGENCY_CONTACT_CACHE_KEY), true);
  await clearEmergencyContactCache();
  assert.equal(secureMemory.has(EMERGENCY_CONTACT_CACHE_KEY), false);
});
