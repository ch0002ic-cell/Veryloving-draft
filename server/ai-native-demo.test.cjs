'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');

const {
  createAINativeDemoRuntime,
  parseLoopbackMockURL
} = require('./ai-native-demo.cjs');

const API_KEY = 'local-test-api-key';
const ACCESS_TOKEN = 'local-test-access-token';

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
  return new Promise((resolve) => server.close(() => resolve()));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.once('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (error) { reject(error); }
    });
    request.once('error', reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function createManufacturerProbe() {
  const requests = [];
  let commandSequence = 0;
  const server = http.createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({
      path: request.url,
      authorization: request.headers.authorization,
      idempotencyKey: request.headers['idempotency-key'],
      body
    });
    if (request.url === '/api/v1/authenticate') {
      assert.equal(request.headers.authorization, `Bearer ${API_KEY}`);
      sendJson(response, 200, { access_token: ACCESS_TOKEN });
      return;
    }
    assert.equal(request.headers.authorization, `Bearer ${ACCESS_TOKEN}`);
    if (request.url === '/api/v1/command') {
      commandSequence += 1;
      sendJson(response, 202, {
        success: true,
        command_id: `command-${commandSequence}`,
        ...(body.command === 'share_camera_view'
          ? { camera_ready: true, camera_session_ref: body.parameters.session_id }
          : {})
      });
      return;
    }
    if (request.url === '/api/v1/simulation/events'
      || request.url === '/api/v1/simulation/scenarios') {
      sendJson(response, 201, { accepted: true });
      return;
    }
    sendJson(response, 404, { error: 'NOT_FOUND' });
  });
  return { server, requests };
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for the scenario to finish');
}

test('AI-native demo is disabled without changing the legacy entrypoint configuration', () => {
  assert.equal(createAINativeDemoRuntime({ env: { AI_NATIVE_ENABLED: 'false' } }), null);
  assert.throws(() => createAINativeDemoRuntime({
    env: {
      NODE_ENV: 'production',
      AI_NATIVE_ENABLED: 'true',
      AI_NATIVE_DATA_LIFECYCLE_ENABLED: 'true',
      AI_NATIVE_SINGLE_REPLICA: 'true',
      MOCK_MANUFACTURER_URL: 'http://127.0.0.1:3001'
    }
  }), /forbidden in production/);
});

test('AI-native demo accepts only credential-free loopback manufacturer URLs', () => {
  assert.equal(parseLoopbackMockURL('http://localhost:3001').origin, 'http://localhost:3001');
  assert.throws(() => parseLoopbackMockURL('https://manufacturer.example/api'), /loopback/);
  assert.throws(() => parseLoopbackMockURL('http://127.0.0.1:3001/api'), /loopback/);
  assert.throws(() => parseLoopbackMockURL('http://user:secret@127.0.0.1:3001'), /credential-free/);
});

test('exact local fall-detection curl starts the injected system and drives the mock backend', async (context) => {
  const manufacturer = createManufacturerProbe();
  const manufacturerUrl = await listen(manufacturer.server);
  context.after(() => close(manufacturer.server));
  const logErrors = [];
  const runtime = createAINativeDemoRuntime({
    env: {
      NODE_ENV: 'test',
      AI_NATIVE_ENABLED: 'true',
      AI_NATIVE_DATA_LIFECYCLE_ENABLED: 'true',
      AI_NATIVE_SINGLE_REPLICA: 'true',
      MOCK_MANUFACTURER_URL: manufacturerUrl,
      MOCK_MANUFACTURER_API_KEY: API_KEY
    },
    logger: { error: (...args) => logErrors.push(args) }
  });
  assert.ok(runtime?.system);

  const fallback = (_request, response) => sendJson(response, 200, { fallback: true });
  const appServer = http.createServer(runtime.wrapHandler(fallback));
  const appUrl = await listen(appServer);
  context.after(() => close(appServer));

  const response = await fetch(`${appUrl}/v1/scenarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scenarioId: 'fall-detection',
      userId: 'test-user-1',
      deviceId: 'wearable-1'
    })
  });
  assert.equal(response.status, 202);
  const result = await response.json();
  assert.equal(result.status, 'started');
  assert.equal(result.scenarioId, 'fall-detection');
  assert.match(result.executionId, /^[0-9a-f-]{36}$/i);

  await waitFor(() => manufacturer.requests.filter((entry) => (
    entry.path === '/api/v1/simulation/scenarios'
  )).length >= 2);
  const events = manufacturer.requests
    .filter((entry) => entry.path === '/api/v1/simulation/events')
    .map((entry) => entry.body);
  assert.deepEqual(events, [{
    device_id: 'wearable-1',
    device_type: 'wearable',
    event_type: 'fall_detected'
  }, {
    device_id: 'home-robot-1',
    device_type: 'home_robot',
    event_type: 'device_online'
  }]);

  const commands = manufacturer.requests
    .filter((entry) => entry.path === '/api/v1/command');
  assert.deepEqual(commands.slice(0, 2).map((entry) => entry.body.command), [
    'navigate_to_location',
    'start_two_way_call'
  ]);
  assert.deepEqual(new Set(commands.slice(2).map((entry) => entry.body.command)), new Set([
    'trigger_sos',
    'share_camera_view'
  ]));
  assert.ok(commands.every((entry) => entry.idempotencyKey === entry.body.idempotency_key));

  const lifecycles = manufacturer.requests
    .filter((entry) => entry.path === '/api/v1/simulation/scenarios')
    .map((entry) => entry.body.status);
  assert.deepEqual(lifecycles, ['started', 'completed']);
  assert.deepEqual(logErrors, []);
});
