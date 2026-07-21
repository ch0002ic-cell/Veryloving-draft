import { describe, expect, jest, test } from '@jest/globals';
import { RobotAdapterError } from '../AdapterErrors';
import {
  AdapterFactory,
  RobotAdapterRegistry,
  type RobotAdapterConfiguration
} from '../AdapterFactory';
import { JiangzhiAdapter } from '../JiangzhiAdapter';
import {
  readBoundedJsonObject,
  type BridgeResponse,
  type FetchLike
} from '../RestRobotAdapter';
import type { RobotAdapter, SignedRobotAction } from '../RobotAdapter';
import {
  createSafeAdapterLogEntry,
  createStructuredAdapterLogger
} from '../StructuredAdapterLogger';
import { YongyidaAdapter } from '../YongyidaAdapter';

function jsonResponse(payload: unknown, status = 200, headers?: Record<string, string>): BridgeResponse {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  }) as unknown as BridgeResponse;
}

function options(fetchImpl: FetchLike, overrides: Record<string, unknown> = {}) {
  let id = 0;
  return {
    adapterId: 'home-primary',
    baseUrl: 'https://bridge.example.test/root/',
    apiKey: 'server-only-key',
    fetchImpl,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    sleep: async () => undefined,
    random: () => 0.5,
    idGenerator: () => `branch-request-${++id}`,
    wallClockNow: () => 1_000,
    allowProvisionalUnsignedCommands: true,
    ...overrides
  };
}

function signedAction(
  envelopeOverrides: Partial<SignedRobotAction['envelope']> = {}
): SignedRobotAction {
  return {
    envelope: {
      version: 2,
      id: '123e4567-e89b-42d3-a456-426614174000',
      issued_at: 500,
      expires_at: 2_000,
      action: 'check_medication',
      device_type: 'home_robot',
      adapter_id: 'home-primary',
      contract_version: 'vl-robot-action/2',
      device_id: 'private-device-001',
      manufacturer_device_id: 'robot-device-001',
      binding_epoch: 7,
      parameters: {},
      ...envelopeOverrides
    },
    payload: 'ZXhhY3Qtc2lnbmVkLXBheWxvYWQ',
    signature: 'a'.repeat(86),
    algorithm: 'Ed25519'
  };
}

describe('adapter hardening branches', () => {
  test('bounded reader supports stream, arrayBuffer and text fallbacks and rejects bad bodies', async () => {
    const encoder = new TextEncoder();
    const arrayBytes = encoder.encode('{"source":"array"}');
    const arrayResponse: BridgeResponse = {
      ok: true,
      status: 200,
      headers: { get: () => String(arrayBytes.byteLength) },
      body: null,
      arrayBuffer: async () => arrayBytes.buffer as ArrayBuffer
    };
    await expect(readBoundedJsonObject(arrayResponse, 128)).resolves.toEqual({ source: 'array' });
    await expect(readBoundedJsonObject(arrayResponse, 2)).rejects.toMatchObject({
      code: 'ADAPTER_RESPONSE_TOO_LARGE'
    });

    const textOnly: BridgeResponse = {
      ok: true,
      status: 200,
      headers: { get: () => String(new TextEncoder().encode('{"source":"text"}').byteLength) },
      body: null,
      text: async () => '{"source":"text"}'
    };
    await expect(readBoundedJsonObject(textOnly, 128)).resolves.toEqual({ source: 'text' });
    await expect(readBoundedJsonObject(textOnly, 2)).rejects.toMatchObject({
      code: 'ADAPTER_RESPONSE_TOO_LARGE'
    });
    await expect(readBoundedJsonObject({ ok: true, status: 200, body: null }, 128))
      .rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });

    const empty: BridgeResponse = {
      ok: true,
      status: 200,
      headers: { get: () => '0' },
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0)
    };
    await expect(readBoundedJsonObject(empty, 128)).rejects.toMatchObject({
      code: 'ADAPTER_RESPONSE_INVALID'
    });
    const arrayPayload = encoder.encode('[]');
    await expect(readBoundedJsonObject({
      ok: true,
      status: 200,
      headers: { get: () => String(arrayPayload.byteLength) },
      body: null,
      arrayBuffer: async () => arrayPayload.buffer as ArrayBuffer
    }, 128)).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });

    const unboundedText = jest.fn(async () => '{"source":"unbounded"}');
    await expect(readBoundedJsonObject({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: null,
      text: unboundedText
    }, 128)).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });
    expect(unboundedText).not.toHaveBeenCalled();

    const invalidCancel = jest.fn(async () => undefined);
    await expect(readBoundedJsonObject({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => ({ done: false, value: 'invalid' as unknown as Uint8Array }),
          cancel: invalidCancel
        })
      }
    }, 128)).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });
    expect(invalidCancel).toHaveBeenCalledTimes(1);

    const oversizedCancel = jest.fn(async () => undefined);
    await expect(readBoundedJsonObject({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => ({ done: false, value: new Uint8Array(4) }),
          cancel: oversizedCancel
        })
      }
    }, 2)).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_TOO_LARGE' });
    expect(oversizedCancel).toHaveBeenCalledTimes(1);
  });

  test('constructor, factory and registry configuration branches fail closed', () => {
    const fetchImpl = jest.fn<FetchLike>();
    expect(() => new YongyidaAdapter(options(fetchImpl, { adapterId: 'INVALID ID' })))
      .toThrow(RobotAdapterError);
    expect(() => new YongyidaAdapter(options(fetchImpl, { baseUrl: 'not a url' })))
      .toThrow(RobotAdapterError);
    expect(() => new YongyidaAdapter(options(fetchImpl, { baseUrl: 'https://user:pass@example.test' })))
      .toThrow(RobotAdapterError);
    expect(() => new YongyidaAdapter(options(fetchImpl, { apiKey: 'short' })))
      .toThrow(RobotAdapterError);
    expect(() => new YongyidaAdapter(options(fetchImpl, { maxAttempts: 0 })))
      .toThrow(RobotAdapterError);
    expect(() => new JiangzhiAdapter(options(fetchImpl, {
      baseUrl: 'http://192.0.2.10', allowInsecureHttp: true
    }))).not.toThrow();

    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: undefined });
    try {
      const withoutFetch = options(fetchImpl);
      delete (withoutFetch as { fetchImpl?: FetchLike }).fetchImpl;
      expect(() => new YongyidaAdapter(withoutFetch)).toThrow(RobotAdapterError);
    } finally {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true, writable: true, value: originalFetch
      });
    }

    const factory = new AdapterFactory();
    expect(factory.createRegistry().size).toBe(0);
    expect(() => factory.create({
      vendor: 'unsupported'
    } as unknown as RobotAdapterConfiguration)).toThrow(RobotAdapterError);
    const registry = new RobotAdapterRegistry();
    expect(() => registry.register({} as RobotAdapter)).toThrow(RobotAdapterError);
    expect(registry.has('missing')).toBe(false);
  });

  test('default id generation and sleep paths work without injected helpers', async () => {
    const fetchImpl = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({ error: 'retry' }, 503))
      .mockResolvedValueOnce(jsonResponse({ success: true, command_id: 'command-defaults', state: 'completed' }));
    const adapter = new YongyidaAdapter({
      adapterId: 'defaults',
      baseUrl: 'https://bridge.example.test',
      apiKey: 'server-only-key',
      fetchImpl,
      logger: { info() {}, warn() {}, error() {} },
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      wallClockNow: () => 1_000,
      allowProvisionalUnsignedCommands: true
    });
    await adapter.initialize({ deviceId: 'robot-device-001' });
    await expect(adapter.emergencyStop()).resolves.toMatchObject({ commandId: 'command-defaults' });
    expect(fetchImpl.mock.calls[1]![1].headers['Idempotency-Key'])
      .toBe(fetchImpl.mock.calls[2]![1].headers['Idempotency-Key']);
  });

  test('initialization identity and public request validation cover rejection paths', async () => {
    const fetchImpl = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true, command_id: 'med-command', state: 'accepted' }));
    const adapter = new YongyidaAdapter(options(fetchImpl, { maxRequestBytes: 1_024 }));

    await expect(adapter.emergencyStop()).rejects.toMatchObject({ code: 'ADAPTER_NOT_INITIALIZED' });
    await expect(adapter.initialize({ deviceId: '' })).rejects.toMatchObject({ code: 'ADAPTER_REQUEST_INVALID' });
    await adapter.initialize({ deviceId: 'robot-device-001' });
    await expect(adapter.initialize({ deviceId: 'robot-device-001' })).resolves.toBeUndefined();
    await expect(adapter.initialize({ deviceId: 'robot-device-002' }))
      .rejects.toMatchObject({ code: 'ADAPTER_INITIALIZATION_CONFLICT' });

    await expect(adapter.sendMedicationReminder({
      id: 'medication-001',
      name: 'medicine',
      dosage: 'one',
      instructions: 'after food',
      scheduledAt: '2026-07-18T10:00:00.000Z'
    }, { id: 'account-001' })).resolves.toMatchObject({ commandId: 'med-command' });
    await expect(adapter.sendMedicationReminder({
      id: 'medication-001', name: 'medicine', scheduledAt: 'not-a-date'
    }, { id: 'account-001' })).rejects.toMatchObject({ code: 'ADAPTER_REQUEST_INVALID' });
    await expect(adapter.playSoothingAudio('audio-1', 101))
      .rejects.toMatchObject({ code: 'ADAPTER_REQUEST_INVALID' });
    await expect(adapter.setConfig({ values: [] as unknown as Record<string, never> }))
      .rejects.toMatchObject({ code: 'ADAPTER_REQUEST_INVALID' });

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(adapter.setConfig({ values: circular as never }))
      .rejects.toMatchObject({ code: 'ADAPTER_REQUEST_INVALID' });
    await expect(adapter.setConfig({ values: { large: 'x'.repeat(2_048) } }))
      .rejects.toMatchObject({ code: 'ADAPTER_REQUEST_INVALID' });
    await expect(adapter.setConfig({ values: {}, requestId: 'invalid key' }))
      .rejects.toMatchObject({ code: 'ADAPTER_REQUEST_INVALID' });
  });

  test('authentication payload and strict command/status parsers reject malformed success bodies', async () => {
    const unauthenticated = new YongyidaAdapter(options(
      jest.fn<FetchLike>().mockResolvedValueOnce(jsonResponse({ authenticated: false }))
    ));
    await expect(unauthenticated.initialize({ deviceId: 'robot-device-001' }))
      .rejects.toMatchObject({ code: 'ADAPTER_AUTH_FAILED' });

    const responses = [
      jsonResponse({ authenticated: true }),
      jsonResponse({ success: true, state: 'accepted' }),
      jsonResponse({ success: true, command_id: 'command-1', state: 'rejected' }),
      jsonResponse({ success: true, command_id: 'command-2', state: 'accepted', accepted_at: 'invalid' }),
      jsonResponse({ command_id: 'safety-1', accepted: true, findings: 'invalid' }),
      jsonResponse({ command_id: 'safety-2', accepted: true, findings: [{ code: 'x', severity: 'invalid' }] }),
      jsonResponse({ command_id: 'call-1', state: 'invalid' }),
      jsonResponse({ percentage: 101, charging: false, observed_at: '2026-07-18T10:00:00.000Z' }),
      jsonResponse({ online: true, state: 'invalid', observed_at: '2026-07-18T10:00:00.000Z' }),
      jsonResponse({ online: true, state: 'offline', observed_at: '2026-07-18T10:00:00.000Z' }),
      jsonResponse({ online: false, state: 'offline', observed_at: '2026-07-18T10:00:00.000Z' })
    ];
    const fetchImpl = jest.fn<FetchLike>().mockImplementation(async () => responses.shift()!);
    const adapter = new JiangzhiAdapter(options(fetchImpl));
    await adapter.initialize({ deviceId: 'robot-device-001' });

    await expect(adapter.activateAlarm()).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });
    await expect(adapter.activateAlarm()).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });
    await expect(adapter.activateAlarm()).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });
    await expect(adapter.executeSafetyCheck('kitchen')).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });
    await expect(adapter.executeSafetyCheck('kitchen')).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });
    await expect(adapter.startTwoWayVoiceCall('contact-001')).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });
    await expect(adapter.getBatteryStatus()).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });
    await expect(adapter.getDeviceStatus()).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });
    await expect(adapter.getDeviceStatus()).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });
    await expect(adapter.getDeviceStatus()).resolves.toEqual({
      online: false, state: 'offline', observedAt: '2026-07-18T10:00:00.000Z'
    });
  });

  test('vital pagination validates cursors, samples and page limits', async () => {
    const pagedFetch = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{
          kind: 'heart_rate', value: 70, unit: 'bpm', observed_at: '2026-07-18T10:00:00.000Z'
        }],
        next_cursor: 'next-page'
      }))
      .mockResolvedValueOnce(jsonResponse({ items: [], next_cursor: null }));
    const paged = new JiangzhiAdapter(options(pagedFetch));
    await paged.initialize({ deviceId: 'robot-device-001' });
    const values: unknown[] = [];
    for await (const value of await paged.streamVitals()) values.push(value);
    expect(values).toHaveLength(1);
    expect(JSON.parse(pagedFetch.mock.calls[2]![1].body)).toMatchObject({ cursor: 'next-page' });

    const invalidItemFetch = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({ items: [{
        kind: 'unknown', value: 1, unit: 'x', observed_at: '2026-07-18T10:00:00.000Z'
      }] }));
    const invalidItem = new JiangzhiAdapter(options(invalidItemFetch));
    await invalidItem.initialize({ deviceId: 'robot-device-001' });
    await expect(async () => {
      for await (const _value of await invalidItem.streamVitals()) { /* consume */ }
    }).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });

    const invalidPageFetch = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({ items: 'invalid' }));
    const invalidPage = new JiangzhiAdapter(options(invalidPageFetch));
    await invalidPage.initialize({ deviceId: 'robot-device-001' });
    await expect(async () => {
      for await (const _value of await invalidPage.streamVitals()) { /* consume */ }
    }).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });

    const limitedFetch = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({ items: [], next_cursor: 'still-more' }));
    const limited = new JiangzhiAdapter(options(limitedFetch, { maxTelemetryPages: 1 }));
    await limited.initialize({ deviceId: 'robot-device-001' });
    await expect(async () => {
      for await (const _value of await limited.streamVitals()) { /* consume */ }
    }).rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });
  });

  test('signed receipts enforce terminal semantics and retry expiry', async () => {
    const completedFetch = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({
        action_id: '123e4567-e89b-42d3-a456-426614174000',
        state: 'completed',
        ok: true
      }, 200));
    const completed = new YongyidaAdapter(options(completedFetch));
    await completed.initialize({ deviceId: 'robot-device-001' });
    await expect(completed.deliverSignedAction(signedAction())).resolves.toEqual({
      status: 'acknowledged', statusCode: 200, acknowledged: true
    });

    const inconsistentFetch = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({
        action_id: '123e4567-e89b-42d3-a456-426614174000',
        state: 'completed',
        ok: false
      }, 200));
    const inconsistent = new YongyidaAdapter(options(inconsistentFetch));
    await inconsistent.initialize({ deviceId: 'robot-device-001' });
    await expect(inconsistent.deliverSignedAction(signedAction()))
      .rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });

    const rejectedFetch = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({
        action_id: '123e4567-e89b-42d3-a456-426614174000',
        state: 'rejected',
        ok: false
      }, 200));
    const rejected = new YongyidaAdapter(options(rejectedFetch));
    await rejected.initialize({ deviceId: 'robot-device-001' });
    await expect(rejected.deliverSignedAction(signedAction()))
      .rejects.toMatchObject({ code: 'ADAPTER_RESPONSE_INVALID' });

    const wallClockNow = jest.fn<() => number>()
      .mockReturnValueOnce(600)
      .mockReturnValueOnce(600)
      .mockReturnValueOnce(600)
      .mockReturnValue(2_000);
    const attempts: number[] = [];
    const retryFetch = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({ error: 'retry' }, 503, { 'Retry-After': '5' }));
    const sleep = jest.fn<(milliseconds: number) => Promise<void>>(async () => undefined);
    const expiring = new YongyidaAdapter(options(retryFetch, {
      wallClockNow,
      maxAttempts: 3,
      retryMaxDelayMs: 2_000,
      sleep,
      onAttempt: (operation: string, attempt: number) => {
        if (operation === 'deliver_signed_action') attempts.push(attempt);
      }
    }));
    await expiring.initialize({ deviceId: 'robot-device-001' });
    await expect(expiring.deliverSignedAction(signedAction()))
      .rejects.toMatchObject({ code: 'ADAPTER_ACTION_EXPIRED', attempts: 1 });
    expect(attempts).toEqual([1]);
    expect(sleep).toHaveBeenCalledWith(2_000, undefined);

    let hookClock = 1_000;
    const delayedFetch = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }));
    const expiresAtAttemptBoundary = new YongyidaAdapter(options(delayedFetch, {
      wallClockNow: () => hookClock,
      onAttempt: (operation: string) => {
        if (operation === 'deliver_signed_action') hookClock = 2_000;
      }
    }));
    await expiresAtAttemptBoundary.initialize({ deviceId: 'robot-device-001' });
    await expect(expiresAtAttemptBoundary.deliverSignedAction(signedAction()))
      .rejects.toMatchObject({ code: 'ADAPTER_ACTION_EXPIRED', attempts: 0 });
    expect(delayedFetch).toHaveBeenCalledTimes(1);
  });

  test('caller cancellation aborts an active signed-action transport without retrying', async () => {
    let transportSignal: AbortSignal | undefined;
    const fetchImpl = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockImplementationOnce(async (_url, init) => {
        transportSignal = init.signal as AbortSignal;
        return new Promise<BridgeResponse>(() => undefined);
      });
    const adapter = new YongyidaAdapter(options(fetchImpl, { timeoutMs: 30_000, maxAttempts: 3 }));
    await adapter.initialize({ deviceId: 'robot-device-001' });
    const controller = new AbortController();
    const delivery = adapter.deliverSignedAction(signedAction(), { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(delivery).rejects.toMatchObject({ code: 'ADAPTER_CANCELLED', retryable: false });
    expect(transportSignal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('caller cancellation exits a retry wait and forwards its signal to the sleeper', async () => {
    let releaseSleepStart!: () => void;
    const sleepStarted = new Promise<void>((resolve) => { releaseSleepStart = resolve; });
    let sleepSignal: AbortSignal | undefined;
    const sleep = jest.fn((_milliseconds: number, signal?: AbortSignal) => {
      sleepSignal = signal;
      releaseSleepStart();
      return new Promise<void>(() => undefined);
    });
    const fetchImpl = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({ error: 'retry' }, 503));
    const adapter = new YongyidaAdapter(options(fetchImpl, {
      maxAttempts: 3,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 1_000,
      sleep
    }));
    await adapter.initialize({ deviceId: 'robot-device-001' });
    const controller = new AbortController();
    const delivery = adapter.deliverSignedAction(signedAction(), { signal: controller.signal });
    await sleepStarted;
    controller.abort();
    await expect(delivery).rejects.toMatchObject({ code: 'ADAPTER_CANCELLED' });
    expect(sleepSignal).toBe(controller.signal);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('non-retryable responses tolerate cancellation failures and logger fallback is safe', async () => {
    const cancel = jest.fn(async () => { throw new Error('cancel failed'); });
    const rejectedResponse: BridgeResponse = {
      ok: false,
      status: 400,
      body: { getReader: () => ({ read: async () => ({ done: true }), cancel }) }
    };
    const fetchImpl = jest.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true }))
      .mockResolvedValueOnce(rejectedResponse);
    const adapter = new YongyidaAdapter(options(fetchImpl, { maxAttempts: 3 }));
    await adapter.initialize({ deviceId: 'robot-device-001' });
    await expect(adapter.activateAlarm()).rejects.toMatchObject({
      code: 'ADAPTER_REQUEST_REJECTED', retryable: false, attempts: 1
    });
    expect(cancel).toHaveBeenCalledTimes(1);

    const entries: unknown[] = [];
    createStructuredAdapterLogger({ log: (entry) => entries.push(entry) }).write('debug',
      'robot_adapter.request.success', {
        adapterId: 'adapter_0123456789ab',
        vendor: 'yongyida',
        operation: 'activate_alarm'
      });
    expect(entries).toHaveLength(1);
    expect(createSafeAdapterLogEntry('robot_adapter.request.success', {
      adapterId: 'logical-id',
      vendor: 'yongyida',
      operation: 'activate_alarm'
    })).not.toHaveProperty('outcome');
  });
});
