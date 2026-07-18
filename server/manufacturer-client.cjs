'use strict';

const crypto = require('node:crypto');
const { createManufacturerPrivacyDeletionCoordinator } = require('./manufacturer-privacy-deletion.cjs');

const MAX_MANUFACTURER_RESPONSE_BYTES = 1024 * 1024;
const INDOOR_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MEDICATION_ACK_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const MANUFACTURER_DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const RESET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const ROBOT_RESET_CONTRACT = 'veryloving.robot-reset.v1';
const ROBOT_RESET_CONTRACT_VERSION = 'vl-robot-reset/1';
const ROBOT_PAIRING_VERIFY_CONTRACT = 'veryloving.robot-pairing-verify.v1';
const ROBOT_PAIRING_VERIFY_CONTRACT_VERSION = 'vl-robot-pairing-verify/1';

function manufacturerTimeoutError() {
  const error = new Error('Manufacturer request timed out');
  error.name = 'TimeoutError';
  error.code = 'MANUFACTURER_TIMEOUT';
  return error;
}

async function cancelManufacturerResponse(response) {
  try { await response?.body?.cancel?.(); } catch {}
}

async function manufacturerRequest({ fetchImpl, url, init, timeoutMs, consume }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('Manufacturer request timeout is invalid');
  }
  const controller = new AbortController();
  let timedOut = false;
  let response;
  let timeoutHandle;
  const operation = (async () => {
    try {
      response = await fetchImpl(url, { ...init, redirect: 'error', signal: controller.signal });
      if (timedOut) {
        await cancelManufacturerResponse(response);
        throw manufacturerTimeoutError();
      }
      return await consume(response, controller.signal);
    } catch (error) {
      if (timedOut && error?.code !== 'MANUFACTURER_TIMEOUT') throw manufacturerTimeoutError();
      throw error;
    }
  })();
  void operation.catch(() => {});
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      void cancelManufacturerResponse(response);
      reject(manufacturerTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function readBoundedResponseText(response, context, signal) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_MANUFACTURER_RESPONSE_BYTES) {
    await cancelManufacturerResponse(response);
    throw new Error(`${context} response is too large`);
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const cancelOnAbort = () => { void reader.cancel().catch(() => {}); };
    if (signal?.aborted) cancelOnAbort();
    else signal?.addEventListener('abort', cancelOnAbort, { once: true });
    const chunks = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value?.byteLength || 0;
        if (received > MAX_MANUFACTURER_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          throw new Error(`${context} response is too large`);
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      signal?.removeEventListener('abort', cancelOnAbort);
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks, received).toString('utf8');
  }
  let text;
  if (typeof response.text === 'function') text = await response.text();
  else if (typeof response.json === 'function') text = JSON.stringify(await response.json());
  else text = '';
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_MANUFACTURER_RESPONSE_BYTES) {
    throw new Error(`${context} response is too large`);
  }
  return text;
}

async function readBoundedObjectResponse(response, context, signal) {
  const text = await readBoundedResponseText(response, context, signal);
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

async function requireSynchronousCompletion(response, context, signal) {
  if (response.status === 204) return { completed: true };
  if (!response.ok || response.status !== 200) {
    throw new Error(`${context} returned ${response.status}`);
  }
  const payload = await readBoundedObjectResponse(response, context, signal);
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
  if (!Number.isSafeInteger(capturedAt) || capturedAt <= 0) return undefined;
  return {
    ...(mapId ? { map_id: mapId } : {}),
    ...(floorId ? { floor_id: floorId } : {}),
    ...(roomId ? { room_id: roomId } : {}),
    ...(hasCoordinates ? { x_m: xMeters, y_m: yMeters } : {}),
    ...(typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? { confidence } : {}),
    captured_at: capturedAt
  };
}

function createManufacturerPairingVerifier({
  url,
  apiKey,
  adapterId = 'manufacturer-default',
  idempotencySecret = apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000
} = {}) {
  return async function verifyPairingCode(qrCode) {
    if (typeof qrCode !== 'string' || qrCode.length < 8 || qrCode.length > 4096) {
      throw new Error('Manufacturer pairing claim is invalid');
    }
    if (typeof idempotencySecret !== 'string' || idempotencySecret.length < 8) {
      throw new Error('Manufacturer pairing idempotency secret is invalid');
    }
    const claimId = crypto.createHmac('sha256', idempotencySecret)
      .update('veryloving.robot-pairing-verify.v1\0', 'utf8')
      .update(adapterId, 'utf8')
      .update('\0', 'utf8')
      .update(qrCode, 'utf8')
      .digest('base64url');
    return manufacturerRequest({
      fetchImpl,
      url,
      timeoutMs,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': claimId,
          'X-Manufacturer-Api-Key': apiKey,
          'X-Veryloving-Pairing-Contract': ROBOT_PAIRING_VERIFY_CONTRACT
        },
        body: JSON.stringify({
          contract_version: ROBOT_PAIRING_VERIFY_CONTRACT_VERSION,
          pairing_code: qrCode
        })
      },
      consume: async (response, signal) => {
        if (response.status === 404) return null;
        if (response.status === 409 || response.status === 410) {
          const replay = new Error('Manufacturer pairing claim has already been used');
          replay.statusCode = 410;
          replay.code = 'ROBOT_PAIRING_REPLAY';
          throw replay;
        }
        if (!response.ok) throw new Error(`Manufacturer pairing service returned ${response.status}`);
        const body = await readBoundedObjectResponse(response, 'Manufacturer pairing service', signal);
        if (body.claim_id !== claimId) {
          throw new Error('Manufacturer pairing service returned an uncorrelated claim');
        }
        return {
          adapterId,
          hardwareSerial: body.hardware_serial,
          manufacturerDeviceId: body.manufacturer_device_id,
          oneTime: body.one_time === true,
          expiresAt: Number(body.expires_at)
        };
      }
    });
  };
}

function createManufacturerRobotStatusClient({ url, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  return async function getRobotStatus(robotId) {
    return manufacturerRequest({
      fetchImpl,
      url,
      timeoutMs,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Manufacturer-Api-Key': apiKey },
        body: JSON.stringify({ robot_id: robotId })
      },
      consume: async (response, signal) => {
        if (response.status === 404) return { online: false, hardware_status: 'offline' };
        if (!response.ok) throw new Error(`Manufacturer status service returned ${response.status}`);
        const body = await readBoundedObjectResponse(response, 'Manufacturer status service', signal);
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
        const reportedAt = Number(body.reported_at);
        if (!Number.isSafeInteger(reportedAt) || reportedAt <= 0) {
          return {
            online: false,
            hardware_status: 'unknown',
            telemetry_error: 'invalid_timestamp'
          };
        }
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
          reported_at: reportedAt
        };
      }
    });
  };
}

function createManufacturerRobotResetClient({ url, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  return async function resetRobot({ resetId, manufacturerDeviceId, bindingEpoch } = {}) {
    if (!RESET_ID_PATTERN.test(resetId || '')) {
      throw new Error('Manufacturer reset id is invalid');
    }
    if (!MANUFACTURER_DEVICE_ID_PATTERN.test(manufacturerDeviceId || '')) {
      throw new Error('Manufacturer device id is invalid');
    }
    if (!Number.isSafeInteger(bindingEpoch) || bindingEpoch <= 0) {
      throw new Error('Manufacturer binding epoch is invalid');
    }
    return manufacturerRequest({
      fetchImpl,
      url,
      timeoutMs,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': resetId,
          'X-Manufacturer-Api-Key': apiKey,
          'X-Veryloving-Reset-Contract': ROBOT_RESET_CONTRACT
        },
        body: JSON.stringify({
          contract_version: ROBOT_RESET_CONTRACT_VERSION,
          reset_id: resetId,
          robot_id: manufacturerDeviceId,
          binding_epoch: bindingEpoch,
          erase_user_data: true
        })
      },
      consume: async (response, signal) => {
        // A receipt, empty success, or uncorrelated completion cannot authorize
        // local unbinding. The bridge must prove that this exact binding epoch
        // was erased and fenced under the caller's stable reset identity.
        if (!response.ok || response.status !== 200) {
          throw new Error(`Manufacturer reset service returned ${response.status}`);
        }
        const payload = await readBoundedObjectResponse(response, 'Manufacturer reset service', signal);
        if (payload.reset_id !== resetId
          || payload.binding_epoch !== bindingEpoch
          || payload.state !== 'completed'
          || payload.erased !== true
          || payload.fenced !== true) {
          throw new Error('Manufacturer reset service returned an invalid completion');
        }
        return true;
      }
    });
  };
}

function normalizePrivacyRobotIds(robotIds) {
  if (!Array.isArray(robotIds) || robotIds.length > 1000) {
    throw new Error('Manufacturer privacy robot identifiers are invalid');
  }
  const normalized = [...new Set(robotIds)];
  if (normalized.some((robotId) => (
    typeof robotId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(robotId)
  ))) {
    throw new Error('Manufacturer privacy robot identifiers are invalid');
  }
  return normalized;
}

function createManufacturerPrivacyClient({
  exportURL,
  deleteURL,
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000
} = {}) {
  async function request(url, robotIds, operation, { idempotencyKey } = {}) {
    if (!url || !apiKey) throw new Error(`Manufacturer privacy ${operation} is not configured`);
    if (idempotencyKey !== undefined
      && (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(idempotencyKey))) {
      throw new Error('Manufacturer privacy idempotency key is invalid');
    }
    return manufacturerRequest({
      fetchImpl,
      url,
      timeoutMs,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Manufacturer-Api-Key': apiKey,
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
        },
        body: JSON.stringify({ robot_ids: robotIds })
      },
      consume: async (response, signal) => {
        if (operation === 'deletion') {
          return requireSynchronousCompletion(response, 'Manufacturer privacy deletion', signal);
        }
        if (!response.ok) {
          throw new Error(`Manufacturer privacy ${operation} returned ${response.status}`);
        }
        if (response.status === 204) return { completed: true };
        const text = await readBoundedResponseText(response, 'Manufacturer privacy', signal);
        if (!text) return { completed: true };
        let payload;
        try { payload = JSON.parse(text); } catch { throw new Error('Manufacturer privacy response is invalid'); }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          throw new Error('Manufacturer privacy response is invalid');
        }
        return payload;
      }
    });
  }
  return {
    async exportRobotData(robotIds) {
      robotIds = normalizePrivacyRobotIds(robotIds);
      if (!robotIds.length) return { robots: [] };
      return request(exportURL, robotIds, 'export');
    },
    async deleteRobotData(robotIds, options) {
      robotIds = normalizePrivacyRobotIds(robotIds);
      if (!robotIds.length) return { deleted: 0 };
      await request(deleteURL, robotIds, 'deletion', options);
      return { deleted: robotIds.length };
    }
  };
}

function createManufacturerPrivacyRepository({
  listManufacturerDeviceIds,
  ...clientOptions
} = {}) {
  if (typeof listManufacturerDeviceIds !== 'function') {
    throw new Error('Manufacturer privacy requires account-bound robot lookup');
  }
  const client = createManufacturerPrivacyClient(clientOptions);
  return {
    async exportUserData(userId) {
      return client.exportRobotData(await listManufacturerDeviceIds(userId));
    },
    async deleteUserData(userId) {
      return client.deleteRobotData(await listManufacturerDeviceIds(userId));
    }
  };
}

function createRoutedManufacturerPrivacyRepository({
  listManufacturerRobotBindings,
  legacyClient,
  robotAdapterRuntime,
  deletionRepository
} = {}) {
  if (typeof listManufacturerRobotBindings !== 'function') {
    throw new Error('Manufacturer privacy requires adapter-bound robot lookup');
  }

  async function groupedBindings(userId) {
    const bindings = await listManufacturerRobotBindings(userId);
    if (!Array.isArray(bindings) || bindings.length > 1000) {
      throw new Error('Manufacturer privacy robot bindings are invalid');
    }
    const grouped = new Map();
    for (const binding of bindings) {
      const adapterId = binding?.adapterId;
      const manufacturerDeviceId = binding?.manufacturerDeviceId;
      if (typeof adapterId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(adapterId)) {
        throw new Error('Manufacturer privacy robot binding is invalid');
      }
      const ids = grouped.get(adapterId) || [];
      ids.push(manufacturerDeviceId);
      grouped.set(adapterId, ids);
    }
    for (const [adapterId, robotIds] of grouped) {
      grouped.set(adapterId, normalizePrivacyRobotIds(robotIds));
    }
    return grouped;
  }

  function missingHandler(adapterId, operation) {
    const error = new Error(`Manufacturer privacy ${operation} is not configured for the robot adapter`);
    error.statusCode = 503;
    error.code = 'ROBOT_ADAPTER_PRIVACY_NOT_CONFIGURED';
    error.adapterId = adapterId;
    return error;
  }

  async function invoke(adapterId, operation, robotIds, options) {
    if (adapterId === 'manufacturer-default') {
      const method = operation === 'export' ? 'exportRobotData' : 'deleteRobotData';
      if (typeof legacyClient?.[method] !== 'function') throw missingHandler(adapterId, operation);
      return legacyClient[method](robotIds, options);
    }
    const method = operation === 'export' ? 'exportRobotData' : 'deleteRobotData';
    if (typeof robotAdapterRuntime?.[method] !== 'function') throw missingHandler(adapterId, operation);
    // The production runtime exposes its privacy client so the operation's
    // stable idempotency key can reach the vendor endpoint without coupling
    // unrelated robot command methods to privacy semantics.
    if (operation === 'delete' && options && typeof robotAdapterRuntime.privacyClient === 'function') {
      return robotAdapterRuntime.privacyClient(adapterId).deleteRobotData(robotIds, options);
    }
    return robotAdapterRuntime[method](adapterId, robotIds, options);
  }

  const deletionCoordinator = deletionRepository
    ? createManufacturerPrivacyDeletionCoordinator({
      repository: deletionRepository,
      deleteAdapter: (adapterId, robotIds, options) => invoke(adapterId, 'delete', robotIds, options)
    })
    : null;

  return {
    async exportUserData(userId) {
      const grouped = await groupedBindings(userId);
      if (!grouped.size) return { robots: [] };
      if (grouped.size === 1 && grouped.has('manufacturer-default')) {
        return invoke('manufacturer-default', 'export', grouped.get('manufacturer-default'));
      }
      const adapterExports = [];
      for (const [adapterId, robotIds] of grouped) {
        adapterExports.push({
          adapter_id: adapterId,
          data: await invoke(adapterId, 'export', robotIds)
        });
      }
      return { adapter_exports: adapterExports };
    },
    async deleteUserData(userId) {
      const grouped = await groupedBindings(userId);
      if (deletionCoordinator) {
        return deletionCoordinator.deleteUserData(userId, [...grouped].map(([adapterId, robotIds]) => ({
          adapterId,
          robotIds
        })));
      }
      let deleted = 0;
      for (const [adapterId, robotIds] of grouped) {
        const result = await invoke(adapterId, 'delete', robotIds);
        deleted += Number.isSafeInteger(result?.deleted) ? result.deleted : robotIds.length;
      }
      return { deleted };
    }
  };
}

module.exports = {
  createManufacturerPairingVerifier,
  createManufacturerPrivacyClient,
  createManufacturerPrivacyRepository,
  createManufacturerRobotResetClient,
  createManufacturerRobotStatusClient,
  createRoutedManufacturerPrivacyRepository,
  normalizeIndoorPosition,
  normalizeMedicationAcknowledgements,
  normalizeNavigationPath,
  normalizeSafetyEvents,
  ROBOT_RESET_CONTRACT,
  ROBOT_RESET_CONTRACT_VERSION
};
