'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  createRobotActionEnvelope,
  normalizeToolCall,
  refreshRobotActionEnvelope,
  signRobotAction,
  verifyRobotActionToken
} = require('./robotics-gateway.cjs');

const secret = 'robotics-test-secret-that-is-at-least-32-characters';
const claims = { sub: 'user-1', sid: 'session-1' };
const now = 1_700_000_000_000;

function resignPayload(token, payload, signingSecret = secret) {
  const [encodedHeader] = token.split('.');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', signingSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

test('creates a session-bound signed ROBOT_ACTION envelope for robotics tools', () => {
  const envelope = createRobotActionEnvelope({
    type: 'tool_call',
    tool_call_id: 'call-1',
    name: 'navigate_robo_cane',
    parameters: JSON.stringify({ latitude: 1.2, longitude: 103.8 })
  }, claims, { sessionJWTSecret: secret }, now);

  assert.equal(envelope.type, 'ROBOT_ACTION');
  const [encodedHeader, encodedPayload, signature] = envelope.token.split('.');
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url'));
  const expected = crypto.createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  assert.equal(signature, expected);
  assert.equal(payload.sub, 'user-1');
  assert.equal(payload.action.name, 'navigate_robo_cane');
  assert.deepEqual(verifyRobotActionToken(envelope.token, claims, { sessionJWTSecret: secret }, now).action, {
    id: 'call-1',
    name: 'navigate_robo_cane',
    parameters: { latitude: 1.2, longitude: 103.8 },
    responseRequired: true
  });
});

test('ignores non-robotics tool calls', () => {
  const envelope = createRobotActionEnvelope({ type: 'tool_call', name: 'get_safety_tips' },
    { sub: 'user-1', sid: 'session-1' },
    { sessionJWTSecret: 'robotics-test-secret-that-is-at-least-32-characters' });
  assert.equal(envelope, null);
});

test('rejects robotics tool calls without a provider correlation id', () => {
  const envelope = createRobotActionEnvelope({
    type: 'tool_call',
    name: 'find_robot',
    parameters: {}
  }, { sub: 'user-1', sid: 'session-1' }, {
    sessionJWTSecret: 'robotics-test-secret-that-is-at-least-32-characters'
  });
  assert.equal(envelope, null);
});

test('fails closed with a short verification secret and logs only a redacted reason', () => {
  const token = signRobotAction({ id: 'call-1', name: 'robot_stop', parameters: {} }, claims,
    { sessionJWTSecret: secret }, now);
  const warnings = [];
  const result = verifyRobotActionToken(token, claims, {
    sessionJWTSecret: 'short',
    logger: { warn: (...args) => warnings.push(args) }
  }, now);
  assert.equal(result, null);
  assert.deepEqual(warnings, [[
    '[RoboticsGateway] robot action verification rejected',
    { reason: 'secret_unconfigured' }
  ]]);
  assert.doesNotMatch(JSON.stringify(warnings), /1\.2|103\.8|call-1/);
});

test('accepts 30 seconds of clock skew but rejects older robot actions', () => {
  const action = { id: 'clock-skew', name: 'robot_stop', parameters: {} };
  const withinTolerance = signRobotAction(action, claims, { sessionJWTSecret: secret }, now - 50_000);
  const outsideTolerance = signRobotAction(action, claims, { sessionJWTSecret: secret }, now - 61_000);
  assert.ok(verifyRobotActionToken(withinTolerance, claims, { sessionJWTSecret: secret }, now));
  assert.equal(verifyRobotActionToken(outsideTolerance, claims, { sessionJWTSecret: secret }, now), null);
});

test('rejects reserved, unexpected, and unsafe robotics parameters before signing', () => {
  const base = { type: 'tool_call', tool_call_id: 'call-1', name: 'navigate_robo_cane' };
  assert.equal(normalizeToolCall({
    ...base,
    parameters: { latitude: 1.2, longitude: 103.8, name: 'robot_stop' }
  }), null);
  assert.equal(normalizeToolCall({
    ...base,
    parameters: { latitude: 91, longitude: 103.8 }
  }), null);
  assert.equal(normalizeToolCall({
    ...base,
    parameters: { latitude: 1.2, longitude: 103.8, untrusted: true }
  }), null);
  assert.equal(normalizeToolCall({
    type: 'tool_call',
    tool_call_id: 'speed-1',
    name: 'set_robot_speed',
    parameters: {}
  }), null);
});

test('refreshes only authentic, session-bound, recently expired actions', () => {
  const action = {
    id: 'refresh-1',
    name: 'navigate_robo_cane',
    parameters: { latitude: 1.3521, longitude: 103.8198 }
  };
  const recentlyExpired = signRobotAction(action, claims, { sessionJWTSecret: secret }, now - 89_000);
  const refreshed = refreshRobotActionEnvelope(recentlyExpired, claims, { sessionJWTSecret: secret }, now);
  assert.equal(refreshed.type, 'ROBOT_ACTION');
  assert.deepEqual(verifyRobotActionToken(refreshed.token, claims, { sessionJWTSecret: secret }, now).action, action);

  const [header, payload] = recentlyExpired.split('.');
  const tamperedPayload = Buffer.from(payload, 'base64url').toString('utf8').replace('navigate_robo_cane', 'stop_robo_cane');
  const tampered = `${header}.${Buffer.from(tamperedPayload).toString('base64url')}.${recentlyExpired.split('.')[2]}`;
  assert.equal(refreshRobotActionEnvelope(tampered, claims, { sessionJWTSecret: secret }, now), null);
  assert.equal(refreshRobotActionEnvelope(recentlyExpired,
    { sub: claims.sub, sid: 'different-session' }, { sessionJWTSecret: secret }, now), null);

  const tooOld = signRobotAction(action, claims, { sessionJWTSecret: secret }, now - 91_000);
  assert.equal(refreshRobotActionEnvelope(tooOld, claims, { sessionJWTSecret: secret }, now), null);
});

test('refresh rejects correctly signed tokens with the wrong issuer, audience, or action schema', () => {
  const token = signRobotAction({ id: 'call-1', name: 'robot_stop', parameters: {} }, claims,
    { sessionJWTSecret: secret }, now);
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  assert.equal(refreshRobotActionEnvelope(resignPayload(token, { ...payload, iss: 'untrusted' }), claims,
    { sessionJWTSecret: secret }, now), null);
  assert.equal(refreshRobotActionEnvelope(resignPayload(token, { ...payload, aud: 'untrusted' }), claims,
    { sessionJWTSecret: secret }, now), null);
  assert.equal(refreshRobotActionEnvelope(resignPayload(token, {
    ...payload,
    action: { ...payload.action, parameters: { name: 'find_robot' } }
  }), claims, { sessionJWTSecret: secret }, now), null);
});
