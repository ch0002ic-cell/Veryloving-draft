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
