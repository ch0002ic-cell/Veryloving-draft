'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  SERVER_INTEGER_ENVIRONMENT,
  parseBoundedServerInteger,
  validateServerIntegerConfig
} = require('./environment-schema.cjs');

test('server integer environment fields use their exact safe-integer bounds and defaults', () => {
  for (const [name, definition] of Object.entries(SERVER_INTEGER_ENVIRONMENT)) {
    assert.equal(parseBoundedServerInteger(name, undefined), definition.fallback);
    assert.equal(parseBoundedServerInteger(name, String(definition.min)), definition.min);
    assert.equal(parseBoundedServerInteger(name, String(definition.max)), definition.max);
    assert.throws(() => parseBoundedServerInteger(name, String(definition.min - 1)), new RegExp(name));
    assert.throws(() => parseBoundedServerInteger(name, String(definition.max + 1)), new RegExp(name));
    assert.throws(() => parseBoundedServerInteger(name, `${definition.min}.5`), new RegExp(name));
  }
  assert.throws(
    () => parseBoundedServerInteger('ACTION_REQUEST_TIMEOUT_MS', '9007199254740993'),
    /safe integer/
  );
});

test('injected server numeric configuration cannot bypass deployment bounds', () => {
  assert.equal(validateServerIntegerConfig({ actionRequestTimeoutMs: 5000 }).actionRequestTimeoutMs, 5000);
  assert.throws(
    () => validateServerIntegerConfig({ upstreamTimeoutMs: Number.POSITIVE_INFINITY }),
    /CLM_UPSTREAM_TIMEOUT_MS/
  );
  assert.throws(
    () => validateServerIntegerConfig({ robotAckTimeoutMs: 300000.5 }),
    /ROBOT_ACK_TIMEOUT_MS/
  );
});
