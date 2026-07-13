'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');
const {
  createAuthenticationNonce,
  isSessionTokenUsable,
  sessionTokenClaims
} = require('../src/utils/session-token');

function unsignedToken(payload) {
  return `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

test('mobile session restoration rejects malformed and expired tokens', () => {
  const currentSeconds = 10_000;
  const valid = unsignedToken({ sub: 'google:user-1', exp: currentSeconds + 120 });
  const expired = unsignedToken({ sub: 'google:user-1', exp: currentSeconds - 1 });
  assert.equal(sessionTokenClaims(valid).sub, 'google:user-1');
  assert.equal(isSessionTokenUsable(valid, { now: () => currentSeconds * 1000 }), true);
  assert.equal(isSessionTokenUsable(expired, { now: () => currentSeconds * 1000 }), false);
  assert.equal(isSessionTokenUsable('not-a-jwt'), false);
});

test('mobile JWT decoding does not depend on browser atob and preserves UTF-8 claims', () => {
  const originalAtob = globalThis.atob;
  try {
    globalThis.atob = undefined;
    const token = unsignedToken({ sub: 'apple:用户', name: 'Grace 🌟', exp: 20_000 });
    assert.deepEqual(sessionTokenClaims(token), { sub: 'apple:用户', name: 'Grace 🌟', exp: 20_000 });
  } finally {
    globalThis.atob = originalAtob;
  }
});

test('Apple sign-in nonce requires a cryptographic random source', () => {
  const nonce = createAuthenticationNonce({
    getRandomValues(bytes) {
      bytes.forEach((_value, index) => { bytes[index] = index; });
      return bytes;
    }
  });
  assert.equal(nonce.length, 64);
  assert.match(nonce, /^00010203/);
  assert.throws(() => createAuthenticationNonce({}), /Secure random/);
});

test('default nonce generation uses Expo native crypto instead of a browser global', () => {
  const originalLoad = Module._load;
  let nativeCalls = 0;
  Module._load = function loadCrypto(request, parent, isMain) {
    if (request === 'expo-crypto') {
      return {
        getRandomValues(bytes) {
          nativeCalls += 1;
          bytes.fill(0xab);
          return bytes;
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    assert.equal(createAuthenticationNonce(), 'ab'.repeat(32));
    assert.equal(nativeCalls, 1);
  } finally {
    Module._load = originalLoad;
  }
});
