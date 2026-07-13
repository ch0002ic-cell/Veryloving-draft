import Mapbox from '@rnmapbox/maps';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { hasUsableMapboxAccessToken } from '../utils/mapbox-config';
import {
  ensureOfflineMapRegion,
  OFFLINE_MAP_STYLE_URL,
  purgeOfflineMapRegion
} from './offline-map-cache';
import { runLocalUserDataMutation } from './local-mutation-coordinator';

export { dangerZones, requestCurrentLocation, requestLocationPermission } from './mapbox-core';
export const MAP_LOAD_FALLBACK_MESSAGE = 'Unable to load map — please check your internet connection.';

let cacheQueue = Promise.resolve();

export function getMapboxModule() {
  if (!hasUsableMapboxAccessToken(config.mapboxAccessToken)) {
    logger.warn('[Mapbox] Runtime access token is unavailable; using the deterministic map fallback');
    return null;
  }
  Mapbox.setAccessToken(config.mapboxAccessToken.trim());
  return Mapbox;
}

export function cacheMapRegion(location) {
  cacheQueue = cacheQueue.catch(() => {}).then(() => runLocalUserDataMutation(
    () => ensureOfflineMapRegion({
      mapbox: Mapbox,
      location,
      styleURL: Mapbox.StyleURL?.Street || OFFLINE_MAP_STYLE_URL
    })
  )).catch((error) => {
    logger.warn('[Mapbox] Could not update the offline safety-map region', {
      errorCode: error?.code || error?.name || 'Error'
    });
    return { status: 'failed' };
  });
  return cacheQueue;
}

export function purgeOfflineMapCache() {
  cacheQueue = cacheQueue.catch(() => {}).then(() => purgeOfflineMapRegion({ mapbox: Mapbox }));
  return cacheQueue;
}
