import Mapbox from '@rnmapbox/maps';
import { config } from '../utils/config';

export { dangerZones, requestCurrentLocation } from './mapbox-core';

export function getMapboxModule() {
  if (config.mapboxAccessToken) Mapbox.setAccessToken(config.mapboxAccessToken);
  return Mapbox;
}
