'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ActionGateway, signEnvelope } = require('./action-gateway.cjs');
const {
  createManufacturerPrivacyClient,
  createManufacturerPrivacyRepository,
  createManufacturerPairingVerifier,
  createManufacturerRobotResetClient,
  createManufacturerRobotStatusClient,
  createRoutedManufacturerPrivacyRepository,
  normalizeIndoorPosition
} = require('./manufacturer-client.cjs');
const { createManufacturerMockServer } = require('../tests/integration/manufacturer-mock-server.js');

const RESET_REQUEST = Object.freeze({
  resetId: 'reset-operation-0001',
  manufacturerDeviceId: 'manufacturer-1',
  bindingEpoch: 4
});

function boundedTextResponse(text, status = 200) {
  const body = String(text);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) { return String(name).toLowerCase() === 'content-length' ? String(Buffer.byteLength(body)) : null; }
    },
    async text() { return body; }
  };
}

function boundedJsonResponse(payload, status = 200) {
  return boundedTextResponse(JSON.stringify(payload), status);
}

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
      return boundedJsonResponse({
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
          });
    }
    return boundedJsonResponse({
          reset_id: RESET_REQUEST.resetId,
          binding_epoch: RESET_REQUEST.bindingEpoch,
          state: 'completed',
          erased: true,
          fenced: true
        });
  };
  const statusClient = createManufacturerRobotStatusClient({
    url: 'https://manufacturer.test/status', apiKey: 'private-key', fetchImpl, now: () => 1000
  });
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
  assert.equal(await resetClient(RESET_REQUEST), true);
  assert.equal(calls[1].options.headers['X-Manufacturer-Api-Key'], 'private-key');
  assert.equal(calls[1].options.headers['Idempotency-Key'], RESET_REQUEST.resetId);
  assert.equal(calls[1].options.headers['X-Veryloving-Reset-Contract'], 'veryloving.robot-reset.v1');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    contract_version: 'vl-robot-reset/1',
    reset_id: RESET_REQUEST.resetId,
    robot_id: RESET_REQUEST.manufacturerDeviceId,
    binding_epoch: RESET_REQUEST.bindingEpoch,
    erase_user_data: true
  });
  assert.ok(calls.every(({ options }) => options.redirect === 'error'));
});

test('manufacturer telemetry without a trustworthy timestamp fails closed', async () => {
  const statusClient = createManufacturerRobotStatusClient({
    url: 'https://manufacturer.test/status',
    apiKey: 'private-key',
    fetchImpl: async () => boundedJsonResponse({
      online: true, location: { longitude: 103.8, latitude: 1.3 }
    })
  });
  assert.deepEqual(await statusClient('manufacturer-1'), {
    online: false,
    hardware_status: 'unknown',
    telemetry_error: 'invalid_timestamp'
  });
});

test('manufacturer status rejects stale clocks and drops invalid safety event timestamps', async () => {
  const statusClient = createManufacturerRobotStatusClient({
    url: 'https://manufacturer.test/status',
    apiKey: 'private-key',
    now: () => 10_000,
    maxStatusAgeMs: 1_000,
    statusFutureSkewMs: 100,
    maxMedicationAcknowledgementAgeMs: 1_000,
    fetchImpl: async () => boundedJsonResponse({
          online: true,
          reported_at: 10_000,
          safety_events: [
            { event_type: 'fall', event_id: 'fall-event-valid', occurred_at: 9_999 },
            { event_type: 'fall', event_id: 'fall-event-negative', occurred_at: -12.5 },
            { event_type: 'fall', event_id: 'fall-event-fraction', occurred_at: 9_999.5 },
            { event_type: 'fall', event_id: 'fall-event-stale', occurred_at: 8_999 },
            { event_type: 'fall', event_id: 'fall-event-future', occurred_at: 10_101 }
          ],
          medication_acknowledgements: [
            { reminder_id: 'reminder-valid-1', receipt_id: 'receipt-valid-1', delivered_at: 9_999 },
            { reminder_id: 'reminder-stale-1', receipt_id: 'receipt-stale-1', delivered_at: 8_999 },
            { reminder_id: 'reminder-future-1', receipt_id: 'receipt-future-1', delivered_at: 10_101 }
          ],
          indoor_position: { room_id: 'bedroom', captured_at: 8_999 }
        })
  });

  const fresh = await statusClient('manufacturer-1');
  assert.deepEqual(fresh.safety_events, [{
    event_type: 'fall', event_id: 'fall-event-valid', occurred_at: 9_999
  }]);
  assert.deepEqual(fresh.medication_acknowledgements, [{
    reminder_id: 'reminder-valid-1', receipt_id: 'receipt-valid-1', delivered_at: 9_999
  }]);
  assert.equal(fresh.indoor_position, undefined);

  const staleClient = createManufacturerRobotStatusClient({
    url: 'https://manufacturer.test/status',
    apiKey: 'private-key',
    now: () => 10_000,
    maxStatusAgeMs: 1_000,
    fetchImpl: async () => boundedJsonResponse({ online: true, reported_at: 8_999 })
  });
  assert.deepEqual(await staleClient('manufacturer-1'), {
    online: false,
    hardware_status: 'unknown',
    telemetry_error: 'stale_timestamp'
  });
});

test('manufacturer requests time out when fetch ignores AbortSignal', async () => {
  let requestSignal;
  const statusClient = createManufacturerRobotStatusClient({
    url: 'https://manufacturer.test/status',
    apiKey: 'private-key',
    timeoutMs: 10,
    fetchImpl: async (_url, options) => {
      requestSignal = options.signal;
      return new Promise(() => {});
    }
  });

  const startedAt = Date.now();
  await assert.rejects(statusClient('manufacturer-1'), (error) => {
    assert.equal(error.name, 'TimeoutError');
    assert.equal(error.code, 'MANUFACTURER_TIMEOUT');
    return true;
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(requestSignal.aborted, true);
  assert.ok(elapsedMs < 500, `manufacturer timeout took ${elapsedMs}ms`);
});

test('manufacturer clients reject unsafe timeout configuration before transport', async () => {
  let called = false;
  const statusClient = createManufacturerRobotStatusClient({
    url: 'https://manufacturer.test/status',
    apiKey: 'server-only-key',
    timeoutMs: 0,
    fetchImpl: async () => {
      called = true;
      return boundedJsonResponse({});
    }
  });

  await assert.rejects(statusClient('manufacturer-r1'), /timeout is invalid/);
  assert.equal(called, false);
});

test('manufacturer status rejects an invalid device identifier before transport', async () => {
  let called = false;
  const statusClient = createManufacturerRobotStatusClient({
    url: 'https://manufacturer.test/status',
    apiKey: 'server-only-key',
    fetchImpl: async () => {
      called = true;
      return boundedJsonResponse({});
    }
  });
  await assert.rejects(statusClient('../other-device'), /device id is invalid/);
  assert.equal(called, false);
});

test('manufacturer clients release response bodies on status-only branches', async () => {
  let cancelled = 0;
  const statusClient = createManufacturerRobotStatusClient({
    url: 'https://manufacturer.test/status',
    apiKey: 'server-only-key',
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      body: { async cancel() { cancelled += 1; } }
    })
  });

  assert.deepEqual(await statusClient('manufacturer-r1'), {
    online: false,
    hardware_status: 'offline'
  });
  assert.equal(cancelled, 1);
});

test('manufacturer timeout cancels a response stream whose body read stalls', async () => {
  let cancelCount = 0;
  let completeRead;
  const response = {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          read() {
            return new Promise((resolve) => { completeRead = resolve; });
          },
          async cancel() {
            cancelCount += 1;
            completeRead?.({ done: true });
          },
          releaseLock() {}
        };
      }
    }
  };
  const statusClient = createManufacturerRobotStatusClient({
    url: 'https://manufacturer.test/status',
    apiKey: 'private-key',
    timeoutMs: 10,
    fetchImpl: async () => response
  });

  const startedAt = Date.now();
  await assert.rejects(statusClient('manufacturer-1'), (error) => {
    assert.equal(error.name, 'TimeoutError');
    assert.equal(error.code, 'MANUFACTURER_TIMEOUT');
    return true;
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(cancelCount, 1);
  assert.ok(elapsedMs < 500, `stalled response timeout took ${elapsedMs}ms`);
});

test('manufacturer timeout releases a reader even when cancel does not settle its read', async () => {
  let cancelCount = 0;
  let releaseCount = 0;
  const statusClient = createManufacturerRobotStatusClient({
    url: 'https://manufacturer.test/status',
    apiKey: 'private-key',
    timeoutMs: 10,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader() {
          return {
            read: () => new Promise(() => {}),
            cancel() { cancelCount += 1; },
            releaseLock() { releaseCount += 1; }
          };
        },
        async cancel() {}
      }
    })
  });

  await assert.rejects(statusClient('manufacturer-1'), { code: 'MANUFACTURER_TIMEOUT' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelCount, 1);
  assert.equal(releaseCount, 1);
});

test('manufacturer privacy sends only bound robot identifiers and requires completed deletion', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/delete')
      ? boundedTextResponse('', 204)
      : boundedJsonResponse({ robots: [{ status: 'erased' }] });
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

  const oversizedExport = createManufacturerPrivacyRepository({
    exportURL: 'https://manufacturer.test/privacy/export',
    deleteURL: 'https://manufacturer.test/privacy/delete',
    apiKey: 'server-only-key',
    listManufacturerDeviceIds: async () => ['manufacturer-r1'],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader: () => {
          let sent = false;
          return {
            async read() {
              if (sent) return { done: true };
              sent = true;
              return { done: false, value: Buffer.alloc((1024 * 1024) + 1) };
            },
            async cancel() {},
            releaseLock() {}
          };
        }
      }
    })
  });
  await assert.rejects(oversizedExport.exportUserData('user-private'), /too large/);
});

test('manufacturer privacy does not treat an asynchronous deletion receipt as erasure', async () => {
  const repository = createManufacturerPrivacyRepository({
    exportURL: 'https://manufacturer.test/privacy/export',
    deleteURL: 'https://manufacturer.test/privacy/delete',
    apiKey: 'server-only-key',
    listManufacturerDeviceIds: async () => ['manufacturer-r1'],
    fetchImpl: async () => boundedTextResponse('', 202)
  });
  await assert.rejects(repository.deleteUserData('user-private'), /returned 202/);
});

test('mixed-fleet privacy groups identifiers by adapter and never crosses handlers', async () => {
  const calls = [];
  const legacyClient = {
    async exportRobotData(robotIds) { calls.push(['legacy-export', robotIds]); return { vendor: 'legacy' }; },
    async deleteRobotData(robotIds) { calls.push(['legacy-delete', robotIds]); return { deleted: robotIds.length }; }
  };
  const robotAdapterRuntime = {
    async exportRobotData(adapterId, robotIds) {
      calls.push(['adapter-export', adapterId, robotIds]);
      return { vendor: adapterId };
    },
    async deleteRobotData(adapterId, robotIds) {
      calls.push(['adapter-delete', adapterId, robotIds]);
      return { deleted: robotIds.length };
    }
  };
  const repository = createRoutedManufacturerPrivacyRepository({
    listManufacturerRobotBindings: async () => [
      { adapterId: 'manufacturer-default', manufacturerDeviceId: 'legacy-1' },
      { adapterId: 'yongyida-cloud', manufacturerDeviceId: 'yongyida-1' },
      { adapterId: 'jiangzhi-edge', manufacturerDeviceId: 'jiangzhi-1' },
      { adapterId: 'yongyida-cloud', manufacturerDeviceId: 'yongyida-1' }
    ],
    legacyClient,
    robotAdapterRuntime
  });

  assert.deepEqual(await repository.exportUserData('user-private'), {
    adapter_exports: [
      { adapter_id: 'manufacturer-default', data: { vendor: 'legacy' } },
      { adapter_id: 'yongyida-cloud', data: { vendor: 'yongyida-cloud' } },
      { adapter_id: 'jiangzhi-edge', data: { vendor: 'jiangzhi-edge' } }
    ]
  });
  assert.deepEqual(calls, [
    ['legacy-export', ['legacy-1']],
    ['adapter-export', 'yongyida-cloud', ['yongyida-1']],
    ['adapter-export', 'jiangzhi-edge', ['jiangzhi-1']]
  ]);

  calls.length = 0;
  assert.deepEqual(await repository.deleteUserData('user-private'), { deleted: 3 });
  assert.deepEqual(calls, [
    ['legacy-delete', ['legacy-1']],
    ['adapter-delete', 'yongyida-cloud', ['yongyida-1']],
    ['adapter-delete', 'jiangzhi-edge', ['jiangzhi-1']]
  ]);

  const missingModernHandler = createRoutedManufacturerPrivacyRepository({
    listManufacturerRobotBindings: async () => [
      { adapterId: 'jiangzhi-edge', manufacturerDeviceId: 'jiangzhi-1' }
    ],
    legacyClient
  });
  await assert.rejects(missingModernHandler.deleteUserData('user-private'), {
    code: 'ROBOT_ADAPTER_PRIVACY_NOT_CONFIGURED', statusCode: 503
  });
  assert.equal(calls.length, 3);
});

test('mixed-fleet routed deletion resumes at the failed adapter with a stable vendor key', async () => {
  let checkpoint;
  const deletionRepository = {
    async begin(_userId, plan) {
      checkpoint ||= {
        operationId: 'operationidentity00000000000000000000000000',
        planFingerprint: 'fingerprint00000000000000000000000000000000',
        adapterIds: plan.map(({ adapterId }) => adapterId),
        completedAdapters: [],
        state: 'in_progress'
      };
      return structuredClone(checkpoint);
    },
    async markAdapterCompleted(_userId, _operationId, adapterId) {
      checkpoint.completedAdapters.push(adapterId);
      return structuredClone(checkpoint);
    },
    async markCompleted() {
      checkpoint.state = 'completed';
      return structuredClone(checkpoint);
    }
  };
  const calls = [];
  let modernFailurePending = true;
  const repository = createRoutedManufacturerPrivacyRepository({
    listManufacturerRobotBindings: async () => [
      { adapterId: 'manufacturer-default', manufacturerDeviceId: 'legacy-1' },
      { adapterId: 'yongyida-cloud', manufacturerDeviceId: 'yongyida-1' }
    ],
    legacyClient: {
      async exportRobotData() { return {}; },
      async deleteRobotData(robotIds, options) {
        calls.push(['legacy', robotIds, options.idempotencyKey]);
        return { deleted: robotIds.length };
      }
    },
    robotAdapterRuntime: {
      async exportRobotData() { return {}; },
      async deleteRobotData(adapterId, robotIds, options) {
        calls.push([adapterId, robotIds, options.idempotencyKey]);
        if (modernFailurePending) {
          modernFailurePending = false;
          throw new Error('modern vendor unavailable');
        }
        return { deleted: robotIds.length };
      }
    },
    deletionRepository
  });

  await assert.rejects(repository.deleteUserData('user-private'), /modern vendor unavailable/);
  assert.deepEqual(checkpoint.completedAdapters, ['manufacturer-default']);
  assert.deepEqual(await repository.deleteUserData('user-private'), { deleted: 2 });
  assert.deepEqual(calls.map(([adapterId]) => adapterId), [
    'legacy',
    'yongyida-cloud',
    'yongyida-cloud'
  ]);
  assert.equal(calls[1][2], calls[2][2]);
});

test('manufacturer reset and privacy deletion require explicit synchronous completion', async () => {
  const completedResponse = () => boundedJsonResponse({
        completed: true,
        reset_id: RESET_REQUEST.resetId,
        binding_epoch: RESET_REQUEST.bindingEpoch,
        state: 'completed',
        erased: true,
        fenced: true
      });
  const reset = createManufacturerRobotResetClient({
    url: 'https://manufacturer.test/reset',
    apiKey: 'server-only-key',
    fetchImpl: async () => completedResponse()
  });
  assert.equal(await reset(RESET_REQUEST), true);

  const deletion = createManufacturerPrivacyRepository({
    exportURL: 'https://manufacturer.test/privacy/export',
    deleteURL: 'https://manufacturer.test/privacy/delete',
    apiKey: 'server-only-key',
    listManufacturerDeviceIds: async () => ['manufacturer-r1'],
    fetchImpl: async () => completedResponse()
  });
  assert.deepEqual(await deletion.deleteUserData('user-private'), { deleted: 1 });

  for (const incomplete of [
    boundedTextResponse('', 200),
    boundedJsonResponse({ completed: false }, 200),
    boundedJsonResponse({ completed: true }, 206)
  ]) {
    const incompleteReset = createManufacturerRobotResetClient({
      url: 'https://manufacturer.test/reset',
      apiKey: 'server-only-key',
      fetchImpl: async () => incomplete
    });
    await assert.rejects(incompleteReset(RESET_REQUEST), /invalid|returned 206/);
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
  }), undefined);
  assert.equal(normalizeIndoorPosition({ room_id: 'room:bedroom' }), undefined);
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
  await assert.rejects(reset(RESET_REQUEST), /returned 202/);
});

test('manufacturer clients reject provisional success statuses for final contracts', async () => {
  const qrCode = 'one-time-code';
  const apiKey = 'server-only-key';
  const claimId = crypto.createHmac('sha256', apiKey)
    .update('veryloving.robot-pairing-verify.v1\0', 'utf8')
    .update('manufacturer-default', 'utf8')
    .update('\0', 'utf8')
    .update(qrCode, 'utf8')
    .digest('base64url');
  const verifier = createManufacturerPairingVerifier({
    url: 'https://manufacturer.test/pair',
    apiKey,
    fetchImpl: async () => boundedJsonResponse({
      claim_id: claimId,
      hardware_serial: 'PRIVATE-SERIAL-1',
      manufacturer_device_id: 'manufacturer-r1',
      one_time: true,
      expires_at: Date.now() + 60_000
    }, 202)
  });
  await assert.rejects(verifier(qrCode), /returned 202/);

  const status = createManufacturerRobotStatusClient({
    url: 'https://manufacturer.test/status',
    apiKey,
    now: () => 1_000,
    fetchImpl: async () => boundedJsonResponse({ online: true, reported_at: 1_000 }, 202)
  });
  await assert.rejects(status('manufacturer-r1'), /returned 202/);

  const privacy = createManufacturerPrivacyClient({
    exportURL: 'https://manufacturer.test/privacy/export',
    deleteURL: 'https://manufacturer.test/privacy/delete',
    apiKey,
    fetchImpl: async () => boundedJsonResponse({ job_id: 'pending-export' }, 202)
  });
  await assert.rejects(privacy.exportRobotData(['manufacturer-r1']), /returned 202/);
});

test('manufacturer clients do not materialize an unbounded non-stream response', async () => {
  let bodyRead = false;
  const status = createManufacturerRobotStatusClient({
    url: 'https://manufacturer.test/status',
    apiKey: 'server-only-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      async text() {
        bodyRead = true;
        return JSON.stringify({ online: true, reported_at: Date.now() });
      }
    })
  });
  await assert.rejects(status('manufacturer-r1'), /cannot be read within the configured limit/);
  assert.equal(bodyRead, false);
});

test('manufacturer reset rejects empty, malformed, or uncorrelated completion responses', async () => {
  const responses = [
    boundedTextResponse('', 204),
    boundedTextResponse('{"broken":', 200),
    boundedJsonResponse({
          reset_id: 'another-reset-operation',
          binding_epoch: RESET_REQUEST.bindingEpoch,
          state: 'completed',
          erased: true,
          fenced: true
        }),
    boundedJsonResponse({
          reset_id: RESET_REQUEST.resetId,
          binding_epoch: RESET_REQUEST.bindingEpoch + 1,
          state: 'completed',
          erased: true,
          fenced: true
        }),
    boundedJsonResponse({
          reset_id: RESET_REQUEST.resetId,
          binding_epoch: RESET_REQUEST.bindingEpoch,
          state: 'accepted',
          erased: true,
          fenced: true
        }),
    boundedJsonResponse({
          reset_id: RESET_REQUEST.resetId,
          binding_epoch: RESET_REQUEST.bindingEpoch,
          state: 'completed',
          erased: false,
          fenced: true
        }),
    boundedJsonResponse({
          reset_id: RESET_REQUEST.resetId,
          binding_epoch: RESET_REQUEST.bindingEpoch,
          state: 'completed',
          erased: true,
          fenced: false
        })
  ];

  for (const response of responses) {
    const reset = createManufacturerRobotResetClient({
      url: 'https://manufacturer.test/reset',
      apiKey: 'server-only-key',
      fetchImpl: async () => response
    });
    await assert.rejects(reset(RESET_REQUEST), /returned 204|invalid/);
  }

  let transportCalled = false;
  const reset = createManufacturerRobotResetClient({
    url: 'https://manufacturer.test/reset',
    apiKey: 'server-only-key',
    fetchImpl: async () => {
      transportCalled = true;
      throw new Error('must not execute');
    }
  });
  await assert.rejects(reset({ ...RESET_REQUEST, resetId: 'short' }), /reset id is invalid/);
  await assert.rejects(reset({ ...RESET_REQUEST, manufacturerDeviceId: '../invalid' }), /device id is invalid/);
  await assert.rejects(reset({ ...RESET_REQUEST, bindingEpoch: 0 }), /binding epoch is invalid/);
  assert.equal(transportCalled, false);
});
