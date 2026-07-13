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

function replaceGlobalCrypto(value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    writable: true,
    value
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  };
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

test('default nonce generation uses Expo native crypto before Web Crypto', () => {
  const originalLoad = Module._load;
  const restoreCrypto = replaceGlobalCrypto({
    getRandomValues() {
      assert.fail('Web Crypto should not run after native crypto succeeds.');
    }
  });
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
    restoreCrypto();
  }
});

test('missing ExpoCrypto falls back to standards-compliant Web Crypto', () => {
  const originalLoad = Module._load;
  let webCalls = 0;
  const restoreCrypto = replaceGlobalCrypto({
    getRandomValues(bytes) {
      webCalls += 1;
      bytes.fill(0xcd);
      return bytes;
    }
  });
  Module._load = function loadCrypto(request, parent, isMain) {
    if (request === 'expo-crypto') throw new Error("Cannot find native module 'ExpoCrypto'");
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    assert.equal(createAuthenticationNonce(), 'cd'.repeat(32));
    assert.equal(webCalls, 1);
  } finally {
    Module._load = originalLoad;
    restoreCrypto();
  }
});

test('a native ExpoCrypto call failure also falls back to Web Crypto', () => {
  const originalLoad = Module._load;
  const restoreCrypto = replaceGlobalCrypto({
    getRandomValues(bytes) {
      bytes.fill(0xef);
      return bytes;
    }
  });
  Module._load = function loadCrypto(request, parent, isMain) {
    if (request === 'expo-crypto') {
      return { getRandomValues() { throw new Error('Native crypto is unavailable.'); } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    assert.equal(createAuthenticationNonce(), 'ef'.repeat(32));
  } finally {
    Module._load = originalLoad;
    restoreCrypto();
  }
});

test('nonce generation fails closed without either CSPRNG and never uses Math.random', () => {
  const originalLoad = Module._load;
  const originalMathRandom = Math.random;
  const restoreCrypto = replaceGlobalCrypto(undefined);
  let mathRandomCalls = 0;
  Math.random = () => {
    mathRandomCalls += 1;
    return 0.5;
  };
  Module._load = function loadCrypto(request, parent, isMain) {
    if (request === 'expo-crypto') throw new Error("Cannot find native module 'ExpoCrypto'");
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    assert.throws(
      () => createAuthenticationNonce(),
      (error) => error.code === 'SECURE_RANDOM_UNAVAILABLE' && /Secure random/.test(error.message)
    );
    assert.equal(mathRandomCalls, 0);
  } finally {
    Module._load = originalLoad;
    Math.random = originalMathRandom;
    restoreCrypto();
  }
});
