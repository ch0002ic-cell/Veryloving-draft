import { base64ToBytes, utf8BytesToString } from '../utils/base64';

const UUID_PATTERN = /^(?:[0-9a-f]{4}|[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function normalizeUUID(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

export function canonicalVL01UUID(value) {
  const normalized = normalizeUUID(value);
  if (!normalized) return null;
  return /^[0-9a-f]{4}$/.test(normalized)
    ? `0000${normalized}-0000-1000-8000-00805f9b34fb`
    : /^[0-9a-f]{8}$/.test(normalized)
      ? `${normalized}-0000-1000-8000-00805f9b34fb`
      : normalized;
}

export function equalVL01UUID(left, right) {
  const canonicalLeft = canonicalVL01UUID(left);
  return Boolean(canonicalLeft) && canonicalLeft === canonicalVL01UUID(right);
}

export function createVL01Protocol({
  enabled,
  serviceUUID,
  batteryCharacteristicUUID,
  statusCharacteristicUUID,
  eventCharacteristicUUID,
  commandCharacteristicUUID
} = {}) {
  if (!enabled) return null;
  const suppliedStatusUUID = typeof statusCharacteristicUUID === 'string' && statusCharacteristicUUID.trim();
  const suppliedEventUUID = typeof eventCharacteristicUUID === 'string' && eventCharacteristicUUID.trim();
  const suppliedCommandUUID = typeof commandCharacteristicUUID === 'string' && commandCharacteristicUUID.trim();
  const protocol = {
    version: 1,
    serviceUUID: normalizeUUID(serviceUUID),
    batteryCharacteristicUUID: normalizeUUID(batteryCharacteristicUUID),
    statusCharacteristicUUID: normalizeUUID(statusCharacteristicUUID),
    eventCharacteristicUUID: normalizeUUID(eventCharacteristicUUID),
    commandCharacteristicUUID: normalizeUUID(commandCharacteristicUUID)
  };
  if (
    !protocol.serviceUUID
    || !protocol.batteryCharacteristicUUID
    || (suppliedStatusUUID && !protocol.statusCharacteristicUUID)
    || (suppliedEventUUID && !protocol.eventCharacteristicUUID)
    || (suppliedCommandUUID && !protocol.commandCharacteristicUUID)
  ) return null;
  return Object.freeze(protocol);
}

export function decodeVL01Battery(base64Value) {
  if (typeof base64Value !== 'string' || !base64Value) throw new Error('VL01 battery value is missing.');
  const bytes = base64ToBytes(base64Value);
  if (bytes.length !== 1) throw new Error('VL01 battery value has an invalid length.');
  const percentage = bytes[0];
  if (percentage < 0 || percentage > 100) throw new Error('VL01 battery value is out of range.');
  return percentage;
}

export function decodeVL01SafetyEvent(base64Value) {
  if (typeof base64Value !== 'string' || !base64Value) throw new Error('VL01 safety event is missing.');
  let bytes;
  try {
    bytes = base64ToBytes(base64Value);
  } catch {
    throw new Error('VL01 safety event is not a valid versioned envelope.');
  }
  if (!bytes.length || bytes.length > 512) throw new Error('VL01 safety event has an invalid length.');
  let decoded;
  try {
    decoded = JSON.parse(utf8BytesToString(bytes));
  } catch {
    throw new Error('VL01 safety event is not a valid versioned envelope.');
  }
  if (decoded?.version !== 1) throw new Error('VL01 safety event version is unsupported.');
  return decoded;
}

export function hasVL01Service(device, protocol) {
  if (!protocol?.serviceUUID) return false;
  return Array.isArray(device?.serviceUUIDs)
    && device.serviceUUIDs.some((uuid) => equalVL01UUID(uuid, protocol.serviceUUID));
}

export function validateVL01GATT(services, characteristics, protocol) {
  const serviceUUIDs = new Set((services || []).map((service) => canonicalVL01UUID(service.uuid)).filter(Boolean));
  if (!serviceUUIDs.has(canonicalVL01UUID(protocol.serviceUUID))) throw new Error('VL01 primary service is unavailable.');
  const characteristicsByUUID = new Map(
    (characteristics || []).map((item) => [canonicalVL01UUID(item.uuid), item]).filter(([uuid]) => Boolean(uuid))
  );
  const battery = characteristicsByUUID.get(canonicalVL01UUID(protocol.batteryCharacteristicUUID));
  if (!battery) {
    throw new Error('VL01 battery characteristic is unavailable.');
  }
  // react-native-ble-plx reports characteristic capabilities explicitly. Treat
  // missing flags as an unverified GATT contract instead of assuming support;
  // a safety wearable must fail closed before any read, subscription, or write.
  if (battery.isReadable !== true) throw new Error('VL01 battery characteristic is not readable.');
  for (const optionalUUID of [protocol.statusCharacteristicUUID, protocol.eventCharacteristicUUID].filter(Boolean)) {
    const characteristic = characteristicsByUUID.get(canonicalVL01UUID(optionalUUID));
    if (!characteristic) throw new Error('VL01 required notification characteristic is unavailable.');
    if (characteristic.isNotifiable !== true && characteristic.isIndicatable !== true) {
      throw new Error('VL01 required notification characteristic does not support notifications.');
    }
  }
  if (protocol.statusCharacteristicUUID) {
    const status = characteristicsByUUID.get(canonicalVL01UUID(protocol.statusCharacteristicUUID));
    if (status.isReadable !== true) throw new Error('VL01 status characteristic is not readable.');
  }
  if (protocol.commandCharacteristicUUID) {
    const command = characteristicsByUUID.get(canonicalVL01UUID(protocol.commandCharacteristicUUID));
    if (!command) throw new Error('VL01 command characteristic is unavailable.');
    if (command.isWritableWithResponse !== true && command.isWritableWithoutResponse !== true) {
      throw new Error('VL01 command characteristic is not writable.');
    }
  }
  return true;
}
