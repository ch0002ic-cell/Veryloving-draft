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
const {
  clearEmergencyContactCache,
  loadEmergencyContactCache,
  persistEmergencyContactCache
} = require('../src/services/emergency-contact-store');
const { secureStorage } = require('../src/services/secure-storage');
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
      const responseBody = JSON.stringify({ id: REMOTE_ID, version: 3 });
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === 'content-length' ? String(Buffer.byteLength(responseBody)) : null },
        text: async () => responseBody
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

test('contact add and remove mutations fence account changes before cache and UI publication', () => {
  const appContext = readFileSync(path.resolve(process.cwd(), 'src/context/AppContext.js'), 'utf8');
  for (const [startMarker, endMarker] of [
    ['const addContact = useCallback', 'const removeContact = useCallback'],
    ['const removeContact = useCallback', 'const updateContact = useCallback']
  ]) {
    const operation = appContext.slice(appContext.indexOf(startMarker), appContext.indexOf(endMarker));
    assert.match(operation, /const accountId = user\.id/);
    assert.match(operation, /CONTACT_ACCOUNT_CHANGED/);
    assert.match(operation, /assertAccountActive\(\)/);
    assert.match(operation, /persistEmergencyContactCache\(accountId, next\)/);
  }
});

test('authoritative contact refresh does not resurrect a remotely deleted cached contact', () => {
  const appContext = readFileSync(path.resolve(process.cwd(), 'src/context/AppContext.js'), 'utf8');
  const start = appContext.indexOf('const remoteContacts = await fetchEmergencyContacts');
  const end = appContext.indexOf("logger.recoverable('[AppState] Could not refresh emergency contacts'", start);
  const reconciliation = appContext.slice(start, end);

  assert.match(reconciliation, /const remoteIds = new Set\(\)/);
  assert.match(reconciliation, /remoteIds\.has\(contact\.id\) \|\| remotePhones\.has\(contact\.phone\)/);
  assert.match(reconciliation, /REMOTE_EMERGENCY_CONTACT_PATTERN\.test\(contact\.id \|\| ''\)/);
  assert.match(reconciliation, /contact\.syncStatus !== 'pending'\) continue/);
  assert.match(reconciliation, /canonicalRemoteContacts/);
});

test('same-account access-token rotation refreshes remotely without dehydrating the contact cache', () => {
  const appContext = readFileSync(path.resolve(process.cwd(), 'src/context/AppContext.js'), 'utf8');
  const cacheEffectStart = appContext.indexOf('if (pairedDeviceNeedsHydration({');
  const remoteEffectStart = appContext.indexOf('// Access-token rotation may refresh', cacheEffectStart);
  const cacheEffect = appContext.slice(cacheEffectStart, remoteEffectStart);
  const remoteEffectEnd = appContext.indexOf('const setDevice = useCallback', remoteEffectStart);
  const remoteEffect = appContext.slice(remoteEffectStart, remoteEffectEnd);

  assert.ok(cacheEffectStart >= 0 && remoteEffectStart > cacheEffectStart);
  assert.match(cacheEffect, /\}, \[authLoading, localStateHydrated, settingsAccountId, user\?\.id\]\);/);
  assert.doesNotMatch(cacheEffect, /\[accessToken,/);
  assert.match(appContext, /contactsHydrationQueueRef = useRef\(Promise\.resolve\(\)\)/);
  assert.match(cacheEffect, /contactsHydrationQueueRef\.current/);
  assert.doesNotMatch(cacheEffect, /contactsMutationQueueRef\.current/);
  assert.match(remoteEffect, /contactsAccountId !== accountId/);
  assert.match(remoteEffect, /accessTokenRef\.current === sessionToken/);
  assert.doesNotMatch(remoteEffect, /setContactsAccountId\(null\)/);
});

test('AppContext binds safety-event dedupe and delivery to the initiating account', () => {
  const appContext = readFileSync(path.resolve(process.cwd(), 'src/context/AppContext.js'), 'utf8');
  const safetyEffectStart = appContext.indexOf('safetyEventRouterRef.current = createSafetyEventRouter');
  const safetyEffectEnd = appContext.indexOf('registerDevicePushToken', safetyEffectStart);
  const safetyEffect = appContext.slice(safetyEffectStart, safetyEffectEnd);

  assert.match(safetyEffect, /const accountScope = activeAccountIdRef\.current/);
  assert.match(safetyEffect, /routeWearableEvent\(telemetry\.value, \{ deviceId, accountScope \}\)/);
  assert.match(safetyEffect, /routeRobotEvent\(event, \{ deviceId, accountScope \}\)/);
  assert.match(safetyEffect, /requireSafetyAccountBinding\(/);
  assert.match(safetyEffect, /contactsAccountIdRef\.current/);
  assert.match(safetyEffect, /const accountContacts = \[\.\.\.contactsRef\.current\]/);
});

test('the secure contact cache rejects stale writes after an account-boundary clear', async () => {
  const originalGet = secureStorage.getItemAsync;
  const originalSet = secureStorage.setItemAsync;
  const originalDelete = secureStorage.deleteItemAsync;
  let snapshot = null;
  secureStorage.getItemAsync = async () => snapshot;
  secureStorage.setItemAsync = async (_key, value) => { snapshot = value; };
  secureStorage.deleteItemAsync = async () => { snapshot = null; };
  try {
    await clearEmergencyContactCache({ nextAccountId: 'account-a' });
    await persistEmergencyContactCache('account-a', [{ id: 'contact-a' }]);
    // Logout blocks every later A write immediately, including work that
    // resolves after the serialized deletion itself.
    await clearEmergencyContactCache();
    await assert.rejects(
      persistEmergencyContactCache('account-a', [{ id: 'stale-after-logout' }]),
      (error) => error.code === 'CONTACT_ACCOUNT_CHANGED'
    );
    // The production account boundary explicitly activates B before its user
    // is published, so the same process can hydrate and persist the next owner.
    await clearEmergencyContactCache({ nextAccountId: 'account-b' });
    await assert.rejects(
      persistEmergencyContactCache('account-a', [{ id: 'stale-a' }]),
      (error) => error.code === 'CONTACT_ACCOUNT_CHANGED'
    );
    await persistEmergencyContactCache('account-b', [{ id: 'contact-b' }]);
    assert.deepEqual(await loadEmergencyContactCache('account-b'), [{ id: 'contact-b' }]);
    assert.deepEqual(await loadEmergencyContactCache('account-a'), []);
  } finally {
    secureStorage.getItemAsync = originalGet;
    secureStorage.setItemAsync = originalSet;
    secureStorage.deleteItemAsync = originalDelete;
  }
});
