import { runLocalUserDataMutation } from './local-mutation-coordinator';
import { retainableRobotLocation } from './robot-telemetry-policy';
import { storage } from './storage';

export const DEVICE_ENTITIES_KEY = 'veryloving.deviceEntities.v1';
const DEVICE_TYPES = new Set(['wearable', 'home_robot']);

function boundedString(value, maxLength = 120) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizedLocation(value) {
  const longitude = Number(value?.longitude ?? value?.location?.longitude);
  const latitude = Number(value?.latitude ?? value?.location?.latitude);
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(latitude) || Math.abs(latitude) > 90) return null;
  const capturedAt = Number(value?.capturedAt ?? value?.location?.capturedAt);
  return { longitude, latitude, ...(Number.isFinite(capturedAt) ? { capturedAt } : {}) };
}

export function normalizeDeviceEntity(value, accountId, { now = Date.now } = {}) {
  const deviceType = DEVICE_TYPES.has(value?.deviceType) ? value.deviceType : null;
  const deviceId = boundedString(value?.deviceId ?? value?.id);
  if (!accountId || !deviceType || !deviceId) return null;
  const location = normalizedLocation(value);
  return {
    accountId,
    deviceId,
    deviceType,
    name: boundedString(value?.name, 80) || (deviceType === 'wearable' ? 'NorthStar VL01' : 'VeryLoving Home'),
    online: false,
    connectionState: deviceType === 'wearable' && value?.autoReconnect !== false ? 'reconnecting' : 'disconnected',
    autoReconnect: deviceType === 'wearable' && value?.autoReconnect !== false,
    location: deviceType === 'home_robot'
      ? retainableRobotLocation(location, { now })
      : location
  };
}

export async function loadDeviceEntities(accountId, { storageImpl = storage, now = Date.now } = {}) {
  if (!accountId) return [];
  const stored = await storageImpl.getJSON(DEVICE_ENTITIES_KEY, null);
  if (stored?.accountId !== accountId || !Array.isArray(stored?.entities)) return [];
  return stored.entities.slice(0, 50).flatMap((entity) => {
    const normalized = normalizeDeviceEntity(entity, accountId, { now });
    return normalized ? [normalized] : [];
  });
}

export async function persistDeviceEntities(accountId, entities, { storageImpl = storage, now = Date.now } = {}) {
  if (!accountId) throw new Error('An authenticated account is required to persist devices.');
  const normalized = (Array.isArray(entities) ? entities : []).slice(0, 50).flatMap((entity) => {
    const next = normalizeDeviceEntity(entity, accountId, { now });
    return next ? [next] : [];
  });
  await runLocalUserDataMutation(() => storageImpl.setJSON(DEVICE_ENTITIES_KEY, {
    version: 1,
    accountId,
    entities: normalized
  }));
  return normalized;
}
