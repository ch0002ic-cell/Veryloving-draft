import * as Location from 'expo-location';
import { explainPermission } from './permissions';
import { withTimeout } from '../utils/async';
import { translate } from '../i18n/core';
import { loadLastKnownLocation, saveLastKnownLocation } from './location-cache';
import { logger } from '../utils/logger';

export const dangerZones = [
  { id: 'queen-west', nameKey: 'map.zones.crowding', coordinate: [-79.400, 43.648], radius: 220, risk: 'medium' },
  { id: 'casa-loma', nameKey: 'map.zones.lowLighting', coordinate: [-79.409, 43.678], radius: 180, risk: 'low' }
];

export async function requestLocationPermission({ showRationale = true } = {}) {
  const existing = await Location.getForegroundPermissionsAsync();
  if (existing.granted) return existing;
  if (!existing.granted && showRationale && !await explainPermission('location')) {
    throw new Error(translate('map.notRequested'));
  }
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error(translate('map.permissionOff'));
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
