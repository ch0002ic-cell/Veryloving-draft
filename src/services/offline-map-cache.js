import { storage } from './storage';
import { logger } from '../utils/logger';

export const OFFLINE_MAP_METADATA_KEY = 'veryloving.offlineMapPack';
// This record intentionally lives outside LOCAL_USER_DATA_PREFIX. It contains
// only opaque pack identifiers and an enumeration marker, so a broad user-data
// sweep can remove PII while preserving evidence needed to retry native tile
// deletion after a bridge or filesystem failure.
export const OFFLINE_MAP_CLEANUP_RETRY_KEY = '@veryloving/offline-map-cleanup-v1';
export const OFFLINE_MAP_STYLE_URL = 'mapbox://styles/mapbox/streets-v12';
export const OFFLINE_MAP_PACK_PREFIX = 'veryloving-offline-v2-';

const LEGACY_PACK_PREFIX = 'veryloving-last-location-';
const METADATA_VERSION = 2;
const CLEANUP_RETRY_VERSION = 1;
const REGION_DELTA = 0.018;
// Mapbox renders Web Mercator tiles, whose latitude domain stops short of the
// geographic poles. Clamping the download bounds avoids invalid/empty regions.
const MAX_MERCATOR_LATITUDE = 85.05112878;
let packSequence = 0;
let lifecycleQueue = Promise.resolve();

function queueLifecycle(operation) {
  const result = lifecycleQueue.then(operation, operation);
  lifecycleQueue = result.catch(() => {});
  return result;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function coordinate(location) {
  const latitude = location?.coords?.latitude;
  const longitude = location?.coords?.longitude;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function hashRegion(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function regionKey(options) {
  return `r-${hashRegion(JSON.stringify({
    bounds: options.bounds.map((point) => point.map((value) => Number(value.toFixed(4)))),
    styleURL: options.styleURL,
    minZoom: options.minZoom,
    maxZoom: options.maxZoom
  }))}`;
}

export function createOfflineMapPackName({ now = Date.now, random = Math.random } = {}) {
  packSequence = (packSequence + 1) % Number.MAX_SAFE_INTEGER;
  const timeToken = Math.max(0, Math.trunc(now())).toString(36);
  const randomToken = Math.floor(random() * 0x100000000).toString(36).padStart(7, '0');
  return `${OFFLINE_MAP_PACK_PREFIX}${timeToken}-${packSequence.toString(36)}-${randomToken}`;
}

function emptyMetadata() {
  return { version: METADATA_VERSION, active: null, pending: null, tombstones: [] };
}

function packEntry(value) {
  if (!value || typeof value.name !== 'string' || !value.name.trim()) return null;
  return {
    name: value.name,
    regionKey: typeof value.regionKey === 'string' ? value.regionKey : null,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : null
  };
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object') return emptyMetadata();

  // Migrate the first cache implementation in place. Legacy names are retained
  // only long enough to keep/delete the already-downloaded native pack.
  const legacyActive = typeof value.name === 'string'
    ? packEntry({ name: value.name, updatedAt: value.updatedAt })
    : null;
  const tombstones = Array.isArray(value.tombstones)
    ? [...new Set(value.tombstones.filter((name) => typeof name === 'string' && name.trim()))]
    : [];

  return {
    version: METADATA_VERSION,
    active: packEntry(value.active) || legacyActive,
    pending: packEntry(value.pending),
    tombstones
  };
}

async function readMetadata(storageImpl) {
  return normalizeMetadata(await storageImpl.getJSON(OFFLINE_MAP_METADATA_KEY, null));
}

async function writeMetadata(storageImpl, metadata) {
  await storageImpl.setJSON(OFFLINE_MAP_METADATA_KEY, normalizeMetadata(metadata));
}

function addTombstone(metadata, name) {
  if (!name) return metadata.tombstones;
  return [...new Set([...metadata.tombstones, name])];
}

async function forgetDeletedTombstone(storageImpl, name) {
  const current = await readMetadata(storageImpl);
  if (!current.tombstones.includes(name)) return;
  await writeMetadata(storageImpl, {
    ...current,
    tombstones: current.tombstones.filter((candidate) => candidate !== name)
  });
}

async function deleteTrackedPack({ manager, name, storageImpl, loggerImpl }) {
  if (!name || !manager?.deletePack) return false;
  try {
    await manager.deletePack(name);
    await forgetDeletedTombstone(storageImpl, name);
    return true;
  } catch (error) {
    // Native error messages can contain the pack identifier, so log only safe
    // operational context here.
    loggerImpl.warn('[Mapbox] Offline safety-map cleanup failed', {
      errorName: error?.name || 'Error'
    });
    return false;
  }
}

async function performPendingPromotion({ manager, name, storageImpl, loggerImpl, now }) {
  const current = await readMetadata(storageImpl);
  if (current.pending?.name !== name) return { status: 'superseded' };

  const previousName = current.active?.name;
  const promoted = {
    ...current,
    active: { ...current.pending, updatedAt: now() },
    pending: null,
    tombstones: previousName && previousName !== name
      ? addTombstone(current, previousName)
      : current.tombstones
  };

  // This single durable write is the hand-off point: the completed pack becomes
  // active before the former active pack is eligible for deletion.
  await writeMetadata(storageImpl, promoted);
  loggerImpl.info('[Mapbox] Offline safety-map region ready');

  if (previousName && previousName !== name) {
    await deleteTrackedPack({ manager, name: previousName, storageImpl, loggerImpl });
  }
  return { status: 'ready' };
}

function promotePendingPack(options) {
  return queueLifecycle(() => performPendingPromotion(options));
}

async function performPendingDiscard({ manager, name, storageImpl, loggerImpl }) {
  const current = await readMetadata(storageImpl);
  if (current.pending?.name !== name) return { status: 'superseded' };

  await writeMetadata(storageImpl, {
    ...current,
    pending: null,
    tombstones: addTombstone(current, name)
  });
  await deleteTrackedPack({ manager, name, storageImpl, loggerImpl });
  return { status: 'failed' };
}

function discardPendingPack(options) {
  return queueLifecycle(() => performPendingDiscard(options));
}

function createCompletionHandlers({ manager, name, storageImpl, loggerImpl, now }) {
  let settled = false;
  let resolveCompletion;
  const completion = new Promise((resolve) => { resolveCompletion = resolve; });

  const settle = (operation) => {
    if (settled) return;
    settled = true;
    Promise.resolve(operation()).then(resolveCompletion, (error) => {
      loggerImpl.warn('[Mapbox] Offline safety-map state update failed', {
        errorName: error?.name || 'Error'
      });
      resolveCompletion({ status: 'failed' });
    });
  };

  return {
    completion,
    onProgress(_pack, progress) {
      if (Number(progress?.percentage) >= 100) {
        settle(() => promotePendingPack({ manager, name, storageImpl, loggerImpl, now }));
      }
    },
    onError() {
      loggerImpl.warn('[Mapbox] Offline safety-map download failed');
      settle(() => discardPendingPack({ manager, name, storageImpl, loggerImpl }));
    }
  };
}

export function offlineMapPackOptions(
  location,
  styleURL = OFFLINE_MAP_STYLE_URL,
  name = createOfflineMapPackName()
) {
  const current = coordinate(location);
  if (!current || typeof name !== 'string' || !name.trim()) return null;

  const latitude = clamp(current.latitude, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  const longitude = clamp(current.longitude, -180, 180);
  return {
    name,
    styleURL,
    minZoom: 10,
    maxZoom: 15,
    bounds: [
      [clamp(longitude + REGION_DELTA, -180, 180), clamp(latitude + REGION_DELTA, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE)],
      [clamp(longitude - REGION_DELTA, -180, 180), clamp(latitude - REGION_DELTA, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE)]
    ]
  };
}

async function discardStalePending({ manager, metadata, storageImpl, loggerImpl }) {
  if (!metadata.pending?.name) return metadata;
  const next = {
    ...metadata,
    pending: null,
    tombstones: addTombstone(metadata, metadata.pending.name)
  };
  await writeMetadata(storageImpl, next);
  await deleteTrackedPack({
    manager,
    name: metadata.pending.name,
    storageImpl,
    loggerImpl
  });
  return readMetadata(storageImpl);
}

async function retainPendingPack({ manager, pending, storageImpl, loggerImpl, now }) {
  const pack = manager.getPack ? await manager.getPack(pending.name).catch(() => null) : null;
  if (!pack) return null;

  const handlers = createCompletionHandlers({
    manager,
    name: pending.name,
    storageImpl,
    loggerImpl,
    now
  });
  const status = pack.status ? await pack.status().catch(() => null) : null;
  if (Number(status?.percentage) >= 100) {
    handlers.onProgress(pack, status);
  } else {
    if (manager.subscribe) {
      await manager.subscribe(pending.name, handlers.onProgress, handlers.onError).catch(() => {});
    }
    if (pack.resume) await pack.resume().catch(() => {});
  }
  return { status: 'retained', completion: handlers.completion };
}

async function performOfflineMapRegionEnsure({
  mapbox,
  location,
  storageImpl = storage,
  loggerImpl = logger,
  styleURL = OFFLINE_MAP_STYLE_URL,
  now = Date.now,
  packNameFactory = createOfflineMapPackName
} = {}) {
  const manager = mapbox?.offlineManager;
  const name = packNameFactory({ now });
  const options = offlineMapPackOptions(location, styleURL, name);
  if (!manager?.createPack || !options) return { status: 'unavailable' };

  const targetRegionKey = regionKey(options);
  let metadata = await readMetadata(storageImpl);

  if (metadata.active?.regionKey === targetRegionKey) {
    return { status: 'retained' };
  }

  if (metadata.pending?.regionKey === targetRegionKey) {
    const retained = await retainPendingPack({
      manager,
      pending: metadata.pending,
      storageImpl,
      loggerImpl,
      now
    });
    if (retained) return retained;
  }

  metadata = await discardStalePending({ manager, metadata, storageImpl, loggerImpl });
  const pending = { name: options.name, regionKey: targetRegionKey, updatedAt: now() };
  await writeMetadata(storageImpl, { ...metadata, pending });

  const handlers = createCompletionHandlers({
    manager,
    name: options.name,
    storageImpl,
    loggerImpl,
    now
  });
  manager.setTileCountLimit?.(3000);
  try {
    await manager.createPack(options, handlers.onProgress, handlers.onError);
  } catch (error) {
    handlers.onError(null, error);
    throw error;
  }

  return { status: 'pending', completion: handlers.completion };
}

export function ensureOfflineMapRegion(options) {
  return queueLifecycle(() => performOfflineMapRegionEnsure(options));
}

function isAppOwnedPackName(name) {
  return typeof name === 'string'
    && (name.startsWith(OFFLINE_MAP_PACK_PREFIX) || name.startsWith(LEGACY_PACK_PREFIX));
}

function isOpaquePackName(name) {
  return typeof name === 'string' && name.startsWith(OFFLINE_MAP_PACK_PREFIX);
}

function isLegacyPackName(name) {
  return typeof name === 'string' && name.startsWith(LEGACY_PACK_PREFIX);
}

function normalizeCleanupRetry(value) {
  const packNames = Array.isArray(value?.packNames)
    ? [...new Set(value.packNames.filter(isOpaquePackName))]
    : [];
  return {
    version: CLEANUP_RETRY_VERSION,
    packNames,
    enumerationPending: value?.enumerationPending === true
  };
}

function cleanupRetryValue(packNames, enumerationPending = false) {
  return {
    packNames: [...packNames].filter(isOpaquePackName),
    // Legacy pack names encoded coordinates. Never copy them into the durable
    // non-user-data record; a successful native enumeration can rediscover and
    // remove those packs without persisting another location-derived value.
    enumerationPending: enumerationPending || [...packNames].some(isLegacyPackName)
  };
}

async function readCleanupRetry(storageImpl) {
  return normalizeCleanupRetry(
    await storageImpl.getJSON(OFFLINE_MAP_CLEANUP_RETRY_KEY, null)
  );
}

async function writeCleanupRetry(storageImpl, value) {
  const retry = normalizeCleanupRetry(value);
  if (!retry.packNames.length && !retry.enumerationPending) {
    if (storageImpl.remove) {
      await storageImpl.remove(OFFLINE_MAP_CLEANUP_RETRY_KEY);
    } else {
      await storageImpl.setJSON(OFFLINE_MAP_CLEANUP_RETRY_KEY, retry);
    }
    return;
  }
  await storageImpl.setJSON(OFFLINE_MAP_CLEANUP_RETRY_KEY, retry);
}

async function performOfflineMapPurge({
  mapbox,
  storageImpl = storage,
  loggerImpl = logger
} = {}) {
  const manager = mapbox?.offlineManager;
  const metadata = await readMetadata(storageImpl);
  const cleanupRetry = await readCleanupRetry(storageImpl);
  const candidates = new Set([
    metadata.active?.name,
    metadata.pending?.name,
    ...metadata.tombstones,
    ...cleanupRetry.packNames
  ].filter(isAppOwnedPackName));

  let enumerationFailed = !manager?.getPacks;
  if (manager?.getPacks) {
    try {
      const packs = await manager.getPacks();
      for (const pack of packs || []) {
        const name = typeof pack === 'string' ? pack : (pack?.name || pack?.metadata?.name);
        if (isAppOwnedPackName(name)) candidates.add(name);
      }
    } catch (error) {
      enumerationFailed = true;
      loggerImpl.warn('[Mapbox] Could not enumerate offline safety-map regions', {
        errorName: error?.name || 'Error'
      });
    }
  }

  if (!candidates.size && !enumerationFailed) {
    if (storageImpl.remove) await storageImpl.remove(OFFLINE_MAP_METADATA_KEY);
    await writeCleanupRetry(storageImpl, null);
    return { status: 'empty', count: 0 };
  }

  // Clear active/pending before native deletion so a late download callback
  // cannot resurrect location-derived cache metadata during a privacy purge.
  await writeMetadata(storageImpl, {
    ...emptyMetadata(),
    tombstones: [...candidates]
  });
  // Persist every candidate before crossing the native bridge. A process death
  // midway through deletion must leave a non-swept retry record.
  const remaining = new Set(candidates);
  await writeCleanupRetry(
    storageImpl,
    cleanupRetryValue(remaining, enumerationFailed)
  );

  if (!manager?.deletePack) {
    const error = new Error('Offline safety-map cleanup is unavailable.');
    error.name = 'OfflineMapPurgeError';
    throw error;
  }

  const failed = [];
  for (const name of candidates) {
    try {
      await manager.deletePack(name);
      remaining.delete(name);
      await writeCleanupRetry(
        storageImpl,
        cleanupRetryValue(remaining, enumerationFailed)
      );
    } catch (error) {
      failed.push(name);
      loggerImpl.warn('[Mapbox] Offline safety-map cleanup failed', {
        errorName: error?.name || 'Error'
      });
    }
  }

  if (failed.length || enumerationFailed) {
    await writeMetadata(storageImpl, { ...emptyMetadata(), tombstones: failed });
    await writeCleanupRetry(
      storageImpl,
      cleanupRetryValue(failed, enumerationFailed)
    );
    const error = new Error('Offline safety-map cleanup could not be verified.');
    error.name = 'OfflineMapPurgeError';
    error.failureCount = failed.length;
    throw error;
  }

  if (storageImpl.remove) {
    await storageImpl.remove(OFFLINE_MAP_METADATA_KEY);
  } else {
    await writeMetadata(storageImpl, emptyMetadata());
  }
  await writeCleanupRetry(storageImpl, null);
  return { status: 'deleted', count: candidates.size };
}

export function purgeOfflineMapRegion(options) {
  return queueLifecycle(() => performOfflineMapPurge(options));
}
