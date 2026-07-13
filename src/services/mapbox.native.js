import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { hasUsableMapboxAccessToken } from '../utils/mapbox-config';
import { isExpoGoRuntime } from '../utils/runtime-environment';
import {
  ensureOfflineMapRegion,
  OFFLINE_MAP_STYLE_URL,
  purgeOfflineMapRegion
} from './offline-map-cache';
import { runLocalUserDataMutation } from './local-mutation-coordinator';

export { dangerZones, requestCurrentLocation, requestLocationPermission } from './mapbox-core';
export const MAP_LOAD_FALLBACK_MESSAGE = 'Unable to load map — please check your internet connection.';

let cacheQueue = Promise.resolve();

export function createMapboxRuntime({
  isExpoGo = isExpoGoRuntime,
  loadMapbox = () => require('@rnmapbox/maps')
} = {}) {
  let loadAttempted = false;
  let mapbox = null;

  return {
    getModule() {
      if (isExpoGo()) return null;
      if (loadAttempted) return mapbox;
      loadAttempted = true;
      try {
        const loaded = loadMapbox();
        mapbox = loaded.default || loaded;
      } catch (error) {
        logger.warn('[Mapbox] Native module unavailable; using the deterministic map fallback', {
          errorCode: error?.code || error?.name || 'MAPBOX_NATIVE_UNAVAILABLE'
        });
      }
      return mapbox;
    }
  };
}

const mapboxRuntime = createMapboxRuntime();

export function getMapboxModule() {
  if (!hasUsableMapboxAccessToken(config.mapboxAccessToken)) {
    logger.warn('[Mapbox] Runtime access token is unavailable; using the deterministic map fallback');
    return null;
  }
  const Mapbox = mapboxRuntime.getModule();
  if (!Mapbox) return null;
  Mapbox.setAccessToken(config.mapboxAccessToken.trim());
  return Mapbox;
}

export function cacheMapRegion(location) {
  const Mapbox = getMapboxModule();
  if (!Mapbox) return Promise.resolve({ status: 'unavailable' });
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
  const Mapbox = mapboxRuntime.getModule();
  if (!Mapbox) return Promise.resolve({ status: 'unavailable' });
  cacheQueue = cacheQueue.catch(() => {}).then(() => purgeOfflineMapRegion({ mapbox: Mapbox }));
  return cacheQueue;
}
