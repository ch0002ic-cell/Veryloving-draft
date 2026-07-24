import { config } from '../utils/config';
import { logger } from '../utils/logger';
import {
  configureMapboxModule,
  hasUsableMapboxAccessToken
} from '../utils/mapbox-config';
import { isExpoGoRuntime } from '../utils/runtime-environment';
import {
  ensureOfflineMapRegion,
  OFFLINE_MAP_STYLE_URL,
  purgeOfflineMapRegion
} from './offline-map-cache';
import { runLocalUserDataMutation } from './local-mutation-coordinator';

export { dangerZones, requestCurrentLocation, requestLocationPermission, watchLiveLocation } from './mapbox-core';

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
        logger.recoverable('[Mapbox] Native module unavailable; using the deterministic map fallback', {
          errorCode: error?.code || error?.name || 'MAPBOX_NATIVE_UNAVAILABLE'
        });
      }
      return mapbox;
    }
  };
}

const mapboxRuntime = createMapboxRuntime();
let missingTokenLogged = false;
let moduleConfigurationFailureLogged = false;

export function getMapboxModule() {
  if (!hasUsableMapboxAccessToken(config.mapboxAccessToken)) {
    if (!missingTokenLogged) {
      missingTokenLogged = true;
      logger.recoverable('[Mapbox] Runtime access token is unavailable; using the deterministic map fallback');
    }
    return null;
  }
  const Mapbox = mapboxRuntime.getModule();
  if (!Mapbox) return null;
  return configureMapboxModule(Mapbox, config.mapboxAccessToken, {
    onFailure: (errorCode) => {
      if (moduleConfigurationFailureLogged) return;
      moduleConfigurationFailureLogged = true;
      logger.recoverable('[Mapbox] Native module configuration failed; using the deterministic map fallback', {
        errorCode
      });
    }
  });
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
    logger.recoverable('[Mapbox] Could not update the offline safety-map region', {
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
