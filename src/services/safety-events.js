const SUPPORTED_DEVICE_TYPES = new Set(['wearable', 'home_robot']);
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const DEFAULT_MAX_EVENT_AGE_MS = 5 * 60 * 1000;
const DEFAULT_FUTURE_TOLERANCE_MS = 30 * 1000;
const DEFAULT_DEDUPE_TTL_MS = 15 * 60 * 1000;
const MAX_DEDUPE_ENTRIES = 256;

export const SAFETY_EVENT_TYPES = Object.freeze({
  patPat: 'pat_pat',
  fall: 'fall'
});

const EVENT_TYPE_ALIASES = Object.freeze({
  pat_pat: SAFETY_EVENT_TYPES.patPat,
  patpat: SAFETY_EVENT_TYPES.patPat,
  fall: SAFETY_EVENT_TYPES.fall,
  fall_detected: SAFETY_EVENT_TYPES.fall
});

function safetyEventError(code, message) {
  return Object.assign(new Error(message), { code });
}

function requiredIdentifier(value, code, label, pattern = EVENT_ID_PATTERN) {
  if (typeof value !== 'string') throw safetyEventError(code, `${label} is required.`);
  const normalized = value.trim();
  if (!pattern.test(normalized)) throw safetyEventError(code, `${label} is invalid.`);
  return normalized;
}

function normalizeType(value) {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const normalized = EVENT_TYPE_ALIASES[key];
  if (!normalized) throw safetyEventError('SAFETY_EVENT_TYPE_UNSUPPORTED', 'Safety event type is unsupported.');
  return normalized;
}

function normalizeConfidence(value) {
  if (value === undefined || value === null) return null;
  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw safetyEventError('SAFETY_EVENT_CONFIDENCE_INVALID', 'Safety event confidence is invalid.');
  }
  return confidence;
}

export function normalizeSafetyEvent(input, {
  deviceType,
  deviceId,
  now = Date.now,
  maxEventAgeMs = DEFAULT_MAX_EVENT_AGE_MS,
  futureToleranceMs = DEFAULT_FUTURE_TOLERANCE_MS
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw safetyEventError('SAFETY_EVENT_INVALID', 'A decoded safety event is required.');
  }
  if (!SUPPORTED_DEVICE_TYPES.has(deviceType)) {
    throw safetyEventError('SAFETY_EVENT_DEVICE_TYPE_INVALID', 'Safety event device type is invalid.');
  }
  const normalizedDeviceId = requiredIdentifier(
    deviceId,
    'SAFETY_EVENT_DEVICE_ID_INVALID',
    'Device identifier',
    DEVICE_ID_PATTERN
  );
  const type = normalizeType(input.eventType ?? input.event_type ?? input.event ?? input.type);
  if (type === SAFETY_EVENT_TYPES.patPat && deviceType !== 'wearable') {
    throw safetyEventError('SAFETY_EVENT_SOURCE_INVALID', 'Pat-Pat events are only accepted from a wearable.');
  }

  // The manufacturer decoder must bind a stable identifier from an authenticated
  // event sequence or signed event ID. A receive timestamp alone cannot prevent
  // replay of a safety activation.
  const eventId = requiredIdentifier(
    input.eventId ?? input.event_id,
    'SAFETY_EVENT_ID_INVALID',
    'Safety event identifier'
  );
  const occurredAt = Number(input.occurredAt ?? input.occurred_at);
  const receivedAt = now();
  if (!Number.isFinite(receivedAt) || !Number.isFinite(occurredAt)) {
    throw safetyEventError('SAFETY_EVENT_TIME_INVALID', 'Safety event time is invalid.');
  }
  const ageMs = receivedAt - occurredAt;
  if (ageMs > Math.max(1, maxEventAgeMs)) {
    throw safetyEventError('SAFETY_EVENT_STALE', 'Safety event is stale.');
  }
  if (ageMs < -Math.max(0, futureToleranceMs)) {
    throw safetyEventError('SAFETY_EVENT_FUTURE', 'Safety event time is in the future.');
  }

  return Object.freeze({
    version: 1,
    eventId,
    type,
    source: deviceType === 'wearable' ? 'vl01' : 'home_robot',
    deviceType,
    deviceId: normalizedDeviceId,
    occurredAt,
    receivedAt,
    confidence: normalizeConfidence(input.confidence)
  });
}

function pruneDedupeRecords(records, timestamp) {
  for (const [key, expiresAt] of records) {
    if (expiresAt <= timestamp) records.delete(key);
  }
  while (records.size >= MAX_DEDUPE_ENTRIES) {
    const oldest = records.keys().next().value;
    if (oldest === undefined) break;
    records.delete(oldest);
  }
}

export function createSafetyEventRouter({
  decodeWearableEvent,
  decodeRobotEvent = (value) => value,
  activateSOS,
  reportFall,
  now = Date.now,
  maxEventAgeMs = DEFAULT_MAX_EVENT_AGE_MS,
  futureToleranceMs = DEFAULT_FUTURE_TOLERANCE_MS,
  dedupeTTLms = DEFAULT_DEDUPE_TTL_MS
} = {}) {
  const acceptedEvents = new Map();
  const inFlightEvents = new Map();

  async function routeDecoded(decoded, deviceType, deviceId) {
    const event = normalizeSafetyEvent(decoded, {
      deviceType,
      deviceId,
      now,
      maxEventAgeMs,
      futureToleranceMs
    });
    const dedupeKey = `${event.deviceType}:${event.deviceId}:${event.eventId}`;
    const timestamp = now();
    pruneDedupeRecords(acceptedEvents, timestamp);
    if (acceptedEvents.has(dedupeKey)) return { status: 'duplicate', event };
    if (inFlightEvents.has(dedupeKey)) return { status: 'duplicate_in_flight', event };

    const operation = (async () => {
      let result;
      if (event.type === SAFETY_EVENT_TYPES.patPat) {
        if (typeof activateSOS !== 'function') {
          throw safetyEventError('SOS_HANDLER_UNAVAILABLE', 'SOS activation is unavailable.');
        }
        result = await activateSOS({
          trigger: SAFETY_EVENT_TYPES.patPat,
          source: event.source,
          deviceId: event.deviceId,
          occurredAt: event.occurredAt,
          idempotencyKey: event.eventId
        });
        acceptedEvents.set(dedupeKey, now() + Math.max(1, dedupeTTLms));
        return { status: 'sos_dispatched', event, result };
      }

      if (typeof reportFall === 'function') result = await reportFall(event);
      acceptedEvents.set(dedupeKey, now() + Math.max(1, dedupeTTLms));
      return { status: result === undefined ? 'fall_detected' : 'fall_reported', event, result };
    })();
    inFlightEvents.set(dedupeKey, operation);
    try {
      return await operation;
    } finally {
      if (inFlightEvents.get(dedupeKey) === operation) inFlightEvents.delete(dedupeKey);
    }
  }

  return Object.freeze({
    async routeWearableEvent(rawValue, { deviceId } = {}) {
      if (typeof decodeWearableEvent !== 'function') {
        throw safetyEventError('WEARABLE_EVENT_DECODER_UNAVAILABLE', 'Wearable event decoding is unavailable.');
      }
      return routeDecoded(await decodeWearableEvent(rawValue), 'wearable', deviceId);
    },

    async routeRobotEvent(rawValue, { deviceId } = {}) {
      if (typeof decodeRobotEvent !== 'function') {
        throw safetyEventError('ROBOT_EVENT_DECODER_UNAVAILABLE', 'Robot event decoding is unavailable.');
      }
      return routeDecoded(await decodeRobotEvent(rawValue), 'home_robot', deviceId);
    }
  });
}
