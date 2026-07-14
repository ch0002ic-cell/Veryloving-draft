'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { URLSearchParams } = require('node:url');
const {
  PHONE_AUTH_CODES,
  TWILIO_VERIFY_BASE_URL,
  phoneSubject,
  signPhoneChallenge,
  startPhoneVerification,
  verifyPhoneChallenge,
  verifyPhoneVerification
} = require('./phone-auth.cjs');

const NOW = 1_900_000_000_000;

function phoneConfig(overrides = {}) {
  return {
    phoneAuthEnabled: true,
    phoneAuthChallengeSecret: 'test-phone-challenge-secret-at-least-32-characters',
    phoneAuthSubjectSecret: 'test-phone-subject-secret-at-least-32-characters',
    phoneAuthChallengeTTLSeconds: 300,
    sessionJWTSecret: 'test-session-secret-at-least-32-characters',
    twilioAccountSid: `AC${'a'.repeat(32)}`,
    twilioAuthToken: 'test-twilio-auth-token-value',
    twilioVerifyServiceSid: `VA${'b'.repeat(32)}`,
    now: () => NOW,
    randomUUID: () => 'fixed-phone-challenge-id',
    fetchImpl: async () => ({
      ok: true,
      status: 201,
      json: async () => ({ status: 'pending' })
    }),
    ...overrides
  };
}

test('phone verification starts through Twilio Verify and returns a signed short-lived challenge', async () => {
  let request;
  const config = phoneConfig({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 201, json: async () => ({ status: 'pending' }) };
    }
  });
  const result = await startPhoneVerification({ phone: '+6591234567', countryCode: 'sg' }, config);
  assert.equal(
    request.url,
    `${TWILIO_VERIFY_BASE_URL}/Services/${config.twilioVerifyServiceSid}/Verifications`
  );
  assert.equal(request.options.method, 'POST');
  assert.equal(
    request.options.headers.Authorization,
    `Basic ${Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64')}`
  );
  assert.deepEqual(
    Object.fromEntries(new URLSearchParams(request.options.body)),
    { To: '+6591234567', Channel: 'sms' }
  );
  assert.equal(result.phone, '+6591234567');
  assert.equal(result.countryCode, 'SG');
  assert.equal(result.expiresAt, NOW + 300_000);
  assert.equal(verifyPhoneChallenge(result.verificationId, config).phone, '+6591234567');
});

test('phone verification checks the code and rejects tampered or expired challenges', async () => {
  let request;
  const config = phoneConfig({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ status: 'approved' }) };
    }
  });
  const challenge = signPhoneChallenge({ phone: '+14155550123', countryCode: 'US' }, config);
  const verified = await verifyPhoneVerification({
    verificationId: challenge.verificationId,
    code: '123456'
  }, config);
  assert.equal(verified.phone, '+14155550123');
  assert.match(request.url, /\/VerificationCheck$/);
  assert.deepEqual(
    Object.fromEntries(new URLSearchParams(request.options.body)),
    { To: '+14155550123', Code: '123456' }
  );

  const segments = challenge.verificationId.split('.');
  segments[2] = `${segments[2][0] === 'A' ? 'B' : 'A'}${segments[2].slice(1)}`;
  await assert.rejects(
    verifyPhoneVerification({ verificationId: segments.join('.'), code: '123456' }, config),
    (error) => error.code === PHONE_AUTH_CODES.INVALID && error.statusCode === 400
  );
  await assert.rejects(
    verifyPhoneVerification(
      { verificationId: challenge.verificationId, code: '123456' },
      phoneConfig({ now: () => NOW + 301_000 })
    ),
    (error) => error.code === PHONE_AUTH_CODES.INVALID && error.statusCode === 401
  );
});

test('phone verification maps provider failures to stable safe errors', async () => {
  await assert.rejects(
    startPhoneVerification({ phone: '+6591234567', countryCode: 'SG' }, phoneConfig({
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ message: 'provider detail must not be exposed' })
      })
    })),
    (error) => error.code === PHONE_AUTH_CODES.RATE_LIMITED
      && error.statusCode === 429
      && !error.message.includes('provider detail')
  );
  await assert.rejects(
    startPhoneVerification({ phone: '+6591234567', countryCode: 'SG' }, phoneConfig({
      fetchImpl: async () => { throw new Error('private network detail'); }
    })),
    (error) => error.code === PHONE_AUTH_CODES.PROVIDER_UNAVAILABLE
      && error.statusCode === 502
      && !error.message.includes('private network detail')
  );

  const config = phoneConfig();
  const challenge = signPhoneChallenge({ phone: '+6591234567', countryCode: 'SG' }, config);
  await assert.rejects(
    verifyPhoneVerification({ verificationId: challenge.verificationId, code: '000000' }, {
      ...config,
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Twilio-specific invalid code detail' })
      })
    }),
    (error) => error.code === PHONE_AUTH_CODES.INVALID
      && error.statusCode === 401
      && !error.message.includes('Twilio')
  );
});

test('phone session subjects are stable, opaque, and keyed', () => {
  const phone = '+6591234567';
  const first = phoneSubject(phone, 'first-phone-subject-secret-at-least-32-characters');
  const repeated = phoneSubject(phone, 'first-phone-subject-secret-at-least-32-characters');
  const second = phoneSubject(phone, 'second-phone-subject-secret-at-least-32-characters');
  assert.equal(first, repeated);
  assert.notEqual(first, second);
  assert.equal(first.includes(phone), false);
});
