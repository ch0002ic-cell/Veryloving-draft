import { afterEach, describe, expect, test } from '@jest/globals';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { JiangzhiAdapter } from '../../src/adapters/JiangzhiAdapter';
import type { FetchLike } from '../../src/adapters/RestRobotAdapter';
import { YongyidaAdapter } from '../../src/adapters/YongyidaAdapter';
import {
  createManufacturerMockServer,
  type ManufacturerMockLogEntry,
  type ManufacturerMockServer
} from '../ManufacturerMockServer';

const API_KEY = 'mock-server-only-api-key';
const ACCESS_TOKEN = 'mock-development-access-token';
const SESSION_TOKEN = 'mock-development-session-token';

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe('ManufacturerMockServer', () => {
  let activeServer: ManufacturerMockServer | undefined;

  afterEach(async () => {
    await activeServer?.stop();
    activeServer = undefined;
  });

  test('serves authentication, command, status, and 1 Hz SSE telemetry without logging secrets', async () => {
    const logs: ManufacturerMockLogEntry[] = [];
    activeServer = createManufacturerMockServer({
      environment: 'test',
      port: 0,
      latencyMinMs: 0,
      latencyMaxMs: 0,
      telemetryIntervalMs: 1_000,
      log: (entry) => logs.push(entry)
    });
    const [firstAddress, secondAddress] = await Promise.all([activeServer.start(), activeServer.start()]);
    expect(secondAddress).toEqual(firstAddress);
    const { baseUrl } = firstAddress;
    const deviceId = 'private-home-device-001';

    const authentication = await fetch(new URL('/api/v1/authenticate', baseUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId })
    });
    expect(authentication.status).toBe(200);
    expect(await json(authentication)).toMatchObject({ access_token: ACCESS_TOKEN, token_type: 'Bearer' });

    const command = await fetch(new URL('/api/v1/command', baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'manual-command-001'
      },
      body: JSON.stringify({ device_id: deviceId, command: 'SEND_MEDICATION_REMINDER', parameters: {} })
    });
    expect(command.status).toBe(202);
    expect(await json(command)).toMatchObject({ success: true, state: 'accepted', duplicate: false });

    const status = await fetch(new URL(`/api/v1/status/${deviceId}`, baseUrl), {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });
    expect(status.status).toBe(200);
    expect(await json(status)).toMatchObject({ device_id: deviceId, online: true, battery_percentage: 78 });

    const controller = new AbortController();
    const telemetry = await fetch(new URL(`/api/v1/telemetry/${deviceId}`, baseUrl), {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      signal: controller.signal
    });
    expect(telemetry.status).toBe(200);
    expect(telemetry.headers.get('content-type')).toContain('text/event-stream');
    const firstChunk = await telemetry.body?.getReader().read();
    expect(new TextDecoder().decode(firstChunk?.value)).toContain('event: telemetry');
    expect(new TextDecoder().decode(firstChunk?.value)).toContain('"synthetic":true');
    controller.abort();

    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain(deviceId);
    expect(serializedLogs).not.toContain(API_KEY);
    expect(serializedLogs).not.toContain(ACCESS_TOKEN);
    expect(logs.map(({ route }) => route)).toEqual(expect.arrayContaining([
      '/api/v1/authenticate',
      '/api/v1/command',
      '/api/v1/status/{deviceId}',
      '/api/v1/telemetry/{deviceId}'
    ]));
  });

  test('serializes commands per device, deduplicates retries, and rejects oversized bodies', async () => {
    activeServer = createManufacturerMockServer({
      environment: 'test',
      port: 0,
      latencyMinMs: 15,
      latencyMaxMs: 15,
      maxRequestBytes: 128,
      log: () => undefined
    });
    const { baseUrl } = await activeServer.start();
    const send = (
      idempotencyKey: string,
      deviceId = 'queue-device-001',
      command = 'ACTIVATE_FALL_ALERT'
    ) => fetch(
      new URL('/api/v1/command', baseUrl),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({ device_id: deviceId, command, parameters: {} })
      }
    );

    const results = await Promise.all([send('queue-001'), send('queue-002'), send('other-001', 'other-device-001')]);
    expect(results.every(({ status }) => status === 202)).toBe(true);
    const firstPayload = await json(results[0]!);
    const records = activeServer.getCommandRecords();
    const sameDevice = records.filter(({ deviceId }) => deviceId === 'queue-device-001');
    expect(sameDevice).toHaveLength(2);
    expect(sameDevice[1]!.startedAt).toBeGreaterThanOrEqual(sameDevice[0]!.completedAt);

    const duplicate = await send('queue-001');
    expect(await json(duplicate)).toMatchObject({ command_id: firstPayload.command_id, duplicate: true });
    expect(activeServer.getCommandRecords()).toHaveLength(3);
    const conflict = await send('queue-001', 'queue-device-001', 'EMERGENCY_STOP');
    expect(conflict.status).toBe(409);
    expect(await json(conflict)).toEqual({ error: 'IDEMPOTENCY_CONFLICT' });

    const oversized = await fetch(new URL('/api/v1/authenticate', baseUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'large-device', padding: 'x'.repeat(256) })
    });
    expect(oversized.status).toBe(413);
    expect(await json(oversized)).toEqual({ error: 'REQUEST_TOO_LARGE' });
  });

  test('both adapters execute their real provisional bridge contract against the simulator', async () => {
    activeServer = createManufacturerMockServer({
      environment: 'test', port: 0, latencyMinMs: 0, latencyMaxMs: 0, log: () => undefined
    });
    const { baseUrl } = await activeServer.start();
    const shared = {
      baseUrl,
      apiKey: API_KEY,
      fetchImpl: globalThis.fetch as unknown as FetchLike,
      allowInsecureHttp: true,
      allowProvisionalUnsignedCommands: true,
      maxAttempts: 1,
      logger: { log: () => undefined }
    };
    const yongyida = new YongyidaAdapter({ ...shared, adapterId: 'yongyida-cloud' });
    const jiangzhi = new JiangzhiAdapter({ ...shared, adapterId: 'jiangzhi-edge' });

    await Promise.all([
      yongyida.initialize({ deviceId: 'shared-device-001' }),
      jiangzhi.initialize({ deviceId: 'shared-device-001' })
    ]);
    await expect(yongyida.sendMedicationReminder({
      id: 'medicine-001', name: 'Synthetic medicine', requestId: 'adapter-command-001'
    }, { id: 'test-user-001' })).resolves.toMatchObject({ success: true, state: 'accepted' });
    await expect(jiangzhi.sendMedicationReminder({
      id: 'medicine-001', name: 'Synthetic medicine', requestId: 'adapter-command-001'
    }, { id: 'test-user-001' })).resolves.toMatchObject({ success: true, state: 'accepted' });
    const snapshot = await jiangzhi.getTelemetrySnapshot();
    expect(snapshot).toMatchObject({
      status: { online: true, firmwareVersion: 'mock-jzkh-1.0.0' },
      battery: { percentage: 78 }
    });
    expect(snapshot.vitals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'heart_rate', value: 72 })
    ]));
  });

  test('supports deterministic failures and cannot run in production', async () => {
    expect(() => createManufacturerMockServer({ environment: 'production' }))
      .toThrow('disabled in production');
    expect(() => createManufacturerMockServer({ environment: 'staging' }))
      .toThrow('requires NODE_ENV=development or NODE_ENV=test');
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      readonly scripts?: Readonly<Record<string, string>>;
    };
    expect(packageJson.scripts?.['mock:manufacturer']).not.toContain('NODE_ENV=development');

    activeServer = createManufacturerMockServer({
      environment: 'test',
      port: 0,
      latencyMinMs: 0,
      latencyMaxMs: 0,
      failureRate: 0.05,
      random: () => 0,
      log: () => undefined
    });
    const { baseUrl } = await activeServer.start();
    const response = await fetch(new URL('/api/v1/status/failure-device-001', baseUrl), {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({ error: 'SIMULATED_FAILURE' });
  });

  test('verifies signed actions and deduplicates only byte-equivalent retries', async () => {
    const keyPair = generateKeyPairSync('ed25519');
    const currentTime = 1_752_832_800_000;
    activeServer = createManufacturerMockServer({
      environment: 'test',
      port: 0,
      latencyMinMs: 0,
      latencyMaxMs: 0,
      now: () => currentTime,
      signedActionPublicKey: keyPair.publicKey,
      log: () => undefined
    });
    const { baseUrl } = await activeServer.start();
    const actionId = '123e4567-e89b-42d3-a456-426614174000';
    const createAction = (
      action: string,
      { adapterId = 'yongyida-cloud' }: { readonly adapterId?: string } = {}
    ) => {
      const envelope = {
        version: 2,
        id: actionId,
        issued_at: currentTime,
        expires_at: currentTime + 60_000,
        action,
        device_type: 'home_robot',
        adapter_id: adapterId,
        contract_version: 'vl-robot-action/2',
        device_id: 'account-device-001',
        manufacturer_device_id: 'signed-device-001',
        binding_epoch: 1,
        parameters: {}
      };
      const payload = Buffer.from(JSON.stringify(envelope)).toString('base64url');
      return {
        envelope,
        payload,
        signature: sign(null, Buffer.from(payload, 'ascii'), keyPair.privateKey).toString('base64url'),
        algorithm: 'Ed25519'
      };
    };
    const send = (body: Record<string, unknown>) => fetch(
      new URL('/v1/veryloving/yongyida-cloud/signed-actions', baseUrl),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': actionId,
          'X-Veryloving-Session': SESSION_TOKEN
        },
        body: JSON.stringify(body)
      }
    );

    const action = createAction('check_medication');
    expect((await send(action)).status).toBe(202);
    expect((await send(action)).status).toBe(202);
    expect(activeServer.getCommandRecords()).toHaveLength(1);

    const changed = await send(createAction('cognitive_engagement'));
    expect(changed.status).toBe(409);
    expect(await json(changed)).toEqual({ error: 'IDEMPOTENCY_CONFLICT' });
    expect(activeServer.getCommandRecords()).toHaveLength(1);

    const forged = await send({ ...action, signature: 'a'.repeat(86) });
    expect(forged.status).toBe(401);
    expect(await json(forged)).toEqual({ error: 'SIGNED_ACTION_UNVERIFIED' });

    const crossVendor = await send(createAction('check_medication', { adapterId: 'jiangzhi-edge' }));
    expect(crossVendor.status).toBe(400);
    expect(await json(crossVendor)).toEqual({ error: 'SIGNED_ACTION_INVALID' });
  });

  test('bounds global requests, queue keys, SSE streams, and closes timed-out bodies', async () => {
    activeServer = createManufacturerMockServer({
      environment: 'test',
      port: 0,
      latencyMinMs: 50,
      latencyMaxMs: 50,
      requestTimeoutMs: 100,
      maxConcurrentRequests: 1,
      maxQueueKeys: 1,
      maxQueuedCommandsTotal: 1,
      maxTelemetryStreams: 1,
      log: () => undefined
    });
    const { baseUrl, port } = await activeServer.start();
    const statusRequest = () => fetch(new URL('/api/v1/status/capacity-device-001', baseUrl), {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });
    const [firstStatus, secondStatus] = await Promise.all([statusRequest(), statusRequest()]);
    expect([firstStatus.status, secondStatus.status].sort()).toEqual([200, 503]);

    await activeServer.stop();
    activeServer = createManufacturerMockServer({
      environment: 'test',
      port: 0,
      latencyMinMs: 50,
      latencyMaxMs: 50,
      requestTimeoutMs: 100,
      maxConcurrentRequests: 10,
      maxQueueKeys: 1,
      maxQueuedCommandsTotal: 1,
      maxTelemetryStreams: 1,
      log: () => undefined
    });
    const secondAddress = await activeServer.start();
    const command = (deviceId: string, key: string) => fetch(new URL('/api/v1/command', secondAddress.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key
      },
      body: JSON.stringify({ device_id: deviceId, command: 'ACTIVATE_FALL_ALERT', parameters: {} })
    });
    const [queued, rejected] = await Promise.all([
      command('bounded-device-001', 'bounded-command-001'),
      command('bounded-device-002', 'bounded-command-002')
    ]);
    expect(queued.status).toBe(202);
    expect(rejected.status).toBe(429);
    expect(await json(rejected)).toEqual({ error: 'COMMAND_QUEUE_KEYS_FULL' });

    const firstController = new AbortController();
    const firstStream = await fetch(
      new URL('/api/v1/telemetry/bounded-device-001', secondAddress.baseUrl),
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }, signal: firstController.signal }
    );
    expect(firstStream.status).toBe(200);
    const secondStream = await fetch(
      new URL('/api/v1/telemetry/bounded-device-002', secondAddress.baseUrl),
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
    );
    expect(secondStream.status).toBe(429);
    expect(await json(secondStream)).toEqual({ error: 'TELEMETRY_STREAM_CAPACITY_EXCEEDED' });
    firstController.abort();

    const slowResponse = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const socket = connect(secondAddress.port, secondAddress.host, () => {
        socket.write([
          'POST /api/v1/authenticate HTTP/1.1',
          `Host: ${secondAddress.host}`,
          `Authorization: Bearer ${API_KEY}`,
          'Content-Type: application/json',
          'Content-Length: 100',
          '',
          '{'
        ].join('\r\n'));
      });
      const deadline = setTimeout(() => {
        socket.destroy();
        reject(new Error('Slow request socket was not closed'));
      }, 2_000);
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      socket.once('error', reject);
      socket.once('close', () => {
        clearTimeout(deadline);
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    expect(slowResponse).toContain('408 Request Timeout');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(activeServer.getResourceSnapshot()).toMatchObject({
      activeRequests: 0,
      telemetryStreams: 0,
      queueKeys: 0,
      queuedCommands: 0
    });
  });
});
