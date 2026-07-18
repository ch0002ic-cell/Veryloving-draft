'use strict';

process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { after, before, test } = require('node:test');
const { performance } = require('node:perf_hooks');
const { ActionGateway } = require('../../server/action-gateway.cjs');
const {
  createManufacturerPairingVerifier,
  createManufacturerRobotResetClient
} = require('../../server/manufacturer-client.cjs');
const { RobotAdapterRuntime } = require('../../server/robot-adapter-runtime.cjs');
const {
  BRIDGE_PREFIXES,
  CONTRACT_VERSION,
  PROTOCOL,
  RESET_CONTRACT,
  createManufacturerMockServer
} = require('./manufacturer-mock-server.js');

const NOW = 1_752_832_800_000;
const keyPair = crypto.generateKeyPairSync('ed25519');
const signingPrivateKey = keyPair.privateKey.export({ format: 'pem', type: 'pkcs8' });
const publicKey = keyPair.publicKey.export({ format: 'pem', type: 'spki' });
const adapters = Object.freeze({
  yongyida: {
    adapterId: 'living-room-cloud',
    apiKey: 'yongyida-server-key',
    deviceId: 'yongyida-device-001',
    sessionToken: 'yongyida-session-token',
    signedActionStatus: 202
  },
  jiangzhi: {
    adapterId: 'bedroom-edge',
    apiKey: 'jiangzhi-server-key',
    deviceId: 'jiangzhi-device-001',
    sessionToken: 'jiangzhi-session-token',
    signedActionStatus: 200
  }
});

let server;
let baseURL;

before(async () => {
  server = createManufacturerMockServer({
    adapters,
    publicKey,
    now: () => NOW,
    maxRequestBytes: 2 * 1024
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  baseURL = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

function signAction({
  vendor,
  id,
  issuedAt = NOW,
  expiresAt = NOW + 60_000,
  action = 'check_medication',
  parameters = {},
  adapterId,
  manufacturerDeviceId,
  bindingEpoch = 1,
  version = 2,
  contractVersion = CONTRACT_VERSION
}) {
  const adapter = adapters[vendor];
  const envelope = {
    version,
    id,
    issued_at: issuedAt,
    action,
    device_type: 'home_robot',
    device_id: `private-${vendor}-robot`,
    manufacturer_device_id: manufacturerDeviceId || adapter.deviceId,
    binding_epoch: bindingEpoch,
    adapter_id: adapterId || adapter.adapterId,
    contract_version: contractVersion,
    expires_at: expiresAt,
    parameters
  };
  const payload = Buffer.from(JSON.stringify(envelope)).toString('base64url');
  return {
    envelope,
    payload,
    signature: crypto.sign(null, Buffer.from(payload, 'ascii'), keyPair.privateKey).toString('base64url'),
    algorithm: 'Ed25519'
  };
}

async function bridgeRequest(vendor, endpoint, {
  body,
  apiKey = adapters[vendor].apiKey,
  sessionToken = adapters[vendor].sessionToken,
  idempotencyKey = `request-${vendor}-${endpoint.replaceAll('/', '-')}`,
  signal
} = {}) {
  const response = await fetch(`${baseURL}${BRIDGE_PREFIXES[vendor]}/${endpoint}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      ...(endpoint === 'lifecycle/reset' ? {
        'X-Manufacturer-Api-Key': apiKey,
        'X-Veryloving-Reset-Contract': RESET_CONTRACT
      } : {
        Authorization: `Bearer ${apiKey}`,
        'X-Veryloving-Adapter-Protocol': PROTOCOL,
        ...(endpoint === 'session' ? {} : { 'X-Veryloving-Session': sessionToken })
      })
    },
    body: typeof body === 'string' ? body : JSON.stringify(body || {}),
    signal
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { response, text, json };
}

async function initialize(vendor) {
  return bridgeRequest(vendor, 'session', {
    body: { schema_version: PROTOCOL, device_id: adapters[vendor].deviceId }
  });
}

test('both provisional bridges authenticate, expose telemetry, and execute each signed action once', async () => {
  for (const vendor of ['yongyida', 'jiangzhi']) {
    const initialized = await initialize(vendor);
    assert.equal(initialized.response.status, 200);
    assert.deepEqual(initialized.json, {
      authenticated: true,
      session_token: adapters[vendor].sessionToken
    });

    const status = await bridgeRequest(vendor, 'telemetry/status/query', {
      body: { device_id: adapters[vendor].deviceId }
    });
    assert.equal(status.response.status, 200);
    assert.equal(status.json.online, true);
    assert.equal(status.json.observed_at, new Date(NOW).toISOString());

    const vitals = await bridgeRequest(vendor, 'telemetry/vitals/query', {
      body: { device_id: adapters[vendor].deviceId }
    });
    assert.equal(vitals.response.status, 200);
    assert.equal(vitals.json.items[0].kind, 'heart_rate');
    assert.equal(vitals.json.items[0].quality, 'good');

    const snapshot = await bridgeRequest(vendor, 'telemetry/snapshot/query', {
      body: { device_id: adapters[vendor].deviceId }
    });
    assert.equal(snapshot.response.status, 200);
    assert.equal(snapshot.json.status.observed_at, new Date(NOW).toISOString());
    assert.equal(snapshot.json.battery.observed_at, new Date(NOW).toISOString());
    assert.equal(snapshot.json.vitals[0].observed_at, new Date(NOW).toISOString());
    assert.equal(snapshot.json.location.captured_at, NOW);
    assert.equal(snapshot.json.navigation_path.captured_at, NOW);
    assert.equal(snapshot.json.navigation_path.points.length, 2);
    assert.equal(snapshot.json.indoor_position.captured_at, NOW);
    assert.equal(snapshot.json.safety_events[0].occurred_at, NOW - 1_000);
    assert.equal(snapshot.json.medication_acknowledgements[0].delivered_at, NOW - 500);
  }

  const cloudAction = signAction({
    vendor: 'yongyida',
    id: '11111111-1111-4111-8111-111111111111',
    parameters: { medication_id: 'morning-dose' }
  });
  const cloudFirst = await bridgeRequest('yongyida', 'signed-actions', {
    body: cloudAction,
    idempotencyKey: cloudAction.envelope.id
  });
  const cloudDuplicate = await bridgeRequest('yongyida', 'signed-actions', {
    body: cloudAction,
    idempotencyKey: cloudAction.envelope.id
  });
  assert.equal(cloudFirst.response.status, 202);
  assert.equal(cloudFirst.json.state, 'accepted');
  assert.equal(cloudFirst.json.ok, true);
  assert.equal(cloudFirst.json.duplicate, false);
  assert.equal(cloudDuplicate.response.status, 202);
  assert.equal(cloudDuplicate.json.duplicate, true);
  assert.equal(server.getExecutions({ vendor: 'yongyida', endpoint: 'signed-actions' }).length, 1);

  const edgeAction = signAction({
    vendor: 'jiangzhi',
    id: '22222222-2222-4222-8222-222222222222',
    action: 'cognitive_engagement',
    parameters: { activity: 'conversation' }
  });
  const edgeResult = await bridgeRequest('jiangzhi', 'signed-actions', {
    body: edgeAction,
    idempotencyKey: edgeAction.envelope.id
  });
  assert.equal(edgeResult.response.status, 200);
  assert.equal(edgeResult.json.state, 'completed');
  assert.equal(edgeResult.json.ok, true);
  assert.equal(server.getExecutions({ vendor: 'jiangzhi', endpoint: 'signed-actions' }).length, 1);
});

test('signature, expiry, adapter binding, request bounds, and idempotency conflicts fail closed', async () => {
  const unauthorized = await bridgeRequest('yongyida', 'telemetry/status/query', {
    apiKey: 'wrong-but-long-key',
    body: { device_id: adapters.yongyida.deviceId }
  });
  assert.equal(unauthorized.response.status, 401);

  const malformedRequest = await bridgeRequest('yongyida', 'session', { body: '{"broken":' });
  assert.equal(malformedRequest.response.status, 400);
  assert.equal(malformedRequest.json.error, 'INVALID_JSON');

  const expired = signAction({
    vendor: 'yongyida',
    id: '33333333-3333-4333-8333-333333333333',
    issuedAt: NOW - 120_000,
    expiresAt: NOW - 1
  });
  const expiredResult = await bridgeRequest('yongyida', 'signed-actions', {
    body: expired,
    idempotencyKey: expired.envelope.id
  });
  assert.equal(expiredResult.response.status, 410);
  assert.equal(expiredResult.json.error, 'SIGNED_ACTION_EXPIRED');

  const signed = signAction({
    vendor: 'yongyida',
    id: '44444444-4444-4444-8444-444444444444'
  });
  const tampered = {
    ...signed,
    envelope: { ...signed.envelope, parameters: { attacker: true } }
  };
  const tamperedResult = await bridgeRequest('yongyida', 'signed-actions', {
    body: tampered,
    idempotencyKey: signed.envelope.id
  });
  assert.equal(tamperedResult.response.status, 401);
  assert.equal(tamperedResult.json.error, 'SIGNED_ACTION_UNVERIFIED');

  const wrongAdapter = signAction({
    vendor: 'yongyida',
    id: '55555555-5555-4555-8555-555555555555',
    adapterId: adapters.jiangzhi.adapterId
  });
  const wrongAdapterResult = await bridgeRequest('yongyida', 'signed-actions', {
    body: wrongAdapter,
    idempotencyKey: wrongAdapter.envelope.id
  });
  assert.equal(wrongAdapterResult.response.status, 400);
  assert.equal(wrongAdapterResult.json.error, 'SIGNED_ACTION_CONTRACT_INVALID');

  const legacyContract = signAction({
    vendor: 'yongyida',
    id: '66666666-6666-4666-8666-666666666666',
    version: 1,
    contractVersion: 'vl-robot-action/1'
  });
  const legacyContractResult = await bridgeRequest('yongyida', 'signed-actions', {
    body: legacyContract,
    idempotencyKey: legacyContract.envelope.id
  });
  assert.equal(legacyContractResult.response.status, 400);
  assert.equal(legacyContractResult.json.error, 'SIGNED_ACTION_CONTRACT_INVALID');

  const first = await bridgeRequest('yongyida', 'signed-actions', {
    body: signed,
    idempotencyKey: signed.envelope.id
  });
  assert.equal(first.response.status, 202);
  const conflicting = signAction({
    vendor: 'yongyida',
    id: signed.envelope.id,
    action: 'cognitive_engagement',
    parameters: { activity: 'music' }
  });
  const conflict = await bridgeRequest('yongyida', 'signed-actions', {
    body: conflicting,
    idempotencyKey: signed.envelope.id
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.json.error, 'IDEMPOTENCY_CONFLICT');
  assert.equal(
    server.getExecutions({ vendor: 'yongyida', endpoint: 'signed-actions' })
      .filter((entry) => entry.actionId === signed.envelope.id).length,
    1
  );

  const oversized = await bridgeRequest('jiangzhi', 'commands', {
    body: {
      schema_version: PROTOCOL,
      device_id: adapters.jiangzhi.deviceId,
      command: 'vl.edge.configuration.apply',
      parameters: { padding: 'x'.repeat(3 * 1024) }
    }
  });
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.json.error, 'REQUEST_TOO_LARGE');
});

test('fault controls deterministically simulate auth, 500, timeout, malformed, and oversized responses', async () => {
  const statusBody = { device_id: adapters.jiangzhi.deviceId };

  server.enqueueBehavior('jiangzhi', 'telemetry/status/query', { type: 'auth' });
  assert.equal((await bridgeRequest('jiangzhi', 'telemetry/status/query', { body: statusBody })).response.status, 401);

  server.enqueueBehavior('jiangzhi', 'telemetry/status/query', { type: 'http_error', statusCode: 500 });
  assert.equal((await bridgeRequest('jiangzhi', 'telemetry/status/query', { body: statusBody })).response.status, 500);

  server.enqueueBehavior('jiangzhi', 'telemetry/status/query', { type: 'malformed' });
  const malformed = await bridgeRequest('jiangzhi', 'telemetry/status/query', { body: statusBody });
  assert.equal(malformed.response.status, 200);
  assert.equal(malformed.json, null);
  assert.match(malformed.text, /malformed/);

  server.enqueueBehavior('jiangzhi', 'telemetry/status/query', { type: 'oversize', bytes: 8 * 1024 });
  const oversized = await bridgeRequest('jiangzhi', 'telemetry/status/query', { body: statusBody });
  assert.equal(oversized.response.status, 200);
  assert.equal(Buffer.byteLength(oversized.text), 8 * 1024);

  server.enqueueBehavior('jiangzhi', 'telemetry/status/query', { type: 'timeout', delayMs: 80 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10);
  await assert.rejects(
    bridgeRequest('jiangzhi', 'telemetry/status/query', { body: statusBody, signal: controller.signal }),
    (error) => error?.name === 'AbortError'
  );
  clearTimeout(timer);
});

test('ActionGateway routes simultaneous vendors through the compiled HAL and mocked outbox acceptance p95 stays below 250ms', async () => {
  const runtime = new RobotAdapterRuntime({
    configurations: [
      {
        vendor: 'yongyida', adapterId: adapters.yongyida.adapterId, baseUrl: baseURL,
        apiKey: adapters.yongyida.apiKey, callbackApiKey: 'yongyida-callback-key',
        pairingVerifyURL: `${baseURL}${BRIDGE_PREFIXES.yongyida}/pairing/verify`,
        allowInsecureHttp: true, timeoutMs: 1000, maxAttempts: 2
      },
      {
        vendor: 'jiangzhi', adapterId: adapters.jiangzhi.adapterId, baseUrl: baseURL,
        apiKey: adapters.jiangzhi.apiKey, callbackApiKey: 'jiangzhi-callback-key',
        pairingVerifyURL: `${baseURL}${BRIDGE_PREFIXES.jiangzhi}/pairing/verify`,
        allowInsecureHttp: true, timeoutMs: 1000, maxAttempts: 2
      }
    ],
    now: () => NOW,
    logger: { info() {}, warn() {}, error() {} }
  });
  const pairing = await runtime.verifyPairingCode('jiangzhi', server.getAdapter('jiangzhi').pairingCode);
  assert.equal(pairing.adapterId, adapters.jiangzhi.adapterId);
  assert.equal(pairing.manufacturerDeviceId, adapters.jiangzhi.deviceId);
  assert.equal(pairing.oneTime, true);
  const telemetry = await runtime.getTelemetrySnapshot(
    adapters.jiangzhi.adapterId,
    adapters.jiangzhi.deviceId
  );
  assert.deepEqual(telemetry, {
    online: true,
    hardware_status: 'online',
    reported_at: NOW,
    firmware_version: 'jzkh-edge-test',
    battery: { percentage: 81, charging: true, observed_at: NOW },
    vitals: [{ kind: 'heart_rate', value: 72, unit: 'bpm', observed_at: NOW, quality: 'good' }],
    location: { longitude: 103.8521, latitude: 1.2904 },
    navigation_path: [[103.8519, 1.2902], [103.8521, 1.2904]],
    indoor_position: {
      map_id: 'integration-home-map', floor_id: 'floor-1', room_id: 'bedroom',
      x_m: 4.25, y_m: 2.75, confidence: 0.95, captured_at: NOW
    },
    safety_events: [{
      event_type: 'fall', event_id: 'jiangzhi-fall-event-0001',
      occurred_at: NOW - 1_000, confidence: 0.9
    }],
    medication_acknowledgements: [{
      reminder_id: 'jiangzhi-reminder-0001', receipt_id: 'jiangzhi-receipt-0001',
      delivered_at: NOW - 500
    }]
  });
  const bindings = {
    'private-cloud': {
      adapterId: adapters.yongyida.adapterId,
      manufacturerDeviceId: adapters.yongyida.deviceId,
      bindingEpoch: 1,
      lifecycleState: 'active'
    },
    'private-edge': {
      adapterId: adapters.jiangzhi.adapterId,
      manufacturerDeviceId: adapters.jiangzhi.deviceId,
      bindingEpoch: 1,
      lifecycleState: 'active'
    }
  };
  const outboxRecords = new Map();
  const outboxRepository = {
    async listPending() { return []; },
    async enqueue(record) {
      if (outboxRecords.has(record.action_id)) return false;
      outboxRecords.set(record.action_id, { ...record, state: 'pending' });
      return true;
    },
    async markDelivering(actionId) {
      const record = outboxRecords.get(actionId);
      if (!record) return false;
      record.state = 'delivering';
      return true;
    },
    async markPendingAck(actionId) {
      const record = outboxRecords.get(actionId);
      if (!record) return false;
      record.state = 'pending_ack';
      return true;
    },
    async markDelivered(actionId) {
      const record = outboxRecords.get(actionId);
      if (!record) return false;
      record.state = 'delivered';
      return true;
    },
    async markFailed(actionId) {
      const record = outboxRecords.get(actionId);
      if (!record) return false;
      record.state = 'failed';
      return true;
    },
    async acknowledge(actionId, details) {
      const record = outboxRecords.get(actionId);
      if (!record || record.adapter_id !== details.adapter_id) return false;
      record.state = details.ok ? 'delivered' : 'failed';
      return true;
    }
  };
  const gateway = new ActionGateway({
    signingPrivateKey,
    robotAdapterRuntime: runtime,
    resolveRobotBinding: async (_userId, deviceId) => bindings[deviceId],
    outboxRepository,
    now: () => NOW,
    logger: { info() {}, warn() {}, error() {} }
  });
  gateway.registerSession('integration-user', null, [
    { device_id: 'private-cloud', device_type: 'home_robot', online: true },
    { device_id: 'private-edge', device_type: 'home_robot', online: true }
  ]);

  const startedAt = performance.now();
  const [cloudAccepted, edgeAccepted] = await Promise.all([
    gateway.route('integration-user', {
      action: 'check_medication', device_type: 'home_robot', device_id: 'private-cloud',
      parameters: { medication_id: 'morning-dose' }, idempotency_key: 'integration-cloud-action'
    }),
    gateway.route('integration-user', {
      action: 'cognitive_engagement', device_type: 'home_robot', device_id: 'private-edge',
      parameters: { activity: 'conversation' }, idempotency_key: 'integration-edge-action'
    })
  ]);
  const parallelAcceptanceMs = performance.now() - startedAt;
  assert.equal(cloudAccepted.status, 'accepted');
  assert.equal(edgeAccepted.status, 'accepted');
  assert.equal(outboxRecords.has(cloudAccepted.action_id), true);
  assert.equal(outboxRecords.has(edgeAccepted.action_id), true);
  assert.ok(parallelAcceptanceMs < 250, `mocked outbox acceptance took ${parallelAcceptanceMs}ms`);

  const bothDelivered = () => (
    server.getExecutions({ vendor: 'yongyida', endpoint: 'signed-actions' })
      .some((entry) => entry.actionId === cloudAccepted.action_id)
    && server.getExecutions({ vendor: 'jiangzhi', endpoint: 'signed-actions' })
      .some((entry) => entry.actionId === edgeAccepted.action_id)
  );
  for (let attempt = 0; attempt < 100 && !bothDelivered(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.ok(server.getExecutions({ vendor: 'yongyida', endpoint: 'signed-actions' })
    .some((entry) => entry.actionId === cloudAccepted.action_id));
  assert.ok(server.getExecutions({ vendor: 'jiangzhi', endpoint: 'signed-actions' })
    .some((entry) => entry.actionId === edgeAccepted.action_id));
  assert.equal(await gateway.acknowledgeRobot(cloudAccepted.action_id, { ok: true }, {
    adapterId: adapters.yongyida.adapterId,
    bindingEpoch: 1
  }), true);
  await gateway.waitForDeliveries();

  const acceptanceSamples = [];
  for (let index = 0; index < 25; index += 1) {
    const sampleStart = performance.now();
    const accepted = await gateway.route('integration-user', {
      action: 'cognitive_engagement', device_type: 'home_robot', device_id: 'private-edge',
      parameters: { activity: index % 2 ? 'music' : 'memory_game' },
      idempotency_key: `latency-sample-${index}`
    });
    acceptanceSamples.push(performance.now() - sampleStart);
    assert.equal(accepted.status, 'accepted');
    await gateway.waitForDeliveries();
  }
  acceptanceSamples.sort((left, right) => left - right);
  const p95 = acceptanceSamples[Math.ceil(acceptanceSamples.length * 0.95) - 1];
  assert.ok(p95 < 250, `mocked acceptance p95 was ${p95}ms`);
});

test('one-time pairing verification replays a stable receipt after response loss and rejects another claim identity', async () => {
  const pairingURL = `${baseURL}${BRIDGE_PREFIXES.yongyida}/pairing/verify`;
  const verifier = createManufacturerPairingVerifier({
    url: pairingURL,
    apiKey: adapters.yongyida.apiKey,
    adapterId: adapters.yongyida.adapterId,
    idempotencySecret: 'stable-pairing-idempotency-secret',
    timeoutMs: 10
  });
  server.enqueueBehavior('yongyida', 'pairing/verify', { type: 'timeout', delayMs: 50 });
  await assert.rejects(
    verifier(server.getAdapter('yongyida').pairingCode),
    (error) => error?.code === 'MANUFACTURER_TIMEOUT'
  );

  const recovered = await verifier(server.getAdapter('yongyida').pairingCode);
  assert.equal(recovered.manufacturerDeviceId, adapters.yongyida.deviceId);
  assert.equal(recovered.oneTime, true);

  const differentClaimIdentity = createManufacturerPairingVerifier({
    url: pairingURL,
    apiKey: adapters.yongyida.apiKey,
    adapterId: adapters.yongyida.adapterId,
    idempotencySecret: 'different-pairing-idempotency-secret',
    timeoutMs: 1000
  });
  await assert.rejects(
    differentClaimIdentity(server.getAdapter('yongyida').pairingCode),
    (error) => error?.statusCode === 410 && error?.code === 'ROBOT_PAIRING_REPLAY'
  );
});

test('correlated reset completion fences every action from the revoked binding epoch', async () => {
  const resetId = 'reset-integration-epoch-9';
  const reset = createManufacturerRobotResetClient({
    url: `${baseURL}${BRIDGE_PREFIXES.yongyida}/lifecycle/reset`,
    apiKey: adapters.yongyida.apiKey,
    timeoutMs: 1000
  });
  const request = {
    resetId,
    manufacturerDeviceId: adapters.yongyida.deviceId,
    bindingEpoch: 9
  };

  assert.equal(await reset(request), true);
  assert.equal(await reset(request), true);
  assert.equal(server.getRevokedThroughEpoch('yongyida'), 9);
  assert.equal(
    server.getExecutions({ vendor: 'yongyida', endpoint: 'lifecycle/reset' }).length,
    1
  );

  const revoked = signAction({
    vendor: 'yongyida',
    id: '77777777-7777-4777-8777-777777777777',
    bindingEpoch: 9
  });
  const revokedResult = await bridgeRequest('yongyida', 'signed-actions', {
    body: revoked,
    idempotencyKey: revoked.envelope.id
  });
  assert.equal(revokedResult.response.status, 410);
  assert.equal(revokedResult.json.error, 'SIGNED_ACTION_BINDING_REVOKED');

  const rebound = signAction({
    vendor: 'yongyida',
    id: '88888888-8888-4888-8888-888888888888',
    bindingEpoch: 10
  });
  const reboundResult = await bridgeRequest('yongyida', 'signed-actions', {
    body: rebound,
    idempotencyKey: rebound.envelope.id
  });
  assert.equal(reboundResult.response.status, 202);
  assert.equal(reboundResult.json.ok, true);

  const newest = signAction({
    vendor: 'yongyida',
    id: '99999999-9999-4999-8999-999999999999',
    bindingEpoch: 11
  });
  const newestResult = await bridgeRequest('yongyida', 'signed-actions', {
    body: newest,
    idempotencyKey: newest.envelope.id
  });
  assert.equal(newestResult.response.status, 202);
  assert.equal(server.getNewestAcceptedEpoch('yongyida'), 11);

  const delayedPriorBinding = signAction({
    vendor: 'yongyida',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    bindingEpoch: 10
  });
  const delayedPriorBindingResult = await bridgeRequest('yongyida', 'signed-actions', {
    body: delayedPriorBinding,
    idempotencyKey: delayedPriorBinding.envelope.id
  });
  assert.equal(delayedPriorBindingResult.response.status, 410);
  assert.equal(delayedPriorBindingResult.json.error, 'SIGNED_ACTION_BINDING_SUPERSEDED');

  const staleReset = await bridgeRequest('yongyida', 'lifecycle/reset', {
    idempotencyKey: 'reset-stale-binding-epoch-10',
    body: {
      contract_version: 'vl-robot-reset/1',
      reset_id: 'reset-stale-binding-epoch-10',
      robot_id: adapters.yongyida.deviceId,
      binding_epoch: 10,
      erase_user_data: true
    }
  });
  assert.equal(staleReset.response.status, 409);
  assert.equal(staleReset.json.error, 'RESET_BINDING_SUPERSEDED');

  const conflict = await bridgeRequest('yongyida', 'lifecycle/reset', {
    idempotencyKey: resetId,
    body: {
      contract_version: 'vl-robot-reset/1',
      reset_id: resetId,
      robot_id: adapters.yongyida.deviceId,
      binding_epoch: 10,
      erase_user_data: true
    }
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.json.error, 'IDEMPOTENCY_CONFLICT');
});

test('bridge rejects a delayed action after observing a newer binding generation', async () => {
  const current = signAction({
    vendor: 'jiangzhi',
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    bindingEpoch: 3
  });
  const currentResult = await bridgeRequest('jiangzhi', 'signed-actions', {
    body: current,
    idempotencyKey: current.envelope.id
  });
  assert.equal(currentResult.response.status, 200);
  assert.equal(server.getNewestAcceptedEpoch('jiangzhi'), 3);

  const delayed = signAction({
    vendor: 'jiangzhi',
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    bindingEpoch: 2
  });
  const delayedResult = await bridgeRequest('jiangzhi', 'signed-actions', {
    body: delayed,
    idempotencyKey: delayed.envelope.id
  });
  assert.equal(delayedResult.response.status, 410);
  assert.equal(delayedResult.json.error, 'SIGNED_ACTION_BINDING_SUPERSEDED');
});
