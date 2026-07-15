'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  PHONE_VERIFICATION_STATE_VERSION,
  createPhoneVerificationState,
  parsePhoneVerificationState,
  restorePhoneVerificationState
} = require('../src/utils/phone-verification-state');

const NOW = 1_900_000_000_000;

function challenge(overrides = {}) {
  return {
    verificationId: 'signed-opaque-challenge',
    phone: '+14155552671',
    countryCode: 'US',
    expiresAt: NOW + 300_000,
    ...overrides
  };
}

test('new phone challenges record when they were issued locally', () => {
  assert.deepEqual(createPhoneVerificationState(challenge(), { now: () => NOW }), {
    version: PHONE_VERIFICATION_STATE_VERSION,
    verificationId: 'signed-opaque-challenge',
    phone: '+14155552671',
    countryCode: 'US',
    createdAt: NOW,
    expiresAt: NOW + 300_000
  });
});
test('a post-logout phone challenge survives cold-start session cleanup', () => {
  const state = createPhoneVerificationState(challenge(), { now: () => NOW });
  const restored = restorePhoneVerificationState(JSON.stringify(state), {
    signedOutMarker: JSON.stringify({ version: 1, signedOutAt: NOW - 1_000 }),
    now: () => NOW + 1_000
  });

  assert.deepEqual(restored, state);
});

test('pre-logout, legacy, malformed, and expired challenges remain fail-closed', () => {
  const preLogoutState = createPhoneVerificationState(challenge({ createdAt: NOW - 2_000 }), {
    now: () => NOW
  });
  const marker = { version: 1, signedOutAt: NOW - 1_000 };
  assert.equal(restorePhoneVerificationState(preLogoutState, {
    signedOutMarker: marker,
    now: () => NOW
  }), null);

  const legacyState = {
    version: PHONE_VERIFICATION_STATE_VERSION,
    verificationId: 'legacy-challenge',
    phone: '+14155552671',
    countryCode: 'US',
    expiresAt: NOW + 60_000
  };
  assert.deepEqual(parsePhoneVerificationState(legacyState, { now: () => NOW }), legacyState);
  assert.equal(restorePhoneVerificationState(legacyState, {
    signedOutMarker: marker,
    now: () => NOW
  }), null);
  assert.equal(restorePhoneVerificationState(preLogoutState, {
    signedOutMarker: 'not-json',
    now: () => NOW
  }), null);
  assert.equal(restorePhoneVerificationState(challenge({
    createdAt: NOW - 600_001,
    expiresAt: NOW + 1
  }), { now: () => NOW }), null);
});
