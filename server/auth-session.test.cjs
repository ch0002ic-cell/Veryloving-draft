'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const {
  APPLE_JWKS_URL,
  GOOGLE_JWKS_URL,
  signRefreshJWT,
  signSessionJWT,
  verifyProviderIdentityToken,
  verifyRefreshJWT,
  verifySessionJWT
} = require('./auth-session.cjs');

function signedIdentityToken(privateKey, { kid, payload }) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const input = `${header}.${body}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
  return `${input}.${signature}`;
}

test('provider verification checks signature, issuer, audience, expiry, and nonce', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'google-test-key';
  const now = 1_700_000_000_000;
  const token = signedIdentityToken(privateKey, {
    kid,
    payload: {
      iss: 'https://accounts.google.com',
      aud: 'google-client.apps.googleusercontent.com',
      azp: 'ios-client.apps.googleusercontent.com',
      sub: 'verified-google-subject',
      email: 'person@example.test',
      name: 'Verified Person',
      nonce: 'nonce-1',
      iat: Math.floor(now / 1000) - 10,
      exp: Math.floor(now / 1000) + 300
    }
  });
  const fetchImpl = async (url) => {
    assert.equal(url, GOOGLE_JWKS_URL);
    return {
      ok: true,
      json: async () => ({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }] })
    };
  };
  const claims = await verifyProviderIdentityToken({
    provider: 'google',
    idToken: token,
    nonce: 'nonce-1'
  }, {
    googleTokenAudiences: 'google-client.apps.googleusercontent.com',
    googleAuthorizedParties: 'ios-client.apps.googleusercontent.com',
    fetchImpl,
    now: () => now
  });
  assert.equal(claims.sub, 'verified-google-subject');

  await assert.rejects(verifyProviderIdentityToken({
    provider: 'google',
    idToken: token,
    nonce: 'wrong-nonce'
  }, {
    googleTokenAudiences: 'google-client.apps.googleusercontent.com',
    googleAuthorizedParties: 'ios-client.apps.googleusercontent.com',
    fetchImpl,
    now: () => now
  }), /nonce/);

  await assert.rejects(verifyProviderIdentityToken({
    provider: 'google',
    idToken: token,
    nonce: 'nonce-1'
  }, {
    googleTokenAudiences: 'google-client.apps.googleusercontent.com',
    googleAuthorizedParties: 'different-native-client.apps.googleusercontent.com',
    fetchImpl,
    now: () => now
  }), /authorized party/);

  const notActive = signedIdentityToken(privateKey, {
    kid,
    payload: {
      ...JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')),
      nbf: Math.floor(now / 1000) + 301
    }
  });
  await assert.rejects(verifyProviderIdentityToken({
    provider: 'google',
    idToken: notActive,
    nonce: 'nonce-1'
  }, {
    googleTokenAudiences: 'google-client.apps.googleusercontent.com',
    googleAuthorizedParties: 'ios-client.apps.googleusercontent.com',
    fetchImpl,
    now: () => now
  }), /not active/);
});

test('provider key discovery has a hard deadline when fetch ignores AbortSignal', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = 2_500_000_000_000;
  const token = signedIdentityToken(privateKey, {
    kid: 'google-hung-provider-key',
    payload: {
      iss: 'https://accounts.google.com',
      aud: 'google-client.apps.googleusercontent.com',
      sub: 'verified-google-subject',
      iat: Math.floor(now / 1000) - 10,
      exp: Math.floor(now / 1000) + 300
    }
  });
  await assert.rejects(verifyProviderIdentityToken({
    provider: 'google',
    idToken: token
  }, {
    googleTokenAudiences: 'google-client.apps.googleusercontent.com',
    fetchImpl: async () => new Promise(() => {}),
    jwksTimeoutMs: 5,
    now: () => now
  }), /keys are unavailable/);
});

test('provider key discovery rejects and cancels an oversized response', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = 2_600_000_000_000;
  const token = signedIdentityToken(privateKey, {
    kid: 'google-oversized-provider-key',
    payload: {
      iss: 'https://accounts.google.com',
      aud: 'google-client.apps.googleusercontent.com',
      sub: 'verified-google-subject',
      iat: Math.floor(now / 1000) - 10,
      exp: Math.floor(now / 1000) + 300
    }
  });
  let cancelled = 0;
  await assert.rejects(verifyProviderIdentityToken({ provider: 'google', idToken: token }, {
    googleTokenAudiences: 'google-client.apps.googleusercontent.com',
    now: () => now,
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => String(300 * 1024) },
      body: { async cancel() { cancelled += 1; } },
      async json() { throw new Error('oversized body must not be parsed'); }
    })
  }), /too large/);
  assert.equal(cancelled, 1);
});

test('provider key discovery releases a response that arrives after its hard deadline', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = 2_700_000_000_000;
  const token = signedIdentityToken(privateKey, {
    kid: 'google-late-provider-key',
    payload: {
      iss: 'https://accounts.google.com',
      aud: 'google-client.apps.googleusercontent.com',
      sub: 'verified-google-subject',
      iat: Math.floor(now / 1000) - 10,
      exp: Math.floor(now / 1000) + 300
    }
  });
  let resolveFetch;
  let cancelled = 0;
  const verification = verifyProviderIdentityToken({ provider: 'google', idToken: token }, {
    googleTokenAudiences: 'google-client.apps.googleusercontent.com',
    now: () => now,
    jwksTimeoutMs: 5,
    fetchImpl: async () => new Promise((resolve) => { resolveFetch = resolve; })
  });
  await assert.rejects(verification, /keys are unavailable/);
  resolveFetch({
    ok: true,
    body: { async cancel() { cancelled += 1; } }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 1);
});

test('Apple exchange verification requires a nonce and refreshes JWKS after key rotation', async () => {
  const first = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const second = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = 1_800_000_000_000;
  const payload = {
    iss: 'https://appleid.apple.com',
    aud: 'com.veryloving.test',
    sub: 'apple-subject',
    nonce: 'secure-nonce-value',
    iat: Math.floor(now / 1000) - 5,
    exp: Math.floor(now / 1000) + 300
  };
  const tokens = [
    signedIdentityToken(first.privateKey, { kid: 'apple-key-1', payload }),
    signedIdentityToken(second.privateKey, { kid: 'apple-key-2', payload })
  ];
  let publishedKey = 0;
  let fetches = 0;
  const fetchImpl = async (url) => {
    assert.equal(url, APPLE_JWKS_URL);
    fetches += 1;
    const key = publishedKey === 0 ? first.publicKey : second.publicKey;
    return {
      ok: true,
      json: async () => ({ keys: [{
        ...key.export({ format: 'jwk' }),
        kid: publishedKey === 0 ? 'apple-key-1' : 'apple-key-2',
        kty: 'RSA'
      }] })
    };
  };
  await verifyProviderIdentityToken({
    provider: 'apple',
    idToken: tokens[0],
    nonce: payload.nonce
  }, {
    appleClientIds: payload.aud,
    fetchImpl,
    now: () => now
  });
  publishedKey = 1;
  const rotated = await verifyProviderIdentityToken({
    provider: 'apple',
    idToken: tokens[1],
    nonce: payload.nonce
  }, {
    appleClientIds: payload.aud,
    fetchImpl,
    now: () => now + 61_000
  });
  assert.equal(rotated.sub, payload.sub);
  assert.equal(fetches, 2);
});

test('first-party sessions are signed, scoped, expiring, and tamper evident', () => {
  const config = {
    sessionJWTSecret: 'test-secret-that-is-at-least-32-characters-long',
    sessionJWTIssuer: 'https://api.example.test',
    sessionJWTAudience: 'veryloving-test',
    sessionJWTTTLSeconds: 600
  };
  const now = 1_700_000_000_000;
  const issued = signSessionJWT({ provider: 'apple', subject: 'apple-subject' }, config, {
    now: () => now,
    randomUUID: () => 'fixed-session-id'
  });
  const claims = verifySessionJWT(issued.token, config, { now: () => now + 1000 });
  assert.equal(claims.sub, 'apple:apple-subject');
  assert.match(claims.scope, /voice:connect/);
  assert.equal(verifySessionJWT(`${issued.token.slice(0, -1)}x`, config, { now: () => now }), null);
  assert.equal(verifySessionJWT(issued.token, config, { now: () => now + 601_000 }), null);
});

test('session TTL is bounded to one day under unsafe deployment input', () => {
  const now = 1_700_000_000_000;
  const issued = signSessionJWT({ provider: 'google', subject: 'subject' }, {
    sessionJWTSecret: 'test-secret-that-is-at-least-32-characters-long',
    sessionJWTTTLSeconds: Number.POSITIVE_INFINITY
  }, { now: () => now, randomUUID: () => 'fixed' });
  assert.equal(issued.payload.exp - issued.payload.iat, 3600);

  const long = signSessionJWT({ provider: 'google', subject: 'subject' }, {
    sessionJWTSecret: 'test-secret-that-is-at-least-32-characters-long',
    sessionJWTTTLSeconds: 999999
  }, { now: () => now, randomUUID: () => 'fixed' });
  assert.equal(long.payload.exp - long.payload.iat, 86400);
});

test('refresh sessions use a distinct audience, scope, and bounded lifetime', () => {
  const config = {
    sessionJWTSecret: 'test-secret-that-is-at-least-32-characters-long',
    sessionJWTIssuer: 'https://api.example.test',
    sessionJWTAudience: 'veryloving-test',
    sessionJWTRefreshTTLSeconds: 999999999
  };
  const now = 1_700_000_000_000;
  const refresh = signRefreshJWT({
    subject: 'google:verified-subject',
    sessionId: 'session-id'
  }, config, { now: () => now, randomUUID: () => 'refresh-jti' });
  const claims = verifyRefreshJWT(refresh.token, config, { now: () => now + 1000 });
  assert.equal(claims.sub, 'google:verified-subject');
  assert.equal(claims.sid, 'session-id');
  assert.equal(claims.scope, 'session:refresh');
  assert.equal(claims.exp - claims.iat, 90 * 86400);
  assert.equal(verifySessionJWT(refresh.token, config, { now: () => now }), null);
  assert.equal(verifyRefreshJWT(`${refresh.token.slice(0, -1)}x`, config, { now: () => now }), null);
});

test('account subjects are bounded before they can become durable partition keys', () => {
  const config = {
    sessionJWTSecret: 'test-secret-that-is-at-least-32-characters-long'
  };
  assert.throws(() => signSessionJWT({
    subjectClaim: `user:${'x'.repeat(300)}`
  }, config), /subject is invalid/);
  assert.throws(() => signSessionJWT({
    subjectClaim: 'user/unsafe-partition'
  }, config), /subject is invalid/);
  assert.throws(() => signRefreshJWT({
    subject: 'user\npartition',
    sessionId: 'session-id'
  }, config), /identity is invalid/);
});
