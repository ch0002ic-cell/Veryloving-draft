'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

const originalLoad = Module._load;
Module._load = function loadAuthClientDependency(request, parent, isMain) {
  if (parent?.filename.endsWith('/src/services/auth-session.js') && request === '../utils/config') {
    return { config: { apiBaseUrl: 'https://api.example.test' } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const {
  confirmPhoneVerification,
  refreshApplicationSession,
  revokeApplicationSession,
  requestPhoneVerification
} = require('../src/services/auth-session');
Module._load = originalLoad;

function testJWT(subject, expiresAt, sid = 'session-a') {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: subject, sid, exp: Math.floor(expiresAt / 1000) })}.signature`;
}

function testSession({ subject = 'google:user', ...overrides } = {}) {
  const expiresAt = Date.now() + 60_000;
  const refreshExpiresAt = Date.now() + 86_400_000;
  return {
    accessToken: testJWT(subject, expiresAt),
    expiresAt: Math.floor(expiresAt / 1000) * 1000,
    refreshToken: testJWT(subject, refreshExpiresAt),
    refreshExpiresAt: Math.floor(refreshExpiresAt / 1000) * 1000,
    ...overrides
  };
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  const text = JSON.stringify(payload);
  return {
    ok,
    status,
    headers: { get: (name) => name === 'content-length' ? String(Buffer.byteLength(text)) : null },
    text: async () => text
  };
}

test('mobile auth refresh rotates both secure session tokens', async () => {
  let request;
  const result = await refreshApplicationSession('old-refresh-token', {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse(testSession());
    }
  });
  assert.equal(request.url, 'https://api.example.test/v1/auth/refresh');
  assert.equal(request.options.redirect, 'error');
  assert.deepEqual(JSON.parse(request.options.body), { refreshToken: 'old-refresh-token' });
  assert.equal(result.accessToken.split('.').length, 3);
  assert.equal(result.refreshToken.split('.').length, 3);
});

test('mobile logout sends only the access token in an authenticated revocation request', async () => {
  let request;
  let cancelled = 0;
  const revoked = await revokeApplicationSession('signed-access-token', {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 204, body: { async cancel() { cancelled += 1; } } };
    }
  });
  assert.equal(revoked, true);
  assert.equal(request.url, 'https://api.example.test/v1/auth/logout');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer signed-access-token');
  assert.equal(request.options.body, undefined);
  assert.equal(request.options.redirect, 'error');
  assert.equal(cancelled, 1);
});

test('mobile auth deadline survives fetch implementations that ignore AbortSignal', async () => {
  const startedAt = Date.now();
  await assert.rejects(refreshApplicationSession('old-refresh-token', {
    timeoutMs: 5,
    fetchImpl: async () => new Promise(() => {})
  }), (error) => error.code === 'AUTH_TIMEOUT');
  assert.ok(Date.now() - startedAt < 500);
});

test('mobile auth rejects an oversized response before reading its body', async () => {
  let bodyReads = 0;
  let cancelled = 0;
  await assert.rejects(refreshApplicationSession('old-refresh-token', {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => String(300 * 1024) },
      body: { async cancel() { cancelled += 1; } },
      async text() { bodyReads += 1; return '{}'; }
    })
  }), (error) => error.code === 'HTTP_RESPONSE_TOO_LARGE');
  assert.equal(bodyReads, 0);
  assert.equal(cancelled, 1);
});

test('mobile auth rejects an unbounded non-streaming response before allocation', async () => {
  let bodyReads = 0;
  await assert.rejects(refreshApplicationSession('old-refresh-token', {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      async text() { bodyReads += 1; return JSON.stringify(testSession()); }
    })
  }), (error) => error.code === 'HTTP_RESPONSE_INVALID');
  assert.equal(bodyReads, 0);
});

test('mobile phone auth starts and confirms a backend verification without URL PII', async () => {
  const requests = [];
  const challenge = await requestPhoneVerification({
    phone: '+14155552671',
    countryCode: 'US'
  }, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({
          verificationId: 'signed-opaque-challenge',
          phone: '+14155552671',
          countryCode: 'US',
          expiresAt: Date.now() + 300_000
      });
    }
  });
  assert.equal(challenge.verificationId, 'signed-opaque-challenge');
  assert.equal(requests[0].url, 'https://api.example.test/v1/auth/phone/start');
  assert.equal(requests[0].url.includes('+14155552671'), false);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    phone: '+14155552671',
    countryCode: 'US'
  });

  const session = testSession({
    subject: 'phone:opaque-user',
    user: { id: 'phone:opaque-user', name: null, email: null, provider: 'phone' }
  });
  const confirmed = await confirmPhoneVerification({
    verificationId: challenge.verificationId,
    code: '804219'
  }, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse(session);
    }
  });
  assert.equal(requests[1].url, 'https://api.example.test/v1/auth/phone/verify');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    verificationId: 'signed-opaque-challenge',
    code: '804219'
  });
  assert.equal(confirmed.user.provider, 'phone');
});

test('mobile phone auth rejects invalid input before making a request', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests += 1; };
  await assert.rejects(
    requestPhoneVerification({ phone: '4155552671', countryCode: 'US' }, { fetchImpl }),
    (error) => error.code === 'PHONE_NUMBER_INVALID'
  );
  await assert.rejects(
    confirmPhoneVerification({ verificationId: 'challenge', code: '1234' }, { fetchImpl }),
    (error) => error.code === 'PHONE_AUTH_CODE_INVALID'
  );
  assert.equal(requests, 0);
});

test('mobile phone auth preserves safe backend error codes for UI mapping', async () => {
  await assert.rejects(requestPhoneVerification({
    phone: '+14155552671',
    countryCode: 'US'
  }, {
    fetchImpl: async () => jsonResponse({
        error: 'Phone verification is not configured',
        code: 'PHONE_AUTH_NOT_CONFIGURED'
    }, { ok: false, status: 503 })
  }), (error) => (
    error.code === 'AUTH_HTTP_503'
    && error.serverCode === 'PHONE_AUTH_NOT_CONFIGURED'
    && error.operation === 'phone-start'
  ));
});

test('mobile rejects malformed or expired session payloads', async () => {
  await assert.rejects(refreshApplicationSession('old-refresh-token', {
    fetchImpl: async () => jsonResponse({
        accessToken: 'not-a-jwt',
        refreshToken: 'not-a-jwt',
        expiresAt: Date.now() + 60_000,
        refreshExpiresAt: Date.now() + 86_400_000
    })
  }), (error) => error.code === 'AUTH_RESPONSE_INVALID');
});

test('mobile rejects mixed-account token pairs and unsafe backend URLs', async () => {
  const expiresAt = Math.floor((Date.now() + 60_000) / 1000) * 1000;
  const refreshExpiresAt = Math.floor((Date.now() + 86_400_000) / 1000) * 1000;
  await assert.rejects(refreshApplicationSession('old-refresh-token', {
    fetchImpl: async () => jsonResponse({
        accessToken: testJWT('google:user-a', expiresAt, 'session-a'),
        expiresAt,
        refreshToken: testJWT('google:user-b', refreshExpiresAt, 'session-b'),
        refreshExpiresAt
    })
  }), (error) => error.code === 'AUTH_RESPONSE_INVALID');

  await assert.rejects(refreshApplicationSession('old-refresh-token', {
    apiBaseUrl: 'https://api.example.test?token=unsafe',
    fetchImpl: async () => { throw new Error('must not fetch'); }
  }), (error) => error.code === 'AUTH_CONFIGURATION_INVALID');
});

test('mobile auth refresh exposes rejection status without leaking a token', async () => {
  await assert.rejects(refreshApplicationSession('sensitive-refresh-token', {
    fetchImpl: async () => jsonResponse(
      { error: 'Refresh session is invalid or expired' },
      { ok: false, status: 401 }
    )
  }), (error) => error.code === 'AUTH_HTTP_401' && !error.message.includes('sensitive-refresh-token'));
});
