'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
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

function createMemoryOutbox(overrides = {}) {
  const records = new Map();
  const clone = (record) => record && { ...record };
  const transition = (actionId, state, allowed, details = {}) => {
    const record = records.get(actionId);
    if (!record || !allowed.includes(record.state)) return false;
    Object.assign(record, details, { state });
    return clone(record);
  };
  return {
    records,
    async listPending() { return []; },
    async getAction(actionId) { return clone(records.get(actionId)); },
    async enqueue(record) {
      if (records.has(record.action_id)) return { duplicate: true, record: clone(records.get(record.action_id)) };
      records.set(record.action_id, { ...record, state: 'queued' });
      return clone(records.get(record.action_id));
    },
    async markDelivering(actionId, details) {
      return transition(actionId, 'delivering', ['queued', 'delivering'], details);
    },
    async markPendingAck(actionId, details) {
      const result = transition(actionId, 'pending_ack', ['queued', 'delivering'], details);
      return result || clone(records.get(actionId));
    },
    async markDelivered(actionId, details) {
      return transition(actionId, 'delivered', ['queued', 'delivering', 'pending_ack'], details);
    },
    async markFailed(actionId, details) {
      return transition(actionId, 'failed', ['queued', 'delivering', 'pending_ack'], details);
    },
    async markQueuedFailed(actionId, details) {
      return transition(actionId, 'failed', ['queued'], details);
    },
    async acknowledge(actionId, details) {
      const record = records.get(actionId);
      if (!record || record.adapter_id !== details.adapter_id || record.binding_epoch !== details.binding_epoch) return false;
      return transition(actionId, details.ok ? 'delivered' : 'failed', ['queued', 'delivering', 'pending_ack'], details);
    },
    async expirePendingAck(actionId, details) {
      return transition(actionId, 'failed', ['pending_ack'], details);
    },
    ...overrides
  };
}

test('action validation enforces device/action compatibility', () => {
  assert.throws(() => validateAction({ action: 'check_medication', device_type: 'wearable', device_id: 'w1' }), /not allowed/);
  assert.equal(validateAction({ action: 'check_medication', device_type: 'home_robot', device_id: 'r1' }).device_id, 'r1');
  assert.equal(validateAction({ action: 'stop', device_type: 'wearable', device_id: 'w1' }).action, 'stop');
});

test('AI-native robot action schemas reject excess or malformed parameters', () => {
  assert.deepEqual(validateAction({
    action: 'emergency_stop', device_type: 'home_robot', device_id: 'r1'
  }).parameters, {});
  assert.throws(() => validateAction({
    action: 'emergency_stop', device_type: 'home_robot', device_id: 'r1', parameters: { reason: 'user' }
  }), /invalid/);
  assert.throws(() => validateAction({
    action: 'emergency_stop', device_type: 'wearable', device_id: 'w1'
  }), /not allowed/);
  assert.deepEqual(validateAction({
    action: 'navigate_to_location', device_type: 'home_robot', device_id: 'r1',
    parameters: { location_ref: 'bedroom-zone' }
  }).parameters, { location_ref: 'bedroom-zone' });
  assert.deepEqual(validateAction({
    action: 'start_two_way_call', device_type: 'home_robot', device_id: 'r1',
    parameters: { contact_id: 'caregiver-1' }
  }).parameters, { contact_id: 'caregiver-1' });
  assert.deepEqual(validateAction({
    action: 'share_camera_view', device_type: 'home_robot', device_id: 'r1',
    parameters: { session_id: 'scenario-1' }
  }).parameters, { session_id: 'scenario-1' });
  assert.deepEqual(validateAction({
    action: 'play_soothing_audio', device_type: 'home_robot', device_id: 'r1',
    parameters: { audio_id: 'guided-breathing', volume: 35 }
  }).parameters, { audio_id: 'guided-breathing', volume: 35 });
  assert.throws(() => validateAction({
    action: 'navigate_to_location', device_type: 'wearable', device_id: 'w1',
    parameters: { location_ref: 'bedroom-zone' }
  }), /not allowed/);
  assert.throws(() => validateAction({
    action: 'share_camera_view', device_type: 'home_robot', device_id: 'r1',
    parameters: { session_id: 'scenario-1', camera_password: 'unsafe' }
  }), /invalid/);
  assert.throws(() => validateAction({
    action: 'play_soothing_audio', device_type: 'home_robot', device_id: 'r1',
    parameters: { audio_id: 'guided-breathing', volume: 101 }
  }), /invalid/);
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

test('wearable cancellation removes its ACK listener and reports that an on-wire command is non-retractable', async () => {
  const controller = new AbortController();
  let listenerAdds = 0;
  let listenerRemoves = 0;
  const addEventListener = controller.signal.addEventListener.bind(controller.signal);
  const removeEventListener = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args) => { listenerAdds += 1; return addEventListener(...args); };
  controller.signal.removeEventListener = (...args) => { listenerRemoves += 1; return removeEventListener(...args); };
  const sent = [];
  const channel = { readyState: 1, send: (message) => sent.push(JSON.parse(message)) };
  const gateway = new ActionGateway({ signingPrivateKey: secret, wearableCommandPayloads });
  gateway.registerSession('user-1', channel, [{ device_id: 'w1', device_type: 'wearable', online: true }]);

  const pending = gateway.route('user-1', {
    action: 'emit_alarm', device_type: 'wearable', device_id: 'w1'
  }, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, (error) => (
    error.code === 'ACTION_CANCELLED' && error.nonRetractable === true
  ));
  assert.equal(sent.length, 1);
  assert.equal(gateway.pendingWearableAcks.size, 0);
  assert.equal(listenerAdds, 1);
  assert.equal(listenerRemoves, 1);
  assert.equal(gateway.acknowledgeWearable('user-1', channel, {
    action_id: sent[0].envelope.id, ok: true
  }), false);
});

test('robot outcome tracking resolves synchronous delivery and asynchronous ACK', async () => {
  const syncGateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    fetchImpl: async () => ({ ok: true, status: 200 })
  });
  syncGateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const delivered = await syncGateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1'
  });
  await syncGateway.waitForDeliveries();
  assert.deepEqual(await syncGateway.waitForActionOutcome('user-1', delivered.action_id), {
    status: 'delivered', action_id: delivered.action_id
  });

  const asyncGateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    fetchImpl: async () => ({ ok: true, status: 202 })
  });
  asyncGateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const accepted = await asyncGateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1'
  });
  await asyncGateway.waitForDeliveries();
  const outcome = asyncGateway.waitForActionOutcome('user-1', accepted.action_id);
  assert.equal(await acknowledgeRobot(asyncGateway, accepted.action_id), true);
  assert.deepEqual(await outcome, { status: 'delivered', action_id: accepted.action_id });
});

test('robot NACK and fixed-clock ACK expiry produce authoritative failures', async () => {
  const nacked = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    fetchImpl: async () => ({ ok: true, status: 202 }),
    logger: { error() {} }
  });
  nacked.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const rejected = await nacked.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1'
  });
  await nacked.waitForDeliveries();
  const rejectedOutcome = nacked.waitForActionOutcome('user-1', rejected.action_id);
  assert.equal(await acknowledgeRobot(nacked, rejected.action_id, {
    ok: false, error_code: 'MANUFACTURER_REJECTED'
  }), true);
  await assert.rejects(rejectedOutcome, (error) => error.code === 'MANUFACTURER_REJECTED' && error.statusCode === 502);

  const expired = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    fetchImpl: async () => ({ ok: true, status: 202 }),
    robotAckTimeoutMs: 10,
    now: () => 1,
    logger: { error() {} }
  });
  expired.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const timed = await expired.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1'
  });
  await expired.waitForDeliveries();
  const startedAt = performance.now();
  await assert.rejects(
    expired.waitForActionOutcome('user-1', timed.action_id, { timeoutMs: 100 }),
    (error) => error.code === 'ACK_TIMEOUT' && error.statusCode === 504
  );
  assert.ok(performance.now() - startedAt < 250);
});

test('manufacturer ACK error details are mapped to a server-owned privacy-safe category', async () => {
  const outboxRepository = createMemoryOutbox();
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    outboxRepository,
    fetchImpl: async () => ({ ok: true, status: 202 }),
    logger: { error() {} }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const accepted = await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1'
  });
  await gateway.waitForDeliveries();
  await acknowledgeRobot(gateway, accepted.action_id, {
    ok: false,
    error_code: 'serial_PERSONAL_IDENTIFIER_123'
  });
  assert.equal(outboxRepository.records.get(accepted.action_id).error_code, 'ROBOT_COMMAND_REJECTED');
  await assert.rejects(
    gateway.waitForActionOutcome('user-1', accepted.action_id),
    (error) => error.code === 'ROBOT_COMMAND_REJECTED'
  );
});

test('outcome reads are bounded even when durable storage hangs and deny cross-account access', async () => {
  const hanging = new ActionGateway({
    signingPrivateKey: secret,
    outboxRepository: { getAction: async () => new Promise(() => {}) }
  });
  const startedAt = performance.now();
  await assert.rejects(
    hanging.waitForActionOutcome('user-1', '11111111-1111-4111-8111-111111111111', { timeoutMs: 20 }),
    (error) => error.code === 'ACTION_OUTCOME_TIMEOUT'
  );
  assert.ok(performance.now() - startedAt < 150);

  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    fetchImpl: async () => ({ ok: true, status: 202 })
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const accepted = await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1'
  });
  await gateway.waitForDeliveries();
  await assert.rejects(
    gateway.waitForActionOutcome('user-2', accepted.action_id, { timeoutMs: 20 }),
    (error) => error.code === 'ACTION_NOT_FOUND' && error.statusCode === 404
  );
  await acknowledgeRobot(gateway, accepted.action_id);
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

test('routeMany dispatches wearable and robot actions independently when BLE is stalled', async () => {
  let robotPosted = false;
  const sent = [];
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    wearableCommandPayloads,
    manufacturerWebhookURL: 'https://manufacturer.example.test/hooks',
    manufacturerApiKey: 'key',
    fetchImpl: async () => {
      robotPosted = true;
      return { ok: true, status: 202 };
    }
  });
  const channel = { readyState: 1, send: (message) => sent.push(JSON.parse(message)) };
  gateway.registerSession('user-1', channel, [
    { device_id: 'w1', device_type: 'wearable', online: true },
    { device_id: 'r1', device_type: 'home_robot', online: true }
  ]);

  const pending = gateway.routeMany('user-1', [{
    action: 'emit_alarm', device_type: 'wearable', device_id: 'w1',
    idempotency_key: 'scenario_wearable_alarm'
  }, {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1',
    idempotency_key: 'scenario_robot_medication'
  }]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(robotPosted, true);
  assert.equal(sent.length, 1);
  assert.equal(gateway.acknowledgeWearable('user-1', channel, {
    action_id: sent[0].envelope.id,
    ok: true
  }), true);
  const result = await pending;
  await gateway.waitForDeliveries();
  assert.equal(result.mode, 'parallel');
  assert.deepEqual(result.results.map((entry) => entry.status), ['fulfilled', 'fulfilled']);
});

test('routeMany is bounded, idempotent, and preserves per-action failures', async () => {
  const sent = [];
  const gateway = new ActionGateway({ signingPrivateKey: secret, wearableCommandPayloads });
  const channel = { readyState: 1, send: (message) => sent.push(JSON.parse(message)) };
  gateway.registerSession('user-1', channel, [
    { device_id: 'w1', device_type: 'wearable', online: true },
    { device_id: 'r-offline', device_type: 'home_robot', online: false }
  ]);
  const pending = gateway.routeMany('user-1', [{
    action: 'stop', device_type: 'wearable', device_id: 'w1', idempotency_key: 'multi_stop_0000001'
  }, {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r-offline',
    idempotency_key: 'multi_medication_01'
  }]);
  gateway.acknowledgeWearable('user-1', channel, { action_id: sent[0].envelope.id, ok: true });
  const result = await pending;
  assert.deepEqual(result.results.map((entry) => entry.status), ['fulfilled', 'rejected']);
  assert.equal(result.results[1].status_code, 503);
  assert.equal(result.results[1].error_code, 'ACTION_FAILED');

  await assert.rejects(gateway.routeMany('user-1', []), (error) => error.statusCode === 400);
  await assert.rejects(gateway.routeMany('user-1', [{
    action: 'stop', device_type: 'wearable', device_id: 'w1'
  }]), /idempotency/);
  const duplicate = {
    action: 'stop', device_type: 'wearable', device_id: 'w1', idempotency_key: 'multi_duplicate_01'
  };
  await assert.rejects(gateway.routeMany('user-1', [duplicate, duplicate]), (error) => error.statusCode === 409);
  await assert.rejects(gateway.routeMany('user-1', [duplicate], { mode: 'unordered' }), /mode/);
});

test('ActionGateway delegates account-bound scenario lifecycle operations and fails closed when absent', async () => {
  const calls = [];
  const scenarioEngine = {
    async startScenario(userId, request) { calls.push(['start', userId, request]); return { accepted: true }; },
    async cancelScenario(userId, executionId) { calls.push(['cancel', userId, executionId]); return { state: 'cancelled' }; },
    async getExecution(userId, executionId) { calls.push(['get', userId, executionId]); return { state: 'running' }; }
  };
  const gateway = new ActionGateway({ signingPrivateKey: secret, scenarioEngine });
  assert.deepEqual(await gateway.startScenario('user-1', { scenarioId: 'fall_detection' }), { accepted: true });
  assert.deepEqual(await gateway.cancelScenario('user-1', 'execution-1'), { state: 'cancelled' });
  assert.deepEqual(await gateway.getScenarioExecution('user-1', 'execution-1'), { state: 'running' });
  assert.deepEqual(calls.map((entry) => entry.slice(0, 2)), [
    ['start', 'user-1'], ['cancel', 'user-1'], ['get', 'user-1']
  ]);

  const unavailable = new ActionGateway({ signingPrivateKey: secret });
  await assert.rejects(unavailable.startScenario('user-1', {}), (error) => (
    error.statusCode === 503 && error.code === 'SCENARIO_ENGINE_UNAVAILABLE'
  ));
  await assert.rejects(unavailable.cancelScenario('user-1', 'execution-1'), (error) => error.statusCode === 503);
  await assert.rejects(unavailable.getScenarioExecution('user-1', 'execution-1'), (error) => error.statusCode === 503);
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

test('account fencing rejects an in-flight wearable ACK wait as non-retractable', async () => {
  const sent = [];
  const channel = { readyState: 1, send: (message) => sent.push(JSON.parse(message)) };
  const gateway = new ActionGateway({ signingPrivateKey: secret, wearableCommandPayloads });
  gateway.registerSession('user-1', channel, [{ device_id: 'w1', device_type: 'wearable', online: true }]);
  const pending = gateway.route('user-1', {
    action: 'trigger_sos', device_type: 'wearable', device_id: 'w1'
  });
  await new Promise((resolve) => setImmediate(resolve));
  const fencing = gateway.fenceUserActions('user-1');
  await assert.rejects(pending, (error) => (
    error.code === 'ACCOUNT_FENCED' && error.nonRetractable === true
  ));
  assert.deepEqual(await fencing, { fenced: true, failedPending: 0, cancelledAcknowledgements: 1 });
  assert.equal(gateway.pendingWearableAcks.size, 0);
  assert.equal(gateway.acknowledgeWearable('user-1', channel, {
    action_id: sent[0].envelope.id, ok: true
  }), false);
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
  assert.deepEqual(await freshReplica.waitForActionOutcome(
    'user-1',
    '11111111-1111-4111-8111-111111111111'
  ), {
    status: 'delivered', action_id: '11111111-1111-4111-8111-111111111111'
  });
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

test('unexpected ACK cancellation and expiry failures are observed and redacted', async () => {
  const logs = [];
  const scheduled = [];
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    setTimeoutImpl(handler) {
      scheduled.push(handler);
      return { unref() {} };
    },
    clearTimeoutImpl() {},
    logger: {
      error(message, fields) { logs.push({ message, fields }); }
    }
  });
  const signed = signEnvelope({
    version: 2,
    action: 'check_medication',
    device_type: 'home_robot',
    device_id: 'r1',
    manufacturer_device_id: 'manufacturer-r1',
    adapter_id: 'manufacturer-default',
    binding_epoch: defaultBindingEpoch,
    contract_version: 'vl-robot-action/2',
    expires_at: Date.now() + 60_000,
    parameters: {}
  }, secret);
  const action = { device_id: 'r1' };
  const cancellation = new AbortController();

  gateway.cancelRobotAcknowledgement = async () => {
    throw Object.assign(new Error('serial-secret-should-not-be-logged'), {
      code: 'unsafe-code-with-secret'
    });
  };
  gateway.scheduleRobotAck(
    'user-1', action, signed, 'cancel-queue', 30_000, () => {}, cancellation.signal
  );
  cancellation.abort();
  await gateway.waitForDeliveries();

  gateway.expireRobotAcknowledgement = async () => {
    throw Object.assign(new Error('device-and-account-secret'), { code: 'OUTBOX_DOWN' });
  };
  gateway.scheduleRobotAck('user-1', action, signed, 'expire-queue', 30_000, () => {});
  scheduled.at(-1)();
  await gateway.waitForDeliveries();

  assert.equal(gateway.pendingDeliveries.size, 0);
  assert.deepEqual(logs, [
    {
      message: '[ActionGateway] Robot acknowledgement maintenance failed',
      fields: { operation: 'cancel', code: 'ACK_BACKGROUND_FAILED' }
    },
    {
      message: '[ActionGateway] Robot acknowledgement maintenance failed',
      fields: { operation: 'expire', code: 'ACK_BACKGROUND_FAILED' }
    }
  ]);
  assert.equal(JSON.stringify(logs).includes('secret'), false);
  gateway.cancelPendingRobotAcknowledgements(() => true);
});

test('unexpected ACK expiry failure retries without stranding its device barrier', async () => {
  const scheduled = [];
  const logs = [];
  let releaseCount = 0;
  let transitionCalls = 0;
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    setTimeoutImpl(handler) {
      const timer = { handler, cleared: false, unref() {} };
      scheduled.push(timer);
      return timer;
    },
    clearTimeoutImpl(timer) {
      if (timer) timer.cleared = true;
    },
    logger: {
      error(message, fields) { logs.push({ message, fields }); }
    }
  });
  const signed = signEnvelope({
    version: 2,
    action: 'check_medication',
    device_type: 'home_robot',
    device_id: 'r1',
    manufacturer_device_id: 'manufacturer-r1',
    adapter_id: 'manufacturer-default',
    binding_epoch: defaultBindingEpoch,
    contract_version: 'vl-robot-action/2',
    expires_at: Date.now() + 60_000,
    parameters: {}
  }, secret);
  gateway.transitionOutbox = async () => {
    transitionCalls += 1;
    if (transitionCalls === 1) {
      throw Object.assign(new Error('private-repository-detail'), { code: 'PRIVATE_DETAIL' });
    }
    return {
      action_id: signed.envelope.id,
      user_id: 'user-1',
      state: 'failed',
      error_code: 'ACK_TIMEOUT'
    };
  };
  gateway.scheduleRobotAck(
    'user-1',
    { device_id: 'r1' },
    signed,
    'expiry-retry-queue',
    1,
    () => { releaseCount += 1; }
  );

  scheduled[0].handler();
  await gateway.waitForDeliveries();
  assert.equal(gateway.pendingRobotAcks.has(signed.envelope.id), true);
  const retry = scheduled.find((timer, index) => index > 0 && !timer.cleared);
  assert.ok(retry);

  retry.handler();
  await gateway.waitForDeliveries();
  assert.equal(gateway.pendingRobotAcks.has(signed.envelope.id), false);
  assert.equal(releaseCount, 1);
  assert.equal(transitionCalls, 2);
  assert.equal(JSON.stringify(logs).includes('private-repository-detail'), false);
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

test('a durable terminal duplicate resolves before offline status gating', async () => {
  const outboxRepository = createMemoryOutbox();
  let fetches = 0;
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    outboxRepository,
    fetchImpl: async () => { fetches += 1; return { ok: true, status: 200 }; }
  });
  const channel = {};
  gateway.registerSession('user-1', channel, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const input = {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1',
    idempotency_key: 'offline-terminal-retry'
  };
  const first = await gateway.route('user-1', input);
  await gateway.waitForDeliveries();
  assert.deepEqual(await gateway.waitForActionOutcome('user-1', first.action_id), {
    status: 'delivered', action_id: first.action_id
  });
  gateway.updateSessionDevices('user-1', channel, [
    { device_id: 'r1', device_type: 'home_robot', online: false }
  ]);
  const duplicate = await gateway.route('user-1', input);
  assert.deepEqual(duplicate, {
    status: 'delivered', action_id: first.action_id, duplicate: true
  });
  assert.equal(fetches, 1);
});

test('queued robot cancellation never dispatches and is durably terminal', async () => {
  const outboxRepository = createMemoryOutbox();
  const delivered = [];
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    outboxRepository,
    fetchImpl: async (_url, options) => {
      delivered.push(JSON.parse(options.body).envelope.id);
      return { ok: true, status: 202 };
    },
    logger: { error() {} }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const first = await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1', idempotency_key: 'queue-blocker'
  });
  await gateway.waitForDeliveries();
  const controller = new AbortController();
  const cancelled = await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1', idempotency_key: 'queue-cancelled'
  }, { signal: controller.signal });
  controller.abort();
  assert.equal(await acknowledgeRobot(gateway, first.action_id), true);
  await gateway.waitForDeliveries();
  assert.deepEqual(delivered, [first.action_id]);
  assert.equal(outboxRepository.records.get(cancelled.action_id).state, 'failed');
  assert.equal(outboxRepository.records.get(cancelled.action_id).error_code, 'ACTION_CANCELLED');
  await assert.rejects(
    gateway.waitForActionOutcome('user-1', cancelled.action_id),
    (error) => error.code === 'ACTION_CANCELLED'
  );
});

test('aborting an on-wire robot transport records delivery as non-retractable', async () => {
  const outboxRepository = createMemoryOutbox();
  let requestSignal;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    requestTimeoutMs: 1_000,
    outboxRepository,
    fetchImpl: async (_url, options) => {
      requestSignal = options.signal;
      markStarted();
      return new Promise(() => {});
    },
    logger: { error() {} }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const controller = new AbortController();
  const accepted = await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1', idempotency_key: 'on-wire-cancel'
  }, { signal: controller.signal });
  await started;
  controller.abort();
  await gateway.waitForDeliveries();
  assert.equal(requestSignal.aborted, true);
  assert.equal(outboxRepository.records.get(accepted.action_id).error_code, 'ACTION_CANCELLED_NON_RETRACTABLE');
  await assert.rejects(
    gateway.waitForActionOutcome('user-1', accepted.action_id),
    (error) => error.code === 'ACTION_CANCELLED_NON_RETRACTABLE'
  );
});

test('account fence joins an underlying HAL transport that ignored AbortSignal', async () => {
  const outboxRepository = createMemoryOutbox({
    async failPendingForUser() { return { failed: 0 }; }
  });
  let releaseTransport;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const gateway = new ActionGateway({
    ...activeRobotOptions({ adapterId: 'jiangzhi-edge' }),
    signingPrivateKey: secret,
    outboxRepository,
    robotAdapterRuntime: {
      async deliverSignedAction(_adapterId, _signed, { onAttempt }) {
        await onAttempt(1);
        markStarted();
        await new Promise((resolve) => { releaseTransport = resolve; });
        return { ok: true, status: 200 };
      }
    },
    logger: { error() {} }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const controller = new AbortController();
  await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1', idempotency_key: 'hal-fence-join'
  }, { signal: controller.signal });
  await started;
  controller.abort();
  await gateway.waitForDeliveries();
  assert.equal(gateway.pendingRobotTransports.size, 1);

  let fenceSettled = false;
  const fence = gateway.fenceUserActions('user-1')
    .then((result) => { fenceSettled = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fenceSettled, false);
  releaseTransport();
  assert.equal((await fence).fenced, true);
  assert.equal(gateway.pendingRobotTransports.size, 0);
});

test('delivery transitions fail closed before send and before installing an ACK timer', async () => {
  const leaseOutbox = createMemoryOutbox({ async markDelivering() { return false; } });
  let leaseFetches = 0;
  const leaseGateway = new ActionGateway({
    ...activeRobotOptions(), signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test', manufacturerApiKey: 'key',
    outboxRepository: leaseOutbox,
    fetchImpl: async () => { leaseFetches += 1; return { ok: true, status: 200 }; },
    logger: { error() {} }
  });
  leaseGateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const lease = await leaseGateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1', idempotency_key: 'lost-lease'
  });
  await leaseGateway.waitForDeliveries();
  assert.equal(leaseFetches, 0);
  assert.equal(leaseOutbox.records.get(lease.action_id).state, 'queued');
  await assert.rejects(
    leaseGateway.waitForActionOutcome('user-1', lease.action_id, { timeoutMs: 20 }),
    (error) => error.code === 'ACTION_OUTCOME_TIMEOUT'
  );

  const events = [];
  const pendingOutbox = createMemoryOutbox({
    async markPendingAck() { events.push('pending-transition-rejected'); return false; }
  });
  const pendingGateway = new ActionGateway({
    ...activeRobotOptions(), signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test', manufacturerApiKey: 'key',
    outboxRepository: pendingOutbox,
    fetchImpl: async () => ({ ok: true, status: 202 }),
    setTimeoutImpl: (handler, ms) => { events.push('ack-timer-installed'); return setTimeout(handler, ms); },
    logger: { error() {} }
  });
  pendingGateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const pending = await pendingGateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1', idempotency_key: 'pending-transition-false'
  });
  await pendingGateway.waitForDeliveries();
  assert.deepEqual(events, ['pending-transition-rejected']);
  assert.equal(pendingGateway.pendingRobotAcks.size, 0);
  await assert.rejects(
    pendingGateway.waitForActionOutcome('user-1', pending.action_id),
    (error) => error.code === 'OUTBOX_PENDING_ACK_TRANSITION_FAILED'
  );
});

test('terminal transition races use the authoritative outbox result', async () => {
  const outboxRepository = createMemoryOutbox();
  outboxRepository.markDelivered = async (actionId, details) => {
    const record = outboxRepository.records.get(actionId);
    Object.assign(record, details, { state: 'delivered' });
    return false;
  };
  const notifications = [];
  const gateway = new ActionGateway({
    ...activeRobotOptions(), signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test', manufacturerApiKey: 'key',
    outboxRepository,
    fetchImpl: async () => ({ ok: true, status: 200 }),
    notifyUser: async (...args) => notifications.push(args),
    logger: { error() {} }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const accepted = await gateway.route('user-1', {
    action: 'check_medication', device_type: 'home_robot', device_id: 'r1', idempotency_key: 'terminal-race'
  });
  await gateway.waitForDeliveries();
  assert.deepEqual(await gateway.waitForActionOutcome('user-1', accepted.action_id), {
    status: 'delivered', action_id: accepted.action_id
  });
  assert.equal(notifications.length, 0);
});

test('camera readiness is present only for an explicit ACK bound to the requested opaque session', async () => {
  const outboxRepository = createMemoryOutbox();
  const gateway = new ActionGateway({
    ...activeRobotOptions(), signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test', manufacturerApiKey: 'key',
    outboxRepository,
    fetchImpl: async () => ({ ok: true, status: 202 })
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const generic = await gateway.route('user-1', {
    action: 'share_camera_view', device_type: 'home_robot', device_id: 'r1',
    idempotency_key: 'camera-generic', parameters: { session_id: 'opaque-session-1' }
  });
  await gateway.waitForDeliveries();
  await acknowledgeRobot(gateway, generic.action_id, { ok: true });
  assert.deepEqual(await gateway.waitForActionOutcome('user-1', generic.action_id), {
    status: 'delivered', action_id: generic.action_id
  });

  const ready = await gateway.route('user-1', {
    action: 'share_camera_view', device_type: 'home_robot', device_id: 'r1',
    idempotency_key: 'camera-ready', parameters: { session_id: 'opaque-session-2' }
  });
  await gateway.waitForDeliveries();
  await acknowledgeRobot(gateway, ready.action_id, {
    ok: true, camera_ready: true, camera_session_ref: 'opaque-session-2'
  });
  assert.deepEqual(await gateway.waitForActionOutcome('user-1', ready.action_id), {
    status: 'delivered', action_id: ready.action_id,
    camera_ready: true, camera_session_ref: 'opaque-session-2'
  });
  gateway.updateSessionDevices('user-1', null, [
    { device_id: 'r1', device_type: 'home_robot', online: false }
  ]);
  assert.deepEqual(await gateway.route('user-1', {
    action: 'share_camera_view', device_type: 'home_robot', device_id: 'r1',
    idempotency_key: 'camera-ready', parameters: { session_id: 'opaque-session-2' }
  }), {
    status: 'delivered', action_id: ready.action_id, duplicate: true,
    camera_ready: true, camera_session_ref: 'opaque-session-2'
  });
  gateway.updateSessionDevices('user-1', null, [
    { device_id: 'r1', device_type: 'home_robot', online: true }
  ]);

  const mismatched = await gateway.route('user-1', {
    action: 'share_camera_view', device_type: 'home_robot', device_id: 'r1',
    idempotency_key: 'camera-mismatch', parameters: { session_id: 'opaque-session-3' }
  });
  await gateway.waitForDeliveries();
  await acknowledgeRobot(gateway, mismatched.action_id, {
    ok: true, camera_ready: true, camera_session_ref: 'attacker-session'
  });
  assert.deepEqual(await gateway.waitForActionOutcome('user-1', mismatched.action_id), {
    status: 'delivered', action_id: mismatched.action_id
  });

  const freshReplica = new ActionGateway({ signingPrivateKey: secret, outboxRepository });
  assert.deepEqual(await freshReplica.waitForActionOutcome('user-1', ready.action_id), {
    status: 'delivered', action_id: ready.action_id,
    camera_ready: true, camera_session_ref: 'opaque-session-2'
  });
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

test('deferred durable recovery resumes after queue capacity drains', async () => {
  const makeSigned = (issuedAt) => signEnvelope({
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
  }, secret, () => issuedAt);
  const firstSigned = makeSigned(10_000);
  const secondSigned = makeSigned(10_001);
  const outboxRepository = createMemoryOutbox();
  for (const signed of [firstSigned, secondSigned]) {
    outboxRepository.records.set(signed.envelope.id, {
      state: 'queued',
      action_id: signed.envelope.id,
      user_id: 'user-1',
      device_id: 'r1',
      adapter_id: 'manufacturer-default',
      binding_epoch: defaultBindingEpoch,
      action: 'check_medication',
      signed
    });
  }
  outboxRepository.listPending = async () => [...outboxRepository.records.values()]
    .filter((record) => ['queued', 'delivering', 'pending_ack'].includes(record.state))
    .map((record) => ({ ...record }));
  const delivered = [];
  const gateway = new ActionGateway({
    ...activeRobotOptions(),
    signingPrivateKey: secret,
    manufacturerWebhookURL: 'https://manufacturer.example.test',
    manufacturerApiKey: 'key',
    now: () => 20_000,
    maxQueueDepthPerDevice: 1,
    outboxRepository,
    fetchImpl: async (_url, options) => {
      delivered.push(JSON.parse(options.body).envelope.id);
      return { ok: true, status: 202 };
    }
  });
  assert.deepEqual(await gateway.recoverPendingCommands(), { recovered: 1 });
  await gateway.waitForDeliveries();
  assert.deepEqual(delivered, [firstSigned.envelope.id]);
  assert.equal(await acknowledgeRobot(gateway, firstSigned.envelope.id), true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await gateway.waitForDeliveries();
  assert.deepEqual(delivered, [firstSigned.envelope.id, secondSigned.envelope.id]);
  assert.equal(await acknowledgeRobot(gateway, secondSigned.envelope.id), true);
});

test('two recovery workers cannot initialize or dispatch the same leased action', async () => {
  const signed = signEnvelope({
    version: 2,
    action: 'check_medication',
    device_type: 'home_robot',
    device_id: 'r1',
    manufacturer_device_id: 'manufacturer-r1',
    adapter_id: 'jiangzhi-edge',
    binding_epoch: defaultBindingEpoch,
    contract_version: 'vl-robot-action/2',
    expires_at: 70_000,
    parameters: {}
  }, secret, () => 10_000);
  const record = {
    state: 'queued', action_id: signed.envelope.id, user_id: 'user-1',
    device_id: 'r1', adapter_id: 'jiangzhi-edge', binding_epoch: defaultBindingEpoch,
    action: 'check_medication', signed
  };
  const outboxRepository = {
    async listPending() { return [{ ...record }]; },
    async getAction() { return { ...record }; },
    async markDelivering(_actionId, details) {
      if (record.state === 'queued') {
        Object.assign(record, details, { state: 'delivering' });
        return { ...record };
      }
      if (record.state === 'delivering' && record.lease_owner === details.lease_owner) {
        Object.assign(record, details);
        return { ...record };
      }
      return false;
    },
    async markPendingAck(_actionId, details) {
      if (record.state !== 'delivering' || record.lease_owner !== details.lease_owner) return false;
      Object.assign(record, details, { state: 'pending_ack' });
      return { ...record };
    },
    async markFailed(_actionId, details) {
      if (details.lease_owner && record.lease_owner !== details.lease_owner) return false;
      Object.assign(record, details, { state: 'failed' });
      return { ...record };
    },
    async acknowledge(_actionId, details) {
      if (record.state !== 'pending_ack') return false;
      Object.assign(record, details, { state: details.ok ? 'delivered' : 'failed' });
      return { ...record };
    }
  };
  let adapterInitializations = 0;
  const makeGateway = (deliveryWorkerId) => new ActionGateway({
    ...activeRobotOptions({ adapterId: 'jiangzhi-edge' }),
    signingPrivateKey: secret,
    deliveryWorkerId,
    now: () => 20_000,
    outboxRepository,
    robotAdapterRuntime: {
      async deliverSignedAction(_adapterId, _signed, { onAttempt }) {
        adapterInitializations += 1;
        await onAttempt(1);
        return { ok: true, status: 202 };
      }
    },
    logger: { error() {} }
  });
  const workerA = makeGateway('worker-a');
  const workerB = makeGateway('worker-b');
  await Promise.all([workerA.recoverPendingCommands(), workerB.recoverPendingCommands()]);
  await Promise.all([workerA.waitForDeliveries(), workerB.waitForDeliveries()]);
  assert.equal(adapterInitializations, 1);
  assert.ok(['worker-a', 'worker-b'].includes(record.lease_owner));
  const winner = record.lease_owner === 'worker-a' ? workerA : workerB;
  assert.equal(await acknowledgeRobot(winner, signed.envelope.id, { ok: true }, {
    adapterId: 'jiangzhi-edge'
  }), true);
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
      async enqueue(record) { return { duplicate: true, record: { ...record, state: 'pending_ack' } }; }
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

test('Dynamo delivery acquisition is an owner-bound lease through the action lifetime', async () => {
  const commands = [];
  const repository = createDynamoActionOutboxRepository({
    tableName: 'actions',
    client: {
      async send(command) {
        commands.push(command);
        return { Attributes: { state: 'delivering', lease_owner: 'worker-1' } };
      }
    }
  });
  assert.deepEqual(await repository.markDelivering(
    '11111111-1111-4111-8111-111111111111',
    {
      attempt: 1,
      lease_owner: 'worker-1',
      lease_now: 10_000,
      lease_expires_at: 70_000
    }
  ), { state: 'delivering', lease_owner: 'worker-1' });
  const lease = commands[0].input;
  assert.match(lease.ConditionExpression, /#state = :queued/);
  assert.match(lease.ConditionExpression, /#leaseOwner = :leaseOwner/);
  assert.match(lease.ConditionExpression, /#leaseExpiresAt < :leaseNow/);
  assert.equal(lease.ExpressionAttributeValues[':leaseOwner'], 'worker-1');
  assert.equal(lease.ExpressionAttributeValues[':leaseNow'], 10_000);

  await repository.markPendingAck('11111111-1111-4111-8111-111111111111', {
    ack_deadline: 80_000,
    lease_owner: 'worker-1'
  });
  assert.match(commands[1].input.ConditionExpression, /#expectedLeaseOwner = :expectedLeaseOwner/);
  assert.equal(commands[1].input.ExpressionAttributeValues[':expectedLeaseOwner'], 'worker-1');
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
