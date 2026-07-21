'use strict';

process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { createAINativeDemoRuntime } = require('../../server/ai-native-demo.cjs');
const {
  createManufacturerMockServer
} = require('../../server/dist-mocks/mocks/ManufacturerMockServer.js');

const SCENARIOS = Object.freeze([
  'fall-detection',
  'medication-adherence',
  'emotional-check-in',
  'cognitive-engagement',
  'ai-angel-auto-dial'
]);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}

async function jsonRequest(url, { cookie, origin, body }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: cookie,
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin'
    },
    body: JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

async function waitFor(read, predicate, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Timed out waiting for state: ${JSON.stringify(value)}`);
}

test('dashboard drives all five scenarios through the real in-memory runtime and mock devices', async (context) => {
  let appHandler = (_request, response) => {
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'STARTING' }));
  };
  const appServer = http.createServer((request, response) => appHandler(request, response));
  const appUrl = await listen(appServer);
  context.after(() => close(appServer));

  const simulator = createManufacturerMockServer({
    environment: 'test',
    port: 0,
    latencyMinMs: 0,
    latencyMaxMs: 0,
    failureRate: 0,
    fallEventRate: 0,
    stressEventRate: 0,
    medicationReminderEveryTicks: 0,
    telemetryIntervalMs: 25,
    mainServerUrl: `${appUrl}/`,
    log: () => undefined
  });
  const simulatorAddress = await simulator.start();
  context.after(() => simulator.stop());

  const runtime = createAINativeDemoRuntime({
    env: {
      NODE_ENV: 'test',
      AI_NATIVE_ENABLED: 'true',
      AI_NATIVE_DATA_LIFECYCLE_ENABLED: 'true',
      AI_NATIVE_SINGLE_REPLICA: 'true',
      AI_NATIVE_DEMO_USER_ID: 'test-user-1',
      MOCK_MANUFACTURER_URL: simulatorAddress.baseUrl,
      MOCK_MANUFACTURER_API_KEY: 'mock-server-only-api-key'
    },
    logger: { error() {} }
  });
  assert.ok(runtime?.system);
  appHandler = runtime.wrapHandler((_request, response) => {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });

  const dashboardResponse = await fetch(new URL('/dashboard', simulatorAddress.baseUrl));
  assert.equal(dashboardResponse.status, 200);
  assert.match(dashboardResponse.headers.get('content-security-policy') || '', /default-src 'none'/);
  const cookie = (dashboardResponse.headers.get('set-cookie') || '').split(';', 1)[0];
  assert.match(cookie, /^vl_mock_dashboard_session=[A-Za-z0-9_-]+$/);
  const html = await dashboardResponse.text();
  assert.match(html, /Care Orchestration Lab/);
  assert.match(html, /new EventSource\('\/api\/v1\/simulation\/dashboard\/events'/);
  for (const scenarioId of SCENARIOS) assert.match(html, new RegExp(`data-scenario="${scenarioId}"`));
  const origin = new URL(simulatorAddress.baseUrl).origin;

  const initialDashboard = await fetch(
    new URL('/api/v1/simulation/dashboard', simulatorAddress.baseUrl),
    { headers: { Cookie: cookie } }
  );
  assert.equal(initialDashboard.status, 200);
  const initialSnapshot = await initialDashboard.json();
  assert.deepEqual(
    new Set(initialSnapshot.devices.map(({ deviceType }) => deviceType)),
    new Set(['wearable', 'home_robot'])
  );

  const executionIds = [];
  for (const scenarioId of SCENARIOS) {
    const triggered = await jsonRequest(new URL('/api/v1/simulation/trigger', simulatorAddress.baseUrl), {
      cookie,
      origin,
      body: {
        scenarioId,
        userId: 'test-user-1',
        deviceId: 'wearable-1',
        robotDeviceId: 'home-robot-1',
        occurredAt: Date.now()
      }
    });
    assert.equal(triggered.response.status, 202);
    assert.equal(triggered.payload.response.status, 'started');
    assert.equal(triggered.payload.response.scenarioId, scenarioId);
    assert.match(triggered.payload.response.executionId, /^[0-9a-f-]{36}$/i);
    executionIds.push(triggered.payload.response.executionId);
  }

  const readExecutions = async () => {
    const result = await jsonRequest(new URL('/api/v1/simulation/executions', simulatorAddress.baseUrl), {
      cookie,
      origin,
      body: { userId: 'test-user-1' }
    });
    assert.equal(result.response.status, 200);
    return result.payload.response.executions;
  };
  const realExecutions = await waitFor(
    readExecutions,
    (items) => items.length === SCENARIOS.length
      && items.every(({ status }) => ['completed', 'fallback_completed', 'failed', 'cancelled'].includes(status))
  );
  assert.deepEqual(new Set(realExecutions.map(({ executionId }) => executionId)), new Set(executionIds));
  assert.ok(realExecutions.every(({ deviceReferences }) => (
    !JSON.stringify(deviceReferences).includes('wearable-1')
    && !JSON.stringify(deviceReferences).includes('home-robot-1')
  )));

  const synthetic = await waitFor(async () => {
    const response = await fetch(new URL('/api/v1/simulation/dashboard', simulatorAddress.baseUrl), {
      headers: { Cookie: cookie }
    });
    assert.equal(response.status, 200);
    return response.json();
  }, (snapshot) => snapshot.devices.length === 2
    && snapshot.scenarioExecutions.length === 10
    && snapshot.scenarioExecutions.filter(({ status }) => status !== 'started').length === 5);
  assert.deepEqual(new Set(synthetic.devices.map(({ deviceType }) => deviceType)), new Set(['wearable', 'home_robot']));
  assert.equal(synthetic.lastEvents.length, 10);

  const streamController = new AbortController();
  const stream = await fetch(new URL('/api/v1/simulation/dashboard/events', simulatorAddress.baseUrl), {
    headers: { Cookie: cookie },
    signal: streamController.signal
  });
  assert.equal(stream.status, 200);
  const streamReader = stream.body.getReader();
  const firstFrame = await streamReader.read();
  assert.match(new TextDecoder().decode(firstFrame.value), /event: dashboard/);
  await streamReader.cancel();
  streamController.abort();
  const resources = await waitFor(
    async () => simulator.getResourceSnapshot(),
    ({ dashboardStreams }) => dashboardStreams === 0
  );
  assert.equal(resources.dashboardStreams, 0);
});
