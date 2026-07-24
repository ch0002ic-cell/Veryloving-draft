import { describe, expect, jest, test } from '@jest/globals';
import { RobotAdapterError } from '../AdapterErrors';
import { AdapterFactory, RobotAdapterRegistry } from '../AdapterFactory';
import { JiangzhiAdapter } from '../JiangzhiAdapter';
import type { BridgeResponse, FetchLike } from '../RestRobotAdapter';
import type { SignedRobotAction } from '../RobotAdapter';
import { createSafeAdapterLogEntry } from '../StructuredAdapterLogger';
import { YongyidaAdapter } from '../YongyidaAdapter';

function jsonResponse(payload: unknown, status = 200, headers?: Record<string, string>): BridgeResponse {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  }) as unknown as BridgeResponse;
}

function textResponse(payload: string, status = 200, headers?: Record<string, string>): BridgeResponse {
  return new Response(payload, { status, headers }) as unknown as BridgeResponse;
}

function silentLogger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function adapterOptions(fetchImpl: FetchLike, overrides: Record<string, unknown> = {}) {
  let id = 0;
  return {
    adapterId: 'home-primary',
    baseUrl: 'https://bridge.example.test/root/',
    apiKey: 'server-only-key',
    fetchImpl,
    logger: silentLogger(),
    sleep: jest.fn(async () => undefined),
    random: () => 0.5,
    idGenerator: () => `request-${++id}`,
    wallClockNow: () => 1_752_832_810_000,
    allowProvisionalUnsignedCommands: true,
    ...overrides
  };
}

describe('vendor robot adapters', () => {
  test('Yongyida initializes and sends a translated command with stable idempotency and metrics', async () => {
    const metrics: unknown[] = [];
    const fetchImpl = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, session_token: 'session-secret' }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        command_id: 'command-0001',
        state: 'accepted',
        accepted_at: '2026-07-18T10:00:00.000Z'
      }));
    const adapter = new YongyidaAdapter(adapterOptions(fetchImpl, {
      onMetric: (metric: unknown) => metrics.push(metric)
    }));

    await adapter.initialize({ deviceId: 'robot-device-001', pairingToken: 'one-time-claim' });
    const result = await adapter.sendMedicationReminder({
      id: 'medication-001',
      name: 'Private medicine name',
      dosage: 'Private dosage',
      requestId: 'voice-action-001'
    }, { id: 'account-001', preferredLanguage: 'fil-PH' });

    expect(result).toEqual({
      success: true,
      commandId: 'command-0001',
      state: 'accepted',
      acceptedAt: '2026-07-18T10:00:00.000Z'
    });
    const [url, request] = fetchImpl.mock.calls[1]!;
    expect(url).toContain('/root/v1/veryloving/yongyida-cloud/commands');
    expect(request.headers['Idempotency-Key']).toBe('voice-action-001');
    expect(request.headers['X-Veryloving-Session']).toBe('session-secret');
    expect(request.redirect).toBe('error');
    expect(JSON.parse(request.body)).toMatchObject({
      command: 'VL_SEND_MEDICATION_REMINDER',
      device_id: 'robot-device-001',
      parameters: {
        user: {
          id: 'account-001',
          preferred_language: 'fil'
        }
      }
    });
    expect(metrics).toHaveLength(2);
    expect(metrics[1]).toMatchObject({ operation: 'send_medication_reminder', outcome: 'success' });
  });

  test('manufacturer medication payloads use an unambiguous Sorani provider tag', async () => {
    const fetchImpl = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        command_id: 'command-sorani',
        state: 'accepted'
      }));
    const adapter = new YongyidaAdapter(adapterOptions(fetchImpl));

    await adapter.initialize({ deviceId: 'robot-device-001' });
    await adapter.sendMedicationReminder({
      id: 'medication-001',
      name: 'medicine'
    }, {
      id: 'account-001',
      preferredLanguage: 'ckb-IQ'
    });

    expect(JSON.parse(fetchImpl.mock.calls[1]![1].body)).toMatchObject({
      parameters: {
        user: {
          preferred_language: 'ckb-Arab'
        }
      }
    });
  });

  test('auth failures are never retried', async () => {
    const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(textResponse('not logged', 401));
    const sleep = jest.fn(async () => undefined);
    const adapter = new YongyidaAdapter(adapterOptions(fetchImpl, { sleep, maxAttempts: 5 }));

    await expect(adapter.initialize({ deviceId: 'robot-device-001' })).rejects.toMatchObject({
      code: 'ADAPTER_AUTH_FAILED',
      retryable: false,
      attempts: 1
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test('retryable responses use bounded retry and preserve the idempotency key', async () => {
    const fetchImpl = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(textResponse('temporary', 503))
      .mockResolvedValueOnce(jsonResponse({ success: true, command_id: 'command-0002', state: 'accepted' }));
    const sleep = jest.fn(async () => undefined);
    const adapter = new YongyidaAdapter(adapterOptions(fetchImpl, { sleep, maxAttempts: 3 }));
    await adapter.initialize({ deviceId: 'robot-device-001' });

    await expect(adapter.activateAlarm()).resolves.toMatchObject({ commandId: 'command-0002' });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[1]![1].headers['Idempotency-Key'])
      .toBe(fetchImpl.mock.calls[2]![1].headers['Idempotency-Key']);
  });

  test('a fetch implementation that ignores AbortSignal still times out with bounded retries', async () => {
    const fetchImpl = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockImplementation(() => new Promise<BridgeResponse>(() => undefined));
    const adapter = new YongyidaAdapter(adapterOptions(fetchImpl, {
      timeoutMs: 5,
      maxAttempts: 2,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0
    }));
    await adapter.initialize({ deviceId: 'robot-device-001' });

    await expect(adapter.emergencyStop()).rejects.toMatchObject({
      code: 'ADAPTER_TIMEOUT',
      retryable: true,
      attempts: 2
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    const cancelBody = jest.fn(async () => undefined);
    const stalledBodyFetch = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () => new Promise(() => undefined),
            cancel: cancelBody
          })
        }
      });
    const stalledBody = new YongyidaAdapter(adapterOptions(stalledBodyFetch, {
      timeoutMs: 5,
      maxAttempts: 1
    }));
    await stalledBody.initialize({ deviceId: 'robot-device-002' });
    await expect(stalledBody.getDeviceStatus()).rejects.toMatchObject({
      code: 'ADAPTER_TIMEOUT',
      retryable: true,
      attempts: 1
    });
    expect(cancelBody).toHaveBeenCalled();
  });

  test('malformed and oversized responses fail closed without retries', async () => {
    const malformedFetch = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(textResponse('{broken-json', 200));
    const malformed = new YongyidaAdapter(adapterOptions(malformedFetch));
    await malformed.initialize({ deviceId: 'robot-device-001' });
    await expect(malformed.getDeviceStatus()).rejects.toMatchObject({
      code: 'ADAPTER_RESPONSE_INVALID',
      retryable: false
    });
    expect(malformedFetch).toHaveBeenCalledTimes(2);

    const oversizedFetch = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(textResponse('{}', 200, { 'Content-Length': '1000' }));
    const oversized = new YongyidaAdapter(adapterOptions(oversizedFetch, { maxResponseBytes: 128 }));
    await oversized.initialize({ deviceId: 'robot-device-002' });
    await expect(oversized.getBatteryStatus()).rejects.toMatchObject({
      code: 'ADAPTER_RESPONSE_TOO_LARGE',
      retryable: false
    });
    expect(oversizedFetch).toHaveBeenCalledTimes(2);

    const unboundedSnapshotFetch = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({
        status: { online: true, state: 'online', observed_at: '2026-07-18T10:00:00.000Z' },
        vitals: Array.from({ length: 101 }, () => ({
          kind: 'heart_rate', value: 72, unit: 'bpm', observed_at: '2026-07-18T10:00:00.000Z'
        }))
      }));
    const schemaMetrics: Array<{ operation?: string; outcome?: string; errorCode?: string }> = [];
    const unboundedSnapshot = new YongyidaAdapter(adapterOptions(unboundedSnapshotFetch, {
      onMetric: (metric: { operation?: string; outcome?: string; errorCode?: string }) => schemaMetrics.push(metric)
    }));
    await unboundedSnapshot.initialize({ deviceId: 'robot-device-003' });
    await expect(unboundedSnapshot.getTelemetrySnapshot()).rejects.toMatchObject({
      code: 'ADAPTER_RESPONSE_INVALID', retryable: false
    });
    expect(schemaMetrics.at(-1)).toMatchObject({
      operation: 'get_telemetry_snapshot',
      outcome: 'failure',
      errorCode: 'ADAPTER_RESPONSE_INVALID'
    });

    const timestampLessLocationFetch = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({
        status: { online: true, state: 'online', observed_at: '2026-07-18T10:00:00.000Z' },
        location: { longitude: 103.8, latitude: 1.3 }
      }));
    const timestampLessLocation = new YongyidaAdapter(adapterOptions(timestampLessLocationFetch));
    await timestampLessLocation.initialize({ deviceId: 'robot-device-004' });
    await expect(timestampLessLocation.getTelemetrySnapshot()).rejects.toMatchObject({
      code: 'ADAPTER_RESPONSE_INVALID', retryable: false
    });

    const timestampLessPathFetch = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({
        status: { online: true, state: 'online', observed_at: '2026-07-18T10:00:00.000Z' },
        navigation_path: { points: [[103.8, 1.3], [103.81, 1.31]] }
      }));
    const timestampLessPath = new JiangzhiAdapter(adapterOptions(timestampLessPathFetch));
    await timestampLessPath.initialize({ deviceId: 'robot-device-005' });
    await expect(timestampLessPath.getTelemetrySnapshot()).rejects.toMatchObject({
      code: 'ADAPTER_RESPONSE_INVALID', retryable: false
    });

    const timestampLessIndoorFetch = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({
        status: { online: true, state: 'online', observed_at: '2026-07-18T10:00:00.000Z' },
        indoor_position: { room_id: 'bedroom' }
      }));
    const timestampLessIndoor = new JiangzhiAdapter(adapterOptions(timestampLessIndoorFetch));
    await timestampLessIndoor.initialize({ deviceId: 'robot-device-006' });
    await expect(timestampLessIndoor.getTelemetrySnapshot()).rejects.toMatchObject({
      code: 'ADAPTER_RESPONSE_INVALID', retryable: false
    });
  });

  test('unsigned direct side effects require an explicit provisional gate', async () => {
    const fetchImpl = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }));
    const adapter = new YongyidaAdapter(adapterOptions(fetchImpl, {
      allowProvisionalUnsignedCommands: false
    }));
    await adapter.initialize({ deviceId: 'robot-device-001' });
    await expect(adapter.activateAlarm()).rejects.toMatchObject({
      code: 'ADAPTER_REQUEST_REJECTED',
      retryable: false
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('initialization is single-flight and resets after failure', async () => {
    let rejectFirst!: (error: Error) => void;
    const first = new Promise<BridgeResponse>((_resolve, reject) => { rejectFirst = reject; });
    const fetchImpl = jest.fn<FetchLike>()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }));
    const adapter = new YongyidaAdapter(adapterOptions(fetchImpl, { maxAttempts: 1 }));

    const attemptOne = adapter.initialize({ deviceId: 'robot-device-001', pairingToken: 'claim-1' });
    const joinedAttempt = adapter.initialize({ deviceId: 'robot-device-001', pairingToken: 'claim-1' });
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    rejectFirst(new Error('network detail containing secret-key-and-192.168.1.20'));
    await expect(attemptOne).rejects.toMatchObject({ code: 'ADAPTER_NETWORK_FAILED' });
    await expect(joinedAttempt).rejects.toMatchObject({ code: 'ADAPTER_NETWORK_FAILED' });

    await expect(adapter.initialize({ deviceId: 'robot-device-001', pairingToken: 'claim-1' })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('different initialization credentials cannot join an in-flight claim', async () => {
    let resolveFirst!: (response: BridgeResponse) => void;
    const fetchImpl = jest.fn<FetchLike>().mockReturnValueOnce(
      new Promise<BridgeResponse>((resolve) => { resolveFirst = resolve; })
    );
    const adapter = new JiangzhiAdapter(adapterOptions(fetchImpl));
    const first = adapter.initialize({ deviceId: 'robot-device-001', pairingToken: 'claim-1' });

    await expect(adapter.initialize({ deviceId: 'robot-device-002', pairingToken: 'claim-2' }))
      .rejects.toMatchObject({ code: 'ADAPTER_INITIALIZATION_CONFLICT' });
    resolveFirst(jsonResponse({ authenticated: true }));
    await first;
  });

  test('factory registry supports simultaneous vendors without cross-adapter blocking', async () => {
    let releaseYongyida!: (response: BridgeResponse) => void;
    const fetchImpl = jest.fn<FetchLike>().mockImplementation(async (url, request) => {
      if (url.endsWith('/session')) return jsonResponse({ authenticated: true });
      const command = JSON.parse(request.body).command as string;
      if (command === 'VL_ACTIVATE_FALL_ALERT') {
        return new Promise<BridgeResponse>((resolve) => { releaseYongyida = resolve; });
      }
      return jsonResponse({ success: true, command_id: 'jiangzhi-command-1', state: 'accepted' });
    });
    const factory = new AdapterFactory({
      fetchImpl,
      logger: silentLogger(),
      idGenerator: (() => { let id = 0; return () => `factory-request-${++id}`; })()
    });
    const registry = factory.createRegistry([
      {
        vendor: 'yongyida', adapterId: 'living-room-cloud',
        baseUrl: 'https://cloud-bridge.example.test', apiKey: 'yongyida-server-key',
        allowProvisionalUnsignedCommands: true
      },
      {
        vendor: 'jiangzhi', adapterId: 'bedroom-edge',
        baseUrl: 'https://edge-bridge.example.test', apiKey: 'jiangzhi-server-key',
        allowProvisionalUnsignedCommands: true
      }
    ]);
    await Promise.all([
      registry.require('living-room-cloud').initialize({ deviceId: 'robot-device-001' }),
      registry.require('bedroom-edge').initialize({ deviceId: 'robot-device-002' })
    ]);

    const cloud = registry.require('living-room-cloud').activateFallAlert('private room');
    const edge = registry.require('bedroom-edge').activateFallAlert('private room');
    await expect(edge).resolves.toMatchObject({ commandId: 'jiangzhi-command-1' });
    releaseYongyida(jsonResponse({ success: true, command_id: 'yongyida-command-1', state: 'accepted' }));
    await expect(cloud).resolves.toMatchObject({ commandId: 'yongyida-command-1' });
    expect(registry.size).toBe(2);
    expect(registry.list().map((adapter) => adapter.vendor).sort()).toEqual(['jiangzhi', 'yongyida']);
    expect(() => registry.register(registry.require('living-room-cloud'))).toThrow(RobotAdapterError);
  });

  test('Jiangzhi uses edge operations and every adapter method validates bounded responses', async () => {
    const commandResponses: Record<string, unknown> = {
      'vl.edge.safety.check': { command_id: 'command-safety', accepted: true, findings: [{ code: 'clear', severity: 'info' }] },
      'vl.edge.communication.two_way_call': { command_id: 'command-call', state: 'ringing' }
    };
    const fetchImpl = jest.fn<FetchLike>().mockImplementation(async (url, request) => {
      if (url.endsWith('/session')) return jsonResponse({ authenticated: true });
      if (url.endsWith('/telemetry/vitals/query')) return jsonResponse({
        items: [{
          kind: 'heart_rate', value: 72, unit: 'bpm',
          observed_at: '2026-07-18T10:00:00.000Z', quality: 'good'
        }]
      });
      if (url.endsWith('/telemetry/battery/query')) return jsonResponse({
        percentage: 80, charging: true, observed_at: '2026-07-18T10:00:00.000Z'
      });
      if (url.endsWith('/telemetry/status/query')) return jsonResponse({
        online: true, state: 'online', observed_at: '2026-07-18T10:00:00.000Z', firmware_version: '1.2.3'
      });
      if (url.endsWith('/telemetry/snapshot/query')) return jsonResponse({
        status: {
          online: true, state: 'online', observed_at: '2026-07-18T10:00:00.000Z', firmware_version: '1.2.3'
        },
        battery: { percentage: 80, charging: true, observed_at: '2026-07-18T10:00:00.000Z' },
        vitals: [{
          kind: 'heart_rate', value: 72, unit: 'bpm',
          observed_at: '2026-07-18T10:00:00.000Z', quality: 'good'
        }],
        location: { longitude: 103.8, latitude: 1.3, captured_at: 1_752_832_800_000 },
        navigation_path: {
          points: [[103.8, 1.3], { longitude: 103.81, latitude: 1.31 }],
          captured_at: 1_752_832_800_000
        },
        indoor_position: {
          map_id: 'home-map-1', floor_id: 'floor-1', room_id: 'bedroom',
          x_m: 4.25, y_m: 2.5, confidence: 0.92, captured_at: 1_752_832_800_000
        },
        safety_events: [{
          event_type: 'fall_detected', event_id: 'robot-fall-0001',
          occurred_at: 1_752_832_799_000, confidence: 0.9
        }],
        medication_acknowledgements: [{
          reminder_id: 'med-reminder-0001', receipt_id: 'delivery-receipt-0001',
          delivered_at: 1_752_832_799_500
        }]
      });
      const command = JSON.parse(request.body).command as string;
      return jsonResponse(commandResponses[command] ?? {
        success: true, command_id: `command-${fetchImpl.mock.calls.length}`, state: 'accepted'
      });
    });
    const adapter = new JiangzhiAdapter(adapterOptions(fetchImpl));
    await adapter.initialize({ deviceId: 'robot-device-001' });

    await expect(adapter.executeSafetyCheck('kitchen')).resolves.toEqual({
      commandId: 'command-safety', accepted: true, findings: [{ code: 'clear', severity: 'info' }]
    });
    await expect(adapter.playSoothingAudio('audio-track-1', 40)).resolves.toMatchObject({ success: true });
    await expect(adapter.startTwoWayVoiceCall('contact-001')).resolves.toEqual({ commandId: 'command-call', state: 'ringing' });
    await expect(adapter.getBatteryStatus()).resolves.toMatchObject({ percentage: 80, charging: true });
    await expect(adapter.getDeviceStatus()).resolves.toMatchObject({ online: true, firmwareVersion: '1.2.3' });
    await expect(adapter.getTelemetrySnapshot()).resolves.toEqual({
      status: {
        online: true, state: 'online', observedAt: '2026-07-18T10:00:00.000Z', firmwareVersion: '1.2.3'
      },
      battery: { percentage: 80, charging: true, observedAt: '2026-07-18T10:00:00.000Z' },
      vitals: [{
        kind: 'heart_rate', value: 72, unit: 'bpm',
        observedAt: '2026-07-18T10:00:00.000Z', quality: 'good'
      }],
      location: { longitude: 103.8, latitude: 1.3, capturedAt: 1_752_832_800_000 },
      navigationPath: {
        coordinates: [[103.8, 1.3], [103.81, 1.31]],
        capturedAt: 1_752_832_800_000
      },
      indoorPosition: {
        mapId: 'home-map-1', floorId: 'floor-1', roomId: 'bedroom',
        xMeters: 4.25, yMeters: 2.5, confidence: 0.92, capturedAt: 1_752_832_800_000
      },
      safetyEvents: [{
        eventType: 'fall', eventId: 'robot-fall-0001',
        occurredAt: 1_752_832_799_000, confidence: 0.9
      }],
      medicationAcknowledgements: [{
        reminderId: 'med-reminder-0001', receiptId: 'delivery-receipt-0001',
        deliveredAt: 1_752_832_799_500
      }]
    });
    await expect(adapter.emergencyStop()).resolves.toMatchObject({ success: true });
    await expect(adapter.activateAlarm()).resolves.toMatchObject({ success: true });
    await expect(adapter.setConfig({ values: { wake_word_enabled: true }, requestId: 'config-001' }))
      .resolves.toMatchObject({ success: true });
    const stream = await adapter.streamVitals();
    const vitals: unknown[] = [];
    for await (const vital of stream) vitals.push(vital);
    expect(vitals).toEqual([{
      kind: 'heart_rate', value: 72, unit: 'bpm',
      observedAt: '2026-07-18T10:00:00.000Z', quality: 'good'
    }]);
    const commandBodies = fetchImpl.mock.calls
      .filter(([url]) => url.endsWith('/commands'))
      .map(([, request]) => JSON.parse(request.body).command);
    expect(commandBodies).toContain('vl.edge.motion.emergency_stop');
    expect(commandBodies).toContain('vl.edge.configuration.apply');
  });

  test('signed ActionGateway output is forwarded unchanged and target mismatch fails closed', async () => {
    const fetchImpl = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({
        action_id: '123e4567-e89b-42d3-a456-426614174000',
        state: 'accepted',
        ok: true
      }, 202));
    const adapter = new YongyidaAdapter(adapterOptions(fetchImpl));
    await adapter.initialize({ deviceId: 'robot-device-001' });
    const signed = Object.freeze({
      envelope: Object.freeze({
        version: 2 as const,
        id: '123e4567-e89b-42d3-a456-426614174000',
        issued_at: 1_752_832_800_000,
        expires_at: 1_752_832_860_000,
        action: 'check_medication',
        device_type: 'home_robot' as const,
        adapter_id: 'home-primary',
        contract_version: 'vl-robot-action/2' as const,
        device_id: 'private-account-device-001',
        manufacturer_device_id: 'robot-device-001',
        binding_epoch: 7,
        parameters: Object.freeze({ reminder_id: 'reminder-001' })
      }),
      payload: 'ZXhhY3Qtc2lnbmVkLXBheWxvYWQ',
      signature: 'a'.repeat(86),
      algorithm: 'Ed25519' as const
    }) satisfies SignedRobotAction;
    const before = JSON.stringify(signed);

    await expect(adapter.deliverSignedAction(signed)).resolves.toEqual({
      status: 'accepted', statusCode: 202, acknowledged: false
    });
    expect(fetchImpl.mock.calls[1]![1].body).toBe(before);
    expect(fetchImpl.mock.calls[1]![1].headers['Idempotency-Key']).toBe(signed.envelope.id);
    expect(JSON.stringify(signed)).toBe(before);

    const wrongTarget: SignedRobotAction = {
      ...signed,
      envelope: { ...signed.envelope, manufacturer_device_id: 'robot-device-002' }
    };
    await expect(adapter.deliverSignedAction(wrongTarget)).rejects.toMatchObject({
      code: 'ADAPTER_REQUEST_INVALID'
    });
    const invalidEpoch: SignedRobotAction = {
      ...signed,
      envelope: { ...signed.envelope, binding_epoch: 0 }
    };
    await expect(adapter.deliverSignedAction(invalidEpoch)).rejects.toMatchObject({
      code: 'ADAPTER_REQUEST_INVALID'
    });
    const legacyContract = {
      ...signed,
      envelope: {
        ...signed.envelope,
        version: 1,
        contract_version: 'vl-robot-action/1'
      }
    } as unknown as SignedRobotAction;
    await expect(adapter.deliverSignedAction(legacyContract)).rejects.toMatchObject({
      code: 'ADAPTER_REQUEST_INVALID'
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('signed-action receipts and freshness fail closed', async () => {
    const fetchImpl = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({ action_id: 'wrong-id', state: 'accepted', ok: true }, 202));
    const adapter = new YongyidaAdapter(adapterOptions(fetchImpl, { wallClockNow: () => 1_752_832_810_000 }));
    await adapter.initialize({ deviceId: 'robot-device-001' });
    const signed: SignedRobotAction = {
      envelope: {
        version: 2,
        id: '123e4567-e89b-42d3-a456-426614174000',
        issued_at: 1_752_832_800_000,
        expires_at: 1_752_832_860_000,
        action: 'check_medication',
        device_type: 'home_robot',
        adapter_id: 'home-primary',
        contract_version: 'vl-robot-action/2',
        device_id: 'private-account-device-001',
        manufacturer_device_id: 'robot-device-001',
        binding_epoch: 7,
        parameters: {}
      },
      payload: 'ZXhhY3Qtc2lnbmVkLXBheWxvYWQ',
      signature: 'a'.repeat(86),
      algorithm: 'Ed25519'
    };
    await expect(adapter.deliverSignedAction(signed)).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });

    const expiredAdapter = new YongyidaAdapter(adapterOptions(jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true })), {
      adapterId: 'home-primary',
      wallClockNow: () => signed.envelope.expires_at
    }));
    await expiredAdapter.initialize({ deviceId: 'robot-device-001' });
    await expect(expiredAdapter.deliverSignedAction(signed)).rejects.toMatchObject({ code: 'ADAPTER_ACTION_EXPIRED' });
  });

  test('structured logs are allowlisted and never contain payloads, keys, URLs, IPs or PII', async () => {
    const entries: unknown[] = [];
    const logger = {
      info: (entry: unknown) => entries.push(entry),
      warn: (entry: unknown) => entries.push(entry),
      error: (entry: unknown) => entries.push(entry)
    };
    const secret = 'api-key-super-secret';
    const privateMedicine = 'PrivateMedicationName';
    const fetchImpl = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockRejectedValueOnce(new Error(`${secret} ${privateMedicine} 192.168.1.20 serial=ABC123 user@example.test`));
    const adapter = new YongyidaAdapter(adapterOptions(fetchImpl, {
      apiKey: secret,
      logger,
      maxAttempts: 1
    }));
    await adapter.initialize({ deviceId: 'hardware-serial-ABC123' });
    await expect(adapter.sendMedicationReminder(
      { id: 'medication-001', name: privateMedicine },
      { id: 'private-user-001' }
    )).rejects.toMatchObject({ code: 'ADAPTER_NETWORK_FAILED' });

    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(privateMedicine);
    expect(serialized).not.toContain('192.168.1.20');
    expect(serialized).not.toContain('ABC123');
    expect(serialized).not.toContain('user@example.test');
    expect(serialized).not.toContain('body');
    expect(serialized).not.toContain('https://');

    expect(createSafeAdapterLogEntry('unsafe event', {
      adapterId: 'bad adapter id with spaces',
      vendor: 'jiangzhi',
      operation: 'unsafe operation',
      outcome: 'failure',
      errorCode: 'bad detail with secret'
    })).toEqual({
      event: 'robot_adapter.unknown', adapterId: '[REDACTED]', vendor: 'jiangzhi',
      operation: 'unknown', outcome: 'failure'
    });

    expect(JSON.stringify(createSafeAdapterLogEntry('robot_adapter.request.failure', {
      adapterId: '192.168.1.20',
      vendor: 'jiangzhi',
      operation: 'activate_alarm',
      outcome: 'failure'
    }))).not.toContain('192.168.1.20');
  });

  test('a broken observability sink cannot fail or retry a safety command', async () => {
    const fetchImpl = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true, command_id: 'command-safe-1', state: 'completed' }));
    const adapter = new YongyidaAdapter(adapterOptions(fetchImpl, {
      logger: { info: () => { throw new Error('logging backend unavailable'); } },
      onMetric: () => { throw new Error('metrics backend unavailable'); }
    }));

    await adapter.initialize({ deviceId: 'robot-device-001' });
    await expect(adapter.emergencyStop()).resolves.toMatchObject({
      success: true, commandId: 'command-safe-1', state: 'completed'
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('registry lookup/removal and configuration validation fail closed', () => {
    const registry = new RobotAdapterRegistry();
    expect(registry.get('missing')).toBeUndefined();
    expect(() => registry.require('missing')).toThrow(RobotAdapterError);
    expect(registry.remove('missing')).toBe(false);
    expect(() => new JiangzhiAdapter(adapterOptions(jest.fn<FetchLike>(), {
      baseUrl: 'http://192.168.1.100',
      allowInsecureHttp: false
    }))).toThrow(RobotAdapterError);

    const cloud = new YongyidaAdapter(adapterOptions(jest.fn<FetchLike>()));
    const edge = new JiangzhiAdapter(adapterOptions(jest.fn<FetchLike>(), { adapterId: 'edge-1' }));
    const cloudTranslate = Reflect.get(cloud, 'translateOperation') as (operation: string) => string;
    const edgeTranslate = Reflect.get(edge, 'translateOperation') as (operation: string) => string;
    expect(() => cloudTranslate.call(cloud, 'unsupported')).toThrow(RobotAdapterError);
    expect(() => edgeTranslate.call(edge, 'unsupported')).toThrow(RobotAdapterError);
  });
});
