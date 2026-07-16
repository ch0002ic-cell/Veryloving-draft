'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createRobotActionEnvelope } = require('./robotics-gateway.cjs');

test('creates a session-bound signed ROBOT_ACTION envelope for robotics tools', () => {
  const secret = 'robotics-test-secret-that-is-at-least-32-characters';
  const envelope = createRobotActionEnvelope({
    type: 'tool_call',
    tool_call_id: 'call-1',
    name: 'navigate_robo_cane',
    parameters: JSON.stringify({ latitude: 1.2, longitude: 103.8 })
  }, { sub: 'user-1', sid: 'session-1' }, { sessionJWTSecret: secret }, 1_700_000_000_000);

  assert.equal(envelope.type, 'ROBOT_ACTION');
  const [encodedHeader, encodedPayload, signature] = envelope.token.split('.');
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url'));
  const expected = crypto.createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  assert.equal(signature, expected);
  assert.equal(payload.sub, 'user-1');
  assert.equal(payload.action.name, 'navigate_robo_cane');
});

test('ignores non-robotics tool calls', () => {
  const envelope = createRobotActionEnvelope({ type: 'tool_call', name: 'get_safety_tips' },
    { sub: 'user-1', sid: 'session-1' },
    { sessionJWTSecret: 'robotics-test-secret-that-is-at-least-32-characters' });
  assert.equal(envelope, null);
});
