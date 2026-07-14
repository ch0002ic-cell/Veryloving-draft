'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  SESSION_ENVELOPE_FAILURE,
  SESSION_ENVELOPE_VERSION,
  createSessionEnvelope,
  inspectSessionEnvelope,
  migrateLegacySession,
  parseSessionEnvelope,
  serializeSessionEnvelope
} = require('../src/utils/session-envelope');

const NOW = 1_900_000_000_000;
const NOW_SECONDS = Math.floor(NOW / 1000);

function token({ sub, sid = 'session-1', exp, type = 'access', ...claims }) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = {
    alg: 'HS256',
    typ: type === 'refresh' ? 'refresh+jwt' : 'JWT'
  };
  const tokenClaims = type === 'refresh'
    ? { sub, sid, exp, scope: 'session:refresh', ...claims }
    : { sub, sid, exp, ...claims };
  return `${encode(header)}.${encode(tokenClaims)}.${'s'.repeat(43)}`;
}

function session(provider = 'google', overrides = {}) {
  const sub = `${provider}:account-1`;
  return {
    accessToken: token({ sub, exp: NOW_SECONDS + 600 }),
    refreshToken: token({ sub, exp: NOW_SECONDS + 86_400, type: 'refresh', scope: 'session:refresh' }),
    user: { id: sub, provider, name: 'Grace' },
    ...overrides
  };
}

const options = { now: () => NOW, skewSeconds: 30 };

test('session envelopes bind Apple, Google, and phone profiles to one versioned token pair', () => {
  for (const provider of ['apple', 'google', 'phone']) {
    const envelope = createSessionEnvelope(session(provider), options);
    assert.equal(envelope.version, SESSION_ENVELOPE_VERSION);
    assert.equal(envelope.user.id, `${provider}:account-1`);
    assert.equal(envelope.expiresAt, (NOW_SECONDS + 600) * 1000);
    assert.equal(envelope.refreshExpiresAt, (NOW_SECONDS + 86_400) * 1000);

    const serialized = serializeSessionEnvelope(session(provider), options);
    assert.deepEqual(parseSessionEnvelope(serialized, options), envelope);
    assert.equal(inspectSessionEnvelope(serialized, options).ok, true);
  }
});

test('session envelopes reject malformed and unsupported persisted data without throwing', () => {
  assert.equal(parseSessionEnvelope(null, options), null);
  assert.equal(parseSessionEnvelope('not-json', options), null);
  assert.equal(parseSessionEnvelope('{"version":999}', options), null);
  assert.deepEqual(inspectSessionEnvelope('not-json', options), {
    ok: false,
    reason: SESSION_ENVELOPE_FAILURE.MALFORMED
  });
  assert.deepEqual(inspectSessionEnvelope({ version: 999 }, options), {
    ok: false,
    reason: SESSION_ENVELOPE_FAILURE.UNSUPPORTED_VERSION
  });
  assert.equal(createSessionEnvelope(session('google', { accessToken: 'not-a-jwt' }), options), null);
  assert.equal(createSessionEnvelope(session('google', { refreshToken: 'not-a-jwt' }), options), null);
});

test('session envelopes reject expired access or refresh claims', () => {
  const sub = 'google:account-1';
  const expiredAccess = createSessionEnvelope(session('google', {
    accessToken: token({ sub, exp: NOW_SECONDS - 1 })
  }), options);
  const expiredRefresh = createSessionEnvelope(session('google', {
    refreshToken: token({ sub, exp: NOW_SECONDS - 1, type: 'refresh' })
  }), options);
  assert.equal(expiredAccess, null);
  assert.equal(expiredRefresh, null);

  const valid = createSessionEnvelope(session('google'), options);
  assert.equal(inspectSessionEnvelope({
    ...valid,
    accessToken: token({ sub, exp: NOW_SECONDS - 1 })
  }, options).reason, SESSION_ENVELOPE_FAILURE.ACCESS_TOKEN_EXPIRED);
  assert.equal(inspectSessionEnvelope({
    ...valid,
    refreshToken: token({ sub, exp: NOW_SECONDS - 1, type: 'refresh' })
  }, options).reason, SESSION_ENVELOPE_FAILURE.REFRESH_TOKEN_EXPIRED);
});

test('refresh restoration may explicitly retain an expired access token without weakening refresh checks', () => {
  const sub = 'google:account-1';
  const expiredAccessSession = session('google', {
    accessToken: token({ sub, exp: NOW_SECONDS - 1 })
  });
  const recoveryOptions = { ...options, allowExpiredAccess: true };
  assert.equal(createSessionEnvelope(expiredAccessSession, options), null);

  const envelope = createSessionEnvelope(expiredAccessSession, recoveryOptions);
  assert.equal(envelope.expiresAt, (NOW_SECONDS - 1) * 1000);
  assert.equal(parseSessionEnvelope(JSON.stringify(envelope), options), null);
  assert.deepEqual(parseSessionEnvelope(JSON.stringify(envelope), recoveryOptions), envelope);
  assert.deepEqual(migrateLegacySession({
    ...expiredAccessSession,
    user: JSON.stringify(expiredAccessSession.user)
  }, recoveryOptions), envelope);

  const expiredRefreshSession = {
    ...expiredAccessSession,
    refreshToken: token({ sub, exp: NOW_SECONDS - 1, type: 'refresh' })
  };
  assert.equal(createSessionEnvelope(expiredRefreshSession, recoveryOptions), null);
});

test('session envelopes reject mixed accounts, sessions, and profile identities', () => {
  const base = session('apple');
  assert.equal(createSessionEnvelope({
    ...base,
    refreshToken: token({
      sub: 'google:different-account',
      exp: NOW_SECONDS + 86_400,
      type: 'refresh'
    })
  }, options), null);
  assert.equal(createSessionEnvelope({
    ...base,
    refreshToken: token({
      sub: base.user.id,
      sid: 'different-session',
      exp: NOW_SECONDS + 86_400,
      type: 'refresh'
    })
  }, options), null);
  assert.equal(createSessionEnvelope({
    ...base,
    user: { ...base.user, id: 'apple:different-account' }
  }, options), null);

  const valid = createSessionEnvelope(base, options);
  const mixed = inspectSessionEnvelope({
    ...valid,
    refreshToken: token({
      sub: 'google:different-account',
      exp: NOW_SECONDS + 86_400,
      type: 'refresh'
    })
  }, options);
  assert.deepEqual(mixed, { ok: false, reason: SESSION_ENVELOPE_FAILURE.MIXED_ACCOUNT });
});

test('persisted expiry metadata must exactly match the JWT claims', () => {
  const envelope = createSessionEnvelope(session('phone'), options);
  const result = inspectSessionEnvelope({ ...envelope, expiresAt: envelope.expiresAt + 1000 }, options);
  assert.deepEqual(result, { ok: false, reason: SESSION_ENVELOPE_FAILURE.EXPIRY_MISMATCH });
});

test('legacy split-key sessions migrate only when the complete account binding is valid', () => {
  const legacy = session('phone');
  const migrated = migrateLegacySession({
    accessToken: legacy.accessToken,
    refreshToken: legacy.refreshToken,
    user: JSON.stringify(legacy.user)
  }, options);
  assert.equal(migrated.version, SESSION_ENVELOPE_VERSION);
  assert.equal(migrated.user.id, 'phone:account-1');
  assert.equal(migrateLegacySession({ ...legacy, user: 'invalid-json' }, options), null);
  assert.equal(migrateLegacySession({
    ...legacy,
    user: JSON.stringify({ ...legacy.user, id: 'phone:other-account' })
  }, options), null);
});

test('typed validation failures expose only stable reasons, never token material', () => {
  const sensitiveToken = token({
    sub: 'google:sensitive-account',
    exp: NOW_SECONDS - 1
  });
  const result = inspectSessionEnvelope({
    version: SESSION_ENVELOPE_VERSION,
    accessToken: sensitiveToken,
    refreshToken: 'also-sensitive',
    user: { id: 'google:sensitive-account', provider: 'google' },
    expiresAt: 0,
    refreshExpiresAt: 0
  }, options);
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(sensitiveToken), false);
  assert.equal(Object.keys(result).sort().join(','), 'ok,reason');
});
