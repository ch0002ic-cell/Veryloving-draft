'use strict';

const { createHash, randomBytes } = require('node:crypto');

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MOCK_REQUEST_TIMEOUT_MS = 4_000;
const MOCK_REQUEST_ATTEMPTS = 3;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const ACTION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const FALL_DEMO_ID = 'fall-detection';
const FALL_SCENARIO_ID = 'fall_detection';
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

class MockManufacturerClient {
  constructor({ baseUrl, apiKey, fetchImpl }) {
    if (typeof fetchImpl !== 'function') throw new TypeError('AI-native demo requires fetch');
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.accessTokenPromise = undefined;
  }

  async authenticate(signal) {
    if (!this.accessTokenPromise) {
      this.accessTokenPromise = this.request('/api/v1/authenticate', {
        authorization: `Bearer ${this.apiKey}`,
        body: { device_id: 'veryloving-demo-runtime' },
        signal
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
    const token = await this.authenticate(signal);
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
      const refreshed = await this.authenticate(signal);
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

  recordScenarioLifecycle(status, wearableDeviceId, robotDeviceId, signal) {
    return this.postAuthenticated('/api/v1/simulation/scenarios', {
      scenario_id: FALL_SCENARIO_ID,
      status,
      wearable_device_id: wearableDeviceId,
      robot_device_id: robotDeviceId
    }, { signal });
  }

  async request(pathname, { authorization, body, signal, idempotencyKey }) {
    let lastError;
    for (let attempt = 1; attempt <= MOCK_REQUEST_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal?.aborted) controller.abort();
      else signal?.addEventListener('abort', abort, { once: true });
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
        const text = await response.text();
        if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
          throw createSafeError('Mock manufacturer response exceeded the limit', 'MOCK_RESPONSE_TOO_LARGE', 502);
        }
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
        if (signal?.aborted) throw createSafeError('AI-native demo request was cancelled', 'REQUEST_CANCELLED', 499);
        const normalized = error?.code && String(error.code).startsWith('MOCK_')
          ? error
          : createSafeError('Mock manufacturer is unavailable', 'MOCK_UNAVAILABLE', 502);
        if (attempt === MOCK_REQUEST_ATTEMPTS || normalized.code === 'MOCK_RESPONSE_TOO_LARGE') throw normalized;
        lastError = normalized;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
      }
      await delay(25 * attempt, signal);
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

function writeJson(response, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(payload);
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
  logger = console
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

  const baseUrl = parseLoopbackMockURL(env.MOCK_MANUFACTURER_URL || '');
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
    scenarioRepository: new modules.InMemoryScenarioExecutionRepository(),
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
      fallEpisodeCooldownMs: 1_000,
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

  const defaultBinding = Object.freeze({
    targets: Object.freeze({ wearableId: 'wearable-1', homeRobotId: DEFAULT_ROBOT_ID }),
    wearableSourceRef: 'demo-wearable-edge',
    homeRobotSourceRef: 'demo-home-robot-edge'
  });

  const triggerFallScenario = async (body, requestSignal) => {
    if (!hasExactKeys(body, ['scenarioId', 'userId', 'deviceId'], ['robotDeviceId'])
      || body.scenarioId !== FALL_DEMO_ID
      || !IDENTIFIER_PATTERN.test(body.userId || '')
      || !IDENTIFIER_PATTERN.test(body.deviceId || '')
      || (body.robotDeviceId !== undefined && !IDENTIFIER_PATTERN.test(body.robotDeviceId))) {
      throw createSafeError('Scenario request is invalid', 'SCENARIO_REQUEST_INVALID', 400);
    }
    const robotDeviceId = body.robotDeviceId || DEFAULT_ROBOT_ID;
    const binding = Object.freeze({
      targets: Object.freeze({ wearableId: body.deviceId, homeRobotId: robotDeviceId }),
      wearableSourceRef: 'demo-wearable-edge',
      homeRobotSourceRef: 'demo-home-robot-edge'
    });

    await Promise.all([
      mockClient.recordDeviceEvent(body.deviceId, 'wearable', 'fall_detected', requestSignal),
      mockClient.recordDeviceEvent(robotDeviceId, 'home_robot', 'device_online', requestSignal)
    ]);

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
    const wearableInference = wearableEdge.infer(wearableEdge.generateFrame({
      deviceRef: binding.wearableSourceRef,
      sequence: ++wearableSequence,
      profile: 'fall'
    }));
    const routed = await system.edgeScenarioRouter.ingestWearableInference(
      body.userId,
      wearableInference,
      binding,
      { locationContext: 'home', locationRef: 'last-known-location' }
    );
    const execution = routed.started?.[0]?.execution;
    if (!execution?.executionId) {
      throw createSafeError('Scenario trigger was suppressed as a duplicate', 'SCENARIO_NOT_STARTED', 409);
    }

    const startedLifecycle = mockClient.recordScenarioLifecycle(
      'started', body.deviceId, robotDeviceId
    ).catch((error) => {
      logger.error?.('[AI-Native] Demo scenario lifecycle sync failed', {
        code: safeErrorCode(error)
      });
    });
    void system.scenarioEngine.waitForCompletion(body.userId, execution.executionId)
      .then(async (completed) => {
        // Close the synthetic fall episode after the workflow completes so a
        // deliberate demo rerun is not held open by stale positive telemetry.
        const settledInference = wearableEdge.infer(wearableEdge.generateFrame({
          deviceRef: binding.wearableSourceRef,
          sequence: ++wearableSequence,
          profile: 'resting'
        }));
        await system.edgeScenarioRouter.ingestWearableInference(
          body.userId,
          settledInference,
          binding,
          { locationContext: 'home', locationRef: 'last-known-location' }
        );
        await startedLifecycle;
        await mockClient.recordScenarioLifecycle(
          lifecycleStatus(completed.state),
          body.deviceId,
          robotDeviceId
        );
      })
      .catch((error) => {
        logger.error?.('[AI-Native] Demo scenario lifecycle sync failed', {
          code: safeErrorCode(error)
        });
      });

    return Object.freeze({
      status: 'started',
      scenarioId: FALL_DEMO_ID,
      executionId: execution.executionId
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
        if (request.method !== 'POST' || url.pathname !== '/v1/scenarios') {
          return fallbackHandler(request, response);
        }
        if (url.search || !isLoopbackAddress(request.socket?.remoteAddress)) {
          writeJson(response, 403, { error: 'Local AI-native demo access only' });
          return;
        }
        const contentType = String(request.headers?.['content-type'] || '').toLowerCase();
        if (!contentType.startsWith('application/json')) {
          writeJson(response, 415, { error: 'Content-Type must be application/json' });
          return;
        }
        try {
          const body = await readJson(request);
          const controller = new AbortController();
          const abort = () => controller.abort();
          request.once('aborted', abort);
          response.once('close', abort);
          try {
            const result = await triggerFallScenario(body, controller.signal);
            if (controller.signal.aborted || response.destroyed) return;
            writeJson(response, 202, result);
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
          });
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
