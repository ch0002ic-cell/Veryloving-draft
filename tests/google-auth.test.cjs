'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  googleIdentityFromResponse,
  googleSignInCancellationError,
  isGoogleSignInCancellation
} = require('../src/utils/google-auth');

test('Google Sign-In v15 success responses produce a stable local identity', () => {
  const identity = googleIdentityFromResponse({
    type: 'success',
    data: {
      idToken: 'identity-token',
      user: { id: 'google-123', name: 'Grace', email: 'grace@example.com' }
    }
  });

  assert.deepEqual(identity, {
    identityToken: 'identity-token',
    user: {
      id: 'google-123',
      name: 'Grace',
      email: 'grace@example.com',
      provider: 'google'
    }
  });
});

test('Google Sign-In cancellation never creates a development account', () => {
  assert.equal(googleIdentityFromResponse({ type: 'cancelled', data: null }), null);
  assert.equal(isGoogleSignInCancellation(googleSignInCancellationError()), true);
});

test('malformed Google Sign-In responses fail closed', () => {
  assert.throws(() => googleIdentityFromResponse({ type: 'success', data: null }), /invalid account response/);
});
