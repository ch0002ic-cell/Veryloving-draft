'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { isDeepStrictEqual } = require('node:util');

if (process.env.NODE_ENV !== 'test') throw new Error('Manufacturer mock server is test-only');

const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_FUTURE_SKEW_MS = 60 * 1000;
const PROTOCOL = 'veryloving.robot-bridge.v1';
const CONTRACT_VERSION = 'vl-robot-action/2';
const RESET_CONTRACT = 'veryloving.robot-reset.v1';
const RESET_CONTRACT_VERSION = 'vl-robot-reset/1';
const PAIRING_VERIFY_CONTRACT = 'veryloving.robot-pairing-verify.v1';
const PAIRING_VERIFY_CONTRACT_VERSION = 'vl-robot-pairing-verify/1';
const ACTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const ADAPTER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const BRIDGE_PREFIXES = Object.freeze({
  yongyida: '/v1/veryloving/yongyida-cloud',
  jiangzhi: '/v1/veryloving/jiangzhi-edge'
});

class MockBridgeError extends Error {
  constructor(statusCode, code, message = code) {
    super(message);
    this.name = 'MockBridgeError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeEqual(left, right) {
  const leftBytes = Buffer.from(String(left || ''));
  const rightBytes = Buffer.from(String(right || ''));
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function responseJSON(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json'
  });
  res.end(body);
}

function readBoundedJSON(req, maximumBytes) {
  const advertisedLength = req.headers?.['content-length'];
  if (advertisedLength && /^\d{1,12}$/.test(advertisedLength) && Number(advertisedLength) > maximumBytes) {
    req.resume?.();
    throw new MockBridgeError(413, 'REQUEST_TOO_LARGE');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > maximumBytes) {
        chunks.length = 0;
        finish(reject, new MockBridgeError(413, 'REQUEST_TOO_LARGE'));
        req.resume?.();
        return;
      }
      chunks.push(bytes);
    });
    req.on('end', () => {
      if (settled) return;
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
      } catch {
        finish(reject, new MockBridgeError(400, 'INVALID_JSON'));
        return;
      }
      if (!isObject(parsed)) {
        finish(reject, new MockBridgeError(400, 'INVALID_JSON_OBJECT'));
        return;
      }
      finish(resolve, parsed);
    });
    req.on('error', (error) => finish(reject, error));
    req.on('aborted', () => finish(reject, new MockBridgeError(400, 'REQUEST_ABORTED')));
  });
}

function normalizeAdapter(vendor, value = {}, now = Date.now) {
  const adapterId = value.adapterId || `${vendor}-integration`;
  const deviceId = value.deviceId || `${vendor}-device-001`;
  const apiKey = value.apiKey || `${vendor}-integration-api-key`;
  const sessionToken = value.sessionToken || `${vendor}-integration-session`;
  if (!ADAPTER_ID_PATTERN.test(adapterId)
    || !IDENTIFIER_PATTERN.test(deviceId)
    || typeof apiKey !== 'string' || apiKey.length < 8
    || typeof sessionToken !== 'string' || sessionToken.length < 8) {
    throw new TypeError(`Invalid ${vendor} mock bridge configuration`);
  }
  const observedAtMs = now();
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs <= 0) {
    throw new TypeError('Mock bridge clock returned an invalid timestamp');
  }
  const observedAt = new Date(observedAtMs).toISOString();
  const signedActionStatus = value.signedActionStatus === 200 ? 200 : 202;
  const status = Object.freeze({
    online: true,
    state: 'online',
    observed_at: observedAt,
    firmware_version: vendor === 'yongyida' ? 'y120-bridge-test' : 'jzkh-edge-test',
    ...(isObject(value.status) ? value.status : {})
  });
  const battery = Object.freeze({
    percentage: vendor === 'yongyida' ? 73 : 81,
    charging: vendor === 'jiangzhi',
    observed_at: observedAt,
    ...(isObject(value.battery) ? value.battery : {})
  });
  const vitals = Object.freeze(Array.isArray(value.vitals) ? value.vitals : [{
    kind: 'heart_rate',
    value: vendor === 'yongyida' ? 71 : 72,
    unit: 'bpm',
    observed_at: observedAt,
    quality: 'good'
  }]);
  const telemetrySnapshot = Object.freeze({
    status,
    battery,
    vitals,
    location: Object.freeze(vendor === 'yongyida'
      ? { longitude: 103.8519, latitude: 1.2902, captured_at: observedAtMs }
      : { longitude: 103.8521, latitude: 1.2904, captured_at: observedAtMs }),
    navigation_path: Object.freeze({
      points: Object.freeze([
        Object.freeze([103.8519, 1.2902]),
        Object.freeze([103.8521, 1.2904])
      ]),
      captured_at: observedAtMs
    }),
    indoor_position: Object.freeze({
      map_id: 'integration-home-map',
      floor_id: 'floor-1',
      room_id: vendor === 'yongyida' ? 'living-room' : 'bedroom',
      x_m: vendor === 'yongyida' ? 2.5 : 4.25,
      y_m: vendor === 'yongyida' ? 3.5 : 2.75,
      confidence: 0.95,
      captured_at: observedAtMs
    }),
    safety_events: Object.freeze([Object.freeze({
      event_type: 'fall_detected',
      event_id: `${vendor}-fall-event-0001`,
      occurred_at: observedAtMs - 1_000,
      confidence: 0.9
    })]),
    medication_acknowledgements: Object.freeze([Object.freeze({
      reminder_id: `${vendor}-reminder-0001`,
      receipt_id: `${vendor}-receipt-0001`,
      delivered_at: observedAtMs - 500
    })]),
    ...(isObject(value.telemetrySnapshot) ? value.telemetrySnapshot : {})
  });
  return Object.freeze({
    adapterId,
    apiKey,
    deviceId,
    sessionToken,
    signedActionStatus,
    pairingCode: value.pairingCode || `${vendor}-one-time-pairing-code`,
    hardwareSerial: value.hardwareSerial || `${vendor.toUpperCase()}-PRIVATE-SERIAL-001`,
    status,
    battery,
    vitals,
    telemetrySnapshot
  });
}

function normalizePublicKey(value) {
  if (!value) return null;
  try {
    const key = crypto.createPublicKey(value);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong key type');
    return key;
  } catch {
    throw new TypeError('Mock bridge publicKey must be an Ed25519 public key');
  }
}

function verifySignedAction(action, adapter, publicKey, now, futureSkewMs) {
  if (!publicKey) throw new MockBridgeError(503, 'SIGNING_KEY_NOT_CONFIGURED');
  if (!isObject(action)
    || !isObject(action.envelope)
    || action.algorithm !== 'Ed25519'
    || typeof action.payload !== 'string'
    || action.payload.length < 1
    || action.payload.length > 64 * 1024
    || !/^[A-Za-z0-9_-]+$/.test(action.payload)
    || typeof action.signature !== 'string'
    || action.signature.length < 40
    || action.signature.length > 512
    || !/^[A-Za-z0-9_-]+$/.test(action.signature)) {
    throw new MockBridgeError(400, 'SIGNED_ACTION_INVALID');
  }

  let signedEnvelope;
  try {
    signedEnvelope = JSON.parse(Buffer.from(action.payload, 'base64url').toString('utf8'));
  } catch {
    throw new MockBridgeError(400, 'SIGNED_ACTION_INVALID');
  }
  const envelope = action.envelope;
  if (!isObject(signedEnvelope)
    || !isDeepStrictEqual(signedEnvelope, envelope)
    || !crypto.verify(
      null,
      Buffer.from(action.payload, 'ascii'),
      publicKey,
      Buffer.from(action.signature, 'base64url')
    )) {
    throw new MockBridgeError(401, 'SIGNED_ACTION_UNVERIFIED');
  }

  if (envelope.version !== 2
    || envelope.contract_version !== CONTRACT_VERSION
    || envelope.device_type !== 'home_robot'
    || envelope.adapter_id !== adapter.adapterId
    || envelope.manufacturer_device_id !== adapter.deviceId
    || !Number.isSafeInteger(envelope.binding_epoch)
    || envelope.binding_epoch <= 0
    || !IDENTIFIER_PATTERN.test(String(envelope.device_id || ''))
    || !ACTION_ID_PATTERN.test(String(envelope.id || ''))
    || typeof envelope.action !== 'string'
    || envelope.action.length < 1
    || envelope.action.length > 128
    || !isObject(envelope.parameters)
    || !Number.isSafeInteger(envelope.issued_at)
    || !Number.isSafeInteger(envelope.expires_at)
    || envelope.expires_at <= envelope.issued_at
    || envelope.issued_at > now + futureSkewMs) {
    throw new MockBridgeError(400, 'SIGNED_ACTION_CONTRACT_INVALID');
  }
  if (envelope.expires_at <= now) throw new MockBridgeError(410, 'SIGNED_ACTION_EXPIRED');
  return envelope;
}

function behaviorKey(vendor, endpoint) {
  return `${vendor}:${endpoint}`;
}

function createManufacturerMockServer({
  apiKey = 'integration-test-key',
  adapters = {},
  publicKey,
  now = Date.now,
  maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
  futureSkewMs = DEFAULT_FUTURE_SKEW_MS
} = {}) {
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 128 || maxRequestBytes > 1024 * 1024) {
    throw new TypeError('maxRequestBytes is invalid');
  }
  if (typeof now !== 'function' || !Number.isSafeInteger(futureSkewMs) || futureSkewMs < 0) {
    throw new TypeError('Mock bridge clock configuration is invalid');
  }
  const configuredAdapters = Object.freeze({
    yongyida: normalizeAdapter('yongyida', adapters.yongyida, now),
    jiangzhi: normalizeAdapter('jiangzhi', adapters.jiangzhi, now)
  });
  const signingPublicKey = normalizePublicKey(publicKey);
  const behaviors = new Map();
  const idempotencyRecords = new Map();
  const pairingReceipts = new Map();
  const consumedPairingCodes = new Map();
  const newestAcceptedEpochs = new Map();
  const revokedThroughEpochs = new Map();
  const executions = [];

  function enqueueBehavior(vendor, endpoint, behavior) {
    if (!configuredAdapters[vendor] || typeof endpoint !== 'string' || !isObject(behavior)) {
      throw new TypeError('Mock bridge behavior is invalid');
    }
    const key = behaviorKey(vendor, endpoint);
    behaviors.set(key, [...(behaviors.get(key) || []), { ...behavior }]);
  }

  function takeBehavior(vendor, endpoint) {
    const key = behaviorKey(vendor, endpoint);
    const queued = behaviors.get(key) || [];
    const next = queued.shift();
    if (queued.length) behaviors.set(key, queued);
    else behaviors.delete(key);
    return next;
  }

  async function applyBehavior(res, behavior) {
    if (!behavior) return false;
    if (behavior.type === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, Number(behavior.delayMs) || 100)));
      if (!res.destroyed) responseJSON(res, Number(behavior.statusCode) || 504, { error: 'SIMULATED_TIMEOUT' });
      return true;
    }
    if (behavior.type === 'auth') {
      responseJSON(res, 401, { error: 'SIMULATED_AUTH_FAILURE' });
      return true;
    }
    if (behavior.type === 'http_error') {
      responseJSON(res, Number(behavior.statusCode) || 500, { error: 'SIMULATED_BRIDGE_FAILURE' });
      return true;
    }
    if (behavior.type === 'malformed') {
      res.writeHead(Number(behavior.statusCode) || 200, { 'Content-Type': 'application/json' });
      res.end('{"malformed":');
      return true;
    }
    if (behavior.type === 'oversize') {
      const body = 'x'.repeat(Math.max(1, Number(behavior.bytes) || 128 * 1024));
      res.writeHead(Number(behavior.statusCode) || 200, {
        'Content-Length': Buffer.byteLength(body),
        'Content-Type': 'application/json'
      });
      res.end(body);
      return true;
    }
    if (behavior.type === 'disconnect') {
      res.destroy();
      return true;
    }
    throw new TypeError('Unknown mock bridge behavior');
  }

  function identifyBridge(pathname) {
    for (const [vendor, prefix] of Object.entries(BRIDGE_PREFIXES)) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        return { vendor, endpoint: pathname.slice(prefix.length).replace(/^\/+/, '') };
      }
    }
    return null;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://manufacturer.test').pathname;
      // Compatibility with the pre-HAL integration test. New bridge tests use
      // only the strict vendor-prefixed contract below.
      if (req.method === 'POST'
        && pathname === '/v1/manufacturer/robot/command'
        && safeEqual(req.headers['x-manufacturer-api-key'], apiKey)) {
        responseJSON(res, 202, { status: 'accepted' });
        return;
      }

      const route = identifyBridge(pathname);
      if (!route || req.method !== 'POST') {
        responseJSON(res, 404, { error: 'NOT_FOUND' });
        return;
      }
      const { vendor, endpoint } = route;
      const adapter = configuredAdapters[vendor];
      if (endpoint === 'pairing/verify') {
        if (!safeEqual(req.headers['x-manufacturer-api-key'], adapter.apiKey)
          || req.headers['x-veryloving-pairing-contract'] !== PAIRING_VERIFY_CONTRACT) {
          responseJSON(res, 401, { error: 'UNAUTHORIZED' });
          return;
        }
        const body = await readBoundedJSON(req, maxRequestBytes);
        const claimId = req.headers['idempotency-key'];
        if (!/^[A-Za-z0-9_-]{43}$/.test(String(claimId || ''))
          || body.contract_version !== PAIRING_VERIFY_CONTRACT_VERSION
          || Object.keys(body).sort().join(',') !== 'contract_version,pairing_code') {
          throw new MockBridgeError(400, 'PAIRING_CLAIM_INVALID');
        }
        const receiptKey = `${vendor}:pairing:${claimId}`;
        const digest = crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64url');
        const previous = pairingReceipts.get(receiptKey);
        if (previous) {
          if (previous.digest !== digest) throw new MockBridgeError(409, 'IDEMPOTENCY_CONFLICT');
          responseJSON(res, 200, { ...previous.payload, duplicate: true });
          return;
        }
        if (body.pairing_code !== adapter.pairingCode) {
          responseJSON(res, 404, { error: 'PAIRING_CLAIM_NOT_FOUND' });
          return;
        }
        const consumedBy = consumedPairingCodes.get(`${vendor}:${body.pairing_code}`);
        if (consumedBy && consumedBy !== claimId) {
          responseJSON(res, 410, { error: 'PAIRING_CLAIM_USED' });
          return;
        }
        const payload = {
          claim_id: claimId,
          hardware_serial: adapter.hardwareSerial,
          manufacturer_device_id: adapter.deviceId,
          one_time: true,
          expires_at: now() + 60_000
        };
        pairingReceipts.set(receiptKey, { digest, payload });
        consumedPairingCodes.set(`${vendor}:${body.pairing_code}`, claimId);
        const behavior = takeBehavior(vendor, endpoint);
        if (await applyBehavior(res, behavior)) return;
        responseJSON(res, 200, payload);
        return;
      }
      if (endpoint === 'lifecycle/reset') {
        if (!safeEqual(req.headers['x-manufacturer-api-key'], adapter.apiKey)
          || req.headers['x-veryloving-reset-contract'] !== RESET_CONTRACT) {
          responseJSON(res, 401, { error: 'UNAUTHORIZED' });
          return;
        }
        const behavior = takeBehavior(vendor, endpoint);
        if (behavior) req.resume?.();
        if (await applyBehavior(res, behavior)) return;
        const body = await readBoundedJSON(req, maxRequestBytes);
        const resetId = req.headers['idempotency-key'];
        const exactKeys = [
          'binding_epoch',
          'contract_version',
          'erase_user_data',
          'reset_id',
          'robot_id'
        ];
        if (typeof resetId !== 'string'
          || !IDENTIFIER_PATTERN.test(resetId)
          || resetId !== body.reset_id
          || !isDeepStrictEqual(Object.keys(body).sort(), exactKeys)
          || body.contract_version !== RESET_CONTRACT_VERSION
          || body.robot_id !== adapter.deviceId
          || !Number.isSafeInteger(body.binding_epoch)
          || body.binding_epoch <= 0
          || body.erase_user_data !== true) {
          throw new MockBridgeError(400, 'RESET_CONTRACT_INVALID');
        }
        const key = `${vendor}:reset:${resetId}`;
        const digest = crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64url');
        const previous = idempotencyRecords.get(key);
        if (previous) {
          if (previous.digest !== digest) throw new MockBridgeError(409, 'IDEMPOTENCY_CONFLICT');
          responseJSON(res, previous.statusCode, { ...previous.payload, duplicate: true });
          return;
        }
        const deviceKey = `${vendor}:${adapter.deviceId}`;
        if (body.binding_epoch < (newestAcceptedEpochs.get(deviceKey) || 0)) {
          throw new MockBridgeError(409, 'RESET_BINDING_SUPERSEDED');
        }
        revokedThroughEpochs.set(
          deviceKey,
          Math.max(revokedThroughEpochs.get(deviceKey) || 0, body.binding_epoch)
        );
        const payload = {
          reset_id: resetId,
          binding_epoch: body.binding_epoch,
          state: 'completed',
          erased: true,
          fenced: true,
          duplicate: false
        };
        idempotencyRecords.set(key, { digest, payload, statusCode: 200 });
        executions.push(Object.freeze({
          vendor,
          endpoint,
          resetId,
          bindingEpoch: body.binding_epoch
        }));
        responseJSON(res, 200, payload);
        return;
      }
      if (!safeEqual(req.headers.authorization, `Bearer ${adapter.apiKey}`)
        || req.headers['x-veryloving-adapter-protocol'] !== PROTOCOL) {
        responseJSON(res, 401, { error: 'UNAUTHORIZED' });
        return;
      }
      if (endpoint !== 'session' && !safeEqual(req.headers['x-veryloving-session'], adapter.sessionToken)) {
        responseJSON(res, 401, { error: 'SESSION_UNAUTHORIZED' });
        return;
      }

      const behavior = takeBehavior(vendor, endpoint);
      if (behavior) req.resume?.();
      if (await applyBehavior(res, behavior)) return;
      const body = await readBoundedJSON(req, maxRequestBytes);

      if (endpoint === 'session') {
        if (body.schema_version !== PROTOCOL || body.device_id !== adapter.deviceId) {
          throw new MockBridgeError(403, 'DEVICE_NOT_BOUND');
        }
        responseJSON(res, 200, { authenticated: true, session_token: adapter.sessionToken });
        return;
      }

      if (endpoint === 'telemetry/status/query') {
        if (body.device_id !== adapter.deviceId) throw new MockBridgeError(403, 'DEVICE_NOT_BOUND');
        responseJSON(res, 200, adapter.status);
        return;
      }
      if (endpoint === 'telemetry/battery/query') {
        if (body.device_id !== adapter.deviceId) throw new MockBridgeError(403, 'DEVICE_NOT_BOUND');
        responseJSON(res, 200, adapter.battery);
        return;
      }
      if (endpoint === 'telemetry/vitals/query') {
        if (body.device_id !== adapter.deviceId) throw new MockBridgeError(403, 'DEVICE_NOT_BOUND');
        responseJSON(res, 200, { items: adapter.vitals, next_cursor: null });
        return;
      }
      if (endpoint === 'telemetry/snapshot/query') {
        if (body.device_id !== adapter.deviceId) throw new MockBridgeError(403, 'DEVICE_NOT_BOUND');
        responseJSON(res, 200, adapter.telemetrySnapshot);
        return;
      }

      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || !IDENTIFIER_PATTERN.test(idempotencyKey)) {
        throw new MockBridgeError(400, 'IDEMPOTENCY_KEY_INVALID');
      }

      if (endpoint === 'signed-actions') {
        const envelope = verifySignedAction(body, adapter, signingPublicKey, now(), futureSkewMs);
        const deviceKey = `${vendor}:${adapter.deviceId}`;
        const revokedThrough = revokedThroughEpochs.get(deviceKey) || 0;
        if (envelope.binding_epoch <= revokedThrough) {
          throw new MockBridgeError(410, 'SIGNED_ACTION_BINDING_REVOKED');
        }
        const newestAcceptedEpoch = newestAcceptedEpochs.get(deviceKey) || 0;
        if (envelope.binding_epoch < newestAcceptedEpoch) {
          throw new MockBridgeError(410, 'SIGNED_ACTION_BINDING_SUPERSEDED');
        }
        if (idempotencyKey !== envelope.id) throw new MockBridgeError(400, 'IDEMPOTENCY_KEY_MISMATCH');
        const key = `${vendor}:signed:${envelope.id}`;
        const digest = crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64url');
        const previous = idempotencyRecords.get(key);
        if (previous) {
          if (previous.digest !== digest) throw new MockBridgeError(409, 'IDEMPOTENCY_CONFLICT');
          responseJSON(res, previous.statusCode, { ...previous.payload, duplicate: true });
          return;
        }
        const statusCode = adapter.signedActionStatus;
        const acknowledged = statusCode !== 202;
        const payload = {
          state: acknowledged ? 'completed' : 'accepted',
          ok: true,
          action_id: envelope.id,
          receipt_id: `${vendor}-receipt-${executions.length + 1}`,
          duplicate: false
        };
        newestAcceptedEpochs.set(deviceKey, Math.max(newestAcceptedEpoch, envelope.binding_epoch));
        idempotencyRecords.set(key, { digest, payload, statusCode });
        executions.push(Object.freeze({
          vendor,
          endpoint,
          actionId: envelope.id,
          adapterId: envelope.adapter_id,
          action: envelope.action,
          bindingEpoch: envelope.binding_epoch
        }));
        responseJSON(res, statusCode, payload);
        return;
      }

      if (endpoint === 'commands') {
        if (body.schema_version !== PROTOCOL
          || body.device_id !== adapter.deviceId
          || typeof body.command !== 'string'
          || body.command.length < 1
          || body.command.length > 128
          || !isObject(body.parameters)) {
          throw new MockBridgeError(400, 'COMMAND_INVALID');
        }
        const key = `${vendor}:command:${idempotencyKey}`;
        const digest = crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64url');
        const previous = idempotencyRecords.get(key);
        if (previous) {
          if (previous.digest !== digest) throw new MockBridgeError(409, 'IDEMPOTENCY_CONFLICT');
          responseJSON(res, previous.statusCode, { ...previous.payload, duplicate: true });
          return;
        }
        const payload = {
          success: true,
          command_id: `${vendor}-command-${executions.length + 1}`,
          state: body.command.includes('EMERGENCY_STOP') || body.command.includes('emergency_stop')
            ? 'completed' : 'accepted',
          duplicate: false
        };
        idempotencyRecords.set(key, { digest, payload, statusCode: 200 });
        executions.push(Object.freeze({ vendor, endpoint, command: body.command }));
        responseJSON(res, 200, payload);
        return;
      }

      responseJSON(res, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (error instanceof MockBridgeError) {
        responseJSON(res, error.statusCode, { error: error.code });
        return;
      }
      responseJSON(res, 500, { error: 'MOCK_BRIDGE_INTERNAL_ERROR' });
    }
  });

  server.enqueueBehavior = enqueueBehavior;
  server.getExecutions = ({ vendor, endpoint } = {}) => executions.filter((entry) => (
    (!vendor || entry.vendor === vendor) && (!endpoint || entry.endpoint === endpoint)
  )).map((entry) => ({ ...entry }));
  server.getAdapter = (vendor) => configuredAdapters[vendor] ? { ...configuredAdapters[vendor] } : null;
  server.getNewestAcceptedEpoch = (vendor) => {
    const adapter = configuredAdapters[vendor];
    return adapter ? (newestAcceptedEpochs.get(`${vendor}:${adapter.deviceId}`) || 0) : null;
  };
  server.getRevokedThroughEpoch = (vendor) => {
    const adapter = configuredAdapters[vendor];
    return adapter ? (revokedThroughEpochs.get(`${vendor}:${adapter.deviceId}`) || 0) : null;
  };
  return server;
}

module.exports = {
  BRIDGE_PREFIXES,
  CONTRACT_VERSION,
  PROTOCOL,
  RESET_CONTRACT,
  RESET_CONTRACT_VERSION,
  PAIRING_VERIFY_CONTRACT,
  PAIRING_VERIFY_CONTRACT_VERSION,
  createManufacturerMockServer
};
