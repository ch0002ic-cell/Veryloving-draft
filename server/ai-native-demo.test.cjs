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

function createRuntimeEnvironment(manufacturerUrl) {
  return {
    NODE_ENV: 'test',
    AI_NATIVE_ENABLED: 'true',
    AI_NATIVE_DATA_LIFECYCLE_ENABLED: 'true',
    AI_NATIVE_SINGLE_REPLICA: 'true',
    MOCK_MANUFACTURER_URL: manufacturerUrl,
    MOCK_MANUFACTURER_API_KEY: API_KEY
  };
}

function createCaptureResponse() {
  return {
    destroyed: false,
    writableEnded: false,
    statusCode: undefined,
    headers: undefined,
    body: undefined,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.writableEnded = true;
      this.body = body ? JSON.parse(Buffer.from(body).toString('utf8')) : undefined;
    }
  };
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

test('AI-native demo rejects an incrementally oversized manufacturer response', async (context) => {
  const manufacturer = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    for (let index = 0; index < 70; index += 1) response.write('x'.repeat(1024));
    response.end();
  });
  const manufacturerUrl = await listen(manufacturer);
  context.after(() => close(manufacturer));
  const runtime = createAINativeDemoRuntime({
    env: {
      NODE_ENV: 'test',
      AI_NATIVE_ENABLED: 'true',
      AI_NATIVE_DATA_LIFECYCLE_ENABLED: 'true',
      AI_NATIVE_SINGLE_REPLICA: 'true',
      MOCK_MANUFACTURER_URL: manufacturerUrl,
      MOCK_MANUFACTURER_API_KEY: API_KEY
    },
    logger: { error() {} }
  });
  const appServer = http.createServer(runtime.wrapHandler((_request, response) => {
    sendJson(response, 404, { error: 'NOT_FOUND' });
  }));
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
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: 'AI-native demo scenario failed',
    code: 'MOCK_RESPONSE_TOO_LARGE'
  });
});

test('AI-native demo shutdown aborts stalled manufacturer work and drains promptly', async (context) => {
  let markFetchStarted;
  const fetchStarted = new Promise((resolve) => { markFetchStarted = resolve; });
  const runtime = createAINativeDemoRuntime({
    env: createRuntimeEnvironment('http://127.0.0.1:9'),
    shutdownDrainGraceMs: 25,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      markFetchStarted();
      const abort = () => {
        const error = new Error('manufacturer request aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    }),
    logger: { error() {} }
  });
  const appServer = http.createServer(runtime.wrapHandler((_request, response) => {
    sendJson(response, 404, { error: 'NOT_FOUND' });
  }));
  const appUrl = await listen(appServer);
  context.after(() => close(appServer));
  const scenarioRequest = fetch(`${appUrl}/v1/scenarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scenarioId: 'fall-detection',
      userId: 'test-user-1',
      deviceId: 'wearable-1'
    })
  });
  await fetchStarted;

  await Promise.race([
    runtime.close(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown did not drain')), 500))
  ]);
  const response = await scenarioRequest;
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'AI-native demo scenario failed',
    code: 'DEMO_SHUTTING_DOWN'
  });
});

test('exact local fall-detection curl starts the injected system and drives the mock backend', async (context) => {
  const manufacturer = createManufacturerProbe();
  const manufacturerUrl = await listen(manufacturer.server);
  context.after(() => close(manufacturer.server));
  const logErrors = [];
  const runtime = createAINativeDemoRuntime({
    env: createRuntimeEnvironment(manufacturerUrl),
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

  // Shutdown drains scenario completion and its simulator lifecycle sync; the
  // entrypoint must not abandon a just-accepted scenario on SIGTERM.
  await runtime.close();
  assert.equal(manufacturer.requests.filter((entry) => (
    entry.path === '/api/v1/simulation/scenarios'
  )).length, 2);
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

test('all dashboard scenarios use the real router paths and expose sanitized executions', async (context) => {
  const manufacturer = createManufacturerProbe();
  const manufacturerUrl = await listen(manufacturer.server);
  context.after(() => close(manufacturer.server));
  const logErrors = [];
  const runtime = createAINativeDemoRuntime({
    env: createRuntimeEnvironment(manufacturerUrl),
    logger: { error: (...args) => logErrors.push(args) }
  });
  const appServer = http.createServer(runtime.wrapHandler((_request, response) => {
    sendJson(response, 404, { error: 'NOT_FOUND' });
  }));
  const appUrl = await listen(appServer);
  context.after(() => close(appServer));

  const aliases = [
    'fall-detection',
    'medication-adherence',
    'emotional-check-in',
    'cognitive-engagement',
    'ai-angel-auto-dial'
  ];
  const executionIds = new Set();
  for (const scenarioId of aliases) {
    const response = await fetch(`${appUrl}/v1/scenarios`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: manufacturerUrl
      },
      body: JSON.stringify({
        scenarioId,
        userId: 'test-user-1',
        deviceId: 'wearable-dashboard-1',
        robotDeviceId: 'robot-dashboard-1',
        occurredAt: Date.now()
      })
    });
    const result = await response.json();
    assert.equal(response.status, 202, `${scenarioId}: ${JSON.stringify(result)}`);
    assert.equal(response.headers.get('access-control-allow-origin'), manufacturerUrl);
    assert.equal(result.scenarioId, scenarioId);
    assert.equal(result.status, 'started');
    assert.match(result.executionId, /^[0-9a-f-]{36}$/i);
    executionIds.add(result.executionId);
  }
  assert.equal(executionIds.size, aliases.length);

  await waitFor(() => manufacturer.requests.filter((entry) => (
    entry.path === '/api/v1/simulation/scenarios'
  )).length >= aliases.length * 2, 5_000);

  const response = await fetch(
    `${appUrl}/v1/scenarios/executions?userId=test-user-1`,
    { headers: { Origin: manufacturerUrl } }
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), manufacturerUrl);
  const listed = await response.json();
  assert.equal(listed.contractVersion, 'vl-ai-native-scenario-executions/1');
  assert.equal(listed.executions.length, aliases.length);
  assert.deepEqual(
    new Set(listed.executions.map((entry) => entry.scenarioId)),
    new Set(aliases)
  );
  assert.ok(listed.executions.every((entry) => (
    executionIds.has(entry.executionId)
      && ['completed', 'fallback_completed', 'failed', 'cancelled'].includes(entry.status)
      && typeof entry.deviceReferences.wearable === 'string'
      && typeof entry.deviceReferences.homeRobot === 'string'
      && !Object.prototype.hasOwnProperty.call(entry, 'accountRef')
      && !Object.prototype.hasOwnProperty.call(entry, 'triggerRef')
  )));
  assert.ok(!JSON.stringify(listed).includes('test-user-1'));
  assert.ok(!JSON.stringify(listed).includes('wearable-dashboard-1'));
  assert.ok(!JSON.stringify(listed).includes('robot-dashboard-1'));

  const scenarioLifecycles = manufacturer.requests
    .filter((entry) => entry.path === '/api/v1/simulation/scenarios')
    .map((entry) => entry.body);
  assert.deepEqual(
    new Set(scenarioLifecycles.filter((entry) => entry.status === 'started')
      .map((entry) => entry.scenario_id)),
    new Set([
      'fall_detection',
      'medication_adherence',
      'emotional_check_in',
      'cognitive_engagement',
      'ai_angel_auto_dial'
    ])
  );
  const commands = manufacturer.requests
    .filter((entry) => entry.path === '/api/v1/command')
    .map((entry) => entry.body.command);
  assert.ok(commands.includes('navigate_to_location'));
  assert.ok(commands.includes('medication_reminder'));
  assert.ok(commands.includes('cognitive_engagement'));
  assert.ok(commands.includes('trigger_sos'));
  assert.ok(commands.includes('share_camera_view'));
  assert.deepEqual(logErrors, []);
});

test('dashboard CORS, strict request validation, and loopback locality are enforced', async (context) => {
  const manufacturer = createManufacturerProbe();
  const manufacturerUrl = await listen(manufacturer.server);
  context.after(() => close(manufacturer.server));
  const runtime = createAINativeDemoRuntime({
    env: createRuntimeEnvironment(manufacturerUrl),
    logger: { error: () => undefined }
  });
  const fallbackRequests = [];
  const wrapped = runtime.wrapHandler((request, response) => {
    fallbackRequests.push(request.url);
    sendJson(response, 200, { fallback: true });
  });
  const appServer = http.createServer(wrapped);
  const appUrl = await listen(appServer);
  context.after(() => close(appServer));

  const preflight = await fetch(`${appUrl}/v1/scenarios`, {
    method: 'OPTIONS',
    headers: {
      Origin: manufacturerUrl,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), manufacturerUrl);
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
  const alternateDashboardOrigin = manufacturerUrl.replace('127.0.0.1', 'localhost');
  const alternatePreflight = await fetch(`${appUrl}/v1/scenarios/executions`, {
    method: 'OPTIONS',
    headers: {
      Origin: alternateDashboardOrigin,
      'Access-Control-Request-Method': 'GET'
    }
  });
  assert.equal(alternatePreflight.status, 204);
  assert.equal(
    alternatePreflight.headers.get('access-control-allow-origin'),
    alternateDashboardOrigin
  );

  const invalidBodies = [{
    scenarioId: 'unknown-scenario',
    userId: 'test-user-1',
    deviceId: 'wearable-1'
  }, {
    scenarioId: 'fall-detection',
    userId: 'test-user-1',
    deviceId: 'wearable-1',
    unexpected: true
  }, {
    scenarioId: 'fall-detection',
    userId: 'test-user-1',
    deviceId: 'wearable-1',
    occurredAt: Date.now() - 10 * 60_000
  }];
  for (const body of invalidBodies) {
    const invalid = await fetch(`${appUrl}/v1/scenarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    assert.equal(invalid.status, 400);
  }

  const invalidMediaType = await fetch(`${appUrl}/v1/scenarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/jsonp' },
    body: JSON.stringify({
      scenarioId: 'fall-detection',
      userId: 'test-user-1',
      deviceId: 'wearable-1'
    })
  });
  assert.equal(invalidMediaType.status, 415);

  const duplicateQuery = await fetch(
    `${appUrl}/v1/scenarios/executions?userId=test-user-1&userId=test-user-1`
  );
  assert.equal(duplicateQuery.status, 400);
  const unauthorizedAccount = await fetch(
    `${appUrl}/v1/scenarios/executions?userId=another-local-user`
  );
  assert.equal(unauthorizedAccount.status, 403);
  const wrongOrigin = await fetch(
    `${appUrl}/v1/scenarios/executions?userId=test-user-1`,
    { headers: { Origin: 'http://127.0.0.1:65535' } }
  );
  assert.equal(wrongOrigin.status, 403);

  const remoteResponse = createCaptureResponse();
  await wrapped({
    method: 'GET',
    url: '/v1/scenarios/executions?userId=test-user-1',
    headers: {},
    socket: { remoteAddress: '192.0.2.10' }
  }, remoteResponse);
  assert.equal(remoteResponse.statusCode, 403);
  assert.deepEqual(remoteResponse.body, { error: 'Local AI-native demo access only' });

  const fallback = await fetch(`${appUrl}/health`);
  assert.equal(fallback.status, 200);
  assert.deepEqual(await fallback.json(), { fallback: true });
  assert.deepEqual(fallbackRequests, ['/health']);
});
