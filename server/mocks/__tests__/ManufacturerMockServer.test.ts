import { afterEach, describe, expect, test } from '@jest/globals';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
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

async function firstSsePayload(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('SSE response body is unavailable');
  const chunk = await reader.read();
  await reader.cancel();
  const text = new TextDecoder().decode(chunk.value);
  const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) throw new Error('SSE data frame is unavailable');
  return JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>;
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

  test('acknowledges camera readiness with only the exact opaque session reference', async () => {
    activeServer = createManufacturerMockServer({
      environment: 'test',
      port: 0,
      latencyMinMs: 0,
      latencyMaxMs: 0,
      log: () => undefined
    });
    const { baseUrl } = await activeServer.start();
    const opaqueSession = 'camera-session_7Qq7bH_nothing-public';
    const response = await fetch(new URL('/api/v1/command', baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'camera-command-001'
      },
      body: JSON.stringify({
        device_id: 'camera-device-001',
        command: 'share_camera_view',
        parameters: { session_id: opaqueSession }
      })
    });
    expect(response.status).toBe(202);
    const payload = await json(response);
    expect(payload).toMatchObject({
      success: true,
      state: 'accepted',
      camera_ready: true,
      camera_session_ref: opaqueSession
    });
    expect(payload).not.toHaveProperty('camera_url');
    expect(payload).not.toHaveProperty('stream_url');
    expect(payload).not.toHaveProperty('raw_media');
    expect(activeServer.getCommandRecords()).toHaveLength(1);

    const missingSession = await fetch(new URL('/api/v1/command', baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'camera-command-002'
      },
      body: JSON.stringify({
        device_id: 'camera-device-001',
        command: 'share_camera_view',
        parameters: {}
      })
    });
    expect(missingSession.status).toBe(400);
    expect(await json(missingSession)).toEqual({ error: 'CAMERA_SESSION_INVALID' });
    expect(activeServer.getCommandRecords()).toHaveLength(1);

    const publicUrlAttempt = await fetch(new URL('/api/v1/command', baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'camera-command-003'
      },
      body: JSON.stringify({
        device_id: 'camera-device-001',
        command: 'share_camera_view',
        parameters: {
          session_id: opaqueSession,
          camera_url: 'https://public.example.invalid/camera'
        }
      })
    });
    expect(publicUrlAttempt.status).toBe(400);
    expect(await json(publicUrlAttempt)).toEqual({ error: 'CAMERA_SESSION_INVALID' });
    expect(activeServer.getCommandRecords()).toHaveLength(1);
  });

  test('streams both edge devices simultaneously and exposes only a redacted bounded dashboard', async () => {
    const logs: ManufacturerMockLogEntry[] = [];
    activeServer = createManufacturerMockServer({
      environment: 'test',
      port: 0,
      latencyMinMs: 0,
      latencyMaxMs: 0,
      telemetryIntervalMs: 10,
      fallEventRate: 0,
      stressEventRate: 1,
      medicationReminderEveryTicks: 1,
      random: () => 0,
      log: (entry) => logs.push(entry)
    });
    const simulationServer = activeServer;
    const { baseUrl } = await simulationServer.start();
    const rawWearableId = 'private-wearable-device-001';
    const rawRobotId = 'private-robot-device-001';
    const wearableController = new AbortController();
    const robotController = new AbortController();
    const [wearableResponse, robotResponse] = await Promise.all([
      fetch(new URL(`/api/v1/wearable/telemetry/${rawWearableId}`, baseUrl), {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
        signal: wearableController.signal
      }),
      fetch(new URL(`/api/v1/robot/telemetry/${rawRobotId}`, baseUrl), {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
        signal: robotController.signal
      })
    ]);
    expect(wearableResponse.status).toBe(200);
    expect(robotResponse.status).toBe(200);
    expect(wearableResponse.headers.get('content-type')).toContain('text/event-stream');
    expect(robotResponse.headers.get('content-type')).toContain('text/event-stream');
    const [wearable, robot] = await Promise.all([
      firstSsePayload(wearableResponse),
      firstSsePayload(robotResponse)
    ]);
    wearableController.abort();
    robotController.abort();

    expect(wearable).toMatchObject({
      contract_version: 'vl-simulation-wearable-telemetry/1',
      synthetic: true,
      inference: {
        contractVersion: 'vl-wearable-inference/1',
        inference: { activity: 'resting' }
      },
      location: { synthetic: true }
    });
    expect(wearable).toHaveProperty('sensor_frame.accelerometer');
    expect(wearable).toHaveProperty('sensor_frame.ppg.heartRateBpm');
    expect(wearable).not.toHaveProperty('device_id');
    expect(JSON.stringify(wearable)).not.toContain(rawWearableId);
    expect((wearable.events as Array<Record<string, unknown>>)[0]).toMatchObject({
      eventType: 'stress_spike',
      severity: 'warning'
    });

    expect(robot).toMatchObject({
      contract_version: 'vl-simulation-robot-telemetry/1',
      synthetic: true,
      raw_camera_retained: false,
      raw_microphone_retained: false,
      inference: { contractVersion: 'vl-robot-edge-inference/1' }
    });
    expect(robot).toHaveProperty('feature_frame.vision');
    expect(robot).toHaveProperty('feature_frame.audio');
    expect(robot).toHaveProperty('feature_frame.motor');
    expect(robot).not.toHaveProperty('device_id');
    expect(JSON.stringify(robot)).not.toContain(rawRobotId);
    expect((robot.events as Array<Record<string, unknown>>)[0]).toMatchObject({
      eventType: 'medication_reminder'
    });

    const unauthorizedInjection = await fetch(new URL('/api/v1/simulation/events', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: rawWearableId,
        device_type: 'wearable',
        event_type: 'fall_detected'
      })
    });
    expect(unauthorizedInjection.status).toBe(401);
    const injection = await fetch(new URL('/api/v1/simulation/events', baseUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: rawWearableId,
        device_type: 'wearable',
        event_type: 'fall_detected'
      })
    });
    expect(injection.status).toBe(201);
    expect(await json(injection)).toMatchObject({
      accepted: true,
      event: { eventType: 'fall_detected', severity: 'critical', synthetic: true }
    });
    const invalidInjection = await fetch(new URL('/api/v1/simulation/events', baseUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: rawWearableId,
        device_type: 'wearable',
        event_type: 'stress_spike',
        private_note: 'must-not-be-accepted'
      })
    });
    expect(invalidInjection.status).toBe(400);
    expect(await json(invalidInjection)).toEqual({ error: 'SIMULATION_EVENT_INVALID' });
    const offlineInjection = await fetch(new URL('/api/v1/simulation/events', baseUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: rawRobotId,
        device_type: 'home_robot',
        event_type: 'device_offline'
      })
    });
    expect(offlineInjection.status).toBe(201);

    for (let index = 0; index < 12; index += 1) {
      simulationServer.recordScenarioExecution({
        scenarioId: 'fall_response',
        status: index % 2 === 0 ? 'started' : 'completed',
        wearableDeviceId: rawWearableId,
        robotDeviceId: rawRobotId
      });
    }
    expect(() => simulationServer.recordScenarioExecution({
      scenarioId: '<private-name>',
      status: 'started'
    })).toThrow('Scenario execution record is invalid');

    const unauthorizedDashboard = await fetch(new URL('/api/v1/simulation/dashboard', baseUrl));
    expect(unauthorizedDashboard.status).toBe(401);
    const dashboardResponse = await fetch(new URL('/api/v1/simulation/dashboard', baseUrl), {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });
    expect(dashboardResponse.status).toBe(200);
    const dashboard = await json(dashboardResponse);
    expect(dashboard).toMatchObject({
      contractVersion: 'vl-manufacturer-simulation-dashboard/1',
      synthetic: true
    });
    expect((dashboard.devices as unknown[])).toHaveLength(2);
    expect(dashboard.devices).toEqual(expect.arrayContaining([
      expect.objectContaining({ deviceType: 'home_robot', online: false, status: 'offline' })
    ]));
    expect((dashboard.scenarioExecutions as unknown[])).toHaveLength(10);
    expect((dashboard.lastEvents as unknown[])).toHaveLength(10);
    const serializedDashboard = JSON.stringify(dashboard);
    expect(serializedDashboard).not.toContain(rawWearableId);
    expect(serializedDashboard).not.toContain(rawRobotId);
    expect(serializedDashboard).not.toContain('private_note');

    const htmlResponse = await fetch(new URL('/dashboard', baseUrl));
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await htmlResponse.text();
    expect(html).toContain('Device states, scenario logs, and last 10 events');
    expect(html).not.toContain(rawWearableId);
    expect(html).not.toContain(rawRobotId);
    expect(html).not.toContain('<script');

    expect(logs.map(({ route }) => route)).toEqual(expect.arrayContaining([
      '/api/v1/wearable/telemetry/{deviceId}',
      '/api/v1/robot/telemetry/{deviceId}',
      '/api/v1/simulation/events',
      '/api/v1/simulation/dashboard',
      '/dashboard'
    ]));
    expect(JSON.stringify(logs)).not.toContain(rawWearableId);
    expect(JSON.stringify(logs)).not.toContain(rawRobotId);
  });

  test('accepts authenticated scenario lifecycle updates without exposing raw device IDs', async () => {
    const logs: ManufacturerMockLogEntry[] = [];
    activeServer = createManufacturerMockServer({
      environment: 'test',
      port: 0,
      latencyMinMs: 0,
      latencyMaxMs: 0,
      log: (entry) => logs.push(entry)
    });
    const { baseUrl } = await activeServer.start();
    const rawWearableId = 'private-wearable-lifecycle-001';
    const rawRobotId = 'private-robot-lifecycle-001';
    const body = {
      scenario_id: 'fall_detection',
      status: 'started',
      wearable_device_id: rawWearableId,
      robot_device_id: rawRobotId
    };

    const unauthorized = await fetch(new URL('/api/v1/simulation/scenarios', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    expect(unauthorized.status).toBe(401);

    const started = await fetch(new URL('/api/v1/simulation/scenarios', baseUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    expect(started.status).toBe(201);
    const startedPayload = await json(started);
    expect(startedPayload).toMatchObject({
      accepted: true,
      scenario: {
        scenarioId: 'fall_detection',
        status: 'started',
        synthetic: true,
        deviceReferences: [
          expect.stringMatching(/^device_[0-9a-f]{12}$/),
          expect.stringMatching(/^device_[0-9a-f]{12}$/)
        ]
      }
    });
    expect(JSON.stringify(startedPayload)).not.toContain(rawWearableId);
    expect(JSON.stringify(startedPayload)).not.toContain(rawRobotId);

    const completed = await fetch(new URL('/api/v1/simulation/scenarios', baseUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, status: 'completed' })
    });
    expect(completed.status).toBe(201);

    const invalid = await fetch(new URL('/api/v1/simulation/scenarios', baseUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, private_note: 'must-not-be-accepted' })
    });
    expect(invalid.status).toBe(400);
    expect(await json(invalid)).toEqual({ error: 'SCENARIO_EXECUTION_INVALID' });

    const dashboard = await fetch(new URL('/api/v1/simulation/dashboard', baseUrl), {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });
    expect(dashboard.status).toBe(200);
    const dashboardPayload = await json(dashboard);
    expect(dashboardPayload.scenarioExecutions).toEqual([
      expect.objectContaining({ scenarioId: 'fall_detection', status: 'started' }),
      expect.objectContaining({ scenarioId: 'fall_detection', status: 'completed' })
    ]);
    const serializedDashboard = JSON.stringify(dashboardPayload);
    expect(serializedDashboard).not.toContain(rawWearableId);
    expect(serializedDashboard).not.toContain(rawRobotId);
    expect(serializedDashboard).not.toContain('private_note');
    expect(logs.map(({ route }) => route)).toContain('/api/v1/simulation/scenarios');
    expect(JSON.stringify(logs)).not.toContain(rawWearableId);
    expect(JSON.stringify(logs)).not.toContain(rawRobotId);
  });

  test('uses deterministic configured fall frequency and validates event configuration', async () => {
    expect(() => createManufacturerMockServer({ environment: 'test', fallEventRate: 1.1 }))
      .toThrow('fall-event rate is invalid');
    expect(() => createManufacturerMockServer({ environment: 'test', stressEventRate: -0.1 }))
      .toThrow('stress-event rate is invalid');
    expect(() => createManufacturerMockServer({ environment: 'test', medicationReminderEveryTicks: -1 }))
      .toThrow('medication-reminder tick interval is invalid');

    activeServer = createManufacturerMockServer({
      environment: 'test',
      port: 0,
      latencyMinMs: 0,
      latencyMaxMs: 0,
      fallEventRate: 1,
      stressEventRate: 0,
      medicationReminderEveryTicks: 0,
      random: () => 0,
      log: () => undefined
    });
    const { baseUrl } = await activeServer.start();
    const controller = new AbortController();
    const response = await fetch(new URL('/api/v1/wearable/telemetry/fall-device-001', baseUrl), {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      signal: controller.signal
    });
    const telemetry = await firstSsePayload(response);
    controller.abort();
    expect(telemetry).toMatchObject({
      inference: { inference: { fallDetected: true, activity: 'fall' } }
    });
    expect((telemetry.events as Array<Record<string, unknown>>)[0]).toMatchObject({
      eventType: 'fall_detected', severity: 'critical'
    });
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
    expect(() => createManufacturerMockServer({
      environment: 'test',
      asyncAckCallbackUrl: 'https://external.example.test/v1/manufacturer/robot/ack',
      asyncAckCallbackCredentials: { 'yongyida-cloud': 'callback-only-secret' }
    })).toThrow('loopback CLM ACK URL');
    expect(() => createManufacturerMockServer({
      environment: 'test',
      asyncAckCallbackUrl: 'http://127.0.0.1:3000/v1/manufacturer/robot/ack'
    })).toThrow('URL and credentials must be configured together');
    expect(() => createManufacturerMockServer({
      environment: 'test',
      asyncAckCallbackUrl: 'http://127.0.0.1:3000/v1/manufacturer/robot/ack',
      asyncAckCallbackCredentials: { 'untrusted-adapter': 'callback-only-secret' }
    })).toThrow('credentials are invalid');
    expect(() => createManufacturerMockServer({
      environment: 'test',
      asyncAckCallbackUrl: 'http://127.0.0.1:3000/v1/manufacturer/robot/ack',
      asyncAckCallbackCredentials: { 'yongyida-cloud': API_KEY }
    })).toThrow('credentials are invalid');
    expect(() => createManufacturerMockServer({
      environment: 'test',
      maxAsyncAckRequestBytes: 256
    })).toThrow('ACK request limit is invalid');
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
      {
        adapterId = 'yongyida-cloud',
        parameters = {}
      }: {
        readonly adapterId?: string;
        readonly parameters?: Readonly<Record<string, unknown>>;
      } = {}
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
        parameters
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

    const opaqueSession = 'camera-session_opaque-2';
    const action = createAction('share_camera_view', {
      parameters: { session_id: opaqueSession }
    });
    const firstCameraAck = await send(action);
    expect(firstCameraAck.status).toBe(202);
    const cameraAck = await json(firstCameraAck);
    expect(cameraAck).toMatchObject({
      state: 'accepted',
      ok: true,
      action_id: actionId,
      camera_ready: true,
      camera_session_ref: opaqueSession
    });
    expect(cameraAck).not.toHaveProperty('camera_url');
    expect(cameraAck).not.toHaveProperty('stream_url');
    expect(cameraAck).not.toHaveProperty('raw_media');
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

  test('posts an authenticated bounded async camera ACK only after the 202 receipt', async () => {
    const keyPair = generateKeyPairSync('ed25519');
    const callbackCredential = 'mock-callback-credential-yongyida';
    const actionId = '456e4567-e89b-42d3-a456-426614174111';
    const opaqueSession = 'camera-session_opaque-callback';
    const rawDeviceId = 'private-callback-device-001';
    const logs: ManufacturerMockLogEntry[] = [];
    let receiptObserved = false;
    const callbackRequest = new Promise<{
      readonly headers: Readonly<Record<string, string | string[] | undefined>>;
      readonly payload: Readonly<Record<string, unknown>>;
      readonly receiptObserved: boolean;
    }>((resolve, reject) => {
      const callbackServer = createServer((request, response) => {
        const chunks: Buffer[] = [];
        let total = 0;
        request.on('data', (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > 4 * 1024) {
            request.destroy(new Error('callback body exceeded test bound'));
            return;
          }
          chunks.push(chunk);
        });
        request.once('error', reject);
        request.once('end', () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
            response.writeHead(204, { 'Cache-Control': 'no-store' });
            response.end();
            resolve({ headers: request.headers, payload, receiptObserved });
          } catch (error) {
            reject(error);
          } finally {
            callbackServer.closeAllConnections?.();
            callbackServer.close();
          }
        });
      });
      callbackServer.once('error', reject);
      callbackServer.listen(0, '127.0.0.1', async () => {
        try {
          const port = (callbackServer.address() as AddressInfo).port;
          const currentTime = Date.now();
          activeServer = createManufacturerMockServer({
            environment: 'test',
            port: 0,
            latencyMinMs: 0,
            latencyMaxMs: 0,
            signedActionPublicKey: keyPair.publicKey,
            asyncAckCallbackUrl: `http://127.0.0.1:${port}/v1/manufacturer/robot/ack`,
            asyncAckCallbackCredentials: { 'yongyida-cloud': callbackCredential },
            asyncAckDelayMs: 10,
            asyncAckTimeoutMs: 500,
            maxAsyncAckRequestBytes: 512,
            maxAsyncAckResponseBytes: 0,
            log: (entry) => logs.push(entry)
          });
          const { baseUrl } = await activeServer.start();
          const envelope = {
            version: 2,
            id: actionId,
            issued_at: currentTime,
            expires_at: currentTime + 60_000,
            action: 'share_camera_view',
            device_type: 'home_robot',
            adapter_id: 'yongyida-cloud',
            contract_version: 'vl-robot-action/2',
            device_id: 'account-device-callback',
            manufacturer_device_id: rawDeviceId,
            binding_epoch: 17,
            parameters: { session_id: opaqueSession }
          };
          const payload = Buffer.from(JSON.stringify(envelope)).toString('base64url');
          const signed = {
            envelope,
            payload,
            signature: sign(null, Buffer.from(payload, 'ascii'), keyPair.privateKey).toString('base64url'),
            algorithm: 'Ed25519'
          };
          const response = await fetch(
            new URL('/v1/veryloving/yongyida-cloud/signed-actions', baseUrl),
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': actionId,
                'X-Veryloving-Session': SESSION_TOKEN
              },
              body: JSON.stringify(signed)
            }
          );
          expect(response.status).toBe(202);
          expect(await json(response)).toMatchObject({
            action_id: actionId,
            state: 'accepted',
            camera_ready: true,
            camera_session_ref: opaqueSession
          });
          receiptObserved = true;
        } catch (error) {
          callbackServer.closeAllConnections?.();
          callbackServer.close();
          reject(error);
        }
      });
    });

    let callbackTimeout: ReturnType<typeof setTimeout> | undefined;
    const callback = await Promise.race([
      callbackRequest,
      new Promise<never>((_resolve, reject) => {
        callbackTimeout = setTimeout(
          () => reject(new Error('async ACK callback was not received')),
          2_000
        );
      })
    ]).finally(() => {
      if (callbackTimeout) clearTimeout(callbackTimeout);
    });
    expect(callback.receiptObserved).toBe(true);
    expect(callback.headers['x-robot-adapter-id']).toBe('yongyida-cloud');
    expect(callback.headers['x-robot-callback-key']).toBe(callbackCredential);
    expect(callback.payload).toEqual({
      action_id: actionId,
      ok: true,
      binding_epoch: 17,
      camera_ready: true,
      camera_session_ref: opaqueSession
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'manufacturer_mock.ack_callback',
        route: '/v1/manufacturer/robot/ack',
        statusCode: 204
      })
    ]));
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain(callbackCredential);
    expect(serializedLogs).not.toContain(actionId);
    expect(serializedLogs).not.toContain(rawDeviceId);
    expect(serializedLogs).not.toContain(opaqueSession);
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
