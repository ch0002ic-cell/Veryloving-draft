'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  LAST_LOCATION_KEY,
  createLocationSnapshot,
  loadLastKnownLocation,
  saveLastKnownLocation
} = require('../src/services/location-cache');
const {
  OFFLINE_MAP_CLEANUP_RETRY_KEY,
  OFFLINE_MAP_METADATA_KEY,
  OFFLINE_MAP_PACK_PREFIX,
  ensureOfflineMapRegion,
  offlineMapPackOptions,
  purgeOfflineMapRegion
} = require('../src/services/offline-map-cache');
const {
  LAST_SOS_STATUS_KEY,
  PENDING_SOS_ATTEMPT_KEY,
  clearPendingSOSAttempt,
  loadSOSStatus,
  loadOrCreatePendingSOSAttempt,
  markSOSAttemptAccepted,
  runAndPersistSOS,
  SOS_ATTEMPT_STATUS,
  sosStatusTranslationKey
} = require('../src/services/sos-state');
const {
  lockAndDrainLocalUserDataMutations,
  runLocalUserDataMutation
} = require('../src/services/local-mutation-coordinator');

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async getJSON(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
    async setJSON(key, value) { values.set(key, value); },
    async remove(key) { values.delete(key); },
    has(key) { return values.has(key); },
    value(key) { return values.get(key); }
  };
}

const liveLocation = {
  timestamp: 1_000,
  coords: { latitude: 1.3521, longitude: 103.8198, accuracy: 12 }
};

test('last known location cache validates coordinates and expires stale entries', async () => {
  const storage = memoryStorage();
  const snapshot = await saveLastKnownLocation(liveLocation, {
    storageImpl: storage,
    now: () => 2_000
  });
  assert.deepEqual(snapshot, createLocationSnapshot(liveLocation, () => 2_000));
  assert.equal(storage.value(LAST_LOCATION_KEY).coords.longitude, 103.8198);

  const cached = await loadLastKnownLocation({
    storageImpl: storage,
    now: () => 2_100,
    maxAgeMs: 1_000
  });
  assert.equal(cached.isCached, true);
  assert.equal(cached.cachedAt, 2_000);

  assert.equal(await loadLastKnownLocation({
    storageImpl: storage,
    now: () => 3_001,
    maxAgeMs: 1_000
  }), null);
  assert.equal(createLocationSnapshot({ coords: { latitude: 100, longitude: 0 } }), null);
});

test('offline map cache keeps the active pack until deferred download progress completes', async () => {
  const storage = memoryStorage({
    [OFFLINE_MAP_METADATA_KEY]: {
      version: 2,
      active: { name: `${OFFLINE_MAP_PACK_PREFIX}active`, regionKey: 'old-region' },
      pending: null,
      tombstones: []
    }
  });
  const actions = [];
  let progress;
  const manager = {
    setTileCountLimit(limit) { actions.push(`limit:${limit}`); },
    async createPack(options, onProgress) {
      actions.push(`create:${options.name}`);
      progress = onProgress;
    },
    async deletePack(name) { actions.push(`delete:${name}`); }
  };
  const result = await ensureOfflineMapRegion({
    mapbox: { offlineManager: manager },
    location: liveLocation,
    storageImpl: storage,
    loggerImpl: { info() {}, warn() {} },
    packNameFactory: () => `${OFFLINE_MAP_PACK_PREFIX}pending`
  });

  assert.equal(result.status, 'pending');
  assert.equal(actions[0], 'limit:3000');
  assert.equal(actions[1], `create:${OFFLINE_MAP_PACK_PREFIX}pending`);
  assert.equal(actions.some((action) => action.startsWith('delete:')), false);
  assert.equal(storage.value(OFFLINE_MAP_METADATA_KEY).active.name, `${OFFLINE_MAP_PACK_PREFIX}active`);
  assert.equal(storage.value(OFFLINE_MAP_METADATA_KEY).pending.name, `${OFFLINE_MAP_PACK_PREFIX}pending`);

  progress(null, { percentage: 99.9 });
  assert.equal(actions.some((action) => action.startsWith('delete:')), false);
  progress(null, { percentage: 100 });
  await result.completion;

  assert.equal(storage.value(OFFLINE_MAP_METADATA_KEY).active.name, `${OFFLINE_MAP_PACK_PREFIX}pending`);
  assert.equal(storage.value(OFFLINE_MAP_METADATA_KEY).pending, null);
  assert.deepEqual(actions.slice(2), [`delete:${OFFLINE_MAP_PACK_PREFIX}active`]);
});

test('offline map cache removes a failed pending download while preserving the active pack', async () => {
  const activeName = `${OFFLINE_MAP_PACK_PREFIX}active`;
  const pendingName = `${OFFLINE_MAP_PACK_PREFIX}pending`;
  const storage = memoryStorage({
    [OFFLINE_MAP_METADATA_KEY]: {
      version: 2,
      active: { name: activeName, regionKey: 'old-region' },
      pending: null,
      tombstones: []
    }
  });
  const deleted = [];
  let failDownload;
  const result = await ensureOfflineMapRegion({
    mapbox: {
      offlineManager: {
        async createPack(_options, _progress, onError) { failDownload = onError; },
        async deletePack(name) { deleted.push(name); }
      }
    },
    location: liveLocation,
    storageImpl: storage,
    loggerImpl: { info() {}, warn() {} },
    packNameFactory: () => pendingName
  });

  failDownload(null, new Error('network unavailable'));
  await result.completion;

  assert.equal(storage.value(OFFLINE_MAP_METADATA_KEY).active.name, activeName);
  assert.equal(storage.value(OFFLINE_MAP_METADATA_KEY).pending, null);
  assert.deepEqual(deleted, [pendingName]);
  assert.equal(deleted.includes(activeName), false);
});

test('offline map cache resumes an incomplete pending pack without duplication', async () => {
  let resumed = 0;
  let created = 0;
  const storage = memoryStorage();
  const pendingName = `${OFFLINE_MAP_PACK_PREFIX}resume`;
  const first = await ensureOfflineMapRegion({
    mapbox: {
      offlineManager: {
        async createPack() { created += 1; }
      }
    },
    location: liveLocation,
    storageImpl: storage,
    loggerImpl: { info() {}, warn() {} },
    packNameFactory: () => pendingName
  });
  assert.equal(first.status, 'pending');

  const result = await ensureOfflineMapRegion({
    mapbox: {
      offlineManager: {
        async getPack(name) {
          assert.equal(name, pendingName);
          return {
            async status() { return { percentage: 40 }; },
            async resume() { resumed += 1; }
          };
        },
        async subscribe() {},
        async createPack() { created += 1; }
      }
    },
    location: liveLocation,
    storageImpl: storage,
    loggerImpl: { info() {}, warn() {} },
    packNameFactory: () => `${OFFLINE_MAP_PACK_PREFIX}unused`
  });

  assert.equal(result.status, 'retained');
  assert.equal(resumed, 1);
  assert.equal(created, 1);
});

test('offline pack names are opaque and boundary coordinates produce clamped bounds', () => {
  assert.equal(offlineMapPackOptions({ coords: { latitude: null, longitude: 0 } }), null);
  assert.equal(offlineMapPackOptions({ coords: { latitude: '', longitude: 0 } }), null);
  assert.equal(offlineMapPackOptions({ coords: { latitude: 0, longitude: '' } }), null);

  const northeast = offlineMapPackOptions(
    { coords: { latitude: 90, longitude: 180 } },
    undefined,
    `${OFFLINE_MAP_PACK_PREFIX}north-boundary`
  );
  const southwest = offlineMapPackOptions(
    { coords: { latitude: -90, longitude: -180 } },
    undefined,
    `${OFFLINE_MAP_PACK_PREFIX}south-boundary`
  );
  for (const options of [northeast, southwest]) {
    assert.equal(options.name.startsWith(OFFLINE_MAP_PACK_PREFIX), true);
    assert.equal(options.name.includes('90'), false);
    assert.equal(options.name.includes('180'), false);
    for (const [longitude, latitude] of options.bounds) {
      assert.equal(longitude >= -180 && longitude <= 180, true);
      assert.equal(latitude >= -85.05112878 && latitude <= 85.05112878, true);
    }
  }
  assert.equal(northeast.bounds[0][0], 180);
  assert.equal(southwest.bounds[1][0], -180);
});

test('failed old-pack deletion leaves a tombstone that privacy purge can recover', async () => {
  const activeName = `${OFFLINE_MAP_PACK_PREFIX}active`;
  const replacementName = `${OFFLINE_MAP_PACK_PREFIX}replacement`;
  const storage = memoryStorage({
    [OFFLINE_MAP_METADATA_KEY]: {
      version: 2,
      active: { name: activeName, regionKey: 'old-region' },
      pending: null,
      tombstones: []
    }
  });
  const deleted = [];
  let progress;
  let failOldDeletion = true;
  const manager = {
    async createPack(_options, onProgress) { progress = onProgress; },
    async deletePack(name) {
      if (name === activeName && failOldDeletion) {
        failOldDeletion = false;
        throw new Error('native deletion failed');
      }
      deleted.push(name);
    },
    async getPacks() {
      return [{ name: activeName }, { name: replacementName }, { name: 'some-other-app-pack' }];
    }
  };
  const created = await ensureOfflineMapRegion({
    mapbox: { offlineManager: manager },
    location: liveLocation,
    storageImpl: storage,
    loggerImpl: { info() {}, warn() {} },
    packNameFactory: () => replacementName
  });
  progress(null, { percentage: 100 });
  await created.completion;

  assert.equal(storage.value(OFFLINE_MAP_METADATA_KEY).active.name, replacementName);
  assert.deepEqual(storage.value(OFFLINE_MAP_METADATA_KEY).tombstones, [activeName]);

  const result = await purgeOfflineMapRegion({
    mapbox: { offlineManager: manager },
    storageImpl: storage,
    loggerImpl: { warn() {} }
  });

  assert.equal(result.status, 'deleted');
  assert.equal(result.count, 2);
  assert.deepEqual(new Set(deleted), new Set([activeName, replacementName]));
  assert.equal(storage.has(OFFLINE_MAP_METADATA_KEY), false);
});

test('privacy purge tries every app-owned pack and retains only failures for retry', async () => {
  const activeName = `${OFFLINE_MAP_PACK_PREFIX}active-private`;
  const failedName = 'veryloving-last-location-135-10382';
  const orphanName = `${OFFLINE_MAP_PACK_PREFIX}orphan-private`;
  const storage = memoryStorage({
    [OFFLINE_MAP_METADATA_KEY]: {
      version: 2,
      active: { name: activeName, regionKey: 'private-region' },
      pending: null,
      tombstones: [failedName]
    }
  });
  const attempted = [];
  const logEntries = [];
  let shouldFail = true;
  const manager = {
    async getPacks() {
      return [{ name: orphanName }, { name: 'another-app-pack' }];
    },
    async deletePack(name) {
      attempted.push(name);
      if (name === failedName && shouldFail) throw new Error(`failed ${name}`);
    }
  };

  await assert.rejects(
    purgeOfflineMapRegion({
      mapbox: { offlineManager: manager },
      storageImpl: storage,
      loggerImpl: { warn(...args) { logEntries.push(args); } }
    }),
    (error) => error.name === 'OfflineMapPurgeError' && error.failureCount === 1
  );
  assert.deepEqual(new Set(attempted), new Set([activeName, failedName, orphanName]));
  assert.deepEqual(storage.value(OFFLINE_MAP_METADATA_KEY).tombstones, [failedName]);
  assert.deepEqual(storage.value(OFFLINE_MAP_CLEANUP_RETRY_KEY), {
    version: 1,
    packNames: [],
    enumerationPending: true
  });
  assert.equal(JSON.stringify(storage.value(OFFLINE_MAP_CLEANUP_RETRY_KEY)).includes('135-10382'), false);
  assert.equal(JSON.stringify(logEntries).includes(failedName), false);

  shouldFail = false;
  attempted.length = 0;
  manager.getPacks = async () => [{ name: failedName }];
  const retried = await purgeOfflineMapRegion({
    mapbox: { offlineManager: manager },
    storageImpl: storage,
    loggerImpl: { warn() {} }
  });
  assert.equal(retried.status, 'deleted');
  assert.deepEqual(attempted, [failedName]);
  assert.equal(storage.has(OFFLINE_MAP_METADATA_KEY), false);
  assert.equal(storage.has(OFFLINE_MAP_CLEANUP_RETRY_KEY), false);
});

test('failed pack enumeration leaves durable verification evidence for retry', async () => {
  const storage = memoryStorage();
  const manager = {
    async getPacks() { throw new Error('native bridge unavailable'); },
    async deletePack() {}
  };

  await assert.rejects(
    purgeOfflineMapRegion({
      mapbox: { offlineManager: manager },
      storageImpl: storage,
      loggerImpl: { warn() {} }
    }),
    (error) => error.name === 'OfflineMapPurgeError' && error.failureCount === 0
  );
  assert.deepEqual(storage.value(OFFLINE_MAP_CLEANUP_RETRY_KEY), {
    version: 1,
    packNames: [],
    enumerationPending: true
  });

  manager.getPacks = async () => [];
  const retried = await purgeOfflineMapRegion({
    mapbox: { offlineManager: manager },
    storageImpl: storage,
    loggerImpl: { warn() {} }
  });
  assert.equal(retried.status, 'empty');
  assert.equal(storage.has(OFFLINE_MAP_CLEANUP_RETRY_KEY), false);
});

test('SOS outcome and failure status survive local reload without duplicating contact PII', async () => {
  const storage = memoryStorage();
  const result = await runAndPersistSOS(async () => ({
    status: 'dialer_opened',
    contact: { id: 'guardian', name: 'Grace', phone: '+6591234567' }
  }), { storageImpl: storage, now: () => 5_000, loggerImpl: { warn() {} } });
  assert.equal(result.status, 'dialer_opened');
  assert.deepEqual(await loadSOSStatus({ storageImpl: storage }), {
    version: 2,
    status: 'dialer_opened',
    backendStatus: 'disabled',
    backendReceiptId: null,
    recordedAt: 5_000
  });
  const storedSOS = JSON.stringify(storage.value(LAST_SOS_STATUS_KEY));
  assert.equal(storedSOS.includes('+6591234567'), false);
  assert.equal(storedSOS.includes('Grace'), false);
  assert.equal(storedSOS.includes('guardian'), false);

  await assert.rejects(runAndPersistSOS(
    async () => { throw new Error('dialer failed'); },
    { storageImpl: storage, now: () => 6_000, loggerImpl: { warn() {} } }
  ), /dialer failed/);
  assert.equal((await loadSOSStatus({ storageImpl: storage })).status, 'dialer_failed');
  assert.equal(sosStatusTranslationKey('dialer_opened'), 'releaseCritical.sosDialerOpened');
  assert.equal(sosStatusTranslationKey('cancelled'), 'releaseCritical.sosCancelled');
  assert.equal(sosStatusTranslationKey('dialer_failed'), 'releaseCritical.sosDialerFailed');
  assert.equal(sosStatusTranslationKey('unexpected'), 'releaseCritical.sosUnknown');
});

test('SOS retry idempotency survives reload until a definitive backend receipt', async () => {
  const storage = memoryStorage();
  let generated = 0;
  const options = {
    accountId: 'google:account-a',
    contactIds: ['contact_b', 'contact_a', 'contact_a'],
    storageImpl: storage,
    now: () => 10_000,
    createId: () => `durable-key-${++generated}`
  };
  const first = await loadOrCreatePendingSOSAttempt(options);
  const retry = await loadOrCreatePendingSOSAttempt({
    ...options,
    contactIds: ['contact_a', 'contact_b']
  });
  assert.equal(retry.idempotencyKey, first.idempotencyKey);
  assert.equal(retry.status, SOS_ATTEMPT_STATUS.pending);
  assert.equal(generated, 1);
  assert.equal(storage.has(PENDING_SOS_ATTEMPT_KEY), true);

  assert.equal(await markSOSAttemptAccepted(first.idempotencyKey, {
    storageImpl: storage,
    now: () => 10_100
  }), true);
  assert.equal(storage.value(PENDING_SOS_ATTEMPT_KEY).status, SOS_ATTEMPT_STATUS.accepted);
  assert.equal(storage.value(PENDING_SOS_ATTEMPT_KEY).acceptedAt, 10_100);

  const nextActivation = await loadOrCreatePendingSOSAttempt(options);
  assert.notEqual(nextActivation.idempotencyKey, first.idempotencyKey);
  assert.equal(nextActivation.status, SOS_ATTEMPT_STATUS.pending);
  assert.equal(generated, 2);

  const indeterminateRetry = await loadOrCreatePendingSOSAttempt(options);
  assert.equal(indeterminateRetry.idempotencyKey, nextActivation.idempotencyKey);
  assert.equal(generated, 2);

  assert.equal(await clearPendingSOSAttempt('another-key', { storageImpl: storage }), false);
  assert.equal(await clearPendingSOSAttempt(nextActivation.idempotencyKey, { storageImpl: storage }), true);
  assert.equal(storage.has(PENDING_SOS_ATTEMPT_KEY), false);
});

test('accepted SOS persistence failure removes the reusable pending key as a safe fallback', async () => {
  const storage = memoryStorage();
  let generated = 0;
  const options = {
    accountId: 'google:account-a',
    contactIds: ['contact_a'],
    storageImpl: storage,
    now: () => 20_000,
    createId: () => `fallback-key-${++generated}`
  };
  const first = await loadOrCreatePendingSOSAttempt(options);
  const persist = storage.setJSON;
  storage.setJSON = async (key, value) => {
    if (key === PENDING_SOS_ATTEMPT_KEY && value?.status === SOS_ATTEMPT_STATUS.accepted) {
      throw new Error('accepted status write failed');
    }
    return persist(key, value);
  };

  await assert.rejects(
    markSOSAttemptAccepted(first.idempotencyKey, { storageImpl: storage }),
    /accepted status write failed/
  );
  assert.equal(storage.has(PENDING_SOS_ATTEMPT_KEY), false);

  storage.setJSON = persist;
  const next = await loadOrCreatePendingSOSAttempt(options);
  assert.notEqual(next.idempotencyKey, first.idempotencyKey);
  assert.equal(generated, 2);
});

test('accepted SOS key remains guarded when storage is briefly unreadable after acceptance', async () => {
  const storage = memoryStorage();
  let generated = 0;
  const options = {
    accountId: 'google:account-storage-recovery',
    contactIds: ['contact_a'],
    storageImpl: storage,
    now: () => 30_000,
    createId: () => `recovery-key-${++generated}`
  };
  const accepted = await loadOrCreatePendingSOSAttempt(options);
  const getJSON = storage.getJSON;
  storage.getJSON = async () => {
    throw new Error('temporary storage read failure');
  };

  await assert.rejects(
    markSOSAttemptAccepted(accepted.idempotencyKey, { storageImpl: storage }),
    /temporary storage read failure/
  );

  storage.getJSON = getJSON;
  const next = await loadOrCreatePendingSOSAttempt(options);
  assert.notEqual(next.idempotencyKey, accepted.idempotencyKey);
  assert.equal(generated, 2);
});

test('local cleanup drains an in-flight write and blocks stale writers until release', async () => {
  let finishWrite;
  const writeStarted = new Promise((resolve) => {
    runLocalUserDataMutation(async () => {
      resolve();
      await new Promise((finish) => { finishWrite = finish; });
    });
  });
  await writeStarted;

  let lockFinished = false;
  const locking = lockAndDrainLocalUserDataMutations().then((release) => {
    lockFinished = true;
    return release;
  });
  await Promise.resolve();
  assert.equal(lockFinished, false);

  finishWrite();
  const release = await locking;
  await assert.rejects(
    runLocalUserDataMutation(async () => {}),
    (error) => error.code === 'LOCAL_DATA_CLEANUP_LOCKED'
  );

  release();
  await runLocalUserDataMutation(async () => {});
});
