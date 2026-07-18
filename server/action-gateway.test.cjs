'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  ActionGateway,
  ROBOT_FAILURE_MESSAGE,
  createDynamoActionOutboxRepository,
  deriveEd25519PublicKey,
  deterministicActionId,
  redactSerial,
  signEnvelope,
  validateAction
} = require('./action-gateway.cjs');

const secret = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
const wearableCommandPayloads = { deploy_barrier: 'AQ==', emit_alarm: 'Ag==', trigger_sos: 'Aw==', stop: 'BA==' };
const defaultBindingEpoch = 7;

function activeRobotOptions({
  adapterId = 'manufacturer-default',
  bindingEpoch = defaultBindingEpoch,
  manufacturerDeviceId = (deviceId) => deviceId
} = {}) {
  return {
    resolveRobotBinding: async (_userId, deviceId) => ({
      active: true,
      state: 'active',
      adapterId,
      bindingEpoch,
      manufacturerDeviceId: typeof manufacturerDeviceId === 'function'
        ? manufacturerDeviceId(deviceId)
        : manufacturerDeviceId
    }),
    isRobotBindingActive: async () => true
  };
}

function acknowledgeRobot(gateway, actionId, acknowledgement = { ok: true }, {
  adapterId = 'manufacturer-default',
  bindingEpoch = defaultBindingEpoch
} = {}) {
  return gateway.acknowledgeRobot(actionId, acknowledgement, { adapterId, bindingEpoch });
}

test('action validation enforces device/action compatibility', () => {
  assert.throws(() => validateAction({ action: 'check_medication', device_type: 'wearable', device_id: 'w1' }), /not allowed/);
  assert.equal(validateAction({ action: 'check_medication', device_type: 'home_robot', device_id: 'r1' }).device_id, 'r1');
  assert.equal(validateAction({ action: 'stop', device_type: 'wearable', device_id: 'w1' }).action, 'stop');
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

test('robot idempotency identity is scoped to the binding epoch while wearable v1 stays stable', () => {
  const robot = {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1',
    idempotency_key: 'same-mobile-command', binding_epoch: 10
  };
  assert.notEqual(
    deterministicActionId('user-1', robot),
    deterministicActionId('user-1', { ...robot, binding_epoch: 11 })
  );
  const wearable = {
    action: 'stop', device_type: 'wearable', device_id: 'w1', idempotency_key: 'wearable-stop'
  };
  assert.equal(
    deterministicActionId('user-1', wearable),
    deterministicActionId('user-1', { ...wearable, binding_epoch: 99 })
  );
});

test('signed manufacturer medication envelope carries the stable reminder correlation ID', async () => {
  let signedRequest;
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test/hooks',
    manufacturerApiKey: 'key',
    fetchImpl: async (_url, options) => {
      signedRequest = JSON.parse(options.body);
      return { ok: true, status: 202 };
    }
  });
  gateway.registerSession('user-1', null, [
    { device_id: 'robot-home-0001', device_type: 'home_robot', online: true }
  ]);
  await gateway.route('user-1', {
    action: 'medication_reminder',
    device_type: 'home_robot',
    device_id: 'robot-home-0001',
    idempotency_key: 'med-reminder-001_reminder_v1',
    parameters: {
      reminder_id: 'med-reminder-001',
      medication_id: 'morning-dose',
      scheduled_at: 1_060_000
    }
  });
  await gateway.waitForDeliveries();
  assert.deepEqual(signedRequest.envelope.parameters, {
    reminder_id: 'med-reminder-001',
    medication_id: 'morning-dose',
    scheduled_at: 1_060_000
  });
  assert.equal(signedRequest.envelope.version, 2);
  assert.equal(signedRequest.envelope.contract_version, 'vl-robot-action/2');
  assert.equal(signedRequest.envelope.binding_epoch, defaultBindingEpoch);
  assert.equal(
    crypto.verify(
      null,
      Buffer.from(signedRequest.payload),
      crypto.createPublicKey(secret),
      Buffer.from(signedRequest.signature, 'base64url')
    ),
    true
  );
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
  assert.equal(sent[0].envelope.version, 1);
  assert.equal(sent[0].envelope.binding_epoch, undefined);
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
  const redirects = [];
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingSecret: secret, manufacturerWebhookURL: 'https://manufacturer.example.test/hooks', manufacturerApiKey: 'key', retryDelayMs: 1,
    sleep: async () => {},
    fetchImpl: async (_url, options) => {
      attempts += 1;
      redirects.push(options.redirect);
      if (attempts === 1) throw new Error('offline');
      return { ok: true, status: 202 };
    }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const result = await gateway.route('user-1', { action: 'check_medication', device_type: 'home_robot', device_id: 'r1' });
  assert.equal(result.status, 'accepted');
  await gateway.waitForDeliveries();
  assert.equal(attempts, 2);
  assert.deepEqual(redirects, ['error', 'error']);
});

test('robot route requires an explicitly active positive binding epoch', async () => {
  for (const binding of [
    { active: false, state: 'resetting', bindingEpoch: 1 },
    { active: true, state: 'active', bindingEpoch: 0 },
    { active: true, state: 'active', bindingEpoch: Number.MAX_SAFE_INTEGER + 1 }
  ]) {
    const gateway = new ActionGateway({
      signingPrivateKey: secret,
      resolveRobotBinding: async () => ({
        manufacturerDeviceId: 'manufacturer-r1',
        adapterId: 'manufacturer-default',
        ...binding
      })
    });
    gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
    await assert.rejects(
      gateway.route('user-1', { action: 'check_medication', device_type: 'home_robot', device_id: 'r1' }),
      (error) => error.statusCode === 403
    );
  }
});

test('binding activity is revalidated before every physical retry without a failure push', async () => {
  let checks = 0;
  let fetches = 0;
  const notifications = [];
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    retries: 3,
    retryDelayMs: 0,
    sleep: async () => {},
    isRobotBindingActive: async (_userId, _deviceId, expected) => {
      assert.deepEqual(expected, {
        bindingEpoch: defaultBindingEpoch,
        adapterId: 'manufacturer-default',
        manufacturerDeviceId: 'r1',
        lifecycleState: 'active'
      });
      checks += 1;
      return checks < 4;
    },
    fetchImpl: async () => { fetches += 1; throw new Error('network split'); },
    notifyUser: async (...args) => notifications.push(args),
    logger: { error() {} }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  assert.equal((await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1'
  })).status, 'accepted');
  await gateway.waitForDeliveries();
  assert.equal(checks, 4);
  assert.equal(fetches, 1);
  assert.equal(notifications.length, 0);
});

test('unreachable manufacturer webhook times out, retries, and pushes one user warning', async () => {
  let attempts = 0;
  const notifications = [];
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
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
    ...activeRobotOptions(),
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

test('same-device commands preserve execution order until the prior asynchronous ACK', async () => {
  const delivered = [];
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    fetchImpl: async (_url, options) => {
      delivered.push(JSON.parse(options.body).envelope.id);
      return { ok: true, status: 202 };
    }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const first = await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1', idempotency_key: 'ordered-first'
  });
  await gateway.waitForDeliveries();
  const second = await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1', idempotency_key: 'ordered-second'
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(delivered, [first.action_id]);
  assert.equal(await acknowledgeRobot(gateway, first.action_id), true);
  await gateway.waitForDeliveries();
  assert.deepEqual(delivered, [first.action_id, second.action_id]);
  assert.equal(await acknowledgeRobot(gateway, second.action_id), true);
});

test('binding fence drains an in-flight request, cancels its ACK barrier, and suppresses warning pushes', async () => {
  let releaseRequest;
  let requestStarted;
  const started = new Promise((resolve) => { requestStarted = resolve; });
  const notifications = [];
  const fences = [];
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    requestTimeoutMs: 1_000,
    outboxRepository: {
      async listPending() { return []; },
      async enqueue() { return true; },
      async markDelivering() { return true; },
      async markPendingAck() { return true; },
      async markFailed() { return true; },
      async failPendingForBinding(userId, deviceId, bindingEpoch, details) {
        fences.push({ userId, deviceId, bindingEpoch, details });
        return { failed: 1 };
      }
    },
    fetchImpl: async () => {
      requestStarted();
      await new Promise((resolve) => { releaseRequest = resolve; });
      return { ok: true, status: 202 };
    },
    notifyUser: async (...args) => notifications.push(args),
    logger: { error() {} }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const accepted = await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1'
  });
  await started;
  let fenceSettled = false;
  const fencing = gateway.fenceRobotBinding('user-1', 'r1', defaultBindingEpoch)
    .then((result) => { fenceSettled = true; return result; });
  await Promise.resolve();
  assert.equal(fenceSettled, false);
  releaseRequest();
  assert.deepEqual(await fencing, { fenced: true, failedPending: 1, cancelledAcknowledgements: 1 });
  assert.equal(gateway.pendingRobotAcks.size, 0);
  assert.equal(gateway.totalRobotCommands, 0);
  assert.equal(notifications.length, 0);
  assert.equal(fences[0].details.error_code, 'BINDING_FENCED');
  assert.equal(await acknowledgeRobot(gateway, accepted.action_id), false);
  await assert.rejects(gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1'
  }), (error) => error.code === 'BINDING_FENCED');
});

test('an in-flight network failure caused during binding fencing does not push a false warning', async () => {
  let rejectRequest;
  let requestStarted;
  const started = new Promise((resolve) => { requestStarted = resolve; });
  const notifications = [];
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    retries: 1,
    requestTimeoutMs: 1_000,
    outboxRepository: {
      async listPending() { return []; },
      async enqueue() { return true; },
      async markDelivering() { return true; },
      async markFailed() { return true; },
      async failPendingForBinding() { return { failed: 1 }; }
    },
    fetchImpl: async () => {
      requestStarted();
      return new Promise((_resolve, reject) => { rejectRequest = reject; });
    },
    notifyUser: async (...args) => notifications.push(args),
    logger: { error() {} }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1'
  });
  await started;
  const fencing = gateway.fenceRobotBinding('user-1', 'r1', defaultBindingEpoch);
  rejectRequest(new Error('socket closed by reset'));
  assert.equal((await fencing).fenced, true);
  assert.equal(notifications.length, 0);
});

test('account fence durably fails queued work and drains an in-flight request before returning', async () => {
  let releaseRequest;
  let requestStarted;
  const started = new Promise((resolve) => { requestStarted = resolve; });
  const notifications = [];
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    requestTimeoutMs: 1_000,
    isAccountActionAllowed: async () => true,
    outboxRepository: {
      async listPending() { return []; },
      async enqueue() { return true; },
      async markDelivering() { return true; },
      async markDelivered() { return true; },
      async failPendingForUser(userId, details) {
        assert.equal(userId, 'user-1');
        assert.equal(details.error_code, 'ACCOUNT_FENCED');
        return { failed: 1 };
      }
    },
    fetchImpl: async () => {
      requestStarted();
      await new Promise((resolve) => { releaseRequest = resolve; });
      return { ok: true, status: 200 };
    },
    notifyUser: async (...args) => notifications.push(args),
    logger: { error() {} }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1'
  });
  await started;
  let fenceSettled = false;
  const fencing = gateway.fenceUserActions('user-1')
    .then((result) => { fenceSettled = true; return result; });
  await Promise.resolve();
  assert.equal(fenceSettled, false);
  releaseRequest();
  assert.deepEqual(await fencing, { fenced: true, failedPending: 1, cancelledAcknowledgements: 0 });
  assert.equal(notifications.length, 0);
  await assert.rejects(gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1'
  }), (error) => error.code === 'ACCOUNT_FENCED');
});

test('a vendor callback cannot acknowledge another adapter\'s pending action', async () => {
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    resolveRobotBinding: async () => ({
      active: true,
      bindingEpoch: defaultBindingEpoch,
      manufacturerDeviceId: 'manufacturer-r1',
      adapterId: 'yongyida-primary'
    }),
    fetchImpl: async () => ({ ok: true, status: 202 })
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const accepted = await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1'
  });
  await gateway.waitForDeliveries();
  assert.equal(
    await acknowledgeRobot(gateway, accepted.action_id, { ok: true }, {
      adapterId: 'yongyida-primary', bindingEpoch: defaultBindingEpoch + 1
    }),
    false
  );
  assert.equal(
    await acknowledgeRobot(gateway, accepted.action_id, { ok: true }, { adapterId: 'jiangzhi-edge' }),
    false
  );
  assert.equal(
    await acknowledgeRobot(gateway, accepted.action_id, { ok: true }, { adapterId: 'yongyida-primary' }),
    true
  );
});

test('a callback on a fresh replica is durably adapter-bound', async () => {
  const records = new Map([['11111111-1111-4111-8111-111111111111', {
    adapter_id: 'jiangzhi-edge', binding_epoch: 19, user_id: 'user-1', device_id: 'robot-1', state: 'pending_ack'
  }]]);
  const outboxRepository = {
    async acknowledge(actionId, details) {
      const record = records.get(actionId);
      if (!record || record.adapter_id !== details.adapter_id
        || record.binding_epoch !== details.binding_epoch || record.state !== 'pending_ack') return false;
      record.state = details.ok ? 'delivered' : 'failed';
      return { ...record };
    }
  };
  const freshReplica = new ActionGateway({ signingPrivateKey: secret, outboxRepository });
  assert.equal(await freshReplica.acknowledgeRobot(
    '11111111-1111-4111-8111-111111111111',
    { ok: true },
    { adapterId: 'yongyida-cloud', bindingEpoch: 19 }
  ), false);
  assert.equal(await freshReplica.acknowledgeRobot(
    '11111111-1111-4111-8111-111111111111',
    { ok: true },
    { adapterId: 'jiangzhi-edge', bindingEpoch: 19 }
  ), true);
  assert.equal(records.get('11111111-1111-4111-8111-111111111111').state, 'delivered');
});

test('an ACK racing a 202 response cannot strand the same-device queue', async () => {
  const records = new Map();
  const delivered = [];
  const outboxRepository = {
    async listPending() { return []; },
    async enqueue(record) {
      records.set(record.action_id, { ...record, state: 'queued' });
      return true;
    },
    async markDelivering(actionId) {
      const record = records.get(actionId);
      if (record.state === 'queued' || record.state === 'delivering') record.state = 'delivering';
      return { ...record };
    },
    async acknowledge(actionId, details) {
      const record = records.get(actionId);
      if (!record || record.adapter_id !== details.adapter_id
        || record.binding_epoch !== details.binding_epoch) return false;
      record.state = details.ok ? 'delivered' : 'failed';
      return { ...record };
    },
    async markPendingAck(actionId) {
      const record = records.get(actionId);
      if (record.state === 'queued' || record.state === 'delivering') record.state = 'pending_ack';
      return { ...record };
    }
  };
  let gateway;
  const robotAdapterRuntime = {
    async deliverSignedAction(adapterId, signed) {
      delivered.push(signed.envelope.id);
      await acknowledgeRobot(gateway, signed.envelope.id, { ok: true }, { adapterId });
      return { status: 202, acknowledged: false };
    }
  };
  gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    resolveRobotBinding: async () => ({
      active: true,
      bindingEpoch: defaultBindingEpoch,
      manufacturerDeviceId: 'manufacturer-r1',
      adapterId: 'jiangzhi-edge'
    }),
    robotAdapterRuntime,
    outboxRepository
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const first = await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1', idempotency_key: 'early-ack-first'
  });
  await gateway.waitForDeliveries();
  const second = await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1', idempotency_key: 'early-ack-second'
  });
  await gateway.waitForDeliveries();
  assert.deepEqual(delivered, [first.action_id, second.action_id]);
  assert.equal(gateway.totalRobotCommands, 0);
  assert.equal(gateway.pendingRobotAcks.size, 0);
});

test('a losing ACK-timeout race cannot release another command queue slot', async () => {
  let releaseExpiry;
  const delivered = [];
  const outboxRepository = {
    async listPending() { return []; },
    async enqueue() { return true; },
    async markDelivering() { return true; },
    async markPendingAck() { return true; },
    async acknowledge() { return true; },
    async expirePendingAck() {
      return new Promise((resolve) => { releaseExpiry = resolve; });
    }
  };
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    outboxRepository,
    fetchImpl: async (_url, options) => {
      delivered.push(JSON.parse(options.body).envelope.id);
      return { ok: true, status: 202 };
    }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const first = await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1', idempotency_key: 'race-first'
  });
  await gateway.waitForDeliveries();
  const second = await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1', idempotency_key: 'race-second'
  });
  const firstPending = gateway.pendingRobotAcks.get(first.action_id);
  const expiry = gateway.expireRobotAcknowledgement(first.action_id, firstPending);
  await Promise.resolve();
  assert.equal(await acknowledgeRobot(gateway, first.action_id), true);
  await gateway.waitForDeliveries();
  assert.deepEqual(delivered, [first.action_id, second.action_id]);
  assert.equal(gateway.totalRobotCommands, 1);

  releaseExpiry(false);
  assert.equal(await expiry, false);
  assert.equal(gateway.totalRobotCommands, 1);
  assert.equal(gateway.deliveryQueueDepths.get(JSON.stringify(['user-1', 'r1', defaultBindingEpoch])), 1);
  assert.equal(await acknowledgeRobot(gateway, second.action_id), true);
  assert.equal(gateway.totalRobotCommands, 0);
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
    ...activeRobotOptions(),
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
  assert.equal(await acknowledgeRobot(gateway, accepted.action_id), true);
  assert.equal(events.at(-1)[0], 'delivered');
  assert.equal(gateway.totalRobotCommands, 0);
});

test('outbox failure prevents false 202 acceptance and a bounded device queue returns 429', async () => {
  let fetches = 0;
  const failedOutbox = new ActionGateway({
    ...activeRobotOptions(),
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
    ...activeRobotOptions(),
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
  await acknowledgeRobot(bounded, first.action_id);
  const next = await bounded.route('user-1', { action: 'check_medication', device_type: 'home_robot', device_id: 'r1' });
  assert.equal(next.status, 'accepted');
  await bounded.waitForDeliveries();
  await acknowledgeRobot(bounded, next.action_id);
});

test('stable mobile idempotency keys do not redeliver a durably accepted command', async () => {
  let fetches = 0;
  let stored;
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    outboxRepository: {
      async enqueue(record) {
        stored ||= { ...record, state: 'pending_ack' };
        return { duplicate: true, record: stored };
      }
    },
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

test('reuse of an idempotency key with different parameters fails with 409', async () => {
  let stored;
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    outboxRepository: {
      async enqueue(record) {
        if (!stored) {
          stored = { ...record, state: 'pending_ack' };
          return { duplicate: true, record: stored };
        }
        return { duplicate: true, record: stored };
      }
    }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const common = {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1',
    idempotency_key: 'same-key-different-request'
  };
  assert.equal((await gateway.route('user-1', {
    ...common, parameters: { medication_id: 'morning-dose' }
  })).duplicate, true);
  await assert.rejects(gateway.route('user-1', {
    ...common, parameters: { medication_id: 'evening-dose' }
  }), (error) => error.statusCode === 409 && error.code === 'ROBOT_IDEMPOTENCY_CONFLICT');
  assert.equal(gateway.totalRobotCommands, 0);
});

test('missing manufacturer ACK expires durable state and pushes the user warning', async () => {
  const transitions = [];
  const notifications = [];
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
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
    version: 2,
    action: 'check_medication',
    device_type: 'home_robot',
    device_id: 'r1',
    manufacturer_device_id: 'manufacturer-r1',
    adapter_id: 'manufacturer-default',
    binding_epoch: defaultBindingEpoch,
    contract_version: 'vl-robot-action/2',
    expires_at: 70_000,
    parameters: {}
  }, secret, () => 10_000);
  const transitions = [];
  let fetches = 0;
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    now: () => 20_000,
    outboxRepository: {
      async listPending() {
        return [{
          state: 'queued',
          action_id: signed.envelope.id,
          user_id: 'user-1',
          device_id: 'r1',
          adapter_id: 'manufacturer-default',
          binding_epoch: defaultBindingEpoch,
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
  assert.equal(await acknowledgeRobot(gateway, signed.envelope.id), true);
  assert.equal(transitions.at(-1), 'delivered');
  assert.equal(gateway.totalRobotCommands, 0);
});

test('process restart fails an expired durable robot action without redelivery', async () => {
  const signed = signEnvelope({
    version: 2,
    action: 'check_medication',
    device_type: 'home_robot',
    device_id: 'r1',
    manufacturer_device_id: 'manufacturer-r1',
    adapter_id: 'manufacturer-default',
    binding_epoch: defaultBindingEpoch,
    contract_version: 'vl-robot-action/2',
    expires_at: 11_000,
    parameters: {}
  }, secret, () => 10_000);
  const failures = [];
  let fetches = 0;
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    now: () => 20_000,
    outboxRepository: {
      async listPending() {
        return [{
          state: 'queued',
          action_id: signed.envelope.id,
          user_id: 'user-1',
          device_id: 'r1',
          adapter_id: 'manufacturer-default',
          binding_epoch: defaultBindingEpoch,
          action: 'check_medication',
          signed
        }];
      },
      async markFailed(actionId, details) { failures.push({ actionId, details }); return true; }
    },
    fetchImpl: async () => { fetches += 1; return { ok: true, status: 202 }; }
  });
  assert.deepEqual(await gateway.recoverPendingCommands(), { recovered: 0 });
  assert.equal(fetches, 0);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].details.error_code, 'ACTION_EXPIRED');
});

test('process restart fails a stale binding generation as BINDING_FENCED without redelivery', async () => {
  const signed = signEnvelope({
    version: 2,
    action: 'check_medication',
    device_type: 'home_robot',
    device_id: 'r1',
    manufacturer_device_id: 'manufacturer-r1',
    adapter_id: 'manufacturer-default',
    binding_epoch: 3,
    contract_version: 'vl-robot-action/2',
    expires_at: 70_000,
    parameters: {}
  }, secret, () => 10_000);
  const failures = [];
  let fetches = 0;
  const gateway = new ActionGateway({
    signingPrivateKey: secret,
    now: () => 20_000,
    isRobotBindingActive: async () => false,
    outboxRepository: {
      async listPending() {
        return [{
          state: 'queued', action_id: signed.envelope.id, user_id: 'user-1',
          device_id: 'r1', adapter_id: 'manufacturer-default', binding_epoch: 3,
          action: 'check_medication', signed
        }];
      },
      async markFailed(actionId, details) { failures.push({ actionId, details }); return true; }
    },
    fetchImpl: async () => { fetches += 1; return { ok: true, status: 202 }; }
  });
  assert.deepEqual(await gateway.recoverPendingCommands(), { recovered: 0 });
  assert.equal(fetches, 0);
  assert.equal(failures[0].details.error_code, 'BINDING_FENCED');
});

test('account deletion guard fences durable recovery as ACCOUNT_FENCED without redelivery', async () => {
  const signed = signEnvelope({
    version: 2,
    action: 'check_medication',
    device_type: 'home_robot',
    device_id: 'r1',
    manufacturer_device_id: 'manufacturer-r1',
    adapter_id: 'manufacturer-default',
    binding_epoch: 5,
    contract_version: 'vl-robot-action/2',
    expires_at: 70_000,
    parameters: {}
  }, secret, () => 10_000);
  const failures = [];
  let bindingChecks = 0;
  const gateway = new ActionGateway({
    signingPrivateKey: secret,
    now: () => 20_000,
    isAccountActionAllowed: async () => false,
    isRobotBindingActive: async () => { bindingChecks += 1; return true; },
    outboxRepository: {
      async listPending() {
        return [{
          state: 'queued', action_id: signed.envelope.id, user_id: 'user-1',
          device_id: 'r1', adapter_id: 'manufacturer-default', binding_epoch: 5,
          action: 'check_medication', signed
        }];
      },
      async markFailed(actionId, details) { failures.push({ actionId, details }); return true; }
    }
  });
  assert.deepEqual(await gateway.recoverPendingCommands(), { recovered: 0 });
  assert.equal(bindingChecks, 0);
  assert.equal(failures[0].details.error_code, 'ACCOUNT_FENCED');
});

test('transient outbox recovery failure is retried instead of poisoning robot routing', async () => {
  let recoveries = 0;
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    outboxRepository: {
      async listPending() {
        recoveries += 1;
        if (recoveries === 1) throw new Error('temporary Dynamo failure');
        return [];
      },
      async enqueue(record) { return { duplicate: true, record }; }
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
    ...activeRobotOptions({ manufacturerDeviceId: 'manufacturer-robot-1' }),
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

test('privacy export uses the account outbox index instead of a table scan', async () => {
  const commands = [];
  const repository = createDynamoActionOutboxRepository({
    tableName: 'actions',
    userIndexName: 'user-index',
    client: {
      async send(command) {
        commands.push(command);
        if (command.constructor.name === 'QueryCommand') return { Items: [] };
        return {};
      }
    }
  });
  await repository.enqueue({
    action_id: '11111111-1111-4111-8111-111111111111',
    user_id: 'user-1',
    device_id: 'robot-1',
    device_type: 'home_robot',
    action: 'check_medication',
    adapter_id: 'jiangzhi-edge',
    binding_epoch: defaultBindingEpoch,
    signed: {},
    created_at: 1000
  });
  const put = commands[0].input.Item;
  assert.equal(put.user_index_pk, 'USER#user-1');
  assert.match(put.user_index_sk, /^ACTION#/);

  await repository.exportUserData('user-1');
  const query = commands[1];
  assert.equal(query.constructor.name, 'QueryCommand');
  assert.equal(query.input.IndexName, 'user-index');
  assert.equal(query.input.ExpressionAttributeValues[':userId'], 'USER#user-1');

  await repository.acknowledge('11111111-1111-4111-8111-111111111111', {
    ok: true,
    adapter_id: 'jiangzhi-edge',
    binding_epoch: defaultBindingEpoch
  });
  const update = commands[2];
  assert.equal(update.constructor.name, 'UpdateCommand');
  assert.match(update.input.ConditionExpression, /#expectedAdapterId = :expectedAdapterId/);
  assert.match(update.input.ConditionExpression, /#expectedBindingEpoch = :expectedBindingEpoch/);
  assert.equal(update.input.ExpressionAttributeValues[':expectedAdapterId'], 'jiangzhi-edge');
  assert.equal(update.input.ExpressionAttributeValues[':expectedBindingEpoch'], defaultBindingEpoch);
});

test('Dynamo pending-ACK transition observes an already-terminal callback race', async () => {
  const commands = [];
  const repository = createDynamoActionOutboxRepository({
    tableName: 'actions',
    client: {
      async send(command) {
        commands.push(command);
        if (command.constructor.name === 'UpdateCommand') {
          const error = new Error('conditional race');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
        if (command.constructor.name === 'GetCommand') {
          return { Item: { state: 'delivered', adapter_id: 'jiangzhi-edge' } };
        }
        return {};
      }
    }
  });
  assert.deepEqual(await repository.markPendingAck(
    '11111111-1111-4111-8111-111111111111',
    { ack_deadline: 20_000 }
  ), { state: 'delivered', adapter_id: 'jiangzhi-edge' });
  assert.deepEqual(commands.map((command) => command.constructor.name), ['UpdateCommand', 'GetCommand']);
  assert.equal(commands[1].input.ConsistentRead, true);
});

test('Dynamo duplicate enqueue returns the consistent existing fingerprint', async () => {
  const commands = [];
  const existing = {
    action_id: '11111111-1111-4111-8111-111111111111',
    request_fingerprint: 'fingerprint-existing'
  };
  const repository = createDynamoActionOutboxRepository({
    tableName: 'actions',
    client: {
      async send(command) {
        commands.push(command);
        if (command.constructor.name === 'PutCommand') {
          const error = new Error('duplicate');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
        if (command.constructor.name === 'GetCommand') return { Item: existing };
        return {};
      }
    }
  });
  assert.deepEqual(await repository.enqueue({
    action_id: existing.action_id,
    user_id: 'user-1',
    request_fingerprint: 'fingerprint-new',
    created_at: 1000
  }), { duplicate: true, record: existing });
  assert.deepEqual(commands.map((command) => command.constructor.name), ['PutCommand', 'GetCommand']);
  assert.equal(commands[1].input.ConsistentRead, true);
});

test('Dynamo fences pending actions with exact user, device, and binding conditions', async () => {
  const commands = [];
  const actionId = '11111111-1111-4111-8111-111111111111';
  let strongScanCount = 0;
  const repository = createDynamoActionOutboxRepository({
    tableName: 'actions',
    userIndexName: 'user-index',
    client: {
      async send(command) {
        commands.push(command);
        if (command.constructor.name === 'QueryCommand') {
          return { Items: [{
            action_id: actionId,
            device_id: 'robot-1',
            binding_epoch: 23,
            state: 'pending_ack'
          }] };
        }
        if (command.constructor.name === 'ScanCommand') {
          strongScanCount += 1;
          return strongScanCount === 1
            ? { Items: [{ action_id: actionId, state: 'pending_ack' }] }
            : { Items: [] };
        }
        if (command.constructor.name === 'UpdateCommand') return { Attributes: { state: 'failed' } };
        return {};
      }
    }
  });
  assert.deepEqual(
    await repository.failPendingForBinding('user-1', 'robot-1', 23),
    { failed: 1 }
  );
  assert.deepEqual(await repository.failPendingForUser('user-1'), { failed: 1 });
  const updates = commands.filter((command) => command.constructor.name === 'UpdateCommand');
  assert.match(updates[0].input.ConditionExpression, /#expectedBindingEpoch = :expectedBindingEpoch/);
  assert.match(updates[0].input.ConditionExpression, /#expectedUserId = :expectedUserId/);
  assert.match(updates[0].input.ConditionExpression, /#expectedDeviceId = :expectedDeviceId/);
  assert.equal(updates[0].input.ExpressionAttributeValues[':expectedBindingEpoch'], 23);
  assert.match(updates[1].input.ConditionExpression, /#expectedUserId = :expectedUserId/);
  const strongScans = commands.filter((command) => command.constructor.name === 'ScanCommand');
  assert.equal(strongScans.length, 2);
  assert.ok(strongScans.every((command) => command.input.ConsistentRead === true));
});

test('privacy fence and deletion see an action before its GSI entry becomes visible', async () => {
  const commands = [];
  const actionId = '11111111-1111-4111-8111-111111111111';
  let item = {
    PK: `ACTION#${actionId}`,
    SK: 'OUTBOX',
    action_id: actionId,
    state: 'queued'
  };
  const repository = createDynamoActionOutboxRepository({
    tableName: 'actions',
    userIndexName: 'user-index',
    client: {
      async send(command) {
        commands.push(command);
        if (command.constructor.name === 'QueryCommand') return { Items: [] };
        if (command.constructor.name === 'ScanCommand') {
          if (!item) return { Items: [] };
          return command.input.ProjectionExpression === 'PK, SK'
            ? { Items: [{ PK: item.PK, SK: item.SK }] }
            : { Items: [{ action_id: item.action_id, state: item.state }] };
        }
        if (command.constructor.name === 'UpdateCommand') {
          item = { ...item, state: 'failed' };
          return { Attributes: { ...item } };
        }
        if (command.constructor.name === 'BatchWriteCommand') {
          item = undefined;
          return {};
        }
        return {};
      }
    }
  });

  // Model an action that is already committed to the base table while the
  // account GSI still returns no records.
  assert.deepEqual(await repository.exportUserData('user-1'), []);
  assert.deepEqual(await repository.failPendingForUser('user-1'), { failed: 1 });
  assert.deepEqual(await repository.deleteUserData('user-1'), { deletedItems: 1 });

  const queryCommands = commands.filter((command) => command.constructor.name === 'QueryCommand');
  const scanCommands = commands.filter((command) => command.constructor.name === 'ScanCommand');
  assert.equal(queryCommands.length, 1);
  assert.equal(scanCommands.length, 4);
  assert.ok(scanCommands.every((command) => command.input.ConsistentRead === true));
  assert.equal(commands.filter((command) => command.constructor.name === 'BatchWriteCommand').length, 1);
});
