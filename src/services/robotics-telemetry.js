import { base64ToBytes, utf8BytesToString } from '../utils/base64';

export const ROBOTICS_SERVICE_UUID = process.env.EXPO_PUBLIC_ROBOTICS_SERVICE_UUID
  || 'f000aa00-0451-4000-b000-000000000000';
export const ROBOTICS_TELEMETRY_CHARACTERISTIC_UUID = process.env.EXPO_PUBLIC_ROBOTICS_TELEMETRY_CHARACTERISTIC_UUID
  || 'f000aa01-0451-4000-b000-000000000000';
export const MAX_ROBOT_ENTITIES = 3;

const MAX_TELEMETRY_BASE64_LENGTH = 4096;
const ROBOT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function decodeRoboticsTelemetry(base64Value) {
  if (typeof base64Value !== 'string' || base64Value.length > MAX_TELEMETRY_BASE64_LENGTH) {
    throw new Error('Robot telemetry payload is invalid.');
  }
  const parsed = JSON.parse(utf8BytesToString(base64ToBytes(base64Value)));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Robot telemetry payload is invalid.');
  }
  return parsed;
}

export function normalizeRobotEntity(deviceId, telemetry, receivedAt = Date.now()) {
  const id = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!ROBOT_ID_PATTERN.test(id) || !telemetry || typeof telemetry !== 'object' || Array.isArray(telemetry)) {
    return null;
  }
  const { latitude, longitude, battery, heading, speed } = telemetry;
  if (
    !finiteNumber(latitude) || latitude < -90 || latitude > 90
    || !finiteNumber(longitude) || longitude < -180 || longitude > 180
    || !finiteNumber(battery) || battery < 0 || battery > 100
    || !finiteNumber(heading) || heading < 0 || heading >= 360
    || !finiteNumber(receivedAt) || receivedAt < 0
    || (speed !== undefined && (!finiteNumber(speed) || speed < 0))
  ) return null;

  return {
    id,
    latitude,
    longitude,
    battery,
    heading,
    ...(speed === undefined ? {} : { speed }),
    receivedAt: Math.floor(receivedAt)
  };
}

export function upsertRobotEntity(entities, entity, limit = MAX_ROBOT_ENTITIES) {
  const current = Array.isArray(entities) ? entities : [];
  const normalized = normalizeRobotEntity(entity?.id, entity, entity?.receivedAt);
  if (!normalized || !Number.isInteger(limit) || limit < 1) return current;
  const previous = current.find((candidate) => candidate.id === normalized.id);
  if (previous?.receivedAt > normalized.receivedAt) return current;
  if (
    previous
    && previous.receivedAt === normalized.receivedAt
    && previous.latitude === normalized.latitude
    && previous.longitude === normalized.longitude
    && previous.battery === normalized.battery
    && previous.heading === normalized.heading
    && previous.speed === normalized.speed
  ) return current;
  return [normalized, ...current.filter((candidate) => candidate.id !== normalized.id)].slice(0, limit);
}

export function removeRobotEntity(entities, deviceId) {
  if (!Array.isArray(entities)) return [];
  const next = entities.filter((entity) => entity.id !== deviceId);
  return next.length === entities.length ? entities : next;
}

export function createRobotFeatureCollection(entities) {
  return {
    type: 'FeatureCollection',
    features: (Array.isArray(entities) ? entities : []).flatMap((entity) => {
      const normalized = normalizeRobotEntity(entity?.id, entity, entity?.receivedAt);
      if (!normalized) return [];
      return [{
        type: 'Feature',
        id: normalized.id,
        geometry: {
          type: 'Point',
          coordinates: [normalized.longitude, normalized.latitude]
        },
        properties: {
          id: normalized.id,
          label: normalized.id,
          battery: Math.round(normalized.battery),
          heading: normalized.heading,
          receivedAt: normalized.receivedAt
        }
      }];
    })
  };
}

export function selectMapCameraCoordinates(userCoordinates, robotEntities, fallbackCoordinates) {
  const latestRobot = Array.isArray(robotEntities) ? robotEntities[0] : null;
  const normalizedRobot = latestRobot
    ? normalizeRobotEntity(latestRobot.id, latestRobot, latestRobot.receivedAt)
    : null;
  if (normalizedRobot) return [normalizedRobot.longitude, normalizedRobot.latitude];
  if (
    Array.isArray(userCoordinates)
    && userCoordinates.length === 2
    && finiteNumber(userCoordinates[0])
    && finiteNumber(userCoordinates[1])
    && userCoordinates[0] >= -180
    && userCoordinates[0] <= 180
    && userCoordinates[1] >= -90
    && userCoordinates[1] <= 90
  ) return userCoordinates;
  return fallbackCoordinates;
}
