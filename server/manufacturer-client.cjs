'use strict';

const MAX_MANUFACTURER_RESPONSE_BYTES = 1024 * 1024;
const INDOOR_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MEDICATION_ACK_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

async function readBoundedObjectResponse(response, context) {
  let text;
  if (typeof response.text === 'function') {
    text = await response.text();
  } else if (typeof response.json === 'function') {
    text = JSON.stringify(await response.json());
  } else {
    text = '';
  }
  if (typeof text !== 'string' || text.length > MAX_MANUFACTURER_RESPONSE_BYTES) {
    throw new Error(`${context} response is too large`);
  }
  if (!text) throw new Error(`${context} response is invalid`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${context} response is invalid`);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${context} response is invalid`);
  }
  return payload;
}

async function requireSynchronousCompletion(response, context) {
  if (response.status === 204) return { completed: true };
  if (!response.ok || response.status !== 200) {
    throw new Error(`${context} returned ${response.status}`);
  }
  const payload = await readBoundedObjectResponse(response, context);
  if (payload.completed !== true) {
    throw new Error(`${context} did not confirm completion`);
  }
  return payload;
}

function normalizeNavigationPath(value) {
  if (!Array.isArray(value)) return undefined;
  const path = value.slice(0, 500).flatMap((point) => {
    const longitude = Number(Array.isArray(point) ? point[0] : point?.longitude);
    const latitude = Number(Array.isArray(point) ? point[1] : point?.latitude);
    return Number.isFinite(longitude) && Math.abs(longitude) <= 180
      && Number.isFinite(latitude) && Math.abs(latitude) <= 90
      ? [[longitude, latitude]] : [];
  });
  return path.length >= 2 ? path : undefined;
}

function normalizeSafetyEvents(value) {
  if (!Array.isArray(value)) return undefined;
  const events = value.slice(0, 20).flatMap((event) => {
    const eventType = event?.event_type;
    const eventId = event?.event_id;
    const occurredAt = Number(event?.occurred_at);
    const confidence = event?.confidence === undefined ? undefined : Number(event.confidence);
    if (!['fall', 'fall_detected'].includes(eventType)
      || typeof eventId !== 'string'
      || !/^[A-Za-z0-9._:-]{8,128}$/.test(eventId)
      || !Number.isFinite(occurredAt)
      || (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1))) return [];
    return [{ event_type: 'fall', event_id: eventId, occurred_at: occurredAt, ...(confidence === undefined ? {} : { confidence }) }];
  });
  return events.length ? events : undefined;
}

function normalizeMedicationAcknowledgements(value) {
  if (!Array.isArray(value)) return undefined;
  const acknowledgements = value.slice(0, 20).flatMap((acknowledgement) => {
    const reminderId = acknowledgement?.reminder_id;
    const receiptId = acknowledgement?.receipt_id;
    const deliveredAt = Number(acknowledgement?.delivered_at);
    if (
      !MEDICATION_ACK_IDENTIFIER_PATTERN.test(reminderId || '')
      || !MEDICATION_ACK_IDENTIFIER_PATTERN.test(receiptId || '')
      || !Number.isSafeInteger(deliveredAt)
      || deliveredAt <= 0
    ) return [];
    return [{ reminder_id: reminderId, receipt_id: receiptId, delivered_at: deliveredAt }];
  });
  return acknowledgements.length ? acknowledgements : undefined;
}

/**
 * Manufacturer-owned indoor coordinates are relative to a bounded map frame,
 * not latitude/longitude. Accept only the documented scalar fields and require
 * either a room identifier or a complete x/y pair so arbitrary gateway data
 * cannot flow through the account telemetry response.
 */
function normalizeIndoorPosition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const boundedIdentifier = (candidate) => (
    typeof candidate === 'string' && INDOOR_IDENTIFIER_PATTERN.test(candidate)
      ? candidate
      : undefined
  );
  const mapId = boundedIdentifier(value.map_id);
  const floorId = boundedIdentifier(value.floor_id);
  const roomId = boundedIdentifier(value.room_id);
  const xMeters = value.x_m;
  const yMeters = value.y_m;
  const hasCoordinates = mapId
    && typeof xMeters === 'number' && Number.isFinite(xMeters) && Math.abs(xMeters) <= 10_000
    && typeof yMeters === 'number' && Number.isFinite(yMeters) && Math.abs(yMeters) <= 10_000;
  if (!roomId && !hasCoordinates) return undefined;
  const confidence = value.confidence;
  const capturedAt = value.captured_at;
  return {
    ...(mapId ? { map_id: mapId } : {}),
    ...(floorId ? { floor_id: floorId } : {}),
    ...(roomId ? { room_id: roomId } : {}),
    ...(hasCoordinates ? { x_m: xMeters, y_m: yMeters } : {}),
    ...(typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? { confidence } : {}),
    ...(Number.isSafeInteger(capturedAt) && capturedAt > 0 ? { captured_at: capturedAt } : {})
  };
}

function createManufacturerPairingVerifier({ url, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  return async function verifyPairingCode(qrCode) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Manufacturer-Api-Key': apiKey },
        body: JSON.stringify({ pairing_code: qrCode }),
        signal: controller.signal
      });
      if (response.status === 404) return null;
      if (response.status === 409 || response.status === 410) {
        const replay = new Error('Manufacturer pairing claim has already been used');
        replay.statusCode = 410;
        replay.code = 'ROBOT_PAIRING_REPLAY';
        throw replay;
      }
      if (!response.ok) throw new Error(`Manufacturer pairing service returned ${response.status}`);
      const body = await readBoundedObjectResponse(response, 'Manufacturer pairing service');
      return {
        hardwareSerial: body.hardware_serial,
        manufacturerDeviceId: body.manufacturer_device_id,
        oneTime: body.one_time === true,
        expiresAt: Number(body.expires_at)
      };
    } finally { clearTimeout(timeout); }
  };
}

function createManufacturerRobotStatusClient({ url, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  return async function getRobotStatus(robotId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Manufacturer-Api-Key': apiKey },
        body: JSON.stringify({ robot_id: robotId }),
        signal: controller.signal
      });
      if (response.status === 404) return { online: false, hardware_status: 'offline' };
      if (!response.ok) throw new Error(`Manufacturer status service returned ${response.status}`);
      const body = await readBoundedObjectResponse(response, 'Manufacturer status service');
      const longitude = Number(body?.location?.longitude);
      const latitude = Number(body?.location?.latitude);
      const location = Number.isFinite(longitude) && Math.abs(longitude) <= 180
        && Number.isFinite(latitude) && Math.abs(latitude) <= 90
        ? { longitude, latitude }
        : undefined;
      const navigationPath = normalizeNavigationPath(body.navigation_path);
      const safetyEvents = normalizeSafetyEvents(body.safety_events);
      const medicationAcknowledgements = normalizeMedicationAcknowledgements(
        body.medication_acknowledgements
      );
      const indoorPosition = normalizeIndoorPosition(body.indoor_position);
      return {
        online: body.online === true,
        hardware_status: body.online === true ? 'online' : 'offline',
        ...(location ? { location } : {}),
        ...(navigationPath ? { navigation_path: navigationPath } : {}),
        ...(safetyEvents ? { safety_events: safetyEvents } : {}),
        ...(medicationAcknowledgements
          ? { medication_acknowledgements: medicationAcknowledgements }
          : {}),
        ...(indoorPosition ? { indoor_position: indoorPosition } : {}),
        reported_at: Number.isFinite(Number(body.reported_at)) ? Number(body.reported_at) : Date.now()
      };
    } finally { clearTimeout(timeout); }
  };
}

function createManufacturerRobotResetClient({ url, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  return async function resetRobot(robotId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Manufacturer-Api-Key': apiKey },
        body: JSON.stringify({ robot_id: robotId, erase_user_data: true }),
        signal: controller.signal
      });
      // An asynchronous receipt cannot authorize local unbinding. A future
      // async reset contract must use its own durable ACK/polling workflow.
      await requireSynchronousCompletion(response, 'Manufacturer reset service');
      return true;
    } finally { clearTimeout(timeout); }
  };
}

function createManufacturerPrivacyRepository({
  exportURL,
  deleteURL,
  apiKey,
  listManufacturerDeviceIds,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000
} = {}) {
  if (typeof listManufacturerDeviceIds !== 'function') {
    throw new Error('Manufacturer privacy requires account-bound robot lookup');
  }
  async function request(url, robotIds, operation) {
    if (!url || !apiKey) throw new Error(`Manufacturer privacy ${operation} is not configured`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Manufacturer-Api-Key': apiKey },
        body: JSON.stringify({ robot_ids: robotIds }),
        signal: controller.signal
      });
      if (operation === 'deletion') {
        return requireSynchronousCompletion(response, 'Manufacturer privacy deletion');
      }
      if (!response.ok) {
        throw new Error(`Manufacturer privacy ${operation} returned ${response.status}`);
      }
      if (response.status === 204) return { completed: true };
      const text = typeof response.text === 'function' ? await response.text() : '';
      if (text.length > MAX_MANUFACTURER_RESPONSE_BYTES) throw new Error('Manufacturer privacy response is too large');
      if (!text) return { completed: true };
      const payload = JSON.parse(text);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Manufacturer privacy response is invalid');
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    async exportUserData(userId) {
      const robotIds = await listManufacturerDeviceIds(userId);
      if (!robotIds.length) return { robots: [] };
      return request(exportURL, robotIds, 'export');
    },
    async deleteUserData(userId) {
      const robotIds = await listManufacturerDeviceIds(userId);
      if (!robotIds.length) return { deleted: 0 };
      await request(deleteURL, robotIds, 'deletion');
      return { deleted: robotIds.length };
    }
  };
}

module.exports = {
  createManufacturerPairingVerifier,
  createManufacturerPrivacyRepository,
  createManufacturerRobotResetClient,
  createManufacturerRobotStatusClient,
  normalizeIndoorPosition,
  normalizeMedicationAcknowledgements,
  normalizeNavigationPath,
  normalizeSafetyEvents
};
