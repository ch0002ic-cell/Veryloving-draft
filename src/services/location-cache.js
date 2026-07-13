import { storage } from './storage';
import { runLocalUserDataMutation } from './local-mutation-coordinator';

export const LAST_LOCATION_KEY = 'veryloving.lastKnownLocation';
export const LAST_LOCATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function createLocationSnapshot(location, now = Date.now) {
  const latitude = finiteNumber(location?.coords?.latitude);
  const longitude = finiteNumber(location?.coords?.longitude);
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return null;
  }
  const cachedAt = finiteNumber(now()) ?? Date.now();
  return {
    version: 1,
    cachedAt,
    timestamp: finiteNumber(location?.timestamp) || cachedAt,
    coords: {
      latitude,
      longitude,
      accuracy: finiteNumber(location?.coords?.accuracy),
      altitude: finiteNumber(location?.coords?.altitude),
      altitudeAccuracy: finiteNumber(location?.coords?.altitudeAccuracy),
      heading: finiteNumber(location?.coords?.heading),
      speed: finiteNumber(location?.coords?.speed)
    }
  };
}

export function isUsableLocationSnapshot(
  snapshot,
  { now = Date.now, maxAgeMs = LAST_LOCATION_MAX_AGE_MS } = {}
) {
  if (!snapshot || snapshot.version !== 1 || !snapshot.coords) return false;
  const latitude = finiteNumber(snapshot.coords.latitude);
  const longitude = finiteNumber(snapshot.coords.longitude);
  const cachedAt = finiteNumber(snapshot.cachedAt);
  if (latitude === null || longitude === null || cachedAt === null) return false;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false;
  const age = now() - cachedAt;
  return age >= 0 && age <= maxAgeMs;
}

export async function saveLastKnownLocation(
  location,
  { storageImpl = storage, now = Date.now } = {}
) {
  const snapshot = createLocationSnapshot(location, now);
  if (!snapshot) return null;
  await runLocalUserDataMutation(() => storageImpl.setJSON(LAST_LOCATION_KEY, snapshot));
  return snapshot;
}

export async function loadLastKnownLocation(
  { storageImpl = storage, now = Date.now, maxAgeMs = LAST_LOCATION_MAX_AGE_MS } = {}
) {
  const snapshot = await storageImpl.getJSON(LAST_LOCATION_KEY, null);
  if (!isUsableLocationSnapshot(snapshot, { now, maxAgeMs })) return null;
  return { ...snapshot, isCached: true };
}
