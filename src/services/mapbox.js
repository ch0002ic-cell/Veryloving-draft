export { dangerZones, requestCurrentLocation, requestLocationPermission } from './mapbox-core';

export const MAP_LOAD_FALLBACK_MESSAGE = 'Unable to load map — please check your internet connection.';

export function getMapboxModule() {
  return null;
}

export async function cacheMapRegion() {
  return { status: 'unavailable' };
}

export async function purgeOfflineMapCache() {
  return { status: 'unavailable' };
}
