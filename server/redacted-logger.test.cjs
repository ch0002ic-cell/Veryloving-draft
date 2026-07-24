'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRedactedLogger, sanitizeServerLog } = require('./redacted-logger.cjs');

test('server log sanitizer removes structured and embedded account PII', () => {
  const sanitized = sanitizeServerLog({
    user_id: 'user-private',
    hardware_serial: 'VL01-PRIVATE',
    phone: '+6591234567',
    detail: 'care@example.test used QR code=PAIRING-PRIVATE with Bearer jwt-private'
  });
  assert.deepEqual(sanitized, {
    user_id: '[REDACTED]',
    hardware_serial: '[REDACTED]',
    phone: '[REDACTED]',
    detail: '[REDACTED_EMAIL] used QR code=[REDACTED] with Bearer [REDACTED]'
  });
});

test('redacted logger sanitizes before forwarding to its configured sink', () => {
  const calls = [];
  const logger = createRedactedLogger({ warn(...args) { calls.push(args); } });
  logger.warn('pairing replay for +6591234567', { pairingToken: 'private-token', code: 'REPLAY' });
  assert.deepEqual(calls, [[
    'pairing replay for [REDACTED_PHONE]',
    { pairingToken: '[REDACTED]', code: 'REPLAY' }
  ]]);
});

test('server log sanitizer redacts device identifiers in common field styles', () => {
  assert.deepEqual(sanitizeServerLog({
    deviceId: 'wearable-private-1',
    device_id: 'robot-private-1',
    sourceDeviceRef: 'edge-private-1',
    parameters: { medication: 'private-medication' },
    nested: { device_ref: 'binding-private-1' }
  }), {
    deviceId: '[REDACTED]',
    device_id: '[REDACTED]',
    sourceDeviceRef: '[REDACTED]',
    parameters: '[REDACTED]',
    nested: { device_ref: '[REDACTED]' }
  });
});

test('server log sanitizer does not retain identifiers embedded in request paths', () => {
  assert.deepEqual(sanitizeServerLog({
    path: '/v1/devices/home-robots/robot-private-1',
    name: 'UpstreamError'
  }), {
    path: '[REDACTED]',
    name: 'UpstreamError'
  });
});

test('server diagnostics contain hostile values and bound native log payloads', () => {
  let reads = 0;
  const hostile = {};
  for (let index = 0; index < 75; index += 1) {
    Object.defineProperty(hostile, `field-${index}`, {
      enumerable: true,
      get() {
        reads += 1;
        if (index === 2) throw new Error('getter exploded');
        return index;
      }
    });
  }
  const revoked = Proxy.revocable([], {});
  revoked.revoke();
  const longSecret = `Bearer private-token ${'x'.repeat(4096)}`;

  assert.doesNotThrow(() => sanitizeServerLog(hostile));
  const sanitized = sanitizeServerLog({
    hostile,
    revoked: revoked.proxy,
    detail: longSecret,
    values: Array.from({ length: 75 }, (_, index) => index)
  });
  assert.equal(reads, 100);
  assert.equal(sanitized.hostile['field-2'], '[UNREADABLE]');
  assert.equal(sanitized.hostile.truncated, true);
  assert.equal(sanitized.revoked, '[UNREADABLE]');
  assert.doesNotMatch(sanitized.detail, /private-token/);
  assert.match(sanitized.detail, /\[TRUNCATED\]$/);
  assert.equal(sanitized.values.length, 51);
  assert.equal(sanitized.values.at(-1), '[TRUNCATED]');
});

test('redacted logger never turns a sanitizer or sink failure into an application failure', () => {
  const hostile = {};
  Object.defineProperty(hostile, 'detail', {
    enumerable: true,
    get() { throw new Error('getter exploded'); }
  });
  const throwingSink = createRedactedLogger({
    error() { throw new Error('sink unavailable'); }
  });
  const revokedSink = Proxy.revocable({}, {});
  revokedSink.revoke();
  const inaccessibleSink = createRedactedLogger(revokedSink.proxy);

  assert.doesNotThrow(() => throwingSink.error('handled failure', hostile));
  assert.doesNotThrow(() => inaccessibleSink.error('handled failure', hostile));
});
