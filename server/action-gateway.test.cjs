'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ActionGateway, ROBOT_FAILURE_MESSAGE, deriveEd25519PublicKey, redactSerial, signEnvelope, validateAction } = require('./action-gateway.cjs');

const secret = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
const wearableCommandPayloads = { deploy_barrier: 'AQ==', emit_alarm: 'Ag==', trigger_sos: 'Aw==' };

test('action validation enforces device/action compatibility', () => {
  assert.throws(() => validateAction({ action: 'check_medication', device_type: 'wearable', device_id: 'w1' }), /not allowed/);
  assert.equal(validateAction({ action: 'check_medication', device_type: 'home_robot', device_id: 'r1' }).device_id, 'r1');
});

test('signed action envelopes are deterministic with a fixed clock except identity', () => {
  const signed = signEnvelope({ action: 'deploy_barrier', device_type: 'wearable', device_id: 'w1', parameters: {} }, secret, () => 42);
  assert.equal(signed.envelope.issued_at, 42);
  assert.equal(signed.algorithm, 'Ed25519');
  assert.equal(signed.payload, Buffer.from(JSON.stringify(signed.envelope)).toString('base64url'));
  const publicKey = crypto.createPublicKey(secret);
  assert.equal(crypto.verify(null, Buffer.from(signed.payload), publicKey, Buffer.from(signed.signature, 'base64url')), true);
  assert.equal(deriveEd25519PublicKey(secret).length, 43);
  assert.ok(signed.signature.length > 20);
});

test('wearable actions use the active authenticated voice channel', async () => {
  const sent = [];
  const gateway = new ActionGateway({ signingSecret: secret, wearableCommandPayloads });
  const channel = { readyState: 1, send: (message) => sent.push(JSON.parse(message)) };
  gateway.registerSession('user-1', channel, [
    { device_id: 'w1', device_type: 'wearable', online: true }
  ]);
  const pending = gateway.route('user-1', { action: 'deploy_barrier', device_type: 'wearable', device_id: 'w1' });
  assert.equal(sent[0].type, 'device_action');
  assert.equal(gateway.acknowledgeWearable('user-1', channel, { action_id: sent[0].envelope.id, ok: true }), true);
  const result = await pending;
  assert.equal(result.status, 'delivered');
});

test('wearable delivery rejects a NACK, timeout, and disconnected session', async () => {
  const channel = { readyState: 1, sent: [], send(message) { this.sent.push(JSON.parse(message)); } };
  const gateway = new ActionGateway({ signingSecret: secret, wearableCommandPayloads, wearableAckTimeoutMs: 5 });
  const unregister = gateway.registerSession('user-1', channel, [
    { device_id: 'w1', device_type: 'wearable', online: true }
  ]);

  const nack = gateway.route('user-1', { action: 'deploy_barrier', device_type: 'wearable', device_id: 'w1' });
  gateway.acknowledgeWearable('user-1', channel, { action_id: channel.sent.at(-1).envelope.id, ok: false, error_code: 'BLE_BUSY' });
  await assert.rejects(nack, (error) => error.statusCode === 502 && error.code === 'BLE_BUSY');

  const timedOut = gateway.route('user-1', { action: 'deploy_barrier', device_type: 'wearable', device_id: 'w1' });
  await assert.rejects(timedOut, (error) => error.statusCode === 504);

  const disconnected = gateway.route('user-1', { action: 'deploy_barrier', device_type: 'wearable', device_id: 'w1' });
  unregister();
  await assert.rejects(disconnected, (error) => error.code === 'WEARABLE_SESSION_CLOSED');
});

test('robot actions return asynchronous acceptance and retry manufacturer delivery', async () => {
  let attempts = 0;
  const gateway = new ActionGateway({
    signingSecret: secret, manufacturerWebhookURL: 'https://manufacturer.example.test/hooks', manufacturerApiKey: 'key', retryDelayMs: 1,
    sleep: async () => {},
    fetchImpl: async () => { attempts += 1; if (attempts === 1) throw new Error('offline'); return { ok: true, status: 202 }; }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const result = await gateway.route('user-1', { action: 'check_medication', device_type: 'home_robot', device_id: 'r1' });
  assert.equal(result.status, 'accepted');
  await gateway.waitForDeliveries();
  assert.equal(attempts, 2);
});

test('unreachable manufacturer webhook times out, retries, and pushes one user warning', async () => {
  let attempts = 0;
  const notifications = [];
  const gateway = new ActionGateway({
    signingSecret: secret, manufacturerWebhookURL: 'https://unreachable.example.test', manufacturerApiKey: 'key',
    retries: 2, retryDelayMs: 1, requestTimeoutMs: 5, sleep: async () => {},
    fetchImpl: async () => { attempts += 1; return new Promise(() => {}); },
    notifyUser: async (userId, notification) => notifications.push({ userId, notification }),
    logger: { error() {} }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  await gateway.route('user-1', { action: 'check_medication', device_type: 'home_robot', device_id: 'r1' });
  await gateway.waitForDeliveries();
  assert.equal(attempts, 2);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].notification.body, ROBOT_FAILURE_MESSAGE);
});

test('separate device delivery queues start independently', async () => {
  let releaseFirst;
  const started = [];
  const gateway = new ActionGateway({
    signingSecret: secret, manufacturerWebhookURL: 'https://manufacturer.example.test', manufacturerApiKey: 'key',
    requestTimeoutMs: 1000,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      started.push(body.envelope.device_id);
      if (body.envelope.device_id === 'r1') await new Promise((resolve) => { releaseFirst = resolve; });
      return { ok: true, status: 202 };
    }
  });
  gateway.registerSession('user-1', null, [
    { device_id: 'r1', device_type: 'home_robot', online: true },
    { device_id: 'r2', device_type: 'home_robot', online: true }
  ]);
  await Promise.all([
    gateway.route('user-1', { action: 'check_medication', device_type: 'home_robot', device_id: 'r1' }),
    gateway.route('user-1', { action: 'check_medication', device_type: 'home_robot', device_id: 'r2' })
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started.sort(), ['r1', 'r2']);
  releaseFirst();
  await gateway.waitForDeliveries();
});

test('robot action is durably enqueued before acceptance and transitions through asynchronous ACK', async () => {
  const events = [];
  const outboxRepository = {
    async enqueue(record) { events.push(['enqueue', record.action_id]); },
    async markDelivering(actionId) { events.push(['delivering', actionId]); return true; },
    async markPendingAck(actionId) { events.push(['pending_ack', actionId]); return true; },
    async acknowledge(actionId, acknowledgement) { events.push([acknowledgement.ok ? 'delivered' : 'failed', actionId]); return true; }
  };
  const gateway = new ActionGateway({
    signingSecret: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    outboxRepository,
    fetchImpl: async () => { events.push(['fetch']); return { ok: true, status: 202 }; }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const accepted = await gateway.route('user-1', { action: 'check_medication', device_type: 'home_robot', device_id: 'r1' });
  assert.equal(events[0][0], 'enqueue');
  await gateway.waitForDeliveries();
  assert.ok(events.some(([event]) => event === 'pending_ack'));
  assert.equal(await gateway.acknowledgeRobot(accepted.action_id, { ok: true }), true);
  assert.equal(events.at(-1)[0], 'delivered');
  assert.equal(gateway.totalRobotCommands, 0);
});

test('outbox failure prevents false 202 acceptance and a bounded device queue returns 429', async () => {
  let fetches = 0;
  const failedOutbox = new ActionGateway({
    signingSecret: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    outboxRepository: { async enqueue() { throw new Error('Dynamo unavailable'); } },
    fetchImpl: async () => { fetches += 1; return { ok: true, status: 202 }; }
  });
  failedOutbox.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  await assert.rejects(
    failedOutbox.route('user-1', { action: 'check_medication', device_type: 'home_robot', device_id: 'r1' }),
    (error) => error.statusCode === 503
  );
  assert.equal(fetches, 0);

  const bounded = new ActionGateway({
    signingSecret: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    maxQueueDepthPerDevice: 1,
    fetchImpl: async () => ({ ok: true, status: 202 })
  });
  bounded.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const first = await bounded.route('user-1', { action: 'check_medication', device_type: 'home_robot', device_id: 'r1' });
  await bounded.waitForDeliveries();
  await assert.rejects(
    bounded.route('user-1', { action: 'check_medication', device_type: 'home_robot', device_id: 'r1' }),
    (error) => error.statusCode === 429
  );
  await bounded.acknowledgeRobot(first.action_id, { ok: true });
  const next = await bounded.route('user-1', { action: 'check_medication', device_type: 'home_robot', device_id: 'r1' });
  assert.equal(next.status, 'accepted');
  await bounded.waitForDeliveries();
  await bounded.acknowledgeRobot(next.action_id, { ok: true });
});

test('stable mobile idempotency keys do not redeliver a durably accepted command', async () => {
  let fetches = 0;
  const gateway = new ActionGateway({
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    outboxRepository: { async enqueue() { return false; } },
    fetchImpl: async () => { fetches += 1; return { ok: true, status: 202 }; }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const input = {
    action: 'check_medication',
    device_type: 'home_robot',
    device_id: 'r1',
    idempotency_key: 'durable-command-1'
  };
  const first = await gateway.route('user-1', input);
  const second = await gateway.route('user-1', input);
  assert.equal(first.action_id, second.action_id);
  assert.equal(first.duplicate, true);
  assert.equal(fetches, 0);
  assert.equal(gateway.totalRobotCommands, 0);
});

test('missing manufacturer ACK expires durable state and pushes the user warning', async () => {
  const transitions = [];
  const notifications = [];
  const gateway = new ActionGateway({
    signingSecret: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    robotAckTimeoutMs: 5,
    outboxRepository: {
      async enqueue() {},
      async markPendingAck() { return true; },
      async expirePendingAck(actionId) { transitions.push(['expired', actionId]); return true; }
    },
    notifyUser: async (userId, notification) => notifications.push({ userId, notification }),
    fetchImpl: async () => ({ ok: true, status: 202 })
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const accepted = await gateway.route('user-1', { action: 'check_medication', device_type: 'home_robot', device_id: 'r1' });
  await gateway.waitForDeliveries();
  await new Promise((resolve) => setTimeout(resolve, 15));
  await gateway.waitForDeliveries();
  assert.deepEqual(transitions, [['expired', accepted.action_id]]);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].notification.body, ROBOT_FAILURE_MESSAGE);
  assert.equal(gateway.totalRobotCommands, 0);
});

test('process restart recovers a durably queued robot command before accepting new work', async () => {
  const signed = signEnvelope({
    action: 'check_medication',
    device_type: 'home_robot',
    device_id: 'r1',
    manufacturer_device_id: 'manufacturer-r1',
    parameters: {}
  }, secret, () => 10_000);
  const transitions = [];
  let fetches = 0;
  const gateway = new ActionGateway({
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    outboxRepository: {
      async listPending() {
        return [{
          state: 'queued',
          action_id: signed.envelope.id,
          user_id: 'user-1',
          device_id: 'r1',
          action: 'check_medication',
          signed
        }];
      },
      async markDelivering() { transitions.push('delivering'); return true; },
      async markPendingAck() { transitions.push('pending_ack'); return true; },
      async acknowledge() { transitions.push('delivered'); return true; }
    },
    fetchImpl: async () => { fetches += 1; return { ok: true, status: 202 }; }
  });
  assert.deepEqual(await gateway.recoverPendingCommands(), { recovered: 1 });
  await gateway.waitForDeliveries();
  assert.equal(fetches, 1);
  assert.ok(transitions.includes('pending_ack'));
  assert.equal(await gateway.acknowledgeRobot(signed.envelope.id, { ok: true }), true);
  assert.equal(transitions.at(-1), 'delivered');
  assert.equal(gateway.totalRobotCommands, 0);
});

test('transient outbox recovery failure is retried instead of poisoning robot routing', async () => {
  let recoveries = 0;
  const gateway = new ActionGateway({
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    outboxRepository: {
      async listPending() {
        recoveries += 1;
        if (recoveries === 1) throw new Error('temporary Dynamo failure');
        return [];
      },
      async enqueue() { return false; }
    },
    logger: { error() {} }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  await assert.rejects(gateway.recoverPendingCommands(), /temporary Dynamo failure/);
  const result = await gateway.route('user-1', {
    action: 'check_medication',
    device_type: 'home_robot',
    device_id: 'r1',
    idempotency_key: 'recovered-route'
  });
  assert.equal(result.duplicate, true);
  assert.equal(recoveries, 2);
});

test('robot delivery translates the private app id to the manufacturer routing id', async () => {
  let deliveredEnvelope;
  const gateway = new ActionGateway({
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    resolveManufacturerDeviceId: async (userId, deviceId) => (
      userId === 'user-1' && deviceId === 'app-robot-1' ? 'manufacturer-robot-1' : null
    ),
    fetchImpl: async (_url, options) => {
      deliveredEnvelope = JSON.parse(options.body).envelope;
      return { ok: true, status: 200 };
    }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'app-robot-1', device_type: 'home_robot', online: true }]);
  await gateway.route('user-1', { action: 'check_medication', device_type: 'home_robot', device_id: 'app-robot-1' });
  await gateway.waitForDeliveries();
  assert.equal(deliveredEnvelope.device_id, 'app-robot-1');
  assert.equal(deliveredEnvelope.manufacturer_device_id, 'manufacturer-robot-1');
});

test('emit_alarm is an approved wearable action', () => {
  assert.equal(validateAction({ action: 'emit_alarm', device_type: 'wearable', device_id: 'w1' }).action, 'emit_alarm');
  assert.throws(() => validateAction({
    action: 'emit_alarm',
    device_type: 'wearable',
    device_id: 'w1',
    parameters: { command_payload: 'attacker-controlled' }
  }), /server-owned/);
});

test('wearable delivery signs only the server-owned firmware command mapping', async () => {
  const sent = [];
  const gateway = new ActionGateway({ signingPrivateKey: secret, wearableCommandPayloads });
  const channel = { readyState: 1, send: (message) => sent.push(JSON.parse(message)) };
  gateway.registerSession('user-1', channel, [{ device_id: 'w1', device_type: 'wearable', online: true }]);
  const pending = gateway.route('user-1', { action: 'emit_alarm', device_type: 'wearable', device_id: 'w1' });
  assert.equal(sent[0].envelope.parameters.command_payload, 'Ag==');
  gateway.acknowledgeWearable('user-1', channel, { action_id: sent[0].envelope.id, ok: true });
  await pending;
});

test('hardware serial redaction never contains the serial', () => {
  assert.doesNotMatch(redactSerial('SERIAL-PRIVATE-123'), /SERIAL-PRIVATE-123/);
});
