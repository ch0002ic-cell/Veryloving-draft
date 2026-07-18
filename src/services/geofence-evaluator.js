const EARTH_RADIUS_METERS = 6371008.8;
const DEFAULT_MAX_LOCATION_AGE_MS = 5 * 60 * 1000;
const DEFAULT_HYSTERESIS_METERS = 15;

function coordinate(value, limit, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > limit) {
    throw Object.assign(new Error(`${label} is invalid.`), { code: 'GEOFENCE_COORDINATE_INVALID' });
  }
  return number;
}

function radians(degrees) {
  return degrees * Math.PI / 180;
}

export function distanceBetweenLocations(left, right) {
  const leftLatitude = coordinate(left?.latitude ?? left?.coords?.latitude, 90, 'Latitude');
  const leftLongitude = coordinate(left?.longitude ?? left?.coords?.longitude, 180, 'Longitude');
  const rightLatitude = coordinate(right?.latitude ?? right?.coords?.latitude, 90, 'Latitude');
  const rightLongitude = coordinate(right?.longitude ?? right?.coords?.longitude, 180, 'Longitude');
  const latitudeDelta = radians(rightLatitude - leftLatitude);
  const longitudeDelta = radians(rightLongitude - leftLongitude);
  const firstLatitude = radians(leftLatitude);
  const secondLatitude = radians(rightLatitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  const boundedHaversine = Math.min(1, Math.max(0, haversine));
  return 2 * EARTH_RADIUS_METERS * Math.atan2(
    Math.sqrt(boundedHaversine),
    Math.sqrt(1 - boundedHaversine)
  );
}

function normalizeFence(geofence) {
  if (!geofence || typeof geofence !== 'object') {
    throw Object.assign(new Error('Geofence is required.'), { code: 'GEOFENCE_INVALID' });
  }
  const radiusMeters = Number(geofence.radiusMeters);
  if (!Number.isFinite(radiusMeters) || radiusMeters < 25 || radiusMeters > 100000) {
    throw Object.assign(new Error('Geofence radius is invalid.'), { code: 'GEOFENCE_RADIUS_INVALID' });
  }
  return {
    id: typeof geofence.id === 'string' ? geofence.id.slice(0, 128) : null,
    latitude: coordinate(geofence.latitude, 90, 'Latitude'),
    longitude: coordinate(geofence.longitude, 180, 'Longitude'),
    radiusMeters
  };
}

export function evaluateGeofence({
  geofence,
  location,
  previousState = 'unknown',
  now = Date.now,
  maxLocationAgeMs = DEFAULT_MAX_LOCATION_AGE_MS,
  hysteresisMeters = DEFAULT_HYSTERESIS_METERS
} = {}) {
  const fence = normalizeFence(geofence);
  const capturedAt = Number(location?.capturedAt ?? location?.timestamp ?? location?.cachedAt);
  const timestamp = now();
  if (!Number.isFinite(capturedAt) || !Number.isFinite(timestamp)) {
    return { state: 'unknown', transition: 'none', reason: 'location_time_invalid', distanceMeters: null };
  }
  const ageMs = timestamp - capturedAt;
  if (ageMs < 0 || ageMs > Math.max(1, maxLocationAgeMs)) {
    return { state: 'unknown', transition: 'none', reason: 'location_stale', distanceMeters: null };
  }

  let distanceMeters;
  try {
    distanceMeters = distanceBetweenLocations(location, fence);
  } catch {
    return { state: 'unknown', transition: 'none', reason: 'location_invalid', distanceMeters: null };
  }
  const boundedHysteresis = Math.min(
    fence.radiusMeters / 2,
    Math.max(0, Number(hysteresisMeters) || 0)
  );
  let state;
  if (previousState === 'inside') {
    state = distanceMeters > fence.radiusMeters + boundedHysteresis ? 'outside' : 'inside';
  } else if (previousState === 'outside') {
    state = distanceMeters < fence.radiusMeters - boundedHysteresis ? 'inside' : 'outside';
  } else {
    state = distanceMeters <= fence.radiusMeters ? 'inside' : 'outside';
  }

  const transition = previousState === 'inside' && state === 'outside'
    ? 'exit'
    : previousState === 'outside' && state === 'inside'
      ? 'enter'
      : 'none';
  return {
    state,
    transition,
    reason: null,
    distanceMeters,
    capturedAt,
    geofenceId: fence.id
  };
}
