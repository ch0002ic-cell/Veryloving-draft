'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  inspectRobotActionEnvelope,
  verifyRobotActionEnvelope,
  verifyRobotActionEnvelopeWithRefresh,
  verifyRobotActionWithGateway
} = require('../src/services/robotics-auth');

function segment(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
const now = 1_700_000_000_000;
const nowSeconds = Math.floor(now / 1000);
const accessToken = `${segment({ alg: 'HS256', typ: 'JWT' })}.${segment({
  sub: 'user-1',
  sid: 'session-1',
  exp: 1_800_000_000
})}.session-signature`;

function robotEnvelope({
  action = { id: 'call-1', name: 'robot_stop', parameters: {}, responseRequired: true },
  issuedAt = nowSeconds,
  signature = 'untrusted-client-signature'
} = {}) {
  const payload = {
    iss: 'veryloving-robotics-gateway',
    aud: 'veryloving-robotics-mobile',
    sub: 'user-1',
    sid: 'session-1',
    iat: issuedAt,
    exp: issuedAt + 30,
    jti: '11111111-1111-4111-8111-111111111111',
    action
  };
  return {
    type: 'ROBOT_ACTION',
    token: `${segment({ alg: 'HS256', typ: 'robot-action+jwt' })}.${segment(payload)}.${signature}`
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('mobile client rejects a ROBOT_ACTION signed with an invalid JWT signature', async () => {
  const result = await verifyRobotActionEnvelope(robotEnvelope(), {
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

test('mobile client uses the action inside the signed token, never a verifier replacement', async () => {
  const signedAction = { id: 'safe-stop', name: 'robot_stop', parameters: {}, responseRequired: true };
  const result = await verifyRobotActionEnvelope(robotEnvelope({ action: signedAction }), {
    accessToken,
    now,
    verifySignature: async () => ({
      valid: true,
      action: {
        id: 'substituted',
        name: 'navigate_robo_cane',
        parameters: { latitude: 1.2, longitude: 103.8 }
      }
    })
  });
  assert.deepEqual(result, signedAction);
});

test('mobile structural checks apply clock tolerance and strict action schemas', () => {
  assert.ok(inspectRobotActionEnvelope(robotEnvelope({ issuedAt: nowSeconds - 50 }), { accessToken, now }));
  assert.equal(inspectRobotActionEnvelope(robotEnvelope({ issuedAt: nowSeconds - 61 }), { accessToken, now }), null);
  assert.equal(inspectRobotActionEnvelope(robotEnvelope({
    action: {
      id: 'reserved-parameter',
      name: 'navigate_robo_cane',
      parameters: { latitude: 1.2, longitude: 103.8, name: 'robot_stop' }
    }
  }), { accessToken, now }), null);
  assert.equal(inspectRobotActionEnvelope(robotEnvelope({
    action: { id: 'bad-metadata', name: 'robot_stop', parameters: {}, responseRequired: 'yes' }
  }), { accessToken, now }), null);
});

test('mobile requests one fresh envelope and verifies it before returning signed action metadata', async () => {
  const expired = robotEnvelope({ issuedAt: nowSeconds - 50, signature: 'expired-signature' });
  const refreshedAction = {
    id: 'fresh-call',
    name: 'navigate_robo_cane',
    parameters: { latitude: 1.3521, longitude: 103.8198 },
    responseRequired: true
  };
  const refreshed = robotEnvelope({ action: refreshedAction, signature: 'fresh-signature' });
  const paths = [];
  const fetchImpl = async (url) => {
    paths.push(url);
    if (url.endsWith('/verify') && paths.length === 1) {
      return jsonResponse(401, { valid: false, action: { name: 'find_robot' } });
    }
    if (url.endsWith('/refresh')) return jsonResponse(200, refreshed);
    return jsonResponse(200, {
      valid: true,
      action: { id: 'replacement', name: 'robot_stop', parameters: {} }
    });
  };

  const result = await verifyRobotActionEnvelopeWithRefresh(expired, {
    accessToken,
    apiBaseUrl: 'https://api.example.test',
    fetchImpl,
    now,
    loggerImpl: { warn() {} }
  });
  assert.deepEqual(paths, [
    'https://api.example.test/v1/robotics/actions/verify',
    'https://api.example.test/v1/robotics/actions/refresh',
    'https://api.example.test/v1/robotics/actions/verify'
  ]);
  assert.deepEqual(result.action, refreshedAction);
  assert.equal(result.expiresAt, (nowSeconds + 60) * 1000);
  assert.equal(result.refreshed, true);
});

test('mobile never performs more than one refresh request for a rejected token', async () => {
  let refreshRequests = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/refresh')) refreshRequests += 1;
    return jsonResponse(401, { valid: false });
  };
  const result = await verifyRobotActionEnvelopeWithRefresh(robotEnvelope(), {
    accessToken,
    apiBaseUrl: 'https://api.example.test',
    fetchImpl,
    now,
    loggerImpl: { warn() {} }
  });
  assert.equal(result, null);
  assert.equal(refreshRequests, 1);
});

test('gateway verification request is abortable and bounded by a timeout', async () => {
  let observedSignal;
  const fetchImpl = async (_url, options) => {
    observedSignal = options.signal;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };
  const warnings = [];
  const result = await verifyRobotActionWithGateway(robotEnvelope().token, {
    accessToken,
    apiBaseUrl: 'https://api.example.test',
    fetchImpl,
    timeoutMs: 5,
    loggerImpl: { warn: (...args) => warnings.push(args) }
  });
  assert.equal(observedSignal.aborted, true);
  assert.equal(result.valid, false);
  assert.deepEqual(warnings, [[
    '[RoboticsAuth] gateway request failed',
    { reason: 'request_timeout' }
  ]]);
});
