export { dangerZones, requestCurrentLocation, requestLocationPermission } from './mapbox-core';

export function getMapboxModule() {
  return null;
}

export async function cacheMapRegion() {
  return { status: 'unavailable' };
}

export async function purgeOfflineMapCache() {
  return { status: 'unavailable' };
}
