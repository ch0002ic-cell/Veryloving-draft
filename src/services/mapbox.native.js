import Mapbox from '@rnmapbox/maps';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { hasUsableMapboxAccessToken } from '../utils/mapbox-config';

export { dangerZones, requestCurrentLocation, requestLocationPermission } from './mapbox-core';

export function getMapboxModule() {
  if (!hasUsableMapboxAccessToken(config.mapboxAccessToken)) {
    logger.warn('[Mapbox] Runtime access token is unavailable; using the deterministic map fallback');
    return null;
  }
  Mapbox.setAccessToken(config.mapboxAccessToken.trim());
  return Mapbox;
}
