'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { verifyRobotActionEnvelope } = require('../src/services/robotics-auth');

function segment(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
const now = 1_700_000_000_000;
const accessToken = `${segment({ alg: 'HS256', typ: 'JWT' })}.${segment({ sub: 'user-1', sid: 'session-1', exp: 1_800_000_000 })}.session-signature`;
const actionPayload = {
  iss: 'veryloving-robotics-gateway',
  aud: 'veryloving-robotics-mobile',
  sub: 'user-1',
  sid: 'session-1',
  exp: 1_700_000_030,
  action: { id: 'call-1', name: 'robot_stop', parameters: {} }
};
const invalidToken = `${segment({ alg: 'HS256', typ: 'robot-action+jwt' })}.${segment(actionPayload)}.invalid-signature`;

test('mobile client rejects a ROBOT_ACTION signed with an invalid JWT signature', async () => {
  const result = await verifyRobotActionEnvelope({ type: 'ROBOT_ACTION', token: invalidToken }, {
    accessToken,
    now,
    verifySignature: async () => ({ valid: false })
  });
  assert.equal(result, null);
});

test('mobile client rejects a ROBOT_ACTION with a missing JWT', async () => {
  let verifierCalled = false;
  const result = await verifyRobotActionEnvelope({ type: 'ROBOT_ACTION' }, {
    accessToken,
    now,
    verifySignature: async () => { verifierCalled = true; return { valid: true }; }
  });
  assert.equal(result, null);
  assert.equal(verifierCalled, false);
});
