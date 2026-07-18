import * as Location from 'expo-location';
import { explainPermission } from './permissions';
import { withTimeout } from '../utils/async';
import { translate } from '../i18n/core';
import { loadLastKnownLocation, saveLastKnownLocation } from './location-cache';
import { logger } from '../utils/logger';

const SAMPLE_DANGER_ZONES = [
  { id: 'queen-west', nameKey: 'map.zones.crowding', coordinate: [-79.400, 43.648], radius: 220, risk: 'medium' },
  { id: 'casa-loma', nameKey: 'map.zones.lowLighting', coordinate: [-79.409, 43.678], radius: 180, risk: 'low' }
];

const DEVELOPMENT_RUNTIME = typeof __DEV__ !== 'undefined' && __DEV__;

// These coordinates are visual-development fixtures, not authoritative risk
// intelligence. A TestFlight/store build must never present them as live
// safety data while the production danger-zone service is still external.
export const dangerZones = Object.freeze(DEVELOPMENT_RUNTIME ? SAMPLE_DANGER_ZONES : []);

function locationAccessError(code, translationKey) {
  const error = new Error(translate(translationKey));
  error.code = code;
  error.userFacing = true;
  return error;
}

export async function requestLocationPermission({ showRationale = true } = {}) {
  const existing = await Location.getForegroundPermissionsAsync();
  if (existing.granted) return existing;
  if (!existing.granted && showRationale && !await explainPermission('location')) {
    throw locationAccessError('LOCATION_NOT_REQUESTED', 'map.notRequested');
  }
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw locationAccessError('LOCATION_PERMISSION_DENIED', 'map.permissionOff');
  return permission;
}

export async function requestCurrentLocation({ showRationale = true } = {}) {
  await requestLocationPermission({ showRationale });
  try {
    const location = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      10000,
      translate('map.timeout')
    );
    await saveLastKnownLocation(location).catch((error) => {
      logger.warn('[Mapbox] Could not persist the last known location', { name: error?.name });
    });
    return { ...location, isCached: false };
  } catch (liveLocationError) {
    const cached = await loadLastKnownLocation().catch(() => null);
    if (cached) {
      logger.warn('[Mapbox] Live location unavailable; using the recent local location cache', {
        name: liveLocationError?.name,
        cachedAt: cached.cachedAt
      });
      return cached;
    }
    throw liveLocationError;
  }
}

export async function watchLiveLocation(onLocation, {
  showRationale = false,
  locationImpl = Location,
  requestPermission = requestLocationPermission
} = {}) {
  if (typeof onLocation !== 'function') throw new TypeError('A live location callback is required.');
  await requestPermission({ showRationale });
  return locationImpl.watchPositionAsync({
    accuracy: locationImpl.Accuracy?.Balanced,
    timeInterval: 10000,
    distanceInterval: 15
  }, (location) => {
    onLocation({ ...location, isCached: false });
    saveLastKnownLocation(location).catch((error) => logger.warn('[Mapbox] Could not cache a live location update', {
      name: error?.name || 'LocationCacheError'
    }));
  });
}
