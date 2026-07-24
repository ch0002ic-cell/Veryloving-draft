'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const nacl = require('tweetnacl');
const { dispatchWearableAction, verifyWearableActionEnvelope } = require('../src/services/device-actions');
const { createDeviceActionReplayStore } = require('../src/services/device-action-replay-store');
const {
  lockAndDrainLocalUserDataMutations
} = require('../src/services/local-mutation-coordinator');

function signedMessage(envelope, keyPair) {
  const payload = Buffer.from(JSON.stringify(envelope)).toString('base64url');
  const signature = nacl.sign.detached(Buffer.from(payload), keyPair.secretKey);
  return {
    type: 'device_action',
    algorithm: 'Ed25519',
    payload,
    signature: Buffer.from(signature).toString('base64url'),
    envelope
  };
}

test('wearable commands verify pinned Ed25519 signatures and persist replay IDs', async () => {
  const keyPair = nacl.sign.keyPair();
  const publicKey = Buffer.from(keyPair.publicKey).toString('base64url');
  const envelope = {
    version: 1,
    id: 'action-1',
    issued_at: 10_000,
    action: 'emit_alarm',
    device_type: 'wearable',
    device_id: 'wearable-1',
    parameters: { command_payload: 'QQ==' }
  };
  const remembered = new Set();
  const commands = [];
  const replayStore = {
    async has(id) { return remembered.has(id); },
    async remember(id) { remembered.add(id); }
  };
  const registry = {
    get: () => ({
      deviceType: 'wearable',
      getStatus: () => ({ online: true }),
      async sendCommand(command) { commands.push(command); return { accepted: true }; }
    })
  };
  const message = signedMessage(envelope, keyPair);
  assert.equal(verifyWearableActionEnvelope(message, { publicKey, now: () => 10_001 }).id, 'action-1');
  await dispatchWearableAction(message, { registry, replayStore, publicKey, now: () => 10_001 });
  assert.deepEqual(commands, [{ payload: 'QQ==', action: 'emit_alarm', priority: 'standard', withResponse: true }]);
  await assert.rejects(
    dispatchWearableAction(message, { registry, replayStore, publicKey, now: () => 10_002 }),
    /already used/
  );
});

test('wearable commands reject forged payloads and mismatched envelope identities', () => {
  const keyPair = nacl.sign.keyPair();
  const publicKey = Buffer.from(keyPair.publicKey).toString('base64url');
  const envelope = {
    version: 1,
    id: 'action-1',
    issued_at: 10_000,
    action: 'emit_alarm',
    device_type: 'wearable',
    device_id: 'wearable-1',
    parameters: { command_payload: 'QQ==' }
  };
  const message = signedMessage(envelope, keyPair);
  assert.throws(
    () => verifyWearableActionEnvelope({ ...message, envelope: { ...envelope, id: 'attacker-id' } }, { publicKey, now: () => 10_001 }),
    /invalid or stale/
  );
  const forged = { ...message, payload: Buffer.from(JSON.stringify({ ...envelope, action: 'trigger_sos' })).toString('base64url') };
  assert.throws(() => verifyWearableActionEnvelope(forged, { publicKey, now: () => 10_001 }), /signature is invalid/);
});

test('concurrent wearable dispatch atomically reserves a signed envelope before BLE execution', async () => {
  const values = new Map();
  const replayStore = createDeviceActionReplayStore({
    storage: {
      async getItem(key) { return values.get(key) || null; },
      async setItem(key, value) { values.set(key, value); }
    },
    now: () => 10_001
  });
  const keyPair = nacl.sign.keyPair();
  const publicKey = Buffer.from(keyPair.publicKey).toString('base64url');
  const message = signedMessage({
    version: 1,
    id: 'atomic-action-1',
    issued_at: 10_000,
    action: 'emit_alarm',
    device_type: 'wearable',
    device_id: 'wearable-1',
    parameters: { command_payload: 'QQ==' }
  }, keyPair);
  let commands = 0;
  const registry = {
    get: () => ({
      deviceType: 'wearable',
      getStatus: () => ({ online: true }),
      async sendCommand() { commands += 1; return { accepted: true }; }
    })
  };
  const results = await Promise.allSettled([
    dispatchWearableAction(message, { registry, replayStore, publicKey, now: () => 10_001 }),
    dispatchWearableAction(message, { registry, replayStore, publicKey, now: () => 10_001 })
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(commands, 1);
});

test('a signed STOP envelope is the only remote path that requests critical queue bypass', async () => {
  const keyPair = nacl.sign.keyPair();
  const publicKey = Buffer.from(keyPair.publicKey).toString('base64url');
  const commands = [];
  const message = signedMessage({
    version: 1,
    id: 'stop-action-1',
    issued_at: 10_000,
    action: 'stop',
    device_type: 'wearable',
    device_id: 'wearable-1',
    parameters: { command_payload: 'AA==' }
  }, keyPair);
  await dispatchWearableAction(message, {
    publicKey,
    now: () => 10_001,
    replayStore: { async reserve() { return true; }, async release() {} },
    registry: {
      get: () => ({
        deviceType: 'wearable',
        getStatus: () => ({ online: true }),
        async sendCommand(command) { commands.push(command); return { accepted: true }; }
      })
    }
  });
  assert.deepEqual(commands, [{ payload: 'AA==', action: 'stop', priority: 'critical', withResponse: true }]);
});

test('replay persistence participates in the logout and privacy mutation barrier', async () => {
  const values = new Map();
  let releaseWrite;
  let writeStarted;
  const started = new Promise((resolve) => { writeStarted = resolve; });
  const blockedWrite = new Promise((resolve) => { releaseWrite = resolve; });
  const replayStore = createDeviceActionReplayStore({
    storage: {
      async getItem(key) { return values.get(key) || null; },
      async setItem(key, value) {
        writeStarted();
        await blockedWrite;
        values.set(key, value);
      }
    },
    now: () => 10_001
  });

  let releaseMutations;
  try {
    const reserve = replayStore.reserve('barrier-action-1', 20_000);
    await started;
    let barrierEstablished = false;
    const locking = lockAndDrainLocalUserDataMutations().then((release) => {
      barrierEstablished = true;
      releaseMutations = release;
    });
    await Promise.resolve();
    assert.equal(barrierEstablished, false);

    releaseWrite();
    assert.equal(await reserve, true);
    await locking;
    assert.equal(barrierEstablished, true);

    await assert.rejects(
      replayStore.remember('barrier-action-2', 20_000),
      (error) => error.code === 'LOCAL_DATA_CLEANUP_LOCKED'
    );
  } finally {
    releaseWrite?.();
    releaseMutations?.();
  }
});
