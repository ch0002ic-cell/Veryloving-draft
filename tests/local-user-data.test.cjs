'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { appendConversationMessage } = require('../src/services/conversation-history');
const {
  deleteLocalUserStores,
  hasLocalUserDataDeletionWarnings
} = require('../src/services/local-user-data');
const {
  OFFLINE_MAP_CLEANUP_RETRY_KEY,
  OFFLINE_MAP_METADATA_KEY,
  OFFLINE_MAP_PACK_PREFIX,
  purgeOfflineMapRegion
} = require('../src/services/offline-map-cache');
const { queueOfflineMessage } = require('../src/services/offline-message-queue');
const { storage } = require('../src/services/storage');
const { purgePrivacyArtifacts } = require('../src/services/privacy-artifact-cleanup');

test('logout purges all VeryLoving stores after draining voice mutation queues', async () => {
  const memory = new Map([
    ['veryloving.settings', { language: 'en' }],
    ['veryloving.emergencyContacts', [{ id: 'private-contact' }]],
    ['veryloving.conversationHistory', [{ id: 'private-call' }]],
    ['veryloving.offlineMessageQueue', [{ id: 'private-message' }]],
    ['unrelated.host.preference', true]
  ]);
  storage.getJSON = async (key, fallback) => memory.has(key) ? structuredClone(memory.get(key)) : fallback;
  storage.setJSON = async (key, value) => memory.set(key, structuredClone(value));
  storage.keys = async () => [...memory.keys()];
  storage.removeMany = async (keys) => keys.forEach((key) => memory.delete(key));
  let artifactPurges = 0;

  await deleteLocalUserStores({ purgeArtifacts: () => { artifactPurges += 1; } });

  assert.deepEqual([...memory.entries()], [['unrelated.host.preference', true]]);
  assert.equal(artifactPurges, 1);
});

test('an ancillary artifact failure cannot block the user-data key sweep', async () => {
  const memory = new Map([
    ['veryloving.settings', { language: 'en' }],
    ['veryloving.lastKnownLocation', { coords: { latitude: 1, longitude: 2 } }],
    ['unrelated.host.preference', true]
  ]);
  storage.getJSON = async (key, fallback) => memory.has(key) ? structuredClone(memory.get(key)) : fallback;
  storage.setJSON = async (key, value) => memory.set(key, structuredClone(value));
  storage.keys = async () => [...memory.keys()];
  storage.removeMany = async (keys) => keys.forEach((key) => memory.delete(key));

  const result = await deleteLocalUserStores({
    purgeArtifacts: async () => { throw new Error('native pack unavailable'); }
  });

  assert.deepEqual([...memory.entries()], [['unrelated.host.preference', true]]);
  assert.equal(result.artifactCleanup.failures, 1);
  assert.equal(hasLocalUserDataDeletionWarnings(result), true);
});

test('a synchronous artifact purge failure cannot prevent the other privacy purge', async () => {
  const attempted = [];
  const result = await purgePrivacyArtifacts([
    () => {
      attempted.push('voice');
      throw new Error('voice cache bridge failed');
    },
    async () => {
      attempted.push('map');
    }
  ]);

  assert.deepEqual(attempted, ['voice', 'map']);
  assert.deepEqual(result, { failures: 1 });
});

test('native map deletion failure survives the broad user-data sweep for retry', async () => {
  const packName = `${OFFLINE_MAP_PACK_PREFIX}privacy-retry`;
  const memory = new Map([
    ['veryloving.settings', { language: 'en' }],
    [OFFLINE_MAP_METADATA_KEY, {
      version: 2,
      active: { name: packName, regionKey: 'private-region' },
      pending: null,
      tombstones: []
    }],
    ['unrelated.host.preference', true]
  ]);
  storage.getJSON = async (key, fallback) => memory.has(key) ? structuredClone(memory.get(key)) : fallback;
  storage.setJSON = async (key, value) => memory.set(key, structuredClone(value));
  storage.keys = async () => [...memory.keys()];
  storage.remove = async (key) => memory.delete(key);
  storage.removeMany = async (keys) => keys.forEach((key) => memory.delete(key));

  let deletionShouldFail = true;
  const manager = {
    async getPacks() { return deletionShouldFail ? [{ name: packName }] : []; },
    async deletePack(name) {
      assert.equal(name, packName);
      if (deletionShouldFail) throw new Error('native deletion failed');
    }
  };
  const result = await deleteLocalUserStores({
    purgeArtifacts: async () => {
      const settled = await Promise.allSettled([
        purgeOfflineMapRegion({
          mapbox: { offlineManager: manager },
          storageImpl: storage,
          loggerImpl: { warn() {} }
        })
      ]);
      return { failures: settled.filter((item) => item.status === 'rejected').length };
    }
  });

  assert.equal(hasLocalUserDataDeletionWarnings(result), true);
  assert.equal([...memory.keys()].some((key) => key.startsWith('veryloving.')), false);
  assert.deepEqual(memory.get(OFFLINE_MAP_CLEANUP_RETRY_KEY), {
    version: 1,
    packNames: [packName],
    enumerationPending: false
  });
  assert.equal(memory.get('unrelated.host.preference'), true);

  deletionShouldFail = false;
  const retried = await purgeOfflineMapRegion({
    mapbox: { offlineManager: manager },
    storageImpl: storage,
    loggerImpl: { warn() {} }
  });
  assert.equal(retried.status, 'deleted');
  assert.equal(memory.has(OFFLINE_MAP_CLEANUP_RETRY_KEY), false);
});

test('voice writers cannot recreate local data after the cleanup lock is acquired', async () => {
  const memory = new Map([
    ['veryloving.conversationHistory', [{ id: 'private-call' }]],
    ['veryloving.offlineMessageQueue', [{ id: 'private-message' }]],
    ['unrelated.host.preference', true]
  ]);
  storage.getJSON = async (key, fallback) => memory.has(key) ? structuredClone(memory.get(key)) : fallback;
  storage.setJSON = async (key, value) => memory.set(key, structuredClone(value));
  storage.keys = async () => [...memory.keys()];
  storage.removeMany = async (keys) => keys.forEach((key) => memory.delete(key));

  await deleteLocalUserStores({
    // Artifact cleanup runs after deleteLocalUserStores has acquired and
    // drained the shared mutation lock, but before the final prefix sweep.
    purgeArtifacts: async () => {
      const attemptedVoiceWrites = [
        appendConversationMessage({
          sessionId: 'stale-session',
          role: 'user',
          text: 'Do not restore this after logout.'
        }),
        queueOfflineMessage({
          id: 'stale-queued-message',
          sessionId: 'stale-session',
          text: 'Do not restore this after logout.'
        })
      ];
      await Promise.all(attemptedVoiceWrites.map((attempt) => assert.rejects(
        attempt,
        (error) => error.code === 'LOCAL_DATA_CLEANUP_LOCKED'
      )));
    }
  });

  await Promise.resolve();
  assert.deepEqual([...memory.entries()], [['unrelated.host.preference', true]]);
});
