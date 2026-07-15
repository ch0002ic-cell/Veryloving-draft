'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');

const originalLoad = Module._load;
Module._load = function loadContactConfig(request, parent, isMain) {
  if (request === '../utils/config' && /\/src\/services\/(?:emergency-contact-edit|safety-api)\.js$/.test(parent?.filename || '')) {
    return { config: { safetyBackendEnabled: true, apiBaseUrl: 'https://api.example.test' } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { editEmergencyContact } = require('../src/services/emergency-contact-edit');
const { updateEmergencyContact } = require('../src/services/safety-api');
Module._load = originalLoad;

const REMOTE_ID = 'contact_abcdefghijklmnopqrstuvwx';

test('offline contact edits replace only the target in the account-bound secure snapshot', async () => {
  const original = [
    { id: 'local-a', name: 'Grace', phone: '+6591234567', countryCode: 'SG', syncStatus: 'pending' },
    { id: 'local-b', name: 'Alex', phone: '+14155552671', countryCode: 'US' }
  ];
  let persisted;

  const result = await editEmergencyContact({
    accountId: 'account-a',
    backendEnabled: false,
    contactId: 'local-a',
    contacts: original,
    edit: { name: ' Grace Lee ', phone: '+6598765432', countryCode: 'sg' },
    isAccountActive: () => true,
    persistCacheImpl: async (accountId, contacts) => { persisted = { accountId, contacts }; },
    updateRemoteImpl: async () => { throw new Error('must not call remote'); }
  });

  assert.equal(result.cacheWarning, false);
  assert.deepEqual(result.contact, {
    id: 'local-a',
    name: 'Grace Lee',
    phone: '+6598765432',
    countryCode: 'SG',
    syncStatus: 'pending'
  });
  assert.equal(result.contacts[1], original[1]);
  assert.deepEqual(persisted, { accountId: 'account-a', contacts: result.contacts });
  assert.equal(original[0].name, 'Grace');
});

test('offline edits fail transactionally when SecureStore cannot save the snapshot', async () => {
  const original = [{ id: 'local-a', name: 'Grace', phone: '+6591234567', countryCode: 'SG' }];
  await assert.rejects(editEmergencyContact({
    accountId: 'account-a',
    backendEnabled: false,
    contactId: 'local-a',
    contacts: original,
    edit: { name: 'Grace Lee', phone: '+6598765432', countryCode: 'SG' },
    persistCacheImpl: async () => { throw new Error('Keychain unavailable'); }
  }), /Keychain unavailable/);
  assert.deepEqual(original, [{ id: 'local-a', name: 'Grace', phone: '+6591234567', countryCode: 'SG' }]);
});

test('remote edits use optimistic versions and retain server truth after a cache warning', async () => {
  const original = [{
    id: REMOTE_ID,
    name: 'Grace',
    phone: '+6591234567',
    countryCode: 'SG',
    version: 3
  }];
  let remoteRequest;

  const result = await editEmergencyContact({
    accessToken: 'session-token',
    accountId: 'account-a',
    backendEnabled: true,
    contactId: REMOTE_ID,
    contacts: original,
    edit: { name: 'Grace Lee', phone: '+6598765432', countryCode: 'SG' },
    isAccountActive: () => true,
    persistCacheImpl: async () => { throw new Error('SecureStore write failed'); },
    updateRemoteImpl: async (contactId, edit, accessToken) => {
      remoteRequest = { contactId, edit, accessToken };
      return { id: contactId, ...edit, version: 4 };
    }
  });

  assert.deepEqual(remoteRequest, {
    contactId: REMOTE_ID,
    edit: { name: 'Grace Lee', phone: '+6598765432', countryCode: 'SG', version: 3 },
    accessToken: 'session-token'
  });
  assert.equal(result.cacheWarning, true);
  assert.equal(result.contact.version, 4);
  assert.equal(result.contact.phone, '+6598765432');
});

test('a remote version conflict refreshes the cache for a safe retry', async () => {
  const original = [{ id: REMOTE_ID, name: 'Grace', phone: '+6591234567', countryCode: 'SG', version: 1 }];
  const latest = [{ id: REMOTE_ID, name: 'Grace Remote', phone: '+6591234567', countryCode: 'SG', version: 2 }];
  let persisted;
  const conflict = new Error('conflict');
  conflict.code = 'SAFETY_HTTP_409';

  await assert.rejects(editEmergencyContact({
    accessToken: 'session-token',
    accountId: 'account-a',
    backendEnabled: true,
    contactId: REMOTE_ID,
    contacts: original,
    edit: { name: 'My edit', phone: '+6598765432', countryCode: 'SG' },
    fetchRemoteContactsImpl: async () => latest,
    isAccountActive: () => true,
    persistCacheImpl: async (accountId, contacts) => { persisted = { accountId, contacts }; },
    updateRemoteImpl: async () => { throw conflict; }
  }), (error) => error === conflict && error.latestContacts === latest);

  assert.deepEqual(persisted, { accountId: 'account-a', contacts: latest });
});

test('an account change after remote acceptance cannot overwrite another account cache', async () => {
  const original = [{ id: REMOTE_ID, name: 'Grace', phone: '+6591234567', countryCode: 'SG', version: 1 }];
  let active = true;
  let cacheWrites = 0;

  await assert.rejects(editEmergencyContact({
    accessToken: 'session-token',
    accountId: 'account-a',
    backendEnabled: true,
    contactId: REMOTE_ID,
    contacts: original,
    edit: { name: 'Grace Lee', phone: '+6598765432', countryCode: 'SG' },
    isAccountActive: () => active,
    persistCacheImpl: async () => { cacheWrites += 1; },
    updateRemoteImpl: async (contactId, edit) => {
      active = false;
      return { id: contactId, ...edit, version: 2 };
    }
  }), (error) => error.code === 'CONTACT_ACCOUNT_CHANGED');
  assert.equal(cacheWrites, 0);
});

test('mobile update client sends an authenticated PATCH with the versioned edit', async () => {
  let request;
  const payload = await updateEmergencyContact(REMOTE_ID, {
    name: 'Grace Lee',
    phone: '+6598765432',
    countryCode: 'SG',
    version: 2
  }, 'session-token', {
    runtimeConfig: { safetyBackendEnabled: true, apiBaseUrl: 'https://api.example.test/' },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: REMOTE_ID, version: 3 })
      };
    }
  });

  assert.deepEqual(payload, { id: REMOTE_ID, version: 3 });
  assert.equal(request.url, `https://api.example.test/v1/emergency-contacts/${REMOTE_ID}`);
  assert.equal(request.options.method, 'PATCH');
  assert.equal(request.options.headers.Authorization, 'Bearer session-token');
  assert.deepEqual(JSON.parse(request.options.body), {
    name: 'Grace Lee',
    phone: '+6598765432',
    countryCode: 'SG',
    version: 2
  });
});

test('emergency contact UI exposes localized edit, save, cancel, and edit-field focus', () => {
  const ui = readFileSync(path.resolve(process.cwd(), 'app/emergency-contacts.js'), 'utf8');
  assert.match(ui, /updateContact\(editId, nextContact\)/);
  assert.match(ui, /accessibilityLabel=\{t\('releaseCritical\.editContactAccessibility'/);
  assert.match(ui, /nameInputRef\.current\?\.focus\(\)/);
  assert.match(ui, /editingId \? t\('common\.save'\)/);
  assert.match(ui, /title=\{t\('common\.cancel'\)\}/);
  assert.match(ui, /else await addContact\(nextContact\)/);
  assert.match(ui, /await removeContact\(contact\.id\)/);
  assert.match(ui, /await callNumber\(contact\.phone\)/);
});
