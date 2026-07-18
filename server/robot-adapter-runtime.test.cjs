'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const {
  RobotAdapterRuntime,
  adapterConfigurationsFromEnv,
  normalizeConfiguration
} = require('./robot-adapter-runtime.cjs');

const configs = [
  normalizeConfiguration({
    vendor: 'yongyida', adapterId: 'yongyida-cloud', baseUrl: 'https://cloud.example.test',
    apiKey: 'cloud-key', callbackApiKey: 'cloud-callback', pairingVerifyURL: 'https://cloud.example.test/pair',
    resetURL: 'https://cloud.example.test/reset',
    privacyExportURL: 'https://cloud.example.test/privacy/export',
    privacyDeleteURL: 'https://cloud.example.test/privacy/delete'
  }),
  normalizeConfiguration({
    vendor: 'jiangzhi', adapterId: 'jiangzhi-edge', baseUrl: 'https://edge.example.test',
    apiKey: 'edge-key', callbackApiKey: 'edge-callback', pairingVerifyURL: 'https://edge.example.test/pair',
    resetURL: 'https://edge.example.test/reset',
    privacyExportURL: 'https://edge.example.test/privacy/export',
    privacyDeleteURL: 'https://edge.example.test/privacy/delete'
  })
];

class FakeFactory {
  constructor(dependencies) { this.dependencies = dependencies; }
  create(configuration) {
    return {
      initialize: async ({ deviceId }) => { this.deviceId = deviceId; },
      deliverSignedAction: async (signed) => {
        await this.dependencies.onAttempt('deliver_signed_action', 1);
        assert.equal(signed.envelope.manufacturer_device_id, this.deviceId);
        return { statusCode: 202, acknowledged: false };
      },
      getDeviceStatus: async () => ({
        online: true, state: 'online', observedAt: '2026-07-18T10:00:00.000Z', firmwareVersion: '1.2.3'
      }),
      getTelemetrySnapshot: async () => ({
        status: {
          online: true, state: 'online', observedAt: '2026-07-18T10:00:00.000Z', firmwareVersion: '1.2.3'
        },
        battery: { percentage: 81, charging: true, observedAt: '2026-07-18T10:00:00.000Z' },
        vitals: [{
          kind: 'heart_rate', value: 72, unit: 'bpm',
          observedAt: '2026-07-18T10:00:00.000Z', quality: 'good'
        }],
        location: { longitude: 103.8, latitude: 1.3, capturedAt: 1_784_368_800_000 },
        navigationPath: {
          coordinates: [[103.8, 1.3], [103.81, 1.31]],
          capturedAt: 1_784_368_800_000
        },
        indoorPosition: {
          mapId: 'home-map', floorId: 'floor-1', roomId: 'bedroom',
          xMeters: 2.5, yMeters: 4.25, confidence: 0.95, capturedAt: 1_784_368_800_000
        },
        safetyEvents: [{
          eventType: 'fall', eventId: 'fall-event-0001', occurredAt: 1_784_368_799_000, confidence: 0.9
        }],
        medicationAcknowledgements: [{
          reminderId: 'reminder-0001', receiptId: 'receipt-0001', deliveredAt: 1_784_368_799_500
        }]
      }),
      configuration
    };
  }
}

describe('RobotAdapterRuntime', () => {
  test('routes a signed action to its immutable adapter and reports physical attempts', async () => {
    const attempts = [];
    const runtime = new RobotAdapterRuntime({ configurations: configs, factoryClass: FakeFactory });
    const result = await runtime.deliverSignedAction('jiangzhi-edge', {
      envelope: {
        version: 2,
        contract_version: 'vl-robot-action/2',
        binding_epoch: 3,
        adapter_id: 'jiangzhi-edge',
        manufacturer_device_id: 'robot-1'
      }
    }, { onAttempt: (attempt) => attempts.push(attempt) });
    assert.deepEqual(result, { status: 202, acknowledged: false });
    assert.deepEqual(attempts, [1]);
  });

  test('fails closed on unknown and cross-adapter routing', async () => {
    const runtime = new RobotAdapterRuntime({ configurations: configs, factoryClass: FakeFactory });
    await assert.rejects(runtime.deliverSignedAction('missing', { envelope: {} }), { code: 'ROBOT_ADAPTER_NOT_CONFIGURED' });
    await assert.rejects(runtime.deliverSignedAction('yongyida-cloud', {
      envelope: {
        version: 2,
        contract_version: 'vl-robot-action/2',
        binding_epoch: 3,
        adapter_id: 'jiangzhi-edge',
        manufacturer_device_id: 'robot-1'
      }
    }), { code: 'ROBOT_ADAPTER_BINDING_MISMATCH' });
    await assert.rejects(runtime.deliverSignedAction('jiangzhi-edge', {
      envelope: {
        version: 2,
        contract_version: 'vl-robot-action/2',
        binding_epoch: 0,
        adapter_id: 'jiangzhi-edge',
        manufacturer_device_id: 'robot-1'
      }
    }), { code: 'ROBOT_ADAPTER_BINDING_MISMATCH' });
  });

  test('callback credentials are isolated by adapter', () => {
    const runtime = new RobotAdapterRuntime({ configurations: configs, factoryClass: FakeFactory });
    assert.equal(runtime.authenticateCallback('yongyida-cloud', 'cloud-callback'), true);
    assert.equal(runtime.authenticateCallback('yongyida-cloud', 'edge-callback'), false);
    assert.equal(runtime.authenticateCallback('jiangzhi-edge', 'cloud-callback'), false);
    assert.equal(runtime.authenticateCallback('missing', 'cloud-callback'), false);
  });

  test('rejects callback credentials shared by two adapters', () => {
    const duplicated = [
      { ...configs[0], callbackApiKey: 'shared-callback-key' },
      { ...configs[1], callbackApiKey: 'shared-callback-key' }
    ];
    assert.throws(
      () => new RobotAdapterRuntime({ configurations: duplicated, factoryClass: FakeFactory }),
      /callback credentials must be unique/
    );
  });

  test('rejects callback credentials reused as an outbound bridge secret', () => {
    assert.throws(
      () => new RobotAdapterRuntime({
        configurations: [{ ...configs[0], callbackApiKey: configs[0].apiKey }],
        factoryClass: FakeFactory
      }),
      /separate from outbound credentials/
    );
    assert.throws(
      () => new RobotAdapterRuntime({
        configurations: [configs[0], { ...configs[1], apiKey: configs[0].callbackApiKey }],
        factoryClass: FakeFactory
      }),
      /separate from outbound credentials/
    );
  });

  test('normalizes status for the existing mobile telemetry contract', async () => {
    const observedAt = Date.parse('2026-07-18T10:00:00.000Z');
    const runtime = new RobotAdapterRuntime({
      configurations: configs,
      factoryClass: FakeFactory,
      now: () => observedAt + 30_000
    });
    assert.deepEqual(await runtime.getDeviceStatus('yongyida-cloud', 'robot-1'), {
      online: true,
      hardware_status: 'online',
      reported_at: observedAt,
      firmware_version: '1.2.3'
    });
    assert.deepEqual(await runtime.getTelemetrySnapshot('jiangzhi-edge', 'robot-2'), {
      online: true,
      hardware_status: 'online',
      reported_at: observedAt,
      firmware_version: '1.2.3',
      battery: { percentage: 81, charging: true, observed_at: observedAt },
      vitals: [{ kind: 'heart_rate', value: 72, unit: 'bpm', observed_at: observedAt, quality: 'good' }],
      location: { longitude: 103.8, latitude: 1.3 },
      navigation_path: [[103.8, 1.3], [103.81, 1.31]],
      indoor_position: {
        map_id: 'home-map', floor_id: 'floor-1', room_id: 'bedroom',
        x_m: 2.5, y_m: 4.25, confidence: 0.95, captured_at: 1_784_368_800_000
      },
      safety_events: [{
        event_type: 'fall', event_id: 'fall-event-0001', occurred_at: 1_784_368_799_000, confidence: 0.9
      }],
      medication_acknowledgements: [{
        reminder_id: 'reminder-0001', receipt_id: 'receipt-0001', delivered_at: 1_784_368_799_500
      }]
    });

    const stale = new RobotAdapterRuntime({
      configurations: configs,
      factoryClass: FakeFactory,
      now: () => observedAt + (6 * 60 * 1000)
    });
    assert.deepEqual(await stale.getDeviceStatus('yongyida-cloud', 'robot-1'), {
      online: false,
      hardware_status: 'unknown',
      reported_at: observedAt,
      telemetry_error: 'stale_timestamp'
    });
    assert.deepEqual(await stale.getTelemetrySnapshot('jiangzhi-edge', 'robot-2'), {
      online: false,
      hardware_status: 'unknown',
      reported_at: observedAt,
      telemetry_error: 'stale_timestamp'
    });
    const future = new RobotAdapterRuntime({
      configurations: configs,
      factoryClass: FakeFactory,
      now: () => observedAt - (2 * 60 * 1000)
    });
    assert.deepEqual(await future.getDeviceStatus('yongyida-cloud', 'robot-1'), {
      online: false,
      hardware_status: 'unknown',
      reported_at: observedAt,
      telemetry_error: 'future_timestamp'
    });

    class StaleOptionalTelemetryFactory extends FakeFactory {
      create(configuration) {
        const adapter = super.create(configuration);
        const getSnapshot = adapter.getTelemetrySnapshot;
        adapter.getTelemetrySnapshot = async () => ({
          ...await getSnapshot(),
          battery: { percentage: 81, charging: true, observedAt: '2026-07-18T09:00:00.000Z' },
          vitals: [{ kind: 'heart_rate', value: 72, unit: 'bpm', observedAt: '2026-07-18T09:00:00.000Z' }],
          location: { longitude: 103.8, latitude: 1.3, capturedAt: observedAt - 3_600_000 },
          navigationPath: {
            coordinates: [[103.8, 1.3], [103.81, 1.31]],
            capturedAt: observedAt + 120_000
          },
          indoorPosition: { mapId: 'home-map', xMeters: 1, yMeters: 2, capturedAt: observedAt - 3_600_000 },
          safetyEvents: [{ eventType: 'fall', eventId: 'future-fall-0001', occurredAt: observedAt + 120_000 }],
          medicationAcknowledgements: [{
            reminderId: 'reminder-0001', receiptId: 'receipt-0001',
            deliveredAt: observedAt - (31 * 24 * 60 * 60 * 1000)
          }]
        });
        return adapter;
      }
    }
    const filtered = new RobotAdapterRuntime({
      configurations: configs,
      factoryClass: StaleOptionalTelemetryFactory,
      now: () => observedAt + 30_000
    });
    assert.deepEqual(await filtered.getTelemetrySnapshot('jiangzhi-edge', 'robot-2'), {
      online: true,
      hardware_status: 'online',
      reported_at: observedAt,
      firmware_version: '1.2.3'
    });

    class TimestampLessSpatialTelemetryFactory extends FakeFactory {
      create(configuration) {
        const adapter = super.create(configuration);
        const getSnapshot = adapter.getTelemetrySnapshot;
        adapter.getTelemetrySnapshot = async () => ({
          ...await getSnapshot(),
          location: { longitude: 103.8, latitude: 1.3 },
          navigationPath: { coordinates: [[103.8, 1.3], [103.81, 1.31]] },
          indoorPosition: { mapId: 'home-map', xMeters: 1, yMeters: 2 }
        });
        return adapter;
      }
    }
    const timestampLess = new RobotAdapterRuntime({
      configurations: configs,
      factoryClass: TimestampLessSpatialTelemetryFactory,
      now: () => observedAt + 30_000
    });
    const withoutSpatialFields = await timestampLess.getTelemetrySnapshot('jiangzhi-edge', 'robot-2');
    assert.equal(Object.hasOwn(withoutSpatialFields, 'location'), false);
    assert.equal(Object.hasOwn(withoutSpatialFields, 'navigation_path'), false);
    assert.equal(Object.hasOwn(withoutSpatialFields, 'indoor_position'), false);
  });

  test('environment configuration supports both vendors without a global robot type', () => {
    const loaded = adapterConfigurationsFromEnv({
      NODE_ENV: 'development',
      YONGYIDA_ADAPTER_ENABLED: 'true', YONGYIDA_BRIDGE_URL: 'http://127.0.0.1:7001',
      YONGYIDA_BRIDGE_API_KEY: '12345678', YONGYIDA_CALLBACK_API_KEY: 'abcdefgh',
      JIANGZHI_ADAPTER_ENABLED: 'true', JIANGZHI_BRIDGE_URL: 'http://127.0.0.1:7002',
      JIANGZHI_BRIDGE_API_KEY: '87654321', JIANGZHI_CALLBACK_API_KEY: 'hgfedcba',
      ROBOT_ADAPTER_ALLOW_INSECURE_HTTP: 'true'
    });
    assert.deepEqual(loaded.map(({ vendor }) => vendor), ['yongyida', 'jiangzhi']);
    assert.throws(() => adapterConfigurationsFromEnv({
      NODE_ENV: 'production', YONGYIDA_ADAPTER_ENABLED: 'true',
      YONGYIDA_BRIDGE_URL: 'http://robot.example.test',
      YONGYIDA_BRIDGE_API_KEY: 'x'.repeat(32), YONGYIDA_CALLBACK_API_KEY: 'y'.repeat(32)
    }), /HTTPS/);
  });

  test('reset and privacy use only the selected adapter endpoints and credential', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/privacy/export')) {
        return { ok: true, status: 200, async text() { return JSON.stringify({ records: ['owned'] }); } };
      }
      if (url.endsWith('/reset')) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              reset_id: 'reset-operation-0001',
              binding_epoch: 4,
              state: 'completed',
              erased: true,
              fenced: true
            });
          }
        };
      }
      return { ok: true, status: 204, async text() { return ''; } };
    };
    const runtime = new RobotAdapterRuntime({ configurations: configs, factoryClass: FakeFactory, fetchImpl });
    assert.equal(await runtime.resetRobot('yongyida-cloud', {
      resetId: 'reset-operation-0001',
      manufacturerDeviceId: 'cloud-device-1',
      bindingEpoch: 4
    }), true);
    assert.deepEqual(await runtime.exportRobotData('jiangzhi-edge', ['edge-device-1']), { records: ['owned'] });
    assert.deepEqual(await runtime.deleteRobotData('jiangzhi-edge', ['edge-device-1']), { deleted: 1 });

    assert.deepEqual(calls.map(({ url }) => url), [
      'https://cloud.example.test/reset',
      'https://edge.example.test/privacy/export',
      'https://edge.example.test/privacy/delete'
    ]);
    assert.equal(calls[0].options.headers['X-Manufacturer-Api-Key'], 'cloud-key');
    assert.equal(calls[0].options.headers['Idempotency-Key'], 'reset-operation-0001');
    assert.equal(
      calls[0].options.headers['X-Veryloving-Reset-Contract'],
      'veryloving.robot-reset.v1'
    );
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      contract_version: 'vl-robot-reset/1',
      reset_id: 'reset-operation-0001',
      robot_id: 'cloud-device-1',
      binding_epoch: 4,
      erase_user_data: true
    });
    assert.ok(calls.every(({ options }) => options.redirect === 'error'));
    assert.ok(calls.slice(1).every(({ options }) => options.headers['X-Manufacturer-Api-Key'] === 'edge-key'));
    assert.ok(calls.slice(1).every(({ options }) => !JSON.stringify(options).includes('cloud-key')));
  });

  test('modern lifecycle operations fail closed when their adapter handler is absent', async () => {
    const runtime = new RobotAdapterRuntime({
      configurations: [normalizeConfiguration({
        vendor: 'jiangzhi', adapterId: 'edge-without-lifecycle', baseUrl: 'https://edge.example.test',
        apiKey: 'edge-key', callbackApiKey: 'edge-callback'
      })],
      factoryClass: FakeFactory
    });
    await assert.rejects(runtime.resetRobot('edge-without-lifecycle', {
      resetId: 'reset-operation-0001',
      manufacturerDeviceId: 'edge-device-1',
      bindingEpoch: 1
    }), {
      code: 'ROBOT_ADAPTER_RESET_NOT_CONFIGURED'
    });
    await assert.rejects(runtime.exportRobotData('edge-without-lifecycle', ['edge-device-1']), /not configured/);
    await assert.rejects(runtime.deleteRobotData('edge-without-lifecycle', ['edge-device-1']), /not configured/);
  });
});
