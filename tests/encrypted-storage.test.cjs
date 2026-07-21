'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createEncryptedStorage,
  ENCRYPTED_STORAGE_KEY_NAME,
  ENCRYPTED_STORAGE_PREFIX
} = require('../src/services/encrypted-storage');

function harness({
  values = new Map(),
  keys = new Map(),
  randomSeed: initialRandomSeed = 1,
  recoverAuthenticationFailure
} = {}) {
  let randomSeed = initialRandomSeed;
  const backend = {
    async getAllKeys() { return [...values.keys()]; },
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
    async multiRemove(items) { items.forEach((key) => values.delete(key)); }
  };
  const keyStore = {
    async getItemAsync(key) { return keys.get(key) ?? null; },
    async setItemAsync(key, value) { keys.set(key, value); },
    async deleteItemAsync(key) { keys.delete(key); }
  };
  const storage = createEncryptedStorage({
    backend,
    keyStore,
    recoverAuthenticationFailure,
    randomBytes: async (length) => Uint8Array.from(
      { length },
      (_value, index) => (randomSeed + index) % 256
    ).map((value) => {
      randomSeed = (randomSeed + 1) % 256;
      return value;
    })
  });
  return { backend, keyStore, keys, storage, values };
}

test('encrypted storage keeps AsyncStorage ciphertext-only and decrypts authenticated values', async () => {
  const { storage, values, keys } = harness();
  await storage.setItem('veryloving.profile', JSON.stringify({ email: 'care@example.test' }));

  const persisted = values.get('veryloving.profile');
  assert.match(persisted, /^VLENC1\./);
  assert.doesNotMatch(persisted, /care@example/);
  assert.ok(keys.get(ENCRYPTED_STORAGE_KEY_NAME));
  assert.equal(
    await storage.getItem('veryloving.profile'),
    JSON.stringify({ email: 'care@example.test' })
  );
});

test('encrypted storage fails closed on tampering and cross-key ciphertext swaps', async () => {
  const { storage, values } = harness();
  await storage.setItem('veryloving.first', 'first-private-value');
  await storage.setItem('veryloving.second', 'second-private-value');

  const first = values.get('veryloving.first');
  values.set('veryloving.second', first);
  await assert.rejects(
    storage.getItem('veryloving.second'),
    (error) => error.code === 'LOCAL_STORAGE_KEY_BINDING_FAILED'
  );

  values.set('veryloving.first', `${first.slice(0, -2)}AA`);
  await assert.rejects(
    storage.getItem('veryloving.first'),
    (error) => error.code === 'LOCAL_STORAGE_AUTHENTICATION_FAILED'
  );
});

test('encrypted storage migrates legacy plaintext on read before returning it', async () => {
  const { storage, values } = harness();
  values.set('veryloving.legacy', '{"private":true}');

  assert.equal(await storage.getItem('veryloving.legacy'), '{"private":true}');
  assert.ok(values.get('veryloving.legacy').startsWith(ENCRYPTED_STORAGE_PREFIX));
  assert.doesNotMatch(values.get('veryloving.legacy'), /private/);
});

test('key rotation makes ciphertext surviving a purge unrecoverable', async () => {
  const { storage, values } = harness();
  await storage.setItem('veryloving.survivor', 'private');
  const ciphertext = values.get('veryloving.survivor');
  await storage.rotateKeyAfterPurge();
  values.set('veryloving.survivor', ciphertext);

  await assert.rejects(
    storage.getItem('veryloving.survivor'),
    (error) => error.code === 'LOCAL_STORAGE_AUTHENTICATION_FAILED'
  );
});

test('confirmed ephemeral runtimes discard ciphertext whose process-local key was lost', async () => {
  const values = new Map();
  const firstRuntime = harness({ values, randomSeed: 1 });
  await firstRuntime.storage.setItem('veryloving.demo', 'ephemeral-value');
  const staleCiphertext = values.get('veryloving.demo');

  const secondRuntime = harness({
    values,
    randomSeed: 101,
    recoverAuthenticationFailure: ({ error, storageKey }) => (
      error.code === 'LOCAL_STORAGE_AUTHENTICATION_FAILED'
      && storageKey === 'veryloving.demo'
    )
  });

  assert.equal(await secondRuntime.storage.getItem('veryloving.demo'), null);
  assert.equal(values.has('veryloving.demo'), false);
  assert.match(staleCiphertext, /^VLENC1\./);
});

test('authentication failures remain fail-closed unless recovery is explicitly enabled', async () => {
  const values = new Map();
  const firstRuntime = harness({ values, randomSeed: 1 });
  await firstRuntime.storage.setItem('veryloving.private', 'private-value');
  const staleCiphertext = values.get('veryloving.private');
  const secondRuntime = harness({ values, randomSeed: 101 });

  await assert.rejects(
    secondRuntime.storage.getItem('veryloving.private'),
    (error) => error.code === 'LOCAL_STORAGE_AUTHENTICATION_FAILED'
  );
  assert.equal(values.get('veryloving.private'), staleCiphertext);
});

test('ephemeral recovery never suppresses malformed encrypted envelopes', async () => {
  const { storage, values } = harness({
    recoverAuthenticationFailure: () => true
  });
  values.set('veryloving.malformed', `${ENCRYPTED_STORAGE_PREFIX}invalid`);

  await assert.rejects(
    storage.getItem('veryloving.malformed'),
    (error) => error.code === 'LOCAL_STORAGE_ENVELOPE_INVALID'
  );
  assert.equal(values.has('veryloving.malformed'), true);
});

test('ephemeral recovery never suppresses authenticated cross-key swaps', async () => {
  const { storage, values } = harness({
    recoverAuthenticationFailure: () => true
  });
  await storage.setItem('veryloving.first', 'first-value');
  await storage.setItem('veryloving.second', 'second-value');
  const firstCiphertext = values.get('veryloving.first');
  values.set('veryloving.second', firstCiphertext);

  await assert.rejects(
    storage.getItem('veryloving.second'),
    (error) => error.code === 'LOCAL_STORAGE_KEY_BINDING_FAILED'
  );
  assert.equal(values.get('veryloving.second'), firstCiphertext);
});
