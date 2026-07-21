'use strict';

const { createHash, randomBytes } = require('node:crypto');

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MOCK_REQUEST_TIMEOUT_MS = 4_000;
const MOCK_REQUEST_ATTEMPTS = 3;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const ACTION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_EXECUTION_RESULTS = 50;
const DEMO_SCENARIOS = Object.freeze({
  'fall-detection': Object.freeze({
    scenarioId: 'fall_detection',
    route: 'wearable_fall',
    wearableEvent: 'fall_detected',
    robotEvent: 'device_online'
  }),
  'medication-adherence': Object.freeze({
    scenarioId: 'medication_adherence',
    route: 'medication_due',
    wearableEvent: 'device_online',
    robotEvent: 'medication_reminder'
  }),
  'emotional-check-in': Object.freeze({
    scenarioId: 'emotional_check_in',
    route: 'wearable_stress',
    wearableEvent: 'stress_spike',
    robotEvent: 'device_online'
  }),
  'cognitive-engagement': Object.freeze({
    scenarioId: 'cognitive_engagement',
    route: 'bedroom_inactivity',
    wearableEvent: 'device_online',
    robotEvent: 'device_online'
  }),
  'ai-angel-auto-dial': Object.freeze({
    scenarioId: 'ai_angel_auto_dial',
    route: 'panic_button',
    wearableEvent: 'device_online',
    robotEvent: 'device_online'
  })
});
const SCENARIO_ALIASES = Object.freeze(Object.fromEntries(
  Object.entries(DEMO_SCENARIOS).map(([alias, value]) => [value.scenarioId, alias])
));
const DEFAULT_ROBOT_ID = 'home-robot-1';
const DEFAULT_MOCK_API_KEY = 'mock-server-only-api-key';

function enabled(value) {
  return String(value || '').toLowerCase() === 'true';
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, required, optional = []) {
  if (!isPlainObject(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname === '::1';
}

function isLoopbackAddress(address) {
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
}

function parseLoopbackMockURL(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('AI-native demo requires a valid MOCK_MANUFACTURER_URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || !isLoopbackHostname(url.hostname)
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash) {
    throw new Error('AI-native demo requires a credential-free loopback MOCK_MANUFACTURER_URL');
  }
  return url;
}

function safeErrorCode(error) {
  const candidate = error && typeof error === 'object' ? error.code : undefined;
  return typeof candidate === 'string' && /^[A-Z0-9_]{1,64}$/.test(candidate)
    ? candidate
    : 'AI_NATIVE_DEMO_FAILED';
}

function createSafeError(message, code, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createSafeError('AI-native demo request was cancelled', 'REQUEST_CANCELLED', 499));
      return;
    }
    const timeout = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      reject(createSafeError('AI-native demo request was cancelled', 'REQUEST_CANCELLED', 499));
    };
    function finish() {
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function readBoundedResponseText(response) {
  const advertised = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(advertised) && advertised > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch {}
    throw createSafeError('Mock manufacturer response exceeded the limit', 'MOCK_RESPONSE_TOO_LARGE', 502);
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw createSafeError('Mock manufacturer response exceeded the limit', 'MOCK_RESPONSE_TOO_LARGE', 502);
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value || new Uint8Array());
      total += chunk.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        throw createSafeError('Mock manufacturer response exceeded the limit', 'MOCK_RESPONSE_TOO_LARGE', 502);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total).toString('utf8');
  } finally {
    reader.releaseLock?.();
  }
}

class MockManufacturerClient {
  constructor({ baseUrl, apiKey, fetchImpl }) {
    if (typeof fetchImpl !== 'function') throw new TypeError('AI-native demo requires fetch');
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.accessTokenPromise = undefined;
    this.shutdownController = new AbortController();
  }

  close() {
    this.shutdownController.abort();
    this.accessTokenPromise = undefined;
  }

  async authenticate() {
    if (!this.accessTokenPromise) {
      this.accessTokenPromise = this.request('/api/v1/authenticate', {
        authorization: `Bearer ${this.apiKey}`,
        body: { device_id: 'veryloving-demo-runtime' },
        // Authentication is shared by concurrent local requests. Never bind
        // the shared promise to one caller's disconnect signal.
        signal: undefined
      }).then((body) => {
        if (typeof body.access_token !== 'string'
          || body.access_token.length < 8
          || body.access_token.length > 2_048) {
          throw createSafeError('Mock manufacturer returned an invalid token', 'MOCK_TOKEN_INVALID', 502);
        }
        return body.access_token;
      }).catch((error) => {
        this.accessTokenPromise = undefined;
        throw error;
      });
    }
    return this.accessTokenPromise;
  }

  async postAuthenticated(pathname, body, { signal, idempotencyKey } = {}) {
    const token = await this.authenticate();
    try {
      return await this.request(pathname, {
        authorization: `Bearer ${token}`,
        body,
        signal,
        idempotencyKey
      });
    } catch (error) {
      if (error?.code !== 'MOCK_HTTP_401') throw error;
      this.accessTokenPromise = undefined;
      const refreshed = await this.authenticate();
      return this.request(pathname, {
        authorization: `Bearer ${refreshed}`,
        body,
        signal,
        idempotencyKey
      });
    }
  }

  async sendCommand(action, signal) {
    const response = await this.postAuthenticated('/api/v1/command', {
      device_id: action.device_id,
      command: action.action,
      parameters: action.parameters,
      idempotency_key: action.idempotency_key
    }, { signal, idempotencyKey: action.idempotency_key });
    if (response.success !== true || typeof response.command_id !== 'string') {
      throw createSafeError('Mock manufacturer command acknowledgement was invalid', 'MOCK_ACK_INVALID', 502);
    }
    return response;
  }

  recordDeviceEvent(deviceId, deviceType, eventType, signal) {
    return this.postAuthenticated('/api/v1/simulation/events', {
      device_id: deviceId,
      device_type: deviceType,
      event_type: eventType
    }, { signal });
  }

  recordScenarioLifecycle(scenarioId, status, wearableDeviceId, robotDeviceId, signal) {
    return this.postAuthenticated('/api/v1/simulation/scenarios', {
      scenario_id: scenarioId,
      status,
      wearable_device_id: wearableDeviceId,
      robot_device_id: robotDeviceId
    }, { signal });
  }

  async request(pathname, { authorization, body, signal, idempotencyKey }) {
    const shutdownSignal = this.shutdownController.signal;
    const requestSignal = signal
      ? globalThis.AbortSignal.any([signal, shutdownSignal])
      : shutdownSignal;
    let lastError;
    for (let attempt = 1; attempt <= MOCK_REQUEST_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (requestSignal.aborted) controller.abort();
      else requestSignal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(() => controller.abort(), MOCK_REQUEST_TIMEOUT_MS);
      try {
        const response = await this.fetchImpl(new URL(pathname, `${this.baseUrl.href}/`), {
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        const text = await readBoundedResponseText(response);
        let parsed;
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch {
          throw createSafeError('Mock manufacturer returned malformed JSON', 'MOCK_RESPONSE_INVALID', 502);
        }
        if (response.ok && isPlainObject(parsed)) return parsed;
        const statusError = createSafeError(
          'Mock manufacturer request was rejected',
          `MOCK_HTTP_${response.status}`,
          response.status >= 500 ? 502 : response.status
        );
        if (!RETRYABLE_STATUS.has(response.status) || attempt === MOCK_REQUEST_ATTEMPTS) throw statusError;
        lastError = statusError;
      } catch (error) {
        if (shutdownSignal.aborted) {
          throw createSafeError('AI-native demo is shutting down', 'DEMO_SHUTTING_DOWN', 503);
        }
        if (signal?.aborted) throw createSafeError('AI-native demo request was cancelled', 'REQUEST_CANCELLED', 499);
        const normalized = error?.code && String(error.code).startsWith('MOCK_')
          ? error
          : createSafeError('Mock manufacturer is unavailable', 'MOCK_UNAVAILABLE', 502);
        if (attempt === MOCK_REQUEST_ATTEMPTS || normalized.code === 'MOCK_RESPONSE_TOO_LARGE') throw normalized;
        lastError = normalized;
      } finally {
        clearTimeout(timeout);
        requestSignal.removeEventListener('abort', abort);
      }
      await delay(25 * attempt, requestSignal);
    }
    throw lastError || createSafeError('Mock manufacturer is unavailable', 'MOCK_UNAVAILABLE', 502);
  }
}

function createDemoActionGateway(client) {
  const accountFences = new Set();
  const outcomes = new Map();
  const accountReference = (accountId) => createHash('sha256')
    .update(`ai-native-demo-account\0${accountId}`)
    .digest('base64url');

  return Object.freeze({
    async route(accountId, action, options = {}) {
      if (!IDENTIFIER_PATTERN.test(accountId || '')
        || accountFences.has(accountReference(accountId))
        || !isPlainObject(action)
        || !['wearable', 'home_robot'].includes(action.device_type)
        || !IDENTIFIER_PATTERN.test(action.device_id || '')
        || !ACTION_PATTERN.test(action.action || '')
        || !isPlainObject(action.parameters)
        || !ACTION_PATTERN.test(action.idempotency_key || '')) {
        throw createSafeError('AI-native demo action was invalid', 'DEMO_ACTION_INVALID', 400);
      }
      const acknowledgement = await client.sendCommand(action, options.signal);
      const outcome = Object.freeze({
        status: 'delivered',
        action_id: acknowledgement.command_id,
        ...(acknowledgement.camera_ready === true
          && typeof acknowledgement.camera_session_ref === 'string'
          ? {
            camera_ready: true,
            camera_session_ref: acknowledgement.camera_session_ref
          }
          : {})
      });
      outcomes.set(acknowledgement.command_id, outcome);
      if (outcomes.size > 1_000) outcomes.delete(outcomes.keys().next().value);
      return outcome;
    },
    async waitForActionOutcome(_accountId, actionId) {
      const outcome = outcomes.get(actionId);
      if (!outcome) throw createSafeError('AI-native demo action outcome was unavailable', 'ACTION_NOT_FOUND', 404);
      return outcome;
    },
    async fenceUserActions(accountId) {
      if (!IDENTIFIER_PATTERN.test(accountId || '')) {
        throw createSafeError('AI-native demo account was invalid', 'DEMO_ACCOUNT_INVALID', 400);
      }
      accountFences.add(accountReference(accountId));
      return Object.freeze({ fenced: true });
    }
  });
}

function loadAINativeModules() {
  try {
    return Object.freeze({
      createAINativeSystem: require('./dist-ai-native/orchestration/AINativeSystem.js').createAINativeSystem,
      InMemoryCiphertextRepository:
        require('./dist-ai-native/models/UserState.js').InMemoryCiphertextRepository,
      InMemoryScenarioExecutionRepository:
        require('./dist-ai-native/orchestration/ScenarioEngine.js').InMemoryScenarioExecutionRepository,
      ...require('./dist-ai-native/edge/WearableEdgeAI.js'),
      ...require('./dist-ai-native/edge/RobotEdgeAI.js')
    });
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    throw createSafeError(
      'AI-native build is missing; run npm run build:ai-native before starting the demo',
      'AI_NATIVE_BUILD_MISSING',
      500
    );
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    request.on('data', (chunk) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > MAX_REQUEST_BYTES) {
        chunks.length = 0;
        request.resume();
        finish(reject, createSafeError('Scenario request is too large', 'REQUEST_TOO_LARGE', 413));
        return;
      }
      chunks.push(bytes);
    });
    request.once('end', () => {
      if (settled) return;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
        finish(resolve, parsed);
      } catch {
        finish(reject, createSafeError('Scenario request JSON is invalid', 'INVALID_JSON', 400));
      }
    });
    request.once('aborted', () => finish(
      reject,
      createSafeError('Scenario request was aborted', 'REQUEST_ABORTED', 400)
    ));
    request.once('error', () => finish(
      reject,
      createSafeError('Scenario request failed', 'REQUEST_FAILED', 400)
    ));
  });
}

function writeJson(response, statusCode, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  response.end(payload);
}

function loopbackDashboardOrigins(baseUrl) {
  const port = baseUrl.port ? `:${baseUrl.port}` : '';
  return new Set([
    baseUrl.origin,
    `${baseUrl.protocol}//localhost${port}`,
    `${baseUrl.protocol}//127.0.0.1${port}`,
    `${baseUrl.protocol}//[::1]${port}`
  ]);
}

function corsHeaders(allowedOrigins, requestOrigin) {
  return allowedOrigins.has(requestOrigin)
    ? Object.freeze({
      'Access-Control-Allow-Origin': requestOrigin,
      Vary: 'Origin'
    })
    : Object.freeze({});
}

function writePreflight(response, allowedOrigin, allowedMethod) {
  response.writeHead(204, {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': `${allowedMethod}, OPTIONS`,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store',
    Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers'
  });
  response.end();
}

function lifecycleStatus(state) {
  if (state === 'completed') return 'completed';
  if (state === 'fallback_completed') return 'fallback';
  if (state === 'cancelled') return 'cancelled';
  return 'failed';
}

function createAINativeDemoRuntime({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
  shutdownDrainGraceMs = 2_000
} = {}) {
  if (!enabled(env.AI_NATIVE_ENABLED)) return null;
  if (env.NODE_ENV === 'production') {
    throw new Error('In-memory AI-native demo repositories are forbidden in production');
  }
  if (!enabled(env.AI_NATIVE_DATA_LIFECYCLE_ENABLED)) {
    throw new Error('AI-native demo requires AI_NATIVE_DATA_LIFECYCLE_ENABLED=true');
  }
  if (!enabled(env.AI_NATIVE_SINGLE_REPLICA)) {
    throw new Error('AI-native demo requires AI_NATIVE_SINGLE_REPLICA=true');
  }
  if (!Number.isSafeInteger(shutdownDrainGraceMs)
    || shutdownDrainGraceMs < 0
    || shutdownDrainGraceMs > 10_000) {
    throw new TypeError('AI-native demo shutdown drain grace is invalid');
  }

  const demoAccountId = env.AI_NATIVE_DEMO_USER_ID || 'test-user-1';
  if (!IDENTIFIER_PATTERN.test(demoAccountId)) {
    throw new Error('AI-native demo account identifier is invalid');
  }
  const baseUrl = parseLoopbackMockURL(env.MOCK_MANUFACTURER_URL || '');
  const dashboardOrigins = loopbackDashboardOrigins(baseUrl);
  const mockClient = new MockManufacturerClient({
    baseUrl,
    apiKey: env.MOCK_MANUFACTURER_API_KEY || DEFAULT_MOCK_API_KEY,
    fetchImpl
  });
  const modules = loadAINativeModules();
  const actionGateway = createDemoActionGateway(mockClient);
  const system = modules.createAINativeSystem({
    actionGateway,
    ciphertextRepository: new modules.InMemoryCiphertextRepository(),
    scenarioRepository: new modules.InMemoryScenarioExecutionRepository({ maxRecords: 500 }),
    encryptionKey: randomBytes(32),
    scenarioIdentitySecret: randomBytes(32),
    externalPrivacyProvider: {
      exportUserData: async () => Object.freeze({}),
      deleteUserData: async () => undefined
    },
    beginHumeSession: async () => Object.freeze({ started: true, simulated: true }),
    authorizeHumeContext: async () => false,
    waitForSignal: async () => Object.freeze({
      status: 'not_found',
      code: 'NO_RESPONSE',
      data: Object.freeze({ responded: false, confirmed: false })
    }),
    notify: async () => Object.freeze({ accepted: true, simulated: true }),
    sendSms: async () => Object.freeze({ accepted: true, simulated: true }),
    recordAnalytics: async () => Object.freeze({ accepted: true, simulated: true }),
    edge: {
      maxTelemetryAgeMs: 5 * 60_000,
      maxFutureSkewMs: 60_000,
      fallEpisodeCooldownMs: 1_000,
      stressEpisodeCooldownMs: 10_000,
      episodeSourceStaleMs: 1_000
    }
  });
  const wearableEdge = new modules.WearableEdgeAI({
    random: modules.createWearableSeededRandom(0x564c3031)
  });
  const robotEdge = new modules.RobotEdgeAI({
    random: modules.createRobotSeededRandom(0x564c3032)
  });
  let wearableSequence = 0;
  let robotSequence = 0;
  let lastWearableObservedAt = 0;
  let closing = false;
  let closePromise;
  const backgroundTasks = new Set();

  const trackBackgroundTask = (task) => {
    const tracked = Promise.resolve(task);
    backgroundTasks.add(tracked);
    // Use both handlers instead of a bare finally so cleanup never creates an
    // unobserved derived rejection when a provider fails during shutdown.
    void tracked.then(
      () => backgroundTasks.delete(tracked),
      () => backgroundTasks.delete(tracked)
    );
    return tracked;
  };

  const defaultBinding = Object.freeze({
    targets: Object.freeze({ wearableId: 'wearable-1', homeRobotId: DEFAULT_ROBOT_ID }),
    wearableSourceRef: 'demo-wearable-edge',
    homeRobotSourceRef: 'demo-home-robot-edge'
  });

  const generateWearableInference = (binding, profile, occurredAt, stepsToday) => {
    const observedAt = Math.max(occurredAt, lastWearableObservedAt);
    lastWearableObservedAt = observedAt;
    const inference = wearableEdge.infer(wearableEdge.generateFrame({
      deviceRef: binding.wearableSourceRef,
      sequence: ++wearableSequence,
      profile,
      // The demo account represents the low-activity morning used by the
      // cognitive-engagement scenario. Keep this day-to-date counter
      // monotonic across all synthetic edge frames.
      stepsToday: stepsToday ?? 100
    }));
    return Object.freeze({
      ...inference,
      observedAtMs: observedAt,
      emittedAtMs: observedAt
    });
  };

  const ingestSettledWearable = async (accountId, binding) => {
    const settledInference = generateWearableInference(binding, 'resting', Date.now());
    await system.edgeScenarioRouter.ingestWearableInference(
      accountId,
      settledInference,
      binding,
      { locationContext: 'home', locationRef: 'last-known-location' }
    );
  };

  const triggerScenario = async (body, requestSignal) => {
    if (!hasExactKeys(
      body,
      ['scenarioId', 'userId', 'deviceId'],
      ['robotDeviceId', 'occurredAt']
    )
      || !IDENTIFIER_PATTERN.test(body.userId || '')
      || !IDENTIFIER_PATTERN.test(body.deviceId || '')
      || (body.robotDeviceId !== undefined && !IDENTIFIER_PATTERN.test(body.robotDeviceId))
      || !Object.prototype.hasOwnProperty.call(DEMO_SCENARIOS, body.scenarioId)) {
      throw createSafeError('Scenario request is invalid', 'SCENARIO_REQUEST_INVALID', 400);
    }
    if (body.userId !== demoAccountId) {
      throw createSafeError(
        'Scenario account is not authorized for this demo',
        'SCENARIO_ACCOUNT_FORBIDDEN',
        403
      );
    }
    const now = Date.now();
    const occurredAt = body.occurredAt ?? now;
    if (!Number.isSafeInteger(occurredAt)
      || occurredAt < now - 5 * 60_000
      || occurredAt > now + 60_000) {
      throw createSafeError('Scenario occurrence time is invalid', 'SCENARIO_REQUEST_INVALID', 400);
    }
    const definition = DEMO_SCENARIOS[body.scenarioId];
    const robotDeviceId = body.robotDeviceId || DEFAULT_ROBOT_ID;
    const binding = Object.freeze({
      targets: Object.freeze({ wearableId: body.deviceId, homeRobotId: robotDeviceId }),
      wearableSourceRef: 'demo-wearable-edge',
      homeRobotSourceRef: 'demo-home-robot-edge'
    });

    await Promise.all([
      mockClient.recordDeviceEvent(
        body.deviceId, 'wearable', definition.wearableEvent, requestSignal
      ),
      mockClient.recordDeviceEvent(
        robotDeviceId, 'home_robot', definition.robotEvent, requestSignal
      )
    ]);

    let routed;
    if (definition.route === 'wearable_fall') {
      const robotInference = robotEdge.infer(robotEdge.generateFrame({
        deviceRef: binding.homeRobotSourceRef,
        sequence: ++robotSequence,
        profile: 'idle'
      }));
      await system.edgeScenarioRouter.ingestRobotInference(
        body.userId,
        robotInference,
        binding,
        { locationContext: 'home', locationRef: 'last-known-location' }
      );
      routed = await system.edgeScenarioRouter.ingestWearableInference(
        body.userId,
        generateWearableInference(binding, 'fall', occurredAt),
        binding,
        { locationContext: 'home', locationRef: 'last-known-location' }
      );
    } else if (definition.route === 'wearable_stress') {
      routed = await system.edgeScenarioRouter.ingestWearableInference(
        body.userId,
        generateWearableInference(binding, 'stressed', occurredAt),
        binding,
        { locationContext: 'home', locationRef: 'last-known-location' }
      );
    } else {
      if (definition.route === 'bedroom_inactivity') {
        await system.edgeScenarioRouter.ingestWearableInference(
          body.userId,
          generateWearableInference(binding, 'resting', occurredAt, 100),
          binding,
          { locationContext: 'home', locationRef: 'last-known-location' }
        );
      }
      const eventId = `demo-${randomBytes(12).toString('hex')}`;
      const data = definition.route === 'medication_due'
        ? { medicationId: 'scheduled-medication', scheduledAt: occurredAt }
        : definition.route === 'panic_button'
          ? { contactId: 'primary-emergency-contact', locationRef: 'last-known-location' }
          : {};
      routed = await system.edgeScenarioRouter.ingestContextEvent(
        body.userId,
        { eventId, type: definition.route, occurredAt, data },
        binding
      );
    }
    const execution = routed.started?.[0]?.execution;
    if (!execution?.executionId) {
      throw createSafeError('Scenario trigger was suppressed as a duplicate', 'SCENARIO_NOT_STARTED', 409);
    }

    const startedLifecycle = mockClient.recordScenarioLifecycle(
      definition.scenarioId, 'started', body.deviceId, robotDeviceId
    ).catch((error) => {
      logger.error?.('[AI-Native] Demo scenario lifecycle sync failed', {
        code: safeErrorCode(error)
      });
    });
    trackBackgroundTask(system.scenarioEngine.waitForCompletion(body.userId, execution.executionId)
      .then(async (completed) => {
        if (definition.route === 'wearable_fall' || definition.route === 'wearable_stress') {
          try {
            await ingestSettledWearable(body.userId, binding);
          } catch (error) {
            logger.error?.('[AI-Native] Demo edge episode reset failed', {
              code: safeErrorCode(error)
            });
          }
        }
        await startedLifecycle;
        await mockClient.recordScenarioLifecycle(
          definition.scenarioId,
          lifecycleStatus(completed.state),
          body.deviceId,
          robotDeviceId
        );
      })
      .catch((error) => {
        logger.error?.('[AI-Native] Demo scenario lifecycle sync failed', {
          code: safeErrorCode(error)
        });
      }));

    return Object.freeze({
      status: 'started',
      scenarioId: body.scenarioId,
      executionId: execution.executionId
    });
  };

  const listScenarioExecutions = async (userId) => {
    if (!IDENTIFIER_PATTERN.test(userId || '')) {
      throw createSafeError('Scenario account is invalid', 'SCENARIO_ACCOUNT_INVALID', 400);
    }
    if (userId !== demoAccountId) {
      throw createSafeError(
        'Scenario account is not authorized for this demo',
        'SCENARIO_ACCOUNT_FORBIDDEN',
        403
      );
    }
    const executions = await system.scenarioEngine.listExecutions(
      userId,
      MAX_EXECUTION_RESULTS
    );
    return Object.freeze({
      contractVersion: 'vl-ai-native-scenario-executions/1',
      executions: Object.freeze(executions.map((execution) => Object.freeze({
        executionId: execution.executionId,
        scenarioId: SCENARIO_ALIASES[execution.scenarioId] || execution.scenarioId,
        canonicalScenarioId: execution.scenarioId,
        priority: execution.priority,
        status: execution.state,
        createdAt: execution.createdAt,
        updatedAt: execution.updatedAt,
        ...(execution.completedAt === undefined ? {} : { completedAt: execution.completedAt }),
        deviceReferences: Object.freeze({ ...execution.deviceReferences })
      })))
    });
  };

  return Object.freeze({
    config: Object.freeze({
      // The loopback demo is intentionally self-contained: do not initialize
      // partially provisioned auth, AWS safety stores, or vendor adapters from
      // a developer's production-shaped .env file.
      authExchangeEnabled: false,
      phoneAuthEnabled: false,
      safetyApiEnabled: false,
      robotAdapterConfigurations: Object.freeze([]),
      actionSigningPrivateKey: '',
      actionSigningPublicKey: '',
      wearableCommandPayloads: '',
      manufacturerWebhookURL: '',
      manufacturerPairingVerifyURL: '',
      manufacturerStatusURL: '',
      manufacturerResetURL: '',
      manufacturerPrivacyExportURL: '',
      manufacturerPrivacyDeleteURL: '',
      manufacturerApiKey: '',
      aiNativeEnabled: true,
      aiNativeDataLifecycleEnabled: true,
      aiNativeSingleReplica: true,
      aiNativeSystem: system,
      resolveScenarioDevices: async () => defaultBinding
    }),
    system,
    mockClient,
    close() {
      if (!closePromise) {
        closing = true;
        closePromise = (async () => {
          const drain = (async () => {
            while (backgroundTasks.size > 0) {
              await Promise.allSettled([...backgroundTasks]);
            }
          })();
          let graceTimer;
          try {
            await Promise.race([
              drain,
              new Promise((resolve) => {
                graceTimer = setTimeout(resolve, shutdownDrainGraceMs);
                graceTimer.unref?.();
              })
            ]);
          } finally {
            if (graceTimer) clearTimeout(graceTimer);
          }
          // Let accepted work finish first, but abort a stalled manufacturer
          // request after the bounded grace period so shutdown cannot hang.
          mockClient.close();
          await drain;
        })();
      }
      return closePromise;
    },
    wrapHandler(fallbackHandler) {
      if (typeof fallbackHandler !== 'function') throw new TypeError('Fallback handler is required');
      return async function aiNativeDemoHandler(request, response) {
        let url;
        try {
          url = new URL(request.url || '/', 'http://localhost');
        } catch {
          writeJson(response, 400, { error: 'Invalid request URL' });
          return;
        }
        const isScenarioPath = url.pathname === '/v1/scenarios';
        const isExecutionsPath = url.pathname === '/v1/scenarios/executions';
        if (!isScenarioPath && !isExecutionsPath) {
          return fallbackHandler(request, response);
        }
        if (closing) {
          writeJson(response, 503, {
            error: 'AI-native demo is shutting down',
            code: 'DEMO_SHUTTING_DOWN'
          });
          return;
        }
        const requestOrigin = String(request.headers?.origin || '');
        if (!isLoopbackAddress(request.socket?.remoteAddress)
          || (requestOrigin && !dashboardOrigins.has(requestOrigin))) {
          writeJson(response, 403, { error: 'Local AI-native demo access only' });
          return;
        }
        const responseCorsHeaders = corsHeaders(dashboardOrigins, requestOrigin);
        if (request.method === 'OPTIONS') {
          const requestedMethod = String(
            request.headers?.['access-control-request-method'] || ''
          ).toUpperCase();
          const expectedMethod = isScenarioPath ? 'POST' : 'GET';
          if (url.search
            || !dashboardOrigins.has(requestOrigin)
            || requestedMethod !== expectedMethod) {
            writeJson(response, 403, { error: 'Local AI-native demo access only' });
            return;
          }
          writePreflight(response, requestOrigin, expectedMethod);
          return;
        }

        if (isExecutionsPath && request.method === 'GET') {
          const queryKeys = [...url.searchParams.keys()];
          const userIds = url.searchParams.getAll('userId');
          if (queryKeys.length !== 1 || queryKeys[0] !== 'userId' || userIds.length !== 1) {
            writeJson(response, 400, {
              error: 'Exactly one userId query parameter is required',
              code: 'SCENARIO_QUERY_INVALID'
            }, responseCorsHeaders);
            return;
          }
          try {
            writeJson(
              response,
              200,
              await listScenarioExecutions(userIds[0]),
              responseCorsHeaders
            );
          } catch (error) {
            logger.error?.('[AI-Native] Demo scenario query failed', {
              code: safeErrorCode(error)
            });
            const statusCode = Number.isSafeInteger(error?.statusCode)
              && error.statusCode >= 400
              && error.statusCode <= 599
              ? error.statusCode
              : 500;
            writeJson(response, statusCode, {
              error: statusCode >= 500 ? 'AI-native demo scenario query failed' : error.message,
              code: safeErrorCode(error)
            }, responseCorsHeaders);
          }
          return;
        }

        if (!isScenarioPath || request.method !== 'POST') {
          writeJson(response, 405, { error: 'Method not allowed' }, {
            ...responseCorsHeaders,
            Allow: isScenarioPath ? 'POST, OPTIONS' : 'GET, OPTIONS'
          });
          return;
        }
        if (url.search) {
          writeJson(response, 400, {
            error: 'Scenario trigger query parameters are not allowed',
            code: 'SCENARIO_REQUEST_INVALID'
          }, responseCorsHeaders);
          return;
        }
        const contentType = String(request.headers?.['content-type'] || '')
          .split(';', 1)[0]
          .trim()
          .toLowerCase();
        if (contentType !== 'application/json') {
          writeJson(response, 415, {
            error: 'Content-Type must be application/json'
          }, responseCorsHeaders);
          return;
        }
        try {
          const body = await readJson(request);
          const controller = new AbortController();
          const abort = () => controller.abort();
          request.once('aborted', abort);
          response.once('close', abort);
          try {
            if (closing) {
              throw createSafeError(
                'AI-native demo is shutting down',
                'DEMO_SHUTTING_DOWN',
                503
              );
            }
            const result = await trackBackgroundTask(triggerScenario(body, controller.signal));
            if (controller.signal.aborted || response.destroyed) return;
            writeJson(response, 202, result, responseCorsHeaders);
          } finally {
            request.removeListener('aborted', abort);
            response.removeListener('close', abort);
          }
        } catch (error) {
          logger.error?.('[AI-Native] Demo scenario request failed', { code: safeErrorCode(error) });
          if (response.destroyed || response.writableEnded) return;
          const statusCode = Number.isSafeInteger(error?.statusCode)
            && error.statusCode >= 400
            && error.statusCode <= 599
            ? error.statusCode
            : 500;
          writeJson(response, statusCode, {
            error: statusCode >= 500 ? 'AI-native demo scenario failed' : error.message,
            code: safeErrorCode(error)
          }, responseCorsHeaders);
        }
      };
    }
  });
}

module.exports = {
  createAINativeDemoRuntime,
  isLoopbackAddress,
  isLoopbackHostname,
  parseLoopbackMockURL
};
