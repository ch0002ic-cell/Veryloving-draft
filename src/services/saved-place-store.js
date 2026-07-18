import { secureStorage } from './secure-storage';
import { createAuthenticationNonce } from '../utils/session-token';

export const SAVED_PLACES_KEY = 'veryloving.savedPlaces.secure.v1';
export const SAVED_PLACES_VERSION = 1;
export const MAX_SAVED_PLACES = 8;
export const DEFAULT_SAVED_PLACE_RADIUS_METERS = 200;

let mutationQueue = Promise.resolve();

function normalizedAccountId(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 512 ? normalized : null;
}

function finiteCoordinate(value, minimum, maximum) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= minimum && coordinate <= maximum
    ? coordinate
    : null;
}

export function normalizeSavedPlace(value) {
  const latitude = finiteCoordinate(value?.latitude, -90, 90);
  const longitude = finiteCoordinate(value?.longitude, -180, 180);
  const id = typeof value?.id === 'string' && value.id.trim().length <= 128
    ? value.id.trim()
    : null;
  const capturedAt = Number(value?.capturedAt);
  const suppliedRadius = Number(value?.radiusMeters);
  const radiusMeters = Number.isFinite(suppliedRadius)
    && suppliedRadius >= 25
    && suppliedRadius <= 100000
    ? suppliedRadius
    : DEFAULT_SAVED_PLACE_RADIUS_METERS;
  if (!id || latitude === null || longitude === null || !Number.isFinite(capturedAt) || capturedAt <= 0) {
    return null;
  }
  return { id, latitude, longitude, radiusMeters, capturedAt };
}

function parseSnapshot(raw, accountId) {
  if (!raw || !accountId) return [];
  try {
    const snapshot = JSON.parse(raw);
    if (snapshot?.version !== SAVED_PLACES_VERSION || snapshot.accountId !== accountId) return [];
    return Array.isArray(snapshot.places)
      ? snapshot.places.map(normalizeSavedPlace).filter(Boolean).slice(-MAX_SAVED_PLACES)
      : [];
  } catch {
    return [];
  }
}

async function readPlaces(accountId) {
  return parseSnapshot(await secureStorage.getItemAsync(SAVED_PLACES_KEY), accountId);
}

async function writePlaces(accountId, places) {
  await secureStorage.setItemAsync(SAVED_PLACES_KEY, JSON.stringify({
    version: SAVED_PLACES_VERSION,
    accountId,
    places: places.slice(-MAX_SAVED_PLACES)
  }));
}

function runMutation(mutation) {
  const operation = mutationQueue.catch(() => {}).then(mutation);
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function loadSavedPlaces(accountId) {
  const normalized = normalizedAccountId(accountId);
  if (!normalized) return [];
  await mutationQueue.catch(() => {});
  return readPlaces(normalized);
}

export function saveCurrentPlace(accountId, location, {
  createId = createAuthenticationNonce,
  now = Date.now
} = {}) {
  const normalized = normalizedAccountId(accountId);
  if (!normalized) return Promise.reject(new Error('An authenticated account is required to save a place.'));
  const candidate = normalizeSavedPlace({
    id: createId(),
    latitude: location?.coords?.latitude,
    longitude: location?.coords?.longitude,
    radiusMeters: DEFAULT_SAVED_PLACE_RADIUS_METERS,
    capturedAt: Number(location?.timestamp || location?.cachedAt) || now()
  });
  if (!candidate) return Promise.reject(new Error('A valid current location is required to save a place.'));
  return runMutation(async () => {
    const current = await readPlaces(normalized);
    const next = [...current, candidate].slice(-MAX_SAVED_PLACES);
    await writePlaces(normalized, next);
    return next;
  });
}

export function removeSavedPlace(accountId, placeId) {
  const normalized = normalizedAccountId(accountId);
  if (!normalized || typeof placeId !== 'string') return Promise.reject(new Error('A saved place is required.'));
  return runMutation(async () => {
    const current = await readPlaces(normalized);
    const next = current.filter((place) => place.id !== placeId);
    await writePlaces(normalized, next);
    return next;
  });
}

export function clearSavedPlaces() {
  return runMutation(() => secureStorage.deleteItemAsync(SAVED_PLACES_KEY));
}
