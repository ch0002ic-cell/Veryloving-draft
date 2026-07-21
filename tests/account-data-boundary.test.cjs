'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  ACCOUNT_DATA_OWNER_KEY,
  ensureAccountDataOwner,
  parseAccountDataOwner
} = require('../src/services/account-data-boundary');
const { DEFAULT_SETTINGS } = require('../src/services/settings-store');
const { storage } = require('../src/services/storage');

function installMemoryStorage(entries = []) {
  const memory = new Map(entries.map(([key, value]) => [key, structuredClone(value)]));
  storage.getJSON = async (key, fallback) => memory.has(key)
    ? structuredClone(memory.get(key))
    : fallback;
  storage.setJSON = async (key, value) => {
    memory.set(key, structuredClone(value));
  };
  storage.keys = async () => [...memory.keys()];
  storage.remove = async (key) => memory.delete(key);
  storage.removeMany = async (keys) => keys.forEach((key) => memory.delete(key));
  return memory;
}

test('a different account purges every local user-data surface and preserves only language', async () => {
  const memory = installMemoryStorage([
    [ACCOUNT_DATA_OWNER_KEY, { version: 1, accountId: 'account-a', boundAt: 1 }],
    ['veryloving.settings', {
      ...DEFAULT_SETTINGS,
      language: 'fr',
      mode: 'emergency',
      selectedVoiceId: 'boyfriend',
      offlineMode: true
    }],
    ['veryloving.conversationHistory', [{ id: 'account-a-conversation' }]],
    ['veryloving.offlineMessageQueue', [{ id: 'account-a-message' }]],
    ['veryloving.lastKnownLocation', { coords: { latitude: 1, longitude: 2 } }],
    ['veryloving.lastSOSStatus', { status: 'dialer_opened' }],
    ['veryloving.pendingSOSAttempt', { accountId: 'account-a' }],
    ['veryloving.pairedDevice', { accountId: 'account-a', id: 'private-device' }],
    ['veryloving.navigation.destination', { accountId: 'account-a', destination: '/settings' }],
    ['veryloving.permissionRationale.location', true],
    ['veryloving.auth.signedOut', { version: 1, signedOutAt: 12 }],
    ['unrelated.host.preference', 'keep-me']
  ]);
  let secureContactClears = 0;
  let nextSecureContactOwner = null;
  let savedPlaceClears = 0;
  let reminderDisables = 0;

  const result = await ensureAccountDataOwner('account-b', {
    clearEmergencyContactsImpl: async ({ nextAccountId }) => {
      secureContactClears += 1;
      nextSecureContactOwner = nextAccountId;
    },
    clearSavedPlacesImpl: async () => { savedPlaceClears += 1; },
    disableReminderImpl: async () => { reminderDisables += 1; },
    now: () => 42,
    purgeArtifactsImpl: async () => ({ failures: 0 })
  });

  assert.equal(result.changed, true);
  assert.equal(secureContactClears, 1);
  assert.equal(nextSecureContactOwner, 'account-b');
  assert.equal(savedPlaceClears, 1);
  assert.equal(reminderDisables, 1);
  assert.deepEqual(memory.get(ACCOUNT_DATA_OWNER_KEY), {
    version: 1,
    accountId: 'account-b',
    boundAt: 42
  });
  assert.deepEqual(memory.get('veryloving.settings'), {
    ...DEFAULT_SETTINGS,
    language: 'fr'
  });
  assert.equal(memory.get('unrelated.host.preference'), 'keep-me');
  assert.deepEqual(
    [...memory.keys()].filter((key) => key.startsWith('veryloving.')).sort(),
    [ACCOUNT_DATA_OWNER_KEY, 'veryloving.auth.signedOut', 'veryloving.settings'].sort()
  );
  assert.deepEqual(memory.get('veryloving.auth.signedOut'), { version: 1, signedOutAt: 12 });
});

test('the same recovering account keeps its offline data after rejected refresh', async () => {
  const owner = { version: 1, accountId: 'recovering-account', boundAt: 10 };
  const conversation = [{ id: 'offline-conversation' }];
  const memory = installMemoryStorage([
    [ACCOUNT_DATA_OWNER_KEY, owner],
    ['veryloving.conversationHistory', conversation],
    ['veryloving.settings', { ...DEFAULT_SETTINGS, language: 'es' }]
  ]);
  let deletions = 0;

  const result = await ensureAccountDataOwner('recovering-account', {
    clearEmergencyContactsImpl: async () => { deletions += 1; },
    clearSavedPlacesImpl: async () => { deletions += 1; },
    deleteLocalUserStoresImpl: async () => { deletions += 1; }
  });

  assert.deepEqual(result, {
    changed: false,
    accountId: 'recovering-account',
    warnings: 0
  });
  assert.equal(deletions, 0);
  assert.deepEqual(memory.get('veryloving.conversationHistory'), conversation);
  assert.equal(memory.get('veryloving.settings').language, 'es');
});

test('unowned legacy data is cleared instead of being assigned to the first account that signs in', async () => {
  const memory = installMemoryStorage([
    ['veryloving.conversationHistory', [{ id: 'unknown-owner' }]],
    ['veryloving.lastKnownLocation', { coords: { latitude: 1, longitude: 2 } }],
    ['veryloving.settings', { ...DEFAULT_SETTINGS, language: 'fr', reminderEnabled: false }]
  ]);

  await ensureAccountDataOwner('first-known-account', {
    clearEmergencyContactsImpl: async () => {},
    disableReminderImpl: async () => {},
    now: () => 99,
    purgeArtifactsImpl: async () => ({ failures: 0 })
  });

  assert.equal(memory.has('veryloving.conversationHistory'), false);
  assert.equal(memory.has('veryloving.lastKnownLocation'), false);
  assert.equal(memory.get('veryloving.settings').language, 'fr');
  assert.equal(memory.get('veryloving.settings').reminderEnabled, DEFAULT_SETTINGS.reminderEnabled);
  assert.equal(memory.get(ACCOUNT_DATA_OWNER_KEY).accountId, 'first-known-account');
});

test('a failed local sweep never publishes a new owner', async () => {
  const memory = installMemoryStorage([
    [ACCOUNT_DATA_OWNER_KEY, { version: 1, accountId: 'account-a', boundAt: 1 }],
    ['veryloving.conversationHistory', [{ id: 'private' }]],
    ['veryloving.settings', { ...DEFAULT_SETTINGS, language: 'en' }]
  ]);

  let secureContactClears = 0;
  await assert.rejects(
    ensureAccountDataOwner('account-b', {
      clearEmergencyContactsImpl: async () => { secureContactClears += 1; },
      disableReminderImpl: async () => {},
      deleteLocalUserStoresImpl: async () => { throw new Error('storage unavailable'); }
    }),
    (error) => error.code === 'LOCAL_ACCOUNT_BOUNDARY_FAILED'
  );

  assert.equal(memory.get(ACCOUNT_DATA_OWNER_KEY).accountId, 'account-a');
  assert.deepEqual(memory.get('veryloving.conversationHistory'), [{ id: 'private' }]);
  assert.equal(secureContactClears, 0);
});

test('owner records are strictly validated and auth establishes the boundary before publishing users', () => {
  assert.equal(parseAccountDataOwner(null), null);
  assert.equal(parseAccountDataOwner({ version: 1, accountId: '  ' }), null);
  assert.equal(parseAccountDataOwner({ version: 2, accountId: 'account-a' }), null);
  assert.deepEqual(
    parseAccountDataOwner({ version: 1, accountId: ' account-a ', boundAt: 5 }),
    { version: 1, accountId: 'account-a', boundAt: 5 }
  );

  const auth = readFileSync(path.resolve(process.cwd(), 'src/context/AuthContext.js'), 'utf8');
  const persistStart = auth.indexOf('const persist = useCallback');
  const persistEnd = auth.indexOf('const advanceOnboarding', persistStart);
  const persist = auth.slice(persistStart, persistEnd);
  assert.ok(persist.indexOf('ensureAccountDataOwner(nextEnvelope.user.id)') < persist.indexOf('setUser(nextEnvelope.user)'));

  const restoreBoundary = auth.indexOf('ensureAccountDataOwner(envelope.user.id)');
  const restorePublish = auth.indexOf('setUser(envelope.user)', restoreBoundary);
  assert.ok(restoreBoundary >= 0 && restoreBoundary < restorePublish);
});
