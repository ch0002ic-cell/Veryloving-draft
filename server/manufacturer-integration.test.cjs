'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ActionGateway, signEnvelope } = require('./action-gateway.cjs');
const {
  createManufacturerPrivacyRepository,
  createManufacturerPairingVerifier,
  createManufacturerRobotResetClient,
  createManufacturerRobotStatusClient,
  normalizeIndoorPosition
} = require('./manufacturer-client.cjs');
const { createManufacturerMockServer } = require('../tests/integration/manufacturer-mock-server.js');

test('manufacturer mock receives the signed production webhook contract', async (t) => {
  const signingPrivateKey = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
  const server = createManufacturerMockServer({ apiKey: 'integration-test-key' });
  t.after(() => server.close());
  const requestHandler = server.listeners('request')[0];
  const fetchImpl = async (url, options) => new Promise((resolve) => {
    const parsed = new URL(url);
    const req = { method: options.method, url: parsed.pathname, headers: { 'x-manufacturer-api-key': options.headers['X-Manufacturer-Api-Key'] } };
    const res = {
      statusCode: 200,
      writeHead(statusCode) { this.statusCode = statusCode; return this; },
      end() { resolve({ ok: this.statusCode >= 200 && this.statusCode < 300, status: this.statusCode }); }
    };
    requestHandler(req, res);
  });
  const gateway = new ActionGateway({
    signingPrivateKey,
    manufacturerWebhookURL: 'http://manufacturer.test/v1/manufacturer/robot/command',
    manufacturerApiKey: 'integration-test-key',
    fetchImpl
  });
  const result = await gateway.deliverRobot(signEnvelope({
    action: 'check_medication',
    device_type: 'home_robot',
    device_id: 'r1',
    manufacturer_device_id: 'manufacturer-r1',
    parameters: {}
  }, signingPrivateKey));
  assert.equal(result.status, 202);
});

test('manufacturer status bounds navigation paths and reset keeps its API key server-side', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/status')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            online: true,
            reported_at: 1000,
            navigation_path: [[103.8, 1.3], { longitude: 103.81, latitude: 1.31 }, [999, 999]],
            safety_events: [{ event_type: 'fall_detected', event_id: 'robot-fall-0001', occurred_at: 999, confidence: 0.9 }],
            medication_acknowledgements: [
              { reminder_id: 'med-reminder-0001', receipt_id: 'manufacturer-delivery-0001', delivered_at: 999 },
              { reminder_id: '../invalid', receipt_id: 'manufacturer-delivery-0002', delivered_at: 999 }
            ],
            indoor_position: {
              map_id: 'home-map-1',
              floor_id: 'floor-1',
              room_id: 'bedroom',
              x_m: 4.25,
              y_m: 2.5,
              confidence: 0.92,
              captured_at: 998,
              raw_camera_frame: 'must-not-pass-through'
            }
          };
        }
      };
    }
    return { ok: true, status: 204 };
  };
  const statusClient = createManufacturerRobotStatusClient({ url: 'https://manufacturer.test/status', apiKey: 'private-key', fetchImpl });
  const status = await statusClient('manufacturer-1');
  assert.deepEqual(status.navigation_path, [[103.8, 1.3], [103.81, 1.31]]);
  assert.deepEqual(status.safety_events, [{ event_type: 'fall', event_id: 'robot-fall-0001', occurred_at: 999, confidence: 0.9 }]);
  assert.deepEqual(status.medication_acknowledgements, [{
    reminder_id: 'med-reminder-0001',
    receipt_id: 'manufacturer-delivery-0001',
    delivered_at: 999
  }]);
  assert.deepEqual(status.indoor_position, {
    map_id: 'home-map-1',
    floor_id: 'floor-1',
    room_id: 'bedroom',
    x_m: 4.25,
    y_m: 2.5,
    confidence: 0.92,
    captured_at: 998
  });
  const resetClient = createManufacturerRobotResetClient({ url: 'https://manufacturer.test/reset', apiKey: 'private-key', fetchImpl });
  assert.equal(await resetClient('manufacturer-1'), true);
  assert.equal(calls[1].options.headers['X-Manufacturer-Api-Key'], 'private-key');
  assert.deepEqual(JSON.parse(calls[1].options.body), { robot_id: 'manufacturer-1', erase_user_data: true });
});

test('manufacturer privacy sends only bound robot identifiers and requires completed deletion', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/delete')
      ? { ok: true, status: 204, async text() { return ''; } }
      : { ok: true, status: 200, async text() { return JSON.stringify({ robots: [{ status: 'erased' }] }); } };
  };
  const repository = createManufacturerPrivacyRepository({
    exportURL: 'https://manufacturer.test/privacy/export',
    deleteURL: 'https://manufacturer.test/privacy/delete',
    apiKey: 'server-only-key',
    listManufacturerDeviceIds: async (userId) => {
      assert.equal(userId, 'user-private');
      return ['manufacturer-r1'];
    },
    fetchImpl
  });

  assert.deepEqual(await repository.exportUserData('user-private'), { robots: [{ status: 'erased' }] });
  assert.deepEqual(await repository.deleteUserData('user-private'), { deleted: 1 });
  assert.deepEqual(calls.map(({ options }) => JSON.parse(options.body)), [
    { robot_ids: ['manufacturer-r1'] },
    { robot_ids: ['manufacturer-r1'] }
  ]);
  assert.ok(calls.every(({ options }) => options.headers['X-Manufacturer-Api-Key'] === 'server-only-key'));
  assert.doesNotMatch(JSON.stringify(calls), /user-private/);
});

test('manufacturer privacy does not treat an asynchronous deletion receipt as erasure', async () => {
  const repository = createManufacturerPrivacyRepository({
    exportURL: 'https://manufacturer.test/privacy/export',
    deleteURL: 'https://manufacturer.test/privacy/delete',
    apiKey: 'server-only-key',
    listManufacturerDeviceIds: async () => ['manufacturer-r1'],
    fetchImpl: async () => ({ ok: true, status: 202, async text() { return ''; } })
  });
  await assert.rejects(repository.deleteUserData('user-private'), /returned 202/);
});

test('manufacturer reset and privacy deletion require explicit synchronous completion', async () => {
  const completedResponse = () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ completed: true }); }
  });
  const reset = createManufacturerRobotResetClient({
    url: 'https://manufacturer.test/reset',
    apiKey: 'server-only-key',
    fetchImpl: async () => completedResponse()
  });
  assert.equal(await reset('manufacturer-r1'), true);

  const deletion = createManufacturerPrivacyRepository({
    exportURL: 'https://manufacturer.test/privacy/export',
    deleteURL: 'https://manufacturer.test/privacy/delete',
    apiKey: 'server-only-key',
    listManufacturerDeviceIds: async () => ['manufacturer-r1'],
    fetchImpl: async () => completedResponse()
  });
  assert.deepEqual(await deletion.deleteUserData('user-private'), { deleted: 1 });

  for (const incomplete of [
    { ok: true, status: 200, async text() { return ''; } },
    { ok: true, status: 200, async text() { return JSON.stringify({ completed: false }); } },
    { ok: true, status: 206, async text() { return JSON.stringify({ completed: true }); } }
  ]) {
    const incompleteReset = createManufacturerRobotResetClient({
      url: 'https://manufacturer.test/reset',
      apiKey: 'server-only-key',
      fetchImpl: async () => incomplete
    });
    await assert.rejects(incompleteReset('manufacturer-r1'), /invalid|did not confirm completion|returned 206/);
    const incompleteDeletion = createManufacturerPrivacyRepository({
      exportURL: 'https://manufacturer.test/privacy/export',
      deleteURL: 'https://manufacturer.test/privacy/delete',
      apiKey: 'server-only-key',
      listManufacturerDeviceIds: async () => ['manufacturer-r1'],
      fetchImpl: async () => incomplete
    });
    await assert.rejects(
      incompleteDeletion.deleteUserData('user-private'),
      /invalid|did not confirm completion|returned 206/
    );
  }
});

test('indoor positioning accepts only bounded contract fields', () => {
  assert.deepEqual(normalizeIndoorPosition({
    map_id: 'map:home',
    floor_id: 'floor:2',
    room_id: 'room:bedroom',
    x_m: -25.5,
    y_m: 10_000,
    confidence: 1,
    captured_at: 1_234,
    camera_url: 'https://private.example/frame'
  }), {
    map_id: 'map:home',
    floor_id: 'floor:2',
    room_id: 'room:bedroom',
    x_m: -25.5,
    y_m: 10_000,
    confidence: 1,
    captured_at: 1_234
  });
  assert.deepEqual(normalizeIndoorPosition({
    room_id: 'room:bedroom',
    x_m: 10_001,
    y_m: 1,
    confidence: 2,
    captured_at: -1
  }), { room_id: 'room:bedroom' });
  assert.equal(normalizeIndoorPosition({ room_id: 'x'.repeat(129) }), undefined);
  assert.equal(normalizeIndoorPosition({ x_m: 1, y_m: 2 }), undefined);
  assert.equal(normalizeIndoorPosition({ map_id: 'map:home', x_m: '1', y_m: 2 }), undefined);
  assert.equal(normalizeIndoorPosition({ x_m: 1, y_m: Number.POSITIVE_INFINITY }), undefined);
});

test('manufacturer pairing preserves replay semantics and reset rejects an async receipt', async () => {
  const verifier = createManufacturerPairingVerifier({
    url: 'https://manufacturer.test/pair',
    apiKey: 'server-only-key',
    fetchImpl: async () => ({ ok: false, status: 410 })
  });
  await assert.rejects(verifier('one-time-code'), (error) => {
    assert.equal(error.statusCode, 410);
    assert.equal(error.code, 'ROBOT_PAIRING_REPLAY');
    return true;
  });
  const reset = createManufacturerRobotResetClient({
    url: 'https://manufacturer.test/reset',
    apiKey: 'server-only-key',
    fetchImpl: async () => ({ ok: true, status: 202 })
  });
  await assert.rejects(reset('manufacturer-r1'), /returned 202/);
});
