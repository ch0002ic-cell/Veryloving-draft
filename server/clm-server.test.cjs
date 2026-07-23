'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const {
  createHandler,
  envConfig,
  fetchWithDeadline,
  readBoundedResponseJson,
  validateServerConfig
} = require('./clm-server.cjs');
const { SAFETY_SYSTEM_PROMPT, getSafetyTips, inferScenario } = require('./safety-companion.cjs');
const { signSessionJWT, verifySessionJWT } = require('./auth-session.cjs');

const silentLogger = { info() {}, warn() {}, error() {} };
const VALID_HUME_CONFIG_ID = '11111111-1111-4111-8111-111111111111';
const VALID_HUME_VOICE_ID = '22222222-2222-4222-8222-222222222222';
const ACTION_KEY_PAIR = crypto.generateKeyPairSync('ed25519');
const ACTION_SIGNING_PRIVATE_KEY = ACTION_KEY_PAIR.privateKey.export({ format: 'pem', type: 'pkcs8' });
const ACTION_SIGNING_PUBLIC_KEY = ACTION_KEY_PAIR.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');

test('CLM environment parsing rejects fractional and oversized timing values at startup', () => {
  const originalActionTimeout = process.env.ACTION_REQUEST_TIMEOUT_MS;
  const originalUpstreamTimeout = process.env.CLM_UPSTREAM_TIMEOUT_MS;
  try {
    process.env.ACTION_REQUEST_TIMEOUT_MS = '12.5';
    assert.throws(() => envConfig(), /ACTION_REQUEST_TIMEOUT_MS/);
    process.env.ACTION_REQUEST_TIMEOUT_MS = '5000';
    process.env.CLM_UPSTREAM_TIMEOUT_MS = '30001';
    assert.throws(() => envConfig(), /CLM_UPSTREAM_TIMEOUT_MS/);
  } finally {
    if (originalActionTimeout === undefined) delete process.env.ACTION_REQUEST_TIMEOUT_MS;
    else process.env.ACTION_REQUEST_TIMEOUT_MS = originalActionTimeout;
    if (originalUpstreamTimeout === undefined) delete process.env.CLM_UPSTREAM_TIMEOUT_MS;
    else process.env.CLM_UPSTREAM_TIMEOUT_MS = originalUpstreamTimeout;
  }
});

test('CLM environment parsing preserves the standard AWS region fallback', () => {
  const originalRegion = process.env.AWS_REGION;
  const originalDefaultRegion = process.env.AWS_DEFAULT_REGION;
  try {
    delete process.env.AWS_REGION;
    process.env.AWS_DEFAULT_REGION = 'ap-southeast-1';
    assert.equal(envConfig().awsRegion, 'ap-southeast-1');
    process.env.AWS_REGION = 'us-east-1';
    assert.equal(envConfig().awsRegion, 'us-east-1');
  } finally {
    if (originalRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = originalRegion;
    if (originalDefaultRegion === undefined) delete process.env.AWS_DEFAULT_REGION;
    else process.env.AWS_DEFAULT_REGION = originalDefaultRegion;
  }
});

function aiNativeTestConfig(edgeScenarioRouter, overrides = {}) {
  const scenarioEngine = overrides.scenarioEngine || {};
  return {
    aiNativeEnabled: true,
    aiNativeDataLifecycleEnabled: true,
    aiNativeSystem: {
      scenarioEngine,
      edgeScenarioRouter,
      async getVoiceContext() { return { state: null, memories: [] }; },
      memory: {
        async list() { return []; },
        async delete() { return false; },
        async deleteAll() { return false; }
      },
      privacyRepository: {
        async exportUserData() { return {}; },
        async deleteUserData() { return {}; }
      }
    },
    ...overrides
  };
}

function productionHTTPConfig(overrides = {}) {
  const authSessionRepository = {
    create: async () => true,
    rotate: async () => true,
    revoke: async () => true,
    isActive: async () => true,
    exportUserData: async () => [],
    deleteUserData: async () => ({ deletedItems: 0 }),
    beginAccountDeletion: async () => true,
    completeAccountDeletion: async () => true,
    finalizeAccountDeletion: async () => ({ deletedItems: 0, completed: true }),
    getAccountDeletionState: async () => 'active',
    consumePhoneChallenge: async () => true
  };
  const safetyRepository = {
    listContacts: async () => [],
    createContact: async (_userId, contact) => contact,
    updateContact: async (_userId, _contactId, contact) => contact,
    deleteContact: async () => undefined,
    acceptSOS: async (_userId, event) => event,
    getSOS: async () => null,
    claimSOSDelivery: async () => null,
    recordSOSDelivery: async () => null,
    getMedicationEscalation: async () => null,
    acceptMedicationEscalation: async (_userId, event) => event,
    claimMedicationEscalationDelivery: async () => null,
    recordMedicationEscalationDelivery: async () => null,
    startSafetySession: async (_userId, session) => session,
    getSafetySession: async () => null,
    exportUserData: async () => ({}),
    deleteUserData: async () => ({ deletedItems: 0 })
  };
  const pushRepository = {
    register: async () => ({ unregisterReceipt: 'receipt-value' }),
    unregister: async () => true,
    unregisterByReceipt: async () => true,
    list: async () => [],
    exportUserData: async () => [],
    deleteUserData: async () => ({ deletedItems: 0 })
  };
  return {
    nodeEnv: 'production',
    httpOnlyDeployment: true,
    authExchangeEnabled: true,
    phoneAuthEnabled: true,
    safetyApiEnabled: true,
    safetyRepository,
    pushRepository,
    notifyEmergencyContacts: async () => ({ eligible: 0, delivered: 0, failedRecipients: 0 }),
    authSessionRepository,
    privacyCoordinator: {
      missingRepositories: () => [],
      exportUserData: async () => ({}),
      deleteUserData: async () => ({ deleted: [] })
    },
    sessionJWTSecret: 'production-session-secret-at-least-32-characters',
    appleClientIds: 'com.veryloving.app',
    googleTokenAudiences: 'google-web.apps.googleusercontent.com',
    googleAuthorizedParties: 'google-ios.apps.googleusercontent.com',
    phoneAuthChallengeSecret: 'production-phone-challenge-secret-at-least-32-characters',
    phoneAuthSubjectSecret: 'production-phone-subject-secret-at-least-32-characters',
    robotPairingTokenSecret: 'production-robot-pairing-secret-at-least-32-characters',
    twilioAccountSid: `AC${'a'.repeat(32)}`,
    twilioAuthToken: 'production-twilio-auth-token-value',
    twilioVerifyServiceSid: `VA${'b'.repeat(32)}`,
    fetchImpl: async () => { throw new Error('must not run'); },
    humeApiKey: '',
    humeConfigId: '',
    humeAllowedVoiceIds: '',
    humeAllowClientResume: false,
    clmBearerToken: '',
    ...overrides
  };
}

function memoryAuthSessionRepository() {
  const sessions = new Map();
  const key = ({ subject, sessionId }) => `${subject}:${sessionId}`;
  return {
    async create(session) {
      sessions.set(key(session), {
        refreshJti: session.refreshJti,
        expiresAt: session.expiresAt,
        revoked: false
      });
      return true;
    },
    async rotate(session) {
      const current = sessions.get(key(session));
      if (!current || current.revoked || current.refreshJti !== session.currentJti) {
        if (current) current.revoked = true;
        return false;
      }
      current.refreshJti = session.nextJti;
      current.expiresAt = session.expiresAt;
      return true;
    },
    async revoke(session) {
      const current = sessions.get(key(session));
      if (!current) return false;
      current.revoked = true;
      return true;
    },
    async isActive(subject, sessionId) {
      const current = sessions.get(`${subject}:${sessionId}`);
      return Boolean(current && !current.revoked && current.expiresAt > Date.now());
    }
  };
}

function memoryRobotResetRepository({
  adapterId = 'manufacturer-default',
  manufacturerDeviceId = 'manufacturer:1',
  bindingEpoch = 7
} = {}) {
  const state = {
    userId: 'google:user-1',
    robotId: 'robot:1',
    pairingToken: 'pairing-token',
    adapterId,
    manufacturerDeviceId,
    bindingEpoch,
    lifecycleState: 'active',
    resetId: null,
    resetAttempt: 0
  };
  return {
    state,
    async beginFactoryReset(userId, robotId, pairingToken) {
      if (userId !== state.userId || robotId !== state.robotId) return null;
      if (pairingToken !== state.pairingToken) {
        throw Object.assign(new Error('Robot pairing token is invalid'), { statusCode: 403 });
      }
      if (state.lifecycleState === 'unbound') {
        return {
          robotId,
          resetId: state.resetId,
          bindingEpoch: state.bindingEpoch,
          lifecycleState: 'unbound',
          completed: true
        };
      }
      if (state.lifecycleState === 'active') {
        state.lifecycleState = 'reset_pending';
        state.resetId = '11111111-1111-4111-8111-111111111111';
      }
      return { ...state };
    },
    async claimFactoryReset(userId, robotId, leaseOwner) {
      assert.equal(userId, state.userId);
      assert.equal(robotId, state.robotId);
      if (state.lifecycleState === 'reset_remote_complete') {
        return { ...state, claimed: false, remoteComplete: true };
      }
      if (state.lifecycleState !== 'reset_pending') return { ...state, claimed: false };
      state.lifecycleState = 'reset_in_progress';
      state.resetAttempt += 1;
      state.resetLeaseOwner = leaseOwner;
      return { ...state, claimed: true };
    },
    async markFactoryResetRemoteComplete(_userId, _robotId, resetId, epoch) {
      assert.equal(resetId, state.resetId);
      assert.equal(epoch, state.bindingEpoch);
      state.lifecycleState = 'reset_remote_complete';
      return { ...state };
    },
    async recordFactoryResetFailure(_userId, _robotId, resetId, epoch) {
      assert.equal(resetId, state.resetId);
      assert.equal(epoch, state.bindingEpoch);
      state.lifecycleState = 'reset_pending';
      delete state.resetLeaseOwner;
      return { ...state };
    },
    async completeFactoryReset(_userId, robotId, resetId, epoch) {
      assert.equal(resetId, state.resetId);
      assert.equal(epoch, state.bindingEpoch);
      state.lifecycleState = 'unbound';
      return {
        robotId,
        resetId,
        bindingEpoch: epoch,
        lifecycleState: 'unbound',
        completed: true
      };
    },
    async listRecoverableFactoryResets() { return []; }
  };
}

async function invokeHandler(handler, { method = 'GET', url = '/', headers = {}, body, rawBody } = {}) {
  const requestBody = rawBody === undefined
    ? (body === undefined ? undefined : JSON.stringify(body))
    : rawBody;
  const req = Readable.from(requestBody === undefined ? [] : [Buffer.from(requestBody)]);
  req.method = method;
  req.url = url;
  req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  if (requestBody !== undefined && !Object.hasOwn(req.headers, 'content-type')) {
    req.headers['content-type'] = 'application/json';
  }
  const chunks = [];
  const res = {
    headersSent: false,
    statusCode: null,
    headers: {},
    writeHead(statusCode, responseHeaders = {}) {
      this.statusCode = statusCode;
      this.headers = responseHeaders;
      this.headersSent = true;
    },
    write(chunk) {
      chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
      this.finished = true;
    }
  };
  await handler(req, res);
  const text = Buffer.concat(chunks).toString('utf8');
  const contentType = res.headers['Content-Type'] || res.headers['content-type'] || '';
  return {
    status: res.statusCode,
    headers: res.headers,
    text,
    json: text && contentType.includes('application/json') ? JSON.parse(text) : null
  };
}

async function invoke(options, request = {}) {
  return invokeHandler(createHandler({ logger: silentLogger, ...options }), request);
}

test('health endpoint reports the CLM service', async () => {
  const response = await invoke({}, { url: '/health' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { status: 'ok', service: 'veryloving-hume-clm' });
});

test('request failures normalize invalid status codes and do not expose server errors', async () => {
  const response = await invoke({
    verifyAppToken: async () => ({ sub: 'google:user-1' }),
    actionGateway: {
      async route() {
        throw Object.assign(new Error('upstream secret detail'), { statusCode: 999 });
      }
    }
  }, {
    method: 'POST',
    url: '/v1/device-actions',
    headers: { Authorization: 'Bearer app-session' },
    body: { action: 'emit_alarm', device_type: 'wearable', device_id: 'wearable-1' }
  });
  assert.equal(response.status, 500);
  assert.deepEqual(response.json, { error: 'Internal server error' });
});

test('external JSON responses are size-bounded and oversized streams are cancelled', async () => {
  let cancelled = 0;
  let released = 0;
  const response = {
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          async read() { return { done: false, value: Buffer.alloc(65 * 1024) }; },
          async cancel() { cancelled += 1; },
          releaseLock() { released += 1; }
        };
      }
    }
  };
  await assert.rejects(
    readBoundedResponseJson(response, 64 * 1024, 'Authentication verifier'),
    /too large/
  );
  assert.equal(cancelled, 1);
  assert.equal(released, 1);

  let bodyRead = false;
  let advertisedBodyCancelled = false;
  await assert.rejects(readBoundedResponseJson({
    headers: { get: (name) => name === 'content-length' ? String(64 * 1024 + 1) : null },
    body: {
      getReader() { bodyRead = true; },
      async cancel() { advertisedBodyCancelled = true; }
    }
  }, 64 * 1024), /too large/);
  assert.equal(bodyRead, false);
  assert.equal(advertisedBodyCancelled, true);
});

test('external requests hard-time-out and release late responses when transport ignores abort', async () => {
  let requestSignal;
  let resolveTransport;
  let cancelled = 0;
  const pending = fetchWithDeadline((_url, options) => {
    requestSignal = options.signal;
    return new Promise((resolve) => { resolveTransport = resolve; });
  }, 'https://upstream.example.test', {}, {
    timeoutMs: 5,
    label: 'Test upstream',
    consume: async () => assert.fail('late response must not be consumed')
  });

  await assert.rejects(pending, (error) => (
    error.name === 'TimeoutError' && error.code === 'UPSTREAM_TIMEOUT'
  ));
  assert.equal(requestSignal.aborted, true);
  resolveTransport({ body: { async cancel() { cancelled += 1; } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 1);
});

test('external request deadlines cancel an active response reader', async () => {
  let cancelled = 0;
  let released = 0;
  const response = {
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          async read() { return new Promise(() => {}); },
          async cancel() { cancelled += 1; },
          releaseLock() { released += 1; }
        };
      },
      async cancel() {}
    }
  };
  await assert.rejects(fetchWithDeadline(async () => response, 'https://upstream.example.test', {}, {
    timeoutMs: 5,
    label: 'Test upstream',
    consume: (nextResponse, signal) => readBoundedResponseJson(
      nextResponse,
      1024,
      'Test upstream',
      signal
    )
  }), (error) => error.name === 'TimeoutError');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 1);
  // The bounded reader races cancellation itself, so even a non-compliant
  // pending read cannot retain its lock after the caller's deadline.
  assert.equal(released, 1);
});

test('production server rejects insecure credential-bearing outbound URLs', () => {
  assert.throws(() => validateServerConfig({
    nodeEnv: 'production',
    appAuthVerifyURL: 'http://auth.example.test/verify',
    upstreamURL: ''
  }), /APP_AUTH_VERIFY_URL must use HTTPS/);
  assert.throws(() => validateServerConfig({
    nodeEnv: 'production',
    appAuthVerifyURL: 'https://auth.example.test/verify?token=leak',
    upstreamURL: ''
  }), /credential query parameters/);
  assert.throws(() => validateServerConfig({
    nodeEnv: 'production',
    appAuthVerifyURL: 'https://auth.example.test/verify',
    upstreamURL: 'https://user:password@model.example.test/v1'
  }), /embedded credentials/);

  assert.throws(() => validateServerConfig({
    nodeEnv: 'production',
    appAuthVerifyURL: '',
    upstreamURL: ''
  }), /AUTH_EXCHANGE_ENABLED/);

  const voiceGateway = productionHTTPConfig({
    httpOnlyDeployment: false,
    humeApiKey: 'server-only-hume-key',
    humeConfigId: VALID_HUME_CONFIG_ID,
    humeAllowedVoiceIds: VALID_HUME_VOICE_ID,
    clmBearerToken: 'server-only-clm-key',
    actionSigningPrivateKey: ACTION_SIGNING_PRIVATE_KEY,
    actionSigningPublicKey: ACTION_SIGNING_PUBLIC_KEY,
    actionGatewaySingleReplica: true,
    wearableCommandPayloads: JSON.stringify({ deploy_barrier: 'AQ==', emit_alarm: 'Ag==', trigger_sos: 'Aw==', stop: 'BA==' }),
    manufacturerWebhookURL: 'https://manufacturer.example.test/v1/commands',
    manufacturerPairingVerifyURL: 'https://manufacturer.example.test/v1/pairing/verify',
    manufacturerStatusURL: 'https://manufacturer.example.test/v1/status',
    manufacturerResetURL: 'https://manufacturer.example.test/v1/reset',
    manufacturerApiKey: 'manufacturer-server-key',
    deviceTableName: 'veryloving-devices',
    actionOutboxUserIndexName: 'user-index',
    robotResetRecoveryIndexName: 'robot-reset-recovery-index'
  });
  assert.doesNotThrow(() => validateServerConfig(voiceGateway));
  assert.throws(
    () => validateServerConfig({ ...voiceGateway, robotResetRecoveryIndexName: '' }),
    /ROBOT_RESET_RECOVERY_INDEX_NAME/
  );
  assert.throws(
    () => validateServerConfig({ ...voiceGateway, robotPairingTokenSecret: '' }),
    /ROBOT_PAIRING_TOKEN_SECRET/
  );
  const vendorOnlyGateway = {
    ...voiceGateway,
    privacyCoordinator: undefined,
    manufacturerWebhookURL: '',
    manufacturerPairingVerifyURL: '',
    manufacturerStatusURL: '',
    manufacturerResetURL: '',
    manufacturerPrivacyExportURL: '',
    manufacturerPrivacyDeleteURL: '',
    manufacturerApiKey: '',
    robotAdapterConfigurations: [{
      adapterId: 'jiangzhi-edge',
      pairingVerifyURL: 'https://edge.example.test/pairing/verify',
      resetURL: 'https://edge.example.test/lifecycle/reset',
      privacyExportURL: 'https://edge.example.test/privacy/export',
      privacyDeleteURL: 'https://edge.example.test/privacy/delete'
    }]
  };
  assert.doesNotThrow(() => validateServerConfig(vendorOnlyGateway));
  assert.throws(
    () => validateServerConfig({
      ...vendorOnlyGateway,
      robotAdapterConfigurations: [{
        ...vendorOnlyGateway.robotAdapterConfigurations[0],
        privacyDeleteURL: ''
      }]
    }),
    /complete adapter lifecycle endpoints|Every enabled robot adapter/
  );
  assert.throws(
    () => validateServerConfig({ ...voiceGateway, actionGatewaySingleReplica: false }),
    /ACTION_GATEWAY_SINGLE_REPLICA/
  );
  assert.throws(
    () => validateServerConfig({ ...voiceGateway, humeConfigId: 'approved-config' }),
    /HUME_CONFIG_ID must be a canonical UUID/
  );
  assert.throws(
    () => validateServerConfig({ ...voiceGateway, humeAllowedVoiceIds: `${VALID_HUME_VOICE_ID},approved-voice` }),
    /HUME_ALLOWED_VOICE_IDS must contain only canonical UUIDs/
  );
});

test('HTTP-only production validation omits voice-gateway secrets but keeps the container fail-closed', async () => {
  const httpOnly = productionHTTPConfig();
  assert.doesNotThrow(() => validateServerConfig(httpOnly));

  assert.throws(
    () => validateServerConfig({ ...httpOnly, authExchangeEnabled: false }),
    /AUTH_EXCHANGE_ENABLED must be true in production/
  );
  assert.throws(
    () => validateServerConfig({ ...httpOnly, phoneAuthEnabled: false }),
    /PHONE_AUTH_ENABLED must be true in production/
  );
  assert.throws(
    () => validateServerConfig({ ...httpOnly, safetyApiEnabled: false }),
    /SAFETY_API_ENABLED must be true in production/
  );
  assert.throws(
    () => validateServerConfig({ ...httpOnly, sessionJWTSecret: '' }),
    /SESSION_JWT_SECRET/
  );
  assert.throws(
    () => validateServerConfig({ ...httpOnly, twilioAuthToken: '' }),
    /TWILIO_AUTH_TOKEN/
  );
  assert.throws(
    () => validateServerConfig({ ...httpOnly, safetyRepository: null, safetyTableName: '' }),
    /SAFETY_TABLE_NAME/
  );
  assert.throws(
    () => validateServerConfig({ ...httpOnly, authSessionRepository: null, authSessionTableName: '' }),
    /AUTH_SESSION_TABLE_NAME/
  );

  assert.throws(
    () => validateServerConfig({ ...httpOnly, httpOnlyDeployment: false }),
    /HUME_API_KEY, HUME_CONFIG_ID, and HUME_CLM_BEARER_TOKEN are required in production/
  );
  assert.throws(
    () => validateServerConfig({ ...httpOnly, httpOnlyDeployment: 'true' }),
    /HUME_API_KEY, HUME_CONFIG_ID, and HUME_CLM_BEARER_TOKEN are required in production/
  );

  const response = await invoke(httpOnly, {
    method: 'POST',
    url: '/chat/completions',
    headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
    body: { messages: [] }
  });
  assert.equal(response.status, 503);
  assert.deepEqual(response.json, { error: 'CLM authentication is not configured' });

  await assert.rejects(
    async () => invoke({ ...httpOnly, authSessionRepository: {} }, { url: '/health' }),
    /Production auth session repository is missing required methods/
  );
  await assert.rejects(
    async () => invoke({ ...httpOnly, pushRepository: {} }, { url: '/health' }),
    /Production push repository is missing required methods/
  );
  await assert.rejects(
    async () => invoke({ ...httpOnly, notifyEmergencyContacts: {} }, { url: '/health' }),
    /Production emergency-contact push delivery is not configured/
  );
});

test('production AI-native configuration fails closed for process-local admission and ingress trust', () => {
  const aiNativeSystem = {
    scenarioEngine: {},
    edgeScenarioRouter: {},
    getVoiceContext() {},
    memory: { list() {}, delete() {}, deleteAll() {} },
    privacyRepository: { exportUserData() {}, deleteUserData() {} }
  };
  const complete = productionHTTPConfig({
    aiNativeEnabled: true,
    aiNativeDataLifecycleEnabled: true,
    aiNativeSingleReplica: true,
    aiNativeSystem,
    resolveEdgeDeviceBinding() {},
    authenticateRobotEdgeIngress() {},
    resolveScenarioDevices() {},
    authenticateScenarioIngress() {}
  });
  assert.doesNotThrow(() => validateServerConfig(complete));
  assert.throws(
    () => validateServerConfig({ ...complete, aiNativeSingleReplica: false }),
    /AI_NATIVE_SINGLE_REPLICA/
  );
  assert.throws(
    () => validateServerConfig({ ...complete, aiNativeDataLifecycleEnabled: false }),
    /AI_NATIVE_DATA_LIFECYCLE_ENABLED/
  );
  assert.throws(
    () => validateServerConfig({ ...complete, resolveEdgeDeviceBinding: undefined }),
    /wearable ingress/
  );
  assert.throws(
    () => validateServerConfig({ ...complete, authenticateRobotEdgeIngress: undefined }),
    /robot ingress/
  );
  assert.throws(
    () => validateServerConfig({ ...complete, resolveScenarioDevices: undefined }),
    /server-side device resolver/
  );
  assert.throws(
    () => validateServerConfig({ ...complete, authenticateScenarioIngress: undefined }),
    /scheduled context ingress/
  );
});

test('production AI-native startup rejects legacy voice completion repositories', async () => {
  const aiNativeSystem = {
    scenarioEngine: {
      startScenario() {},
      getExecution() {},
      listExecutions() {},
      exportExecutions() {},
      cancelScenario() {}
    },
    edgeScenarioRouter: {
      ingestWearableInference() {},
      ingestRobotInference() {},
      ingestContextEvent() {},
      confirmCancellation() {}
    },
    getVoiceContext() {},
    memory: { list() {}, delete() {}, deleteAll() {} },
    privacyRepository: { exportUserData() {}, deleteUserData() {} }
  };
  const config = productionHTTPConfig({
    aiNativeEnabled: true,
    aiNativeDataLifecycleEnabled: true,
    aiNativeSingleReplica: true,
    aiNativeSystem,
    resolveEdgeDeviceBinding() {},
    authenticateRobotEdgeIngress() {},
    resolveScenarioDevices() {},
    authenticateScenarioIngress() {},
    voiceInteractionCompletionRepository: {
      begin() {},
      complete() {},
      verifyCompleted() {}
    }
  });

  await assert.rejects(
    async () => invoke(config, { url: '/health' }),
    /Production voice interaction completion repository is missing required methods: observeActivity, hasActivity, disconnect/
  );
});

test('arbitrary bearer tokens cannot bypass first-party authentication', async () => {
  const response = await invoke({
    sessionJWTSecret: 'test-session-secret-with-at-least-32-characters'
  }, {
    method: 'POST',
    url: '/v1/safety/tips',
    headers: { Authorization: 'Bearer arbitrary-unsigned-token' },
    body: { scenario: 'general' }
  });
  assert.equal(response.status, 401);

  const invalidSubject = await invoke({
    verifyAppToken: async () => ({ sub: 'user\nforged-partition', scope: 'safety:read' })
  }, {
    method: 'POST',
    url: '/v1/safety/tips',
    headers: { Authorization: 'Bearer externally-verified-token' },
    body: { scenario: 'general' }
  });
  assert.equal(invalidSubject.status, 401);
});

test('durable account-deletion state blocks new work but permits deletion retry', async () => {
  const authSessionRepository = {
    async getAccountDeletionState() { return 'deleting'; }
  };
  const verifyAppToken = async () => ({
    sub: 'user-deleting',
    scope: 'safety:read safety:write'
  });
  const blocked = await invoke({ authSessionRepository, verifyAppToken }, {
    method: 'GET',
    url: '/v1/devices/home-robots',
    headers: { Authorization: 'Bearer still-valid' }
  });
  assert.equal(blocked.status, 423);

  let retries = 0;
  const retry = await invoke({
    authSessionRepository,
    verifyAppToken,
    authExchangeEnabled: true,
    sessionJWTSecret: 'account-deletion-test-secret-at-least-32-characters',
    appleClientIds: 'com.example.test',
    safetyApiEnabled: true,
    safetyRepository: {},
    privacyCoordinator: { async deleteUserData() { retries += 1; } }
  }, {
    method: 'DELETE',
    url: '/v1/privacy/data',
    headers: { Authorization: 'Bearer still-valid' }
  });
  assert.equal(retry.status, 204);
  assert.equal(retries, 1);
});

test('default safety and push repositories receive the auth-session account fence', async () => {
  const safetyTransactions = [];
  const pushTransactions = [];
  const safetyRepositoryClient = {
    async send(command) {
      const name = command.constructor.name;
      if (name === 'QueryCommand') return { Items: [] };
      if (name === 'TransactWriteCommand') {
        safetyTransactions.push(command.input.TransactItems);
        return {};
      }
      throw new Error(`Unexpected safety command ${name}`);
    }
  };
  const pushRepositoryClient = {
    async send(command) {
      const name = command.constructor.name;
      if (name === 'GetCommand') return {};
      if (name === 'QueryCommand') return { Items: [] };
      if (name === 'TransactWriteCommand') {
        pushTransactions.push(command.input.TransactItems);
        return {};
      }
      throw new Error(`Unexpected push command ${name}`);
    }
  };
  const config = {
    authExchangeEnabled: true,
    safetyApiEnabled: true,
    sessionJWTSecret: 'test-session-secret-at-least-32-characters',
    appleClientIds: 'com.veryloving.test',
    safetyTableName: 'safety-data',
    deviceTableName: 'device-data',
    authSessionTableName: 'auth-sessions',
    safetyRepositoryClient,
    pushRepositoryClient,
    authSessionRepository: { async getAccountDeletionState() { return 'active'; } },
    robotRepository: {},
    actionOutboxRepository: {},
    verifyAppToken: async () => ({ sub: 'user-1', scope: 'safety:read safety:write' })
  };
  const authorization = { Authorization: 'Bearer verified-token' };

  const pushResponse = await invoke(config, {
    method: 'POST',
    url: '/v1/devices/push-token',
    headers: authorization,
    body: { token: 'ExpoPushToken[token_00000001]' }
  });
  assert.equal(pushResponse.status, 200);
  assert.match(pushResponse.json.unregisterReceipt, /^[A-Za-z0-9_-]{80,1024}$/);
  const contactResponse = await invoke(config, {
    method: 'POST',
    url: '/v1/emergency-contacts',
    headers: authorization,
    body: { name: 'Caregiver', phone: '+15555550100', countryCode: 'US' }
  });
  assert.equal(contactResponse.status, 201);

  assert.equal(pushTransactions.length, 2);
  assert.equal(safetyTransactions.length, 1);
  for (const transaction of [...pushTransactions, ...safetyTransactions]) {
    assert.equal(transaction[0].ConditionCheck.TableName, 'auth-sessions');
    assert.deepEqual(transaction[0].ConditionCheck.Key, {
      PK: 'USER#user-1',
      SK: 'ACCOUNT#STATE'
    });
  }
});

test('push unregistration receipt is accepted as a narrow post-logout capability', async () => {
  let consumedReceipt = null;
  const response = await invoke({
    pushRepository: {
      async unregisterByReceipt(receipt) { consumedReceipt = receipt; }
    }
  }, {
    method: 'DELETE',
    url: '/v1/devices/push-token/receipt',
    body: { receipt: 'A'.repeat(120) }
  });
  assert.equal(response.status, 204);
  assert.equal(consumedReceipt, 'A'.repeat(120));
});

test('factory-reset recovery completes before action recovery and fails closed', async () => {
  const lifecycle = [];
  await invoke({
    robotResetCoordinator: {
      async recover() { lifecycle.push('reset-recovery'); },
      async requestReset() {},
      async resume() {}
    },
    actionGateway: {
      async recoverPendingCommands() { lifecycle.push('action-recovery'); }
    }
  }, { url: '/health' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lifecycle, ['reset-recovery', 'action-recovery']);

  let unsafeActionRecovery = false;
  await invoke({
    robotResetCoordinator: {
      async recover() { throw new Error('reset checkpoint unavailable'); },
      async requestReset() {},
      async resume() {}
    },
    actionGateway: {
      async recoverPendingCommands() { unsafeActionRecovery = true; }
    }
  }, { url: '/health' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(unsafeActionRecovery, false);
});

test('account deletion durably fences and drains actions before manufacturer erasure', async () => {
  const lifecycle = [];
  const dataRepository = (name) => ({
    async exportUserData() { return []; },
    async deleteUserData() { lifecycle.push(name); return { deletedItems: 0 }; }
  });
  const authSessionRepository = {
    ...dataRepository('sessions'),
    async getAccountDeletionState() { return 'active'; },
    async beginAccountDeletion() { lifecycle.push('account-fence'); },
    async completeAccountDeletion() { lifecycle.push('account-deleted'); }
  };
  const response = await invoke({
    authExchangeEnabled: true,
    sessionJWTSecret: 'privacy-action-fence-secret-at-least-32-characters',
    appleClientIds: 'com.example.test',
    safetyApiEnabled: true,
    verifyAppToken: async () => ({ sub: 'user-private', scope: 'safety:read safety:write' }),
    authSessionRepository,
    safetyRepository: dataRepository('safety'),
    manufacturerPrivacyRepository: dataRepository('manufacturer-erasure'),
    actionOutboxRepository: dataRepository('action-outbox'),
    pushRepository: dataRepository('push'),
    robotRepository: dataRepository('robots'),
    notifyUser: async () => ({ delivered: 0 }),
    notifyEmergencyContacts: async () => ({ eligible: 0, delivered: 0, failedRecipients: 0 }),
    actionGateway: {
      async fenceUserActions(userId) { lifecycle.push(`action-fence:${userId}`); }
    }
  }, {
    method: 'DELETE',
    url: '/v1/privacy/data',
    headers: { Authorization: 'Bearer active-account-session' }
  });
  assert.equal(response.status, 204);
  assert.deepEqual(lifecycle.slice(0, 3), [
    'account-fence',
    'action-fence:user-private',
    'manufacturer-erasure'
  ]);
});

test('CLM rejects requests without the configured bearer token', async () => {
  const response = await invoke({ clmBearerToken: 'server-only-secret' }, {
    method: 'POST',
    url: '/chat/completions',
    headers: { 'Content-Type': 'application/json' },
    body: { messages: [] }
  });
  assert.equal(response.status, 401);
});

test('CLM fails closed when server credentials are missing', async () => {
  const response = await invoke({ clmBearerToken: '' }, {
    method: 'POST',
    url: '/chat/completions',
    headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
    body: { messages: [] }
  });
  assert.equal(response.status, 503);
  assert.deepEqual(response.json, { error: 'CLM authentication is not configured' });
});

test('auth exchange returns a first-party JWT derived from verified provider claims', async () => {
  const response = await invoke({
    authExchangeEnabled: true,
    sessionJWTSecret: 'test-session-secret-with-at-least-32-characters',
    sessionJWTIssuer: 'https://api.example.test',
    sessionJWTAudience: 'veryloving-test',
    googleTokenAudiences: 'google-web.apps.googleusercontent.com',
    googleAuthorizedParties: 'google-native.apps.googleusercontent.com',
    verifyProviderToken: async ({ provider, idToken }) => {
      assert.equal(provider, 'google');
      assert.equal(idToken, 'provider-token-that-must-not-be-persisted');
      return {
        sub: 'verified-subject',
        email: 'verified@example.test',
        email_verified: true,
        name: 'Verified User'
      };
    }
  }, {
    method: 'POST',
    url: '/v1/auth/exchange',
    headers: { 'Content-Type': 'application/json' },
    body: { provider: 'google', idToken: 'provider-token-that-must-not-be-persisted' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json.user.id, 'google:verified-subject');
  assert.equal(response.json.user.email, 'verified@example.test');
  assert.equal(response.json.accessToken.split('.').length, 3);
  assert.equal(response.json.refreshToken.split('.').length, 3);
  assert.equal(JSON.stringify(response.json).includes('provider-token-that-must-not-be-persisted'), false);
  assert.equal(Number.isFinite(response.json.expiresAt), true);
  assert.equal(Number.isFinite(response.json.refreshExpiresAt), true);

  const refreshed = await invoke({
    authExchangeEnabled: true,
    sessionJWTSecret: 'test-session-secret-with-at-least-32-characters',
    sessionJWTIssuer: 'https://api.example.test',
    sessionJWTAudience: 'veryloving-test',
    googleTokenAudiences: 'google-web.apps.googleusercontent.com',
    googleAuthorizedParties: 'google-native.apps.googleusercontent.com'
  }, {
    method: 'POST',
    url: '/v1/auth/refresh',
    headers: { 'Content-Type': 'application/json' },
    body: { refreshToken: response.json.refreshToken }
  });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.json.accessToken.split('.').length, 3);
  assert.equal(refreshed.json.refreshToken.split('.').length, 3);
  assert.notEqual(refreshed.json.accessToken, response.json.accessToken);
});

test('refresh rotation rejects replay, revokes the token family, and logout revokes access', async () => {
  const authSessionRepository = memoryAuthSessionRepository();
  const config = {
    authExchangeEnabled: true,
    sessionJWTSecret: 'test-session-secret-with-at-least-32-characters',
    sessionJWTIssuer: 'https://api.example.test',
    sessionJWTAudience: 'veryloving-test',
    googleTokenAudiences: 'google-web.apps.googleusercontent.com',
    googleAuthorizedParties: 'google-native.apps.googleusercontent.com',
    authSessionRepository,
    robotRepository: { list: async () => [] },
    verifyProviderToken: async () => ({ sub: crypto.randomUUID(), email_verified: false })
  };
  const exchange = await invoke(config, {
    method: 'POST',
    url: '/v1/auth/exchange',
    body: { provider: 'google', idToken: 'verified-provider-token' }
  });
  assert.equal(exchange.status, 200);

  const firstRefresh = await invoke(config, {
    method: 'POST',
    url: '/v1/auth/refresh',
    body: { refreshToken: exchange.json.refreshToken }
  });
  assert.equal(firstRefresh.status, 200);
  const initialRefreshClaims = JSON.parse(Buffer.from(exchange.json.refreshToken.split('.')[1], 'base64url'));
  const rotatedRefreshClaims = JSON.parse(Buffer.from(firstRefresh.json.refreshToken.split('.')[1], 'base64url'));
  assert.equal(rotatedRefreshClaims.exp, initialRefreshClaims.exp, 'refresh rotation must not slide the family expiry');

  const replay = await invoke(config, {
    method: 'POST',
    url: '/v1/auth/refresh',
    body: { refreshToken: exchange.json.refreshToken }
  });
  assert.equal(replay.status, 401);

  const tokenFamily = await invoke(config, {
    method: 'POST',
    url: '/v1/auth/refresh',
    body: { refreshToken: firstRefresh.json.refreshToken }
  });
  assert.equal(tokenFamily.status, 401);

  const secondExchange = await invoke(config, {
    method: 'POST',
    url: '/v1/auth/exchange',
    body: { provider: 'google', idToken: 'another-verified-provider-token' }
  });
  const beforeLogout = await invoke(config, {
    url: '/v1/devices/home-robots',
    headers: { Authorization: `Bearer ${secondExchange.json.accessToken}` }
  });
  assert.equal(beforeLogout.status, 200);
  const logout = await invoke(config, {
    method: 'POST',
    url: '/v1/auth/logout',
    headers: { Authorization: `Bearer ${secondExchange.json.accessToken}` }
  });
  assert.equal(logout.status, 204);
  const afterLogout = await invoke(config, {
    url: '/v1/devices/home-robots',
    headers: { Authorization: `Bearer ${secondExchange.json.accessToken}` }
  });
  assert.equal(afterLogout.status, 401);
});

test('auth exchange fails closed when disabled or provider verification fails', async () => {
  const disabled = await invoke({}, {
    method: 'POST',
    url: '/v1/auth/exchange',
    body: { provider: 'google', idToken: 'token' }
  });
  assert.equal(disabled.status, 503);

  const rejected = await invoke({
    authExchangeEnabled: true,
    sessionJWTSecret: 'test-session-secret-with-at-least-32-characters',
    googleTokenAudiences: 'google-web.apps.googleusercontent.com',
    googleAuthorizedParties: 'google-native.apps.googleusercontent.com',
    verifyProviderToken: async () => { throw new Error('bad signature'); }
  }, {
    method: 'POST',
    url: '/v1/auth/exchange',
    body: { provider: 'google', idToken: 'invalid-provider-token' }
  });
  assert.equal(rejected.status, 401);
  assert.deepEqual(rejected.json, { error: 'Identity token verification failed' });

  const missingAppleNonce = await invoke({
    authExchangeEnabled: true,
    sessionJWTSecret: 'test-session-secret-with-at-least-32-characters',
    appleClientIds: 'com.veryloving.test',
    verifyProviderToken: async () => { throw new Error('must not run'); }
  }, {
    method: 'POST',
    url: '/v1/auth/exchange',
    body: { provider: 'apple', idToken: 'apple-provider-token' }
  });
  assert.equal(missingAppleNonce.status, 400);
  assert.match(missingAppleNonce.json.error, /nonce/);
});

test('phone auth uses Twilio Verify and issues an opaque first-party session', async () => {
  const calls = [];
  const config = {
    phoneAuthEnabled: true,
    phoneAuthChallengeSecret: 'test-phone-challenge-secret-at-least-32-characters',
    phoneAuthSubjectSecret: 'test-phone-subject-secret-at-least-32-characters',
    sessionJWTSecret: 'test-session-secret-with-at-least-32-characters',
    sessionJWTIssuer: 'https://api.example.test',
    sessionJWTAudience: 'veryloving-test',
    twilioAccountSid: `AC${'a'.repeat(32)}`,
    twilioAuthToken: 'test-twilio-auth-token-value',
    twilioVerifyServiceSid: `VA${'b'.repeat(32)}`,
    phoneChallengeReplayCache: new Map(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: url.endsWith('/Verifications') ? 201 : 200,
        json: async () => ({ status: url.endsWith('/Verifications') ? 'pending' : 'approved' })
      };
    }
  };
  const started = await invoke(config, {
    method: 'POST',
    url: '/v1/auth/phone/start',
    body: { phone: '+6591234567', countryCode: 'SG' }
  });
  assert.equal(started.status, 202);
  assert.equal(started.json.phone, '+6591234567');
  assert.equal(started.json.countryCode, 'SG');
  assert.equal(typeof started.json.verificationId, 'string');

  const verified = await invoke(config, {
    method: 'POST',
    url: '/v1/auth/phone/verify',
    body: { verificationId: started.json.verificationId, code: '123456' }
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.json.user.provider, 'phone');
  assert.equal(verified.json.user.phone, '+6591234567');
  assert.match(verified.json.user.id, /^phone:[A-Za-z0-9_-]{43}$/);
  const claims = verifySessionJWT(verified.json.accessToken, config);
  assert.equal(claims.sub, verified.json.user.id);
  assert.equal(claims.sub.includes('+6591234567'), false);
  assert.equal(calls.length, 2);

  const replayed = await invoke(config, {
    method: 'POST',
    url: '/v1/auth/phone/verify',
    body: { verificationId: started.json.verificationId, code: '123456' }
  });
  assert.equal(replayed.status, 410);
  assert.equal(replayed.json.code, 'PHONE_AUTH_CHALLENGE_USED');

  const refreshed = await invoke(config, {
    method: 'POST',
    url: '/v1/auth/refresh',
    body: { refreshToken: verified.json.refreshToken }
  });
  assert.equal(refreshed.status, 200);
  assert.equal(verifySessionJWT(refreshed.json.accessToken, config).sub, verified.json.user.id);
});

test('phone endpoints return stable safe failure codes', async () => {
  const disabled = await invoke({}, {
    method: 'POST',
    url: '/v1/auth/phone/start',
    body: { phone: '+6591234567', countryCode: 'SG' }
  });
  assert.equal(disabled.status, 503);
  assert.deepEqual(disabled.json, {
    error: 'Phone authentication is not configured',
    code: 'PHONE_AUTH_NOT_CONFIGURED'
  });

  const config = {
    phoneAuthEnabled: true,
    phoneAuthChallengeSecret: 'test-phone-challenge-secret-at-least-32-characters',
    phoneAuthSubjectSecret: 'test-phone-subject-secret-at-least-32-characters',
    sessionJWTSecret: 'test-session-secret-with-at-least-32-characters',
    twilioAccountSid: `AC${'a'.repeat(32)}`,
    twilioAuthToken: 'test-twilio-auth-token-value',
    twilioVerifyServiceSid: `VA${'b'.repeat(32)}`,
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      json: async () => ({ message: 'provider account detail' })
    })
  };
  const invalid = await invoke(config, {
    method: 'POST',
    url: '/v1/auth/phone/start',
    body: { phone: 'not-a-phone', countryCode: 'SG' }
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.code, 'PHONE_AUTH_INVALID');

  const limited = await invoke(config, {
    method: 'POST',
    url: '/v1/auth/phone/start',
    body: { phone: '+6591234567', countryCode: 'SG' }
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.json.code, 'PHONE_AUTH_RATE_LIMITED');
  assert.equal(JSON.stringify(limited.json).includes('provider account detail'), false);
});

test('CLM handles immediate danger locally and preserves the custom session ID', async () => {
  const response = await invoke({ clmBearerToken: 'server-only-secret' }, {
    method: 'POST',
    url: '/chat/completions?custom_session_id=opaque-session-1',
    headers: { Authorization: 'Bearer server-only-secret', 'Content-Type': 'application/json' },
    body: { model: 'veryloving', messages: [{ role: 'user', content: 'Someone has a knife and is attacking me' }] }
  });
  assert.equal(response.status, 200);
  assert.match(response.headers['Content-Type'], /text\/event-stream/);
  assert.match(response.text, /local emergency services/);
  assert.match(response.text, /opaque-session-1/);
  assert.match(response.text, /data: \[DONE\]/);
});

test('CLM emits the confirmed help-dial tool for immediate danger when available', async () => {
  const response = await invoke({ clmBearerToken: 'server-secret' }, {
    method: 'POST',
    url: '/chat/completions?custom_session_id=urgent-session',
    headers: { Authorization: 'Bearer server-secret' },
    body: {
      model: 'safety-model',
      messages: [{ role: 'user', content: 'I am in immediate danger and need help now' }],
      tools: [{ type: 'function', function: { name: 'request_help_dial', parameters: { type: 'object' } } }]
    }
  });
  assert.equal(response.status, 200);
  assert.match(response.text, /"name":"request_help_dial"/);
  assert.match(response.text, /urgent-session/);
  assert.match(response.text, /"finish_reason":"tool_calls"/);
});

test('CLM prefers the account-bound AI Angel tool when cross-device orchestration is available', async () => {
  const response = await invoke(aiNativeTestConfig({}, {
    clmBearerToken: 'server-secret',
    resolveScenarioDevices() { return { targets: { wearableId: 'wearable-1' } }; }
  }), {
    method: 'POST',
    url: '/chat/completions?custom_session_id=ai-angel-session',
    headers: { Authorization: 'Bearer server-secret' },
    body: {
      model: 'safety-model',
      messages: [{ role: 'user', content: 'I am in immediate danger and need help now' }],
      tools: [
        { type: 'function', function: { name: 'request_help_dial', parameters: { type: 'object' } } },
        { type: 'function', function: { name: 'trigger_ai_angel', parameters: { type: 'object' } } }
      ]
    }
  });
  assert.equal(response.status, 200);
  assert.match(response.text, /"name":"trigger_ai_angel"/);
  assert.doesNotMatch(response.text, /"name":"request_help_dial"/);
  assert.match(response.text, /ai-angel-session/);
});

test('CLM emits an OpenAI-compatible custom tool call for safety guidance', async () => {
  const response = await invoke({ clmBearerToken: 'server-only-secret' }, {
    method: 'POST',
    url: '/chat/completions',
    headers: { Authorization: 'Bearer server-only-secret', 'Content-Type': 'application/json' },
    body: {
      messages: [{ role: 'user', content: 'What safety tips should I use while walking alone?' }],
      tools: [{ type: 'function', function: { name: 'get_safety_tips', parameters: { type: 'object' } } }]
    }
  });
  assert.match(response.text, /get_safety_tips/);
  assert.match(response.text, /walking_alone/);
  assert.match(response.text, /tool_calls/);
});

test('CLM injects the authoritative safety prompt before upstream context', async () => {
  let upstreamRequest;
  const fetchImpl = async (_url, options) => {
    upstreamRequest = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ choices: [{ message: { content: 'Stay near other people while we decide the next step.' } }] })
    };
  };
  const response = await invoke({
    clmBearerToken: 'server-only-secret',
    upstreamURL: 'https://model.example/chat/completions',
    upstreamApiKey: 'upstream-secret',
    upstreamModel: 'safety-model',
    fetchImpl
  }, {
    method: 'POST',
    url: '/chat/completions',
    headers: { Authorization: 'Bearer server-only-secret', 'Content-Type': 'application/json' },
    body: {
      messages: [
        { role: 'system', content: 'Speak gently and use the user name when known.' },
        { role: 'user', content: 'I feel uneasy walking home.' }
      ]
    }
  });
  assert.equal(upstreamRequest.messages[0].role, 'system');
  assert.match(upstreamRequest.messages[0].content, new RegExp(SAFETY_SYSTEM_PROMPT.split('\n')[0]));
  assert.match(upstreamRequest.messages[0].content, /Additional configured context/);
  assert.equal(upstreamRequest.messages[1].role, 'user');
  assert.match(response.headers['Content-Type'], /text\/event-stream/);
  assert.match(response.text, /Stay near other people/);
  assert.match(response.text, /data: \[DONE\]/);
});

test('CLM does not treat a lookalike media type as an event stream', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name === 'content-type' ? 'text/event-stream+json' : null },
    json: async () => ({ choices: [{ message: { content: 'Bounded JSON response.' } }] })
  });
  const response = await invoke({
    clmBearerToken: 'server-only-secret',
    upstreamURL: 'https://model.example/chat/completions',
    upstreamApiKey: 'upstream-secret',
    upstreamModel: 'safety-model',
    fetchImpl
  }, {
    method: 'POST',
    url: '/chat/completions',
    headers: { Authorization: 'Bearer server-only-secret', 'Content-Type': 'application/json' },
    body: { messages: [{ role: 'user', content: 'Please stay with me.' }] }
  });
  assert.match(response.text, /Bounded JSON response/);
});

test('CLM aborts and cancels an upstream SSE reader when the downstream disconnects', async () => {
  let upstreamSignal;
  let fetchStarted;
  const started = new Promise((resolve) => { fetchStarted = resolve; });
  let cancelCount = 0;
  const fetchImpl = async (_url, options) => {
    upstreamSignal = options.signal;
    fetchStarted();
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: {
        getReader() {
          return {
            read() {
              return new Promise((_resolve, reject) => {
                const abort = () => {
                  const error = new Error('downstream disconnected');
                  error.name = 'AbortError';
                  reject(error);
                };
                if (upstreamSignal.aborted) abort();
                else upstreamSignal.addEventListener('abort', abort, { once: true });
              });
            },
            async cancel() { cancelCount += 1; },
            releaseLock() {}
          };
        }
      }
    };
  };
  const body = JSON.stringify({ messages: [{ role: 'user', content: 'Please stay with me.' }] });
  const req = Readable.from([Buffer.from(body)]);
  req.method = 'POST';
  req.url = '/chat/completions';
  req.headers = { authorization: 'Bearer server-only-secret', 'content-type': 'application/json' };
  const res = Object.assign(new EventEmitter(), {
    headersSent: false,
    destroyed: false,
    writableEnded: false,
    writeHead() { this.headersSent = true; },
    write() { return true; },
    end() { this.writableEnded = true; }
  });
  const handling = createHandler({
    logger: silentLogger,
    clmBearerToken: 'server-only-secret',
    upstreamURL: 'https://model.example/chat/completions',
    upstreamApiKey: 'upstream-secret',
    upstreamModel: 'safety-model',
    upstreamTimeoutMs: 5_000,
    fetchImpl
  })(req, res);

  await started;
  res.destroyed = true;
  res.emit('close');
  await handling;

  assert.equal(upstreamSignal.aborted, true);
  assert.equal(cancelCount, 1);
  assert.equal(res.writableEnded, false);
});

test('CLM deadline cancels a locked SSE reader even when its pending read ignores abort', async () => {
  let upstreamSignal;
  let cancelCount = 0;
  let releaseCount = 0;
  let bodyCancelCount = 0;
  const response = await invoke({
    clmBearerToken: 'server-only-secret',
    upstreamURL: 'https://model.example/chat/completions',
    upstreamApiKey: 'upstream-secret',
    upstreamModel: 'safety-model',
    upstreamTimeoutMs: 5,
    fetchImpl: async (_url, options) => {
      upstreamSignal = options.signal;
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: {
          locked: true,
          getReader() {
            return {
              read() { return new Promise(() => {}); },
              async cancel() { cancelCount += 1; },
              releaseLock() { releaseCount += 1; }
            };
          },
          async cancel() {
            bodyCancelCount += 1;
          }
        }
      };
    }
  }, {
    method: 'POST',
    url: '/chat/completions',
    headers: { Authorization: 'Bearer server-only-secret', 'Content-Type': 'application/json' },
    body: { messages: [{ role: 'user', content: 'Please stay with me.' }] }
  });

  assert.equal(upstreamSignal.aborted, true);
  assert.equal(cancelCount, 1);
  assert.equal(releaseCount, 1);
  assert.equal(bodyCancelCount, 0);
  assert.equal(response.status, 200);
  assert.match(response.text, /data: \[DONE\]/);
});

test('CLM aborts upstream when a backpressured downstream response errors', async () => {
  let upstreamSignal;
  let cancelCount = 0;
  let reads = 0;
  const fetchImpl = async (_url, options) => {
    upstreamSignal = options.signal;
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: {
        getReader() {
          return {
            read() {
              reads += 1;
              if (reads === 1) {
                return Promise.resolve({
                  done: false,
                  value: Buffer.from('data: {"choices":[]}\n\n')
                });
              }
              return new Promise((_resolve, reject) => {
                const abort = () => {
                  const error = new Error('downstream response failed');
                  error.name = 'AbortError';
                  reject(error);
                };
                if (upstreamSignal.aborted) abort();
                else upstreamSignal.addEventListener('abort', abort, { once: true });
              });
            },
            async cancel() { cancelCount += 1; },
            releaseLock() {}
          };
        }
      }
    };
  };
  const body = JSON.stringify({ messages: [{ role: 'user', content: 'Please stay with me.' }] });
  const req = Readable.from([Buffer.from(body)]);
  req.method = 'POST';
  req.url = '/chat/completions';
  req.headers = { authorization: 'Bearer server-only-secret', 'content-type': 'application/json' };
  const res = Object.assign(new EventEmitter(), {
    headersSent: false,
    destroyed: false,
    writableEnded: false,
    writeHead() { this.headersSent = true; },
    write() {
      setImmediate(() => this.emit('error', new Error('socket write failed')));
      return false;
    },
    end() { this.writableEnded = true; }
  });

  await createHandler({
    logger: silentLogger,
    clmBearerToken: 'server-only-secret',
    upstreamURL: 'https://model.example/chat/completions',
    upstreamApiKey: 'upstream-secret',
    upstreamModel: 'safety-model',
    upstreamTimeoutMs: 5_000,
    fetchImpl
  })(req, res);

  assert.equal(upstreamSignal.aborted, true);
  assert.equal(cancelCount, 1);
  assert.equal(res.writableEnded, false);
});

test('CLM bounds an unterminated upstream SSE event and cancels its reader', async () => {
  let cancelCount = 0;
  let sent = false;
  const response = await invoke({
    clmBearerToken: 'server-only-secret',
    upstreamURL: 'https://model.example/chat/completions',
    upstreamApiKey: 'upstream-secret',
    upstreamModel: 'safety-model',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: {
        getReader() {
          return {
            async read() {
              if (sent) return { done: true };
              sent = true;
              return { done: false, value: Buffer.alloc((256 * 1024) + 1, 97) };
            },
            async cancel() { cancelCount += 1; },
            releaseLock() {}
          };
        }
      }
    })
  }, {
    method: 'POST',
    url: '/chat/completions',
    headers: { Authorization: 'Bearer server-only-secret', 'Content-Type': 'application/json' },
    body: { messages: [{ role: 'user', content: 'Please stay with me.' }] }
  });

  assert.equal(response.status, 200);
  assert.match(response.text, /data: \[DONE\]/);
  assert.equal(cancelCount, 1);
});

test('CLM falls back to a local safety response when the upstream times out', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('upstream timeout');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  const response = await invoke({
    clmBearerToken: 'server-only-secret',
    upstreamURL: 'https://model.example/chat/completions',
    upstreamApiKey: 'upstream-secret',
    upstreamModel: 'safety-model',
    upstreamTimeoutMs: 5,
    fetchImpl
  }, {
    method: 'POST',
    url: '/chat/completions',
    headers: { Authorization: 'Bearer server-only-secret', 'Content-Type': 'application/json' },
    body: { messages: [{ role: 'user', content: 'I am feeling unsure right now.' }] }
  });
  assert.equal(response.status, 200);
  assert.match(response.text, /one small, practical next step/);
  assert.match(response.text, /data: \[DONE\]/);
});

test('safety tips endpoint validates app auth and returns curated guidance', async () => {
  const response = await invoke({ verifyAppToken: (token) => token === 'valid-user-token' }, {
    method: 'POST',
    url: '/v1/safety/tips',
    headers: { Authorization: 'Bearer valid-user-token', 'Content-Type': 'application/json' },
    body: { scenario: 'being_followed' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json.scenario, 'being_followed');
  assert.equal(response.json.tips.length, 3);
});

test('user scenario ingress derives trigger and devices server-side and rejects forged safety inputs', async () => {
  const calls = [];
  const starts = [];
  const edgeScenarioRouter = {
    async ingestContextEvent(accountId, event, binding) {
      calls.push({ accountId, event, binding });
      return { started: [{ executionId: 'execution-user-1' }] };
    }
  };
  const scenarioEngine = {
    async exportExecutions(accountId) {
      assert.equal(accountId, 'google:user-scenario');
      return [];
    },
    async startScenario(accountId, request) {
      starts.push({ accountId, request });
      return { accepted: true, duplicate: false, execution: { executionId: `execution-${request.scenarioId}` } };
    }
  };
  const config = {
    ...aiNativeTestConfig(edgeScenarioRouter, { scenarioEngine }),
    verifyAppToken: async (token) => token === 'valid-user-token' && { sub: 'google:user-scenario' },
    async resolveScenarioDevices(request) {
      calls.push({ resolve: request });
      return { targets: { wearableId: 'wearable-bound', homeRobotId: 'robot-bound' } };
    }
  };
  const occurredAt = Date.now();
  const accepted = await invoke(config, {
    method: 'POST',
    url: '/v1/scenarios',
    headers: { Authorization: 'Bearer valid-user-token' },
    body: {
      scenario_id: 'ai_angel_auto_dial',
      request_id: 'panic-request-1',
      occurred_at: occurredAt
    }
  });
  assert.equal(accepted.status, 202);
  assert.deepEqual(calls, [{ resolve: {
    accountId: 'google:user-scenario',
    scenarioId: 'ai_angel_auto_dial',
    source: 'authenticated_app'
  } }, {
    accountId: 'google:user-scenario',
    event: { eventId: 'panic-request-1', type: 'panic_button', occurredAt, data: {} },
    binding: { targets: { wearableId: 'wearable-bound', homeRobotId: 'robot-bound' } }
  }]);

  for (const [scenarioId, intent, triggerType] of [
    ['fall_detection', 'practice_drill', 'user_fall_drill'],
    ['medication_adherence', 'review_reminder', 'user_medication_reminder'],
    ['emotional_check_in', 'self_check_in', 'user_emotional_check_in'],
    ['cognitive_engagement', 'start_activity', 'user_cognitive_engagement']
  ]) {
    const response = await invoke(config, {
      method: 'POST',
      url: '/v1/scenarios',
      headers: { Authorization: 'Bearer valid-user-token' },
      body: {
        scenario_id: scenarioId,
        request_id: `user-${scenarioId}`,
        occurred_at: occurredAt,
        intent,
        ...(scenarioId === 'emotional_check_in'
          ? { context: { mood_key: 'okay' } }
          : scenarioId === 'cognitive_engagement'
            ? { context: { activity: 'memory' } }
            : {})
      }
    });
    assert.equal(response.status, 202);
    assert.deepEqual(starts.at(-1), {
      accountId: 'google:user-scenario',
      request: {
        scenarioId,
        trigger: {
          eventId: `user-${scenarioId}`,
          type: triggerType,
          occurredAt,
          data: {}
        },
        devices: { wearableId: 'wearable-bound', homeRobotId: 'robot-bound' },
        idempotencyKey: `user-${scenarioId}`,
        input: {
          userInitiated: true,
          ...(scenarioId === 'emotional_check_in' ? { moodKey: 'okay' } : {}),
          ...(scenarioId === 'cognitive_engagement' ? { activity: 'memory' } : {})
        }
      }
    });
  }

  for (const forged of [{
    scenario_id: 'fall_detection',
    request_id: 'forged-fall',
    occurred_at: occurredAt,
    trigger: { type: 'wearable_fall' }
  }, {
    scenario_id: 'ai_angel_auto_dial',
    request_id: 'forged-target',
    occurred_at: occurredAt,
    devices: { homeRobotId: 'robot-attacker-selected' }
  }, {
    scenario_id: 'ai_angel_auto_dial',
    request_id: 'forged-safety',
    occurred_at: occurredAt,
    input: { robotSafeToMove: true }
  }, {
    scenario_id: 'ai_angel_auto_dial',
    request_id: 'stale-emergency',
    occurred_at: occurredAt - 6 * 60_000
  }, {
    scenario_id: 'emotional_check_in',
    request_id: 'future-check-in',
    occurred_at: occurredAt + 6 * 60_000,
    intent: 'self_check_in'
  }]) {
    const rejected = await invoke(config, {
      method: 'POST',
      url: '/v1/scenarios',
      headers: { Authorization: 'Bearer valid-user-token' },
      body: forged
    });
    assert.equal(rejected.status, 400);
  }
  assert.equal(calls.length, 6);
  assert.equal(starts.length, 4);
});

test('user wellness scenario context is exact, bounded, normalized, and privacy-minimal', async () => {
  const starts = [];
  const scenarioEngine = {
    async startScenario(accountId, request) {
      starts.push({ accountId, request });
      return { accepted: true, duplicate: false, execution: { executionId: `execution-${starts.length}` } };
    }
  };
  const config = aiNativeTestConfig({}, { scenarioEngine });
  config.verifyAppToken = async () => ({ sub: 'google:wellness-owner' });
  config.resolveScenarioDevices = async () => ({
    targets: { wearableId: 'wearable-bound', homeRobotId: 'robot-bound' }
  });
  const occurredAt = Date.now();

  const emotional = await invoke(config, {
    method: 'POST',
    url: '/v1/scenarios',
    headers: { Authorization: 'Bearer token' },
    body: {
      scenario_id: 'emotional_check_in',
      request_id: 'mood-request-1',
      occurred_at: occurredAt,
      intent: 'self_check_in',
      context: { mood_key: 'good', reflection_summary: '  A calm   afternoon.  ' }
    }
  });
  assert.equal(emotional.status, 202);
  assert.deepEqual(starts.at(-1).request.input, {
    userInitiated: true,
    moodKey: 'good',
    reflectionSummary: 'A calm afternoon.'
  });

  const cognitive = await invoke(config, {
    method: 'POST',
    url: '/v1/scenarios',
    headers: { Authorization: 'Bearer token' },
    body: {
      scenario_id: 'cognitive_engagement',
      request_id: 'cognitive-request-1',
      occurred_at: occurredAt,
      intent: 'start_activity',
      context: { activity: 'trivia' }
    }
  });
  assert.equal(cognitive.status, 202);
  assert.deepEqual(starts.at(-1).request.input, { userInitiated: true, activity: 'trivia' });

  for (const body of [{
    scenario_id: 'fall_detection', request_id: 'fall-with-context', occurred_at: occurredAt,
    intent: 'practice_drill', context: { activity: 'trivia' }
  }, {
    scenario_id: 'emotional_check_in', request_id: 'mood-missing-context', occurred_at: occurredAt,
    intent: 'self_check_in'
  }, {
    scenario_id: 'cognitive_engagement', request_id: 'activity-missing-context', occurred_at: occurredAt,
    intent: 'start_activity'
  }, {
    scenario_id: 'emotional_check_in', request_id: 'mood-unknown-key', occurred_at: occurredAt,
    intent: 'self_check_in', context: { mood_key: 'good', notes: 'private' }
  }, {
    scenario_id: 'emotional_check_in', request_id: 'mood-invalid', occurred_at: occurredAt,
    intent: 'self_check_in', context: { mood_key: 'excellent' }
  }, {
    scenario_id: 'cognitive_engagement', request_id: 'activity-invalid', occurred_at: occurredAt,
    intent: 'start_activity', context: { activity: 'chess' }
  }]) {
    assert.equal((await invoke(config, {
      method: 'POST',
      url: '/v1/scenarios',
      headers: { Authorization: 'Bearer token' },
      body
    })).status, 400);
  }
  assert.equal(starts.length, 2);
});

test('scenario execution listing is authenticated, account-bound, and strictly bounded', async () => {
  const calls = [];
  const executions = [{
    executionId: '11111111-1111-4111-8111-111111111111',
    scenarioId: 'fall_detection',
    state: 'completed'
  }];
  const scenarioEngine = {
    async listExecutions(accountId, limit) {
      calls.push({ accountId, limit });
      return executions.slice(0, limit);
    }
  };
  const config = aiNativeTestConfig({}, { scenarioEngine });
  config.verifyAppToken = async (token) => token === 'list-token' && { sub: 'google:list-owner' };

  const response = await invoke(config, {
    url: '/v1/scenarios/executions?limit=1',
    headers: { Authorization: 'Bearer list-token' }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { executions });
  assert.deepEqual(calls, [{ accountId: 'google:list-owner', limit: 1 }]);
  assert.equal((await invoke(config, { url: '/v1/scenarios/executions?limit=101', headers: { Authorization: 'Bearer list-token' } })).status, 400);
  assert.equal((await invoke(config, { url: '/v1/scenarios/executions?limit=1&limit=2', headers: { Authorization: 'Bearer list-token' } })).status, 400);
  assert.equal((await invoke(config, { url: '/v1/scenarios/executions?other=1', headers: { Authorization: 'Bearer list-token' } })).status, 400);
  assert.equal((await invoke(config, { url: '/v1/scenarios/executions' })).status, 401);
});

test('AI Angel starts coalesce per account while active and recover active state', async () => {
  let active;
  let routerCalls = 0;
  const executionId = '22222222-2222-4222-8222-222222222222';
  const scenarioEngine = {
    async exportExecutions(accountId) {
      assert.equal(accountId, 'google:emergency-owner');
      return active ? [active] : [];
    },
    async getExecution(accountId, requestedId) {
      assert.equal(accountId, 'google:emergency-owner');
      return requestedId === active?.executionId ? active : undefined;
    }
  };
  const edgeScenarioRouter = {
    async ingestContextEvent() {
      routerCalls += 1;
      await Promise.resolve();
      active = { executionId, scenarioId: 'ai_angel_auto_dial', state: 'running' };
      return { started: [{ accepted: true, duplicate: false, execution: active }] };
    }
  };
  const config = aiNativeTestConfig(edgeScenarioRouter, { scenarioEngine });
  config.verifyAppToken = async () => ({ sub: 'google:emergency-owner' });
  config.resolveScenarioDevices = async () => ({ targets: { wearableId: 'wearable-1', homeRobotId: 'robot-1' } });
  const handler = createHandler({ logger: silentLogger, ...config });
  const occurredAt = Date.now();
  const request = (requestId) => ({
    method: 'POST', url: '/v1/scenarios', headers: { Authorization: 'Bearer token' },
    body: { scenario_id: 'ai_angel_auto_dial', request_id: requestId, occurred_at: occurredAt }
  });

  const [first, second] = await Promise.all([
    invokeHandler(handler, request('panic-one')),
    invokeHandler(handler, request('panic-two'))
  ]);
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(routerCalls, 1);
  assert.equal(second.json.started[0].duplicate, true);
  assert.equal(second.json.started[0].execution.executionId, executionId);
});

test('AI Angel restart recovery exhaustively finds active executions older than the public history window', async () => {
  const executionId = '24444444-4444-4444-8444-444444444444';
  const active = { executionId, scenarioId: 'ai_angel_auto_dial', state: 'running' };
  const newerTerminalExecutions = Array.from({ length: 100 }, (_, index) => ({
    executionId: `terminal-${index}`,
    scenarioId: 'cognitive_engagement',
    state: 'completed'
  }));
  let exportCalls = 0;
  let routerCalls = 0;
  const scenarioEngine = {
    async exportExecutions(accountId) {
      assert.equal(accountId, 'google:restart-emergency-owner');
      exportCalls += 1;
      return [...newerTerminalExecutions, active];
    },
    async listExecutions() {
      throw new Error('bounded public history must not be used for emergency recovery');
    }
  };
  const edgeScenarioRouter = {
    async ingestContextEvent() {
      routerCalls += 1;
      throw new Error('an active emergency must be coalesced');
    }
  };
  const config = aiNativeTestConfig(edgeScenarioRouter, { scenarioEngine });
  config.verifyAppToken = async () => ({ sub: 'google:restart-emergency-owner' });
  config.resolveScenarioDevices = async () => ({ targets: { wearableId: 'wearable-1' } });
  const response = await invoke(config, {
    method: 'POST',
    url: '/v1/scenarios',
    headers: { Authorization: 'Bearer token' },
    body: {
      scenario_id: 'ai_angel_auto_dial',
      request_id: 'panic-after-process-restart',
      occurred_at: Date.now()
    }
  });

  assert.equal(response.status, 202);
  assert.equal(response.json.started[0].duplicate, true);
  assert.equal(response.json.started[0].execution.executionId, executionId);
  assert.equal(exportCalls, 1);
  assert.equal(routerCalls, 0);
});

test('AI Angel admission queue is bounded per account and recovers after pressure drains', async () => {
  let releaseFirstScan;
  let markFirstScanStarted;
  const firstScanStarted = new Promise((resolve) => { markFirstScanStarted = resolve; });
  const firstScanGate = new Promise((resolve) => { releaseFirstScan = resolve; });
  let active;
  let exportCalls = 0;
  let routerCalls = 0;
  const executionId = '25555555-5555-4555-8555-555555555555';
  const scenarioEngine = {
    async exportExecutions(accountId) {
      assert.equal(accountId, 'google:queued-emergency-owner');
      exportCalls += 1;
      if (exportCalls === 1) {
        markFirstScanStarted();
        await firstScanGate;
      }
      return active ? [active] : [];
    },
    async getExecution(accountId, requestedId) {
      assert.equal(accountId, 'google:queued-emergency-owner');
      return requestedId === active?.executionId ? active : undefined;
    }
  };
  const edgeScenarioRouter = {
    async ingestContextEvent() {
      routerCalls += 1;
      active = { executionId, scenarioId: 'ai_angel_auto_dial', state: 'running' };
      return { started: [{ accepted: true, duplicate: false, execution: active }] };
    }
  };
  const config = aiNativeTestConfig(edgeScenarioRouter, { scenarioEngine });
  config.verifyAppToken = async () => ({ sub: 'google:queued-emergency-owner' });
  config.resolveScenarioDevices = async () => ({ targets: { wearableId: 'wearable-1' } });
  const handler = createHandler({ logger: silentLogger, ...config });
  const occurredAt = Date.now();
  const send = (index) => invokeHandler(handler, {
    method: 'POST',
    url: '/v1/scenarios',
    headers: { Authorization: 'Bearer token' },
    body: {
      scenario_id: 'ai_angel_auto_dial',
      request_id: `queued-panic-${index}`,
      occurred_at: occurredAt
    }
  });

  const admitted = [send(0)];
  await firstScanStarted;
  for (let index = 1; index < 8; index += 1) {
    admitted.push(send(index));
    await new Promise((resolve) => setImmediate(resolve));
  }
  const overflow = await send(8);
  assert.equal(overflow.status, 503);

  releaseFirstScan();
  const admittedResponses = await Promise.all(admitted);
  assert.equal(admittedResponses.every(({ status }) => status === 202), true);
  assert.equal(routerCalls, 1);
  assert.equal(exportCalls, 1);

  const afterDrain = await send(9);
  assert.equal(afterDrain.status, 202);
  assert.equal(afterDrain.json.started[0].duplicate, true);
});

test('AI Angel unique terminal retries are rate-bounded without blocking idempotent retries', async () => {
  let routerCalls = 0;
  const scenarioEngine = { async exportExecutions() { return []; } };
  const edgeScenarioRouter = {
    async ingestContextEvent(_accountId, event) {
      routerCalls += 1;
      return { started: [{
        accepted: true,
        duplicate: routerCalls > 3,
        execution: {
          executionId: '33333333-3333-4333-8333-333333333333',
          scenarioId: 'ai_angel_auto_dial',
          state: 'completed',
          triggerEventId: event.eventId
        }
      }] };
    }
  };
  const config = aiNativeTestConfig(edgeScenarioRouter, { scenarioEngine });
  config.verifyAppToken = async () => ({ sub: 'google:rate-owner' });
  config.resolveScenarioDevices = async () => ({ targets: { wearableId: 'wearable-1' } });
  const handler = createHandler({ logger: silentLogger, ...config });
  const occurredAt = Date.now();
  const send = (id) => invokeHandler(handler, {
    method: 'POST', url: '/v1/scenarios', headers: { Authorization: 'Bearer token' },
    body: { scenario_id: 'ai_angel_auto_dial', request_id: id, occurred_at: occurredAt }
  });
  assert.equal((await send('panic-rate-1')).status, 202);
  assert.equal((await send('panic-rate-2')).status, 202);
  assert.equal((await send('panic-rate-3')).status, 202);
  assert.equal((await send('panic-rate-4')).status, 429);
  assert.equal((await send('panic-rate-1')).status, 202);
  assert.equal(routerCalls, 4);
});

test('scenario feedback is successful-terminal, account-bound, bounded, and stored in encrypted memory', async () => {
  const executionId = '11111111-1111-4111-8111-111111111111';
  const stores = [];
  let executionState = 'completed';
  const scenarioEngine = {
    async getExecution(accountId, requestedExecutionId) {
      assert.equal(accountId, 'google:feedback-owner');
      if (requestedExecutionId !== executionId) return undefined;
      return {
        executionId,
        scenarioId: 'emotional_check_in',
        state: executionState
      };
    }
  };
  const config = aiNativeTestConfig({}, { scenarioEngine });
  config.verifyAppToken = async (token) => token === 'feedback-token' && { sub: 'google:feedback-owner' };
  config.aiNativeSystem.memory.store = async (...args) => {
    stores.push(args);
    return { id: `scenario-feedback-${executionId}` };
  };
  const occurredAt = Date.now();
  const accepted = await invoke(config, {
    method: 'POST',
    url: `/v1/scenarios/${executionId}/feedback`,
    headers: { Authorization: 'Bearer feedback-token' },
    body: { rating: 'helpful', occurred_at: occurredAt }
  });
  assert.equal(accepted.status, 201);
  assert.deepEqual(accepted.json, { recorded: true, rating: 'helpful' });
  assert.deepEqual(stores, [[
    'google:feedback-owner',
    {
      id: `scenario-feedback-${executionId}`,
      kind: 'preference',
      source: 'user',
      category: 'scenario_feedback',
      value: 'emotional_check_in:helpful'
    },
    { idempotencyKey: `scenario_feedback_${executionId}_helpful` }
  ]]);

  for (const body of [
    { rating: 'five-stars', occurred_at: occurredAt },
    { rating: 'helpful', occurred_at: occurredAt - 6 * 60_000 },
    { rating: 'helpful', occurred_at: occurredAt, comment: 'private free text' }
  ]) {
    assert.equal((await invoke(config, {
      method: 'POST',
      url: `/v1/scenarios/${executionId}/feedback`,
      headers: { Authorization: 'Bearer feedback-token' },
      body
    })).status, 400);
  }
  assert.equal(stores.length, 1);

  executionState = 'fallback_completed';
  const acceptedFallback = await invoke(config, {
    method: 'POST',
    url: `/v1/scenarios/${executionId}/feedback`,
    headers: { Authorization: 'Bearer feedback-token' },
    body: { rating: 'not_helpful', occurred_at: occurredAt }
  });
  assert.equal(acceptedFallback.status, 201);
  assert.deepEqual(acceptedFallback.json, { recorded: true, rating: 'not_helpful' });
  assert.equal(stores.length, 2);

  for (const state of ['failed', 'cancelled', 'queued', 'running']) {
    executionState = state;
    const rejected = await invoke(config, {
      method: 'POST',
      url: `/v1/scenarios/${executionId}/feedback`,
      headers: { Authorization: 'Bearer feedback-token' },
      body: { rating: 'helpful', occurred_at: occurredAt }
    });
    assert.equal(rejected.status, 409);
    assert.deepEqual(rejected.json, {
      error: 'Scenario feedback requires a successful execution'
    });
  }
  assert.equal(stores.length, 2);
});

test('voice-call feedback is authenticated, bounded, and stored without free text', async () => {
  const stores = [];
  const config = aiNativeTestConfig({});
  config.verifyAppToken = async (token) => token === 'voice-feedback-token'
    && { sub: 'google:voice-feedback-owner' };
  config.voiceInteractionCompletionRepository = {
    begin() { return true; },
    complete() { return true; },
    verifyCompleted(accountId, interactionId, { occurredAt: verifiedAt }) {
      return accountId === 'google:voice-feedback-owner'
        && interactionId === 'voice-session-1'
        && verifiedAt === occurredAt;
    }
  };
  config.aiNativeSystem.memory.store = async (...args) => {
    stores.push(args);
    return { id: 'interaction-feedback-voice-session-1' };
  };
  const occurredAt = Date.now();
  const accepted = await invoke(config, {
    method: 'POST',
    url: '/v1/interaction-feedback',
    headers: { Authorization: 'Bearer voice-feedback-token' },
    body: {
      interaction_type: 'voice_call',
      interaction_id: 'voice-session-1',
      rating: 'helpful',
      occurred_at: occurredAt
    }
  });
  assert.equal(accepted.status, 201);
  assert.deepEqual(accepted.json, { recorded: true, rating: 'helpful' });
  assert.deepEqual(stores, [[
    'google:voice-feedback-owner',
    {
      id: 'interaction-feedback-voice-session-1',
      kind: 'preference',
      source: 'user',
      category: 'interaction_feedback',
      value: 'voice_call:helpful'
    },
    { idempotencyKey: 'interaction_feedback_voice-session-1_helpful' }
  ]]);

  for (const body of [
    {
      interaction_type: 'raw_transcript', interaction_id: 'voice-session-2',
      rating: 'helpful', occurred_at: occurredAt
    },
    {
      interaction_type: 'voice_call', interaction_id: 'voice-session-2',
      rating: 'stars', occurred_at: occurredAt
    },
    {
      interaction_type: 'voice_call', interaction_id: 'voice-session-2',
      rating: 'helpful', occurred_at: occurredAt, comment: 'private text'
    },
    {
      interaction_type: 'voice_call', interaction_id: 'voice-session-2',
      rating: 'helpful', occurred_at: occurredAt - 6 * 60_000
    }
  ]) {
    assert.equal((await invoke(config, {
      method: 'POST',
      url: '/v1/interaction-feedback',
      headers: { Authorization: 'Bearer voice-feedback-token' },
      body
    })).status, 400);
  }
  assert.equal((await invoke(config, {
    method: 'POST',
    url: '/v1/interaction-feedback',
    body: {
      interaction_type: 'voice_call', interaction_id: 'voice-session-2',
      rating: 'helpful', occurred_at: occurredAt
    }
  })).status, 401);
  assert.equal((await invoke(config, {
    method: 'POST',
    url: '/v1/interaction-feedback',
    headers: { Authorization: 'Bearer voice-feedback-token' },
    body: {
      interaction_type: 'voice_call', interaction_id: 'unowned-session',
      rating: 'helpful', occurred_at: occurredAt
    }
  })).status, 404);
  assert.equal(stores.length, 1);
});

test('voice-call feedback writes are rate-bounded per authenticated account', async () => {
  const config = aiNativeTestConfig({});
  config.verifyAppToken = async () => ({ sub: 'google:voice-rate-owner' });
  config.voiceInteractionCompletionRepository = {
    begin() { return true; },
    complete() { return true; },
    verifyCompleted() { return true; }
  };
  config.aiNativeSystem.memory.store = async () => ({ id: 'feedback' });
  const handler = createHandler({ logger: silentLogger, ...config });
  const occurredAt = Date.now();
  const send = (index) => invokeHandler(handler, {
    method: 'POST',
    url: '/v1/interaction-feedback',
    headers: { Authorization: 'Bearer voice-feedback-token' },
    body: {
      interaction_type: 'voice_call',
      interaction_id: `voice-session-${index}`,
      rating: 'helpful',
      occurred_at: occurredAt
    }
  });
  for (let index = 0; index < 10; index += 1) assert.equal((await send(index)).status, 201);
  assert.equal((await send(10)).status, 429);
});

test('wearable edge ingress uses app identity while robot ingress requires device credentials', async () => {
  const calls = [];
  const edgeScenarioRouter = {
    async ingestWearableInference(accountId, envelope, binding, context) {
      calls.push(['wearable', accountId, envelope, binding, context]);
      return { started: [] };
    },
    async ingestRobotInference(accountId, envelope, binding, context) {
      calls.push(['robot', accountId, envelope, binding, context]);
      return { started: [] };
    }
  };
  const config = {
    ...aiNativeTestConfig(edgeScenarioRouter),
    verifyAppToken: async (token) => token === 'app-token' && { sub: 'google:wearable-owner' },
    async resolveEdgeDeviceBinding(request) {
      calls.push(['resolve-wearable', request]);
      return {
        targets: { wearableId: 'wearable-command-1', homeRobotId: 'robot-command-1' },
        wearableSourceRef: 'wearable-source-1'
      };
    },
    async authenticateRobotEdgeIngress(request) {
      calls.push(['authenticate-robot', request]);
      if (request.adapterId !== 'jiangzhi-edge' || request.credential !== 'robot-secret') return null;
      return {
        accountId: 'google:robot-owner',
        binding: {
          targets: { wearableId: 'wearable-command-2', homeRobotId: 'robot-command-2' },
          homeRobotSourceRef: 'robot-source-1'
        }
      };
    }
  };
  const wearableEnvelope = { sourceDeviceRef: 'wearable-source-1', sequence: 1 };
  const wearable = await invoke(config, {
    method: 'POST',
    url: '/v1/edge/wearable/inference',
    headers: { Authorization: 'Bearer app-token' },
    body: { envelope: wearableEnvelope, context: { location_context: 'away' } }
  });
  assert.equal(wearable.status, 202);
  assert.deepEqual(calls[0], ['resolve-wearable', {
    accountId: 'google:wearable-owner',
    deviceType: 'wearable',
    sourceDeviceRef: 'wearable-source-1'
  }]);
  assert.deepEqual(calls[1], ['wearable', 'google:wearable-owner', wearableEnvelope, {
    targets: { wearableId: 'wearable-command-1', homeRobotId: 'robot-command-1' },
    wearableSourceRef: 'wearable-source-1'
  }, { locationContext: 'away' }]);

  const robotEnvelope = { sourceDeviceRef: 'robot-source-1', sequence: 2 };
  const robot = await invoke(config, {
    method: 'POST',
    url: '/v1/edge/robot/inference',
    headers: {
      'X-Robot-Adapter-Id': 'jiangzhi-edge',
      'X-Robot-Callback-Key': 'robot-secret'
    },
    body: { envelope: robotEnvelope, context: { location_context: 'home' } }
  });
  assert.equal(robot.status, 202);
  assert.deepEqual(calls[2], ['authenticate-robot', {
    adapterId: 'jiangzhi-edge',
    credential: 'robot-secret',
    sourceDeviceRef: 'robot-source-1'
  }]);
  assert.deepEqual(calls[3], ['robot', 'google:robot-owner', robotEnvelope, {
    targets: { wearableId: 'wearable-command-2', homeRobotId: 'robot-command-2' },
    homeRobotSourceRef: 'robot-source-1'
  }, { locationContext: 'home' }]);

  const appCannotImpersonateRobot = await invoke(config, {
    method: 'POST',
    url: '/v1/edge/robot/inference',
    headers: { Authorization: 'Bearer app-token' },
    body: { envelope: robotEnvelope }
  });
  assert.equal(appCannotImpersonateRobot.status, 401);
  const robotCannotImpersonateWearable = await invoke(config, {
    method: 'POST',
    url: '/v1/edge/wearable/inference',
    headers: {
      Authorization: 'Bearer app-token',
      'X-Robot-Adapter-Id': 'jiangzhi-edge',
      'X-Robot-Callback-Key': 'robot-secret'
    },
    body: { envelope: wearableEnvelope }
  });
  assert.equal(robotCannotImpersonateWearable.status, 401);
  assert.equal(calls.length, 4);
});

test('scheduled context ingress accepts only service authentication and bounded event data', async () => {
  const calls = [];
  const config = {
    ...aiNativeTestConfig({
      async ingestContextEvent(accountId, event, binding) {
        calls.push(['ingest', accountId, event, binding]);
        return { started: [{ executionId: 'medication-execution' }] };
      }
    }),
    verifyAppToken: async () => ({ sub: 'google:app-user' }),
    async authenticateScenarioIngress({ credential, eventType }) {
      calls.push(['authenticate', credential, eventType]);
      return credential === 'scheduler-secret' ? { accountId: 'google:scheduled-user' } : null;
    },
    async resolveScenarioDevices(request) {
      calls.push(['resolve', request]);
      return { targets: { wearableId: 'wearable-scheduled', homeRobotId: 'robot-scheduled' } };
    }
  };
  const occurredAt = Date.now();
  const appOnly = await invoke(config, {
    method: 'POST',
    url: '/v1/scenarios/context-events',
    headers: { Authorization: 'Bearer app-token' },
    body: { event_id: 'med-1', type: 'medication_due', occurred_at: occurredAt, data: {} }
  });
  assert.equal(appOnly.status, 401);
  assert.deepEqual(calls, []);

  const accepted = await invoke(config, {
    method: 'POST',
    url: '/v1/scenarios/context-events',
    headers: { 'X-Scenario-Ingress-Key': 'scheduler-secret' },
    body: {
      event_id: 'med-2',
      type: 'medication_due',
      occurred_at: occurredAt,
      data: { medication_id: 'medication-plan-1', scheduled_at: occurredAt }
    }
  });
  assert.equal(accepted.status, 202);
  assert.deepEqual(calls[1], ['resolve', {
    accountId: 'google:scheduled-user',
    scenarioId: 'medication_adherence',
    source: 'trusted_scheduler'
  }]);
  assert.deepEqual(calls[2][2].data, {
    medicationId: 'medication-plan-1',
    scheduledAt: occurredAt
  });

  const forged = await invoke(config, {
    method: 'POST',
    url: '/v1/scenarios/context-events',
    headers: { 'X-Scenario-Ingress-Key': 'scheduler-secret' },
    body: {
      event_id: 'med-3',
      type: 'medication_due',
      occurred_at: occurredAt,
      data: { robotSafeToMove: true }
    }
  });
  assert.equal(forged.status, 400);
  assert.deepEqual(calls[3], ['authenticate', 'scheduler-secret', 'medication_due']);
  assert.equal(calls.length, 4);
});

test('authenticated users can list and selectively or completely erase only their AI memories', async () => {
  const calls = [];
  const config = aiNativeTestConfig({});
  config.verifyAppToken = async (token) => token === 'memory-token' && { sub: 'google:memory-owner' };
  config.aiNativeSystem.memory = {
    async list(accountId, query) {
      calls.push(['list', accountId, query]);
      return [{ id: 'memory-1', kind: 'preference' }];
    },
    async delete(accountId, memoryId) {
      calls.push(['delete', accountId, memoryId]);
      return memoryId === 'memory-1';
    },
    async deleteAll(accountId) {
      calls.push(['delete-all', accountId]);
      return true;
    }
  };
  const headers = { Authorization: 'Bearer memory-token' };
  const listed = await invoke(config, {
    url: '/v1/ai-native/memories?kind=preference&offset=2&limit=10', headers
  });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.json.memories, [{ id: 'memory-1', kind: 'preference' }]);
  assert.deepEqual(calls[0], ['list', 'google:memory-owner', { kind: 'preference', offset: 2, limit: 10 }]);

  const removed = await invoke(config, {
    method: 'DELETE', url: '/v1/ai-native/memories/memory-1', headers
  });
  assert.equal(removed.status, 204);
  const missing = await invoke(config, {
    method: 'DELETE', url: '/v1/ai-native/memories/missing-memory', headers
  });
  assert.equal(missing.status, 404);
  const unconfirmed = await invoke(config, {
    method: 'DELETE', url: '/v1/ai-native/memories', headers, body: { confirmed: false }
  });
  assert.equal(unconfirmed.status, 400);
  const erased = await invoke(config, {
    method: 'DELETE', url: '/v1/ai-native/memories', headers, body: { confirmed: true }
  });
  assert.equal(erased.status, 204);
  assert.deepEqual(calls.at(-1), ['delete-all', 'google:memory-owner']);

  for (const invalidUrl of [
    '/v1/ai-native/memories?limit=0',
    '/v1/ai-native/memories?kind=raw_transcript',
    '/v1/ai-native/memories?limit=10&limit=20',
    '/v1/ai-native/memories?private=true'
  ]) {
    assert.equal((await invoke(config, { url: invalidUrl, headers })).status, 400);
  }
});

test('AI-native feature flag suppresses runtime routes and AI Angel selection despite injected objects', async () => {
  let invoked = false;
  const enabled = aiNativeTestConfig({
    async ingestContextEvent() { invoked = true; return { started: [] }; }
  }, {
    clmBearerToken: 'server-secret',
    verifyAppToken: async () => ({ sub: 'google:disabled-owner' }),
    resolveScenarioDevices: async () => ({ targets: { wearableId: 'wearable-1' } })
  });
  const config = { ...enabled, aiNativeEnabled: false };
  const route = await invoke(config, {
    method: 'POST',
    url: '/v1/scenarios',
    headers: { Authorization: 'Bearer token' },
    body: { scenario_id: 'ai_angel_auto_dial', request_id: 'disabled-request-1', occurred_at: Date.now() }
  });
  assert.equal(route.status, 503);
  const completion = await invoke(config, {
    method: 'POST',
    url: '/chat/completions',
    headers: { Authorization: 'Bearer server-secret' },
    body: {
      messages: [{ role: 'user', content: 'I am in immediate danger' }],
      tools: [
        { type: 'function', function: { name: 'request_help_dial', parameters: { type: 'object' } } },
        { type: 'function', function: { name: 'trigger_ai_angel', parameters: { type: 'object' } } }
      ]
    }
  });
  assert.match(completion.text, /"name":"request_help_dial"/);
  assert.doesNotMatch(completion.text, /"name":"trigger_ai_angel"/);
  assert.equal(invoked, false);
});

test('authenticated safety API persists contacts, mode sessions, and idempotent SOS receipts', async () => {
  const records = { contacts: [], sessions: [], sos: [] };
  const repository = {
    async listContacts() { return records.contacts; },
    async createContact(_userId, contact) { records.contacts.push(contact); return contact; },
    async updateContact(_userId, contactId, contact, expectedVersion) {
      const index = records.contacts.findIndex((item) => item.id === contactId && item.version === expectedVersion);
      if (index < 0) throw Object.assign(new Error('conflict'), { statusCode: 409 });
      records.contacts[index] = contact;
      return contact;
    },
    async deleteContact(_userId, contactId) {
      records.contacts = records.contacts.filter((contact) => contact.id !== contactId);
    },
    async startSafetySession(_userId, session) {
      const existing = records.sessions.find((entry) => entry.idempotencyKey === session.idempotencyKey);
      if (existing) return existing;
      records.sessions.push(session);
      return session;
    },
    async getSafetySession() { return records.sessions.at(-1) || null; },
    async exportUserData() {
      return {
        contacts: records.contacts,
        safetyState: records.sessions.at(-1) || null,
        sosEvents: records.sos
      };
    },
    async deleteUserData() {
      records.contacts = [];
      records.sessions = [];
      records.sos = [];
    },
    async acceptSOS(_userId, event) {
      const existing = records.sos.find((item) => item.idempotencyKey === event.idempotencyKey);
      if (existing) return existing;
      records.sos.push(event);
      return event;
    }
  };
  const config = {
    safetyApiEnabled: true,
    safetyRepository: repository,
    authExchangeEnabled: true,
    sessionJWTSecret: 'safety-api-session-secret-at-least-32-characters',
    sessionJWTIssuer: 'https://api.example.test',
    sessionJWTAudience: 'veryloving-test',
    googleTokenAudiences: 'google-web.apps.googleusercontent.com',
    googleAuthorizedParties: 'google-native.apps.googleusercontent.com'
  };
  const token = signSessionJWT({ provider: 'google', subject: 'safety-user' }, config).token;
  const authorization = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const created = await invoke(config, {
    method: 'POST',
    url: '/v1/emergency-contacts',
    headers: authorization,
    body: { name: 'Grace', phone: '+6591234567', countryCode: 'SG' }
  });
  assert.equal(created.status, 201);
  assert.match(created.json.id, /^contact_[A-Za-z0-9_-]{24}$/);

  const listed = await invoke(config, {
    method: 'GET',
    url: '/v1/emergency-contacts',
    headers: authorization
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.json.contacts.length, 1);

  const updated = await invoke(config, {
    method: 'PATCH',
    url: `/v1/emergency-contacts/${created.json.id}`,
    headers: authorization,
    body: {
      name: 'Grace Lee',
      phone: '+6598765432',
      countryCode: 'SG',
      version: created.json.version
    }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.id, created.json.id);
  assert.equal(updated.json.name, 'Grace Lee');
  assert.equal(updated.json.phone, '+6598765432');
  assert.equal(updated.json.version, 2);

  const staleUpdate = await invoke(config, {
    method: 'PATCH',
    url: `/v1/emergency-contacts/${created.json.id}`,
    headers: authorization,
    body: {
      name: 'Stale edit',
      phone: '+6591234567',
      countryCode: 'SG',
      version: created.json.version
    }
  });
  assert.equal(staleUpdate.status, 409);
  assert.equal(records.contacts[0].name, 'Grace Lee');

  const mode = await invoke(config, {
    method: 'POST',
    url: '/v1/safety-sessions',
    headers: authorization,
    body: { idempotencyKey: 'mode_1234567890abcdef', mode: 'guardian' }
  });
  assert.equal(mode.status, 201);
  assert.equal(mode.json.status, 'active');

  const duplicateMode = await invoke(config, {
    method: 'POST',
    url: '/v1/safety-sessions',
    headers: authorization,
    body: { idempotencyKey: 'mode_1234567890abcdef', mode: 'guardian' }
  });
  assert.deepEqual(duplicateMode.json, mode.json);
  assert.equal(records.sessions.length, 1);

  const conflictingMode = await invoke(config, {
    method: 'POST',
    url: '/v1/safety-sessions',
    headers: authorization,
    body: { idempotencyKey: 'mode_1234567890abcdef', mode: 'home' }
  });
  assert.equal(conflictingMode.status, 409);
  assert.equal(records.sessions.length, 1);

  const currentMode = await invoke(config, {
    method: 'GET',
    url: '/v1/safety-sessions/current',
    headers: authorization
  });
  assert.equal(currentMode.status, 200);
  assert.equal(currentMode.json.session.mode, 'guardian');

  const sosBody = {
    idempotencyKey: 'sos_1234567890abcdefg',
    occurredAt: Date.now(),
    source: 'app',
    contactIds: [created.json.id]
  };
  const firstSOS = await invoke(config, {
    method: 'POST',
    url: '/v1/sos-events',
    headers: authorization,
    body: sosBody
  });
  const duplicateSOS = await invoke(config, {
    method: 'POST',
    url: '/v1/sos-events',
    headers: authorization,
    body: sosBody
  });
  assert.equal(firstSOS.status, 202);
  assert.deepEqual(duplicateSOS.json, firstSOS.json);
  assert.equal(records.sos.length, 1);

  const exported = await invoke(config, {
    method: 'GET',
    url: '/v1/privacy/export',
    headers: authorization
  });
  assert.equal(exported.status, 200);
  assert.equal(exported.json.data.datasets.safety.data.contacts.length, 1);
  assert.equal(exported.json.data.datasets.safety.data.sosEvents.length, 1);
  assert.equal(exported.json.data.datasets.devices.status, 'not-configured');

  const deleted = await invoke(config, {
    method: 'DELETE',
    url: '/v1/privacy/data',
    headers: authorization
  });
  assert.equal(deleted.status, 204);
  assert.equal(records.contacts.length, 0);
  assert.equal(records.sos.length, 0);
});

test('medication caregiver escalation is durable, idempotent, private, and can target selected or all contacts', async () => {
  const contacts = [
    { id: 'contact_abcdefghijklmnopqrstuvwx', phone: '+6591111111' },
    { id: 'contact_1234567890abcdefghijklmn', phone: '+6592222222' }
  ];
  const escalations = new Map();
  const pushes = [];
  const repository = {
    async listContacts() { return contacts; },
    async getMedicationEscalation(_userId, idempotencyKey) {
      return escalations.get(idempotencyKey) || null;
    },
    async acceptMedicationEscalation(_userId, event) {
      if (!escalations.has(event.idempotencyKey)) escalations.set(event.idempotencyKey, event);
      return escalations.get(event.idempotencyKey);
    },
    async claimMedicationEscalationDelivery(_userId, idempotencyKey) {
      const event = escalations.get(idempotencyKey);
      if (!event || event.deliveryAttemptedAt) return null;
      event.deliveryAttemptedAt = Date.now();
      return event;
    },
    async recordMedicationEscalationDelivery(_userId, idempotencyKey, delivery) {
      Object.assign(escalations.get(idempotencyKey), delivery, { deliveryRecordedAt: Date.now() });
    },
    async exportUserData() { return { medicationEscalations: [...escalations.values()] }; },
    async deleteUserData() { escalations.clear(); return { deletedItems: 1 }; }
  };
  const config = {
    safetyApiEnabled: true,
    safetyRepository: repository,
    safetyRetentionDays: 365,
    authExchangeEnabled: true,
    sessionJWTSecret: 'medication-escalation-test-secret-at-least-32-characters',
    sessionJWTIssuer: 'https://api.example.test',
    sessionJWTAudience: 'veryloving-test',
    googleTokenAudiences: 'google-web.apps.googleusercontent.com',
    googleAuthorizedParties: 'google-native.apps.googleusercontent.com',
    async notifyEmergencyContacts(userId, contactIds, notification) {
      pushes.push({ userId, contactIds, notification });
      return { eligible: contactIds.length, delivered: contactIds.length, failedRecipients: 0 };
    }
  };
  const token = signSessionJWT({ provider: 'google', subject: 'medication-user' }, config).token;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const occurredAt = Date.now();
  const selectedBody = {
    idempotencyKey: 'medication_1234567890abcdef',
    medicationReference: 'schedule_item_01',
    reason: 'missed_dose',
    occurredAt,
    source: 'home_robot',
    contactIds: [contacts[0].id]
  };

  const first = await invoke(config, {
    method: 'POST', url: '/v1/medication-escalations', headers, body: selectedBody
  });
  const duplicate = await invoke(config, {
    method: 'POST', url: '/v1/medication-escalations', headers, body: selectedBody
  });
  assert.equal(first.status, 202);
  assert.equal(first.json.status, 'accepted');
  assert.equal(first.json.deliveryStatus, 'delivered');
  assert.deepEqual(duplicate.json, first.json);
  assert.equal(pushes.length, 1);
  assert.deepEqual(pushes[0].contactIds, [contacts[0].id]);
  assert.equal(JSON.stringify(pushes[0].notification).includes(selectedBody.medicationReference), false);
  assert.equal(JSON.stringify(pushes[0].notification).includes(selectedBody.reason), false);
  const persisted = escalations.get(selectedBody.idempotencyKey);
  assert.equal(persisted.status, 'accepted');
  assert.equal(persisted.deliveryStatus, 'delivered');
  assert.ok(persisted.expiresAt <= Math.floor((Date.now() + 365 * 86400000) / 1000));

  const conflictingRetry = await invoke(config, {
    method: 'POST',
    url: '/v1/medication-escalations',
    headers,
    body: { ...selectedBody, reason: 'reminder_unacknowledged' }
  });
  assert.equal(conflictingRetry.status, 409);
  assert.equal(pushes.length, 1);

  const allContacts = await invoke(config, {
    method: 'POST',
    url: '/v1/medication-escalations',
    headers,
    body: {
      idempotencyKey: 'medication_abcdef1234567890',
      medicationReference: 'schedule_item_02',
      reason: 'care_recipient_unresponsive',
      occurredAt,
      source: 'app'
    }
  });
  assert.equal(allContacts.status, 202);
  assert.deepEqual(pushes[1].contactIds, contacts.map(({ id }) => id));

  const failedDeliveryConfig = {
    ...config,
    async notifyEmergencyContacts() { throw new Error('push unavailable'); }
  };
  const failedDelivery = await invoke(failedDeliveryConfig, {
    method: 'POST',
    url: '/v1/medication-escalations',
    headers,
    body: {
      ...selectedBody,
      idempotencyKey: 'medication_failed_123456',
      medicationReference: 'schedule_item_03'
    }
  });
  assert.equal(failedDelivery.status, 202);
  assert.equal(failedDelivery.json.status, 'accepted');
  assert.equal(failedDelivery.json.deliveryStatus, 'failed');
  assert.equal(escalations.get('medication_failed_123456').status, 'accepted');
  assert.equal(escalations.get('medication_failed_123456').deliveryStatus, 'failed');

  const invalid = await invoke(config, {
    method: 'POST',
    url: '/v1/medication-escalations',
    headers,
    body: { ...selectedBody, idempotencyKey: 'medication_invalid_1234', medicationReference: 'x'.repeat(101) }
  });
  assert.equal(invalid.status, 400);

  const exported = await invoke(config, { url: '/v1/privacy/export', headers });
  assert.equal(exported.status, 200);
  assert.equal(exported.json.data.datasets.safety.data.medicationEscalations.length, 3);
  const deleted = await invoke(config, { method: 'DELETE', url: '/v1/privacy/data', headers });
  assert.equal(deleted.status, 204);
  assert.equal(escalations.size, 0);
});

test('safety API rejects missing sessions and invalid contact data', async () => {
  const repository = {
    async listContacts() { return []; },
    async createContact() { throw new Error('must not run'); }
  };
  const baseConfig = {
    safetyApiEnabled: true,
    safetyRepository: repository,
    authExchangeEnabled: true,
    sessionJWTSecret: 'safety-api-session-secret-at-least-32-characters',
    appleClientIds: 'com.example.test'
  };
  const unauthorized = await invoke(baseConfig, {
    method: 'GET',
    url: '/v1/emergency-contacts'
  });
  assert.equal(unauthorized.status, 401);

  const config = { ...baseConfig };
  const token = signSessionJWT({ provider: 'apple', subject: 'user' }, config).token;
  const invalid = await invoke(config, {
    method: 'POST',
    url: '/v1/emergency-contacts',
    headers: { Authorization: `Bearer ${token}` },
    body: { name: 'Bad', phone: '123', countryCode: 'SG' }
  });
  assert.equal(invalid.status, 400);
});

test('control-plane endpoint injects the CLM key without returning it to the app', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 204 };
  };
  const response = await invoke({
    verifyAppToken: () => true,
    fetchImpl,
    humeApiKey: 'hume-server-key',
    clmBearerToken: 'clm-server-key'
  }, {
    method: 'POST',
    url: '/v1/hume/session/configure',
    headers: { Authorization: 'Bearer valid-user-token', 'Content-Type': 'application/json' },
    body: { chatId: '8859a139-d98a-4e2f-af54-9dd66d8c96e1', customSessionId: 'opaque-session' }
  });
  assert.equal(response.status, 204);
  assert.equal(response.text, '');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v0\/evi\/chat\/8859a139-d98a-4e2f-af54-9dd66d8c96e1\/send$/);
  assert.equal(calls[0].options.headers['X-Hume-Api-Key'], 'hume-server-key');
  assert.deepEqual(JSON.parse(calls[0].options.body), { type: 'session_settings', language_model_api_key: 'clm-server-key' });
});

test('safety classification selects conservative scenarios', () => {
  assert.equal(inferScenario('I think someone is following me'), 'being_followed');
  assert.equal(inferScenario('I am waiting for my rideshare'), 'rideshare');
  assert.equal(getSafetyTips('unknown').scenario, 'general');
});

test('robot recovery, telemetry, and manufacturer ACK endpoints preserve trust boundaries', async () => {
  const verifyAppToken = async () => ({ sub: 'google:user-1' });
  const listed = await invoke({
    verifyAppToken,
    robotRepository: {
      async list(userId) {
        assert.equal(userId, 'google:user-1');
        return [{ robot_id: 'robot-1', device_type: 'home_robot' }];
      }
    }
  }, {
    method: 'GET',
    url: '/v1/devices/home-robots',
    headers: { Authorization: 'Bearer app-session' }
  });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.json.devices, [{ robot_id: 'robot-1', device_type: 'home_robot' }]);

  const telemetry = await invoke({
    verifyAppToken,
    robotRepository: {
      async verifyPairingToken(userId, robotId, token) {
        return userId === 'google:user-1' && robotId === 'robot:1' && token === 'pairing-token';
      },
      async resolveManufacturerDeviceId(userId, robotId) {
        return userId === 'google:user-1' && robotId === 'robot:1' ? 'manufacturer:1' : null;
      }
    },
    getManufacturerRobotStatus: async (robotId) => ({ online: robotId === 'manufacturer:1', hardware_status: 'online' })
  }, {
    method: 'GET',
    url: '/v1/devices/robot%3A1/telemetry',
    headers: { Authorization: 'Bearer app-session', 'X-Device-Pairing-Token': 'pairing-token' }
  });
  assert.equal(telemetry.status, 200);
  assert.equal(telemetry.json.online, true);

  const resetCalls = [];
  const legacyRepository = memoryRobotResetRepository();
  const reset = await invoke({
    verifyAppToken,
    robotRepository: legacyRepository,
    actionGateway: {
      async fenceRobotBinding(userId, robotId, epoch) {
        resetCalls.push(['fence', userId, robotId, epoch]);
      }
    },
    async resetManufacturerRobot(request) { resetCalls.push(['reset', request]); }
  }, {
    method: 'DELETE',
    url: '/v1/devices/home-robots/robot%3A1',
    headers: { Authorization: 'Bearer app-session', 'X-Device-Pairing-Token': 'pairing-token' }
  });
  assert.equal(reset.status, 204);
  assert.equal(resetCalls.filter(([kind]) => kind === 'fence').length, 2);
  assert.deepEqual(resetCalls.at(-1), ['reset', {
    resetId: '11111111-1111-4111-8111-111111111111',
    manufacturerDeviceId: 'manufacturer:1',
    bindingEpoch: 7
  }]);
  assert.equal(legacyRepository.state.lifecycleState, 'unbound');

  const modernResetCalls = [];
  const modernRepository = memoryRobotResetRepository({
    adapterId: 'jiangzhi-edge',
    manufacturerDeviceId: 'jiangzhi-device-1',
    bindingEpoch: 9
  });
  const modernReset = await invoke({
    verifyAppToken,
    robotRepository: modernRepository,
    actionGateway: {
      async fenceRobotBinding(userId, robotId, epoch) {
        modernResetCalls.push(['fence', userId, robotId, epoch]);
      }
    },
    robotAdapterRuntime: {
      async resetRobot(adapterId, request) {
        modernResetCalls.push(['reset', adapterId, request]);
      }
    },
    async resetManufacturerRobot() { throw new Error('legacy reset must not receive modern bindings'); }
  }, {
    method: 'DELETE',
    url: '/v1/devices/home-robots/robot%3A1',
    headers: { Authorization: 'Bearer app-session', 'X-Device-Pairing-Token': 'pairing-token' }
  });
  assert.equal(modernReset.status, 204);
  assert.equal(modernResetCalls.filter(([kind]) => kind === 'fence').length, 2);
  assert.deepEqual(modernResetCalls.at(-1), ['reset', 'jiangzhi-edge', {
    resetId: '11111111-1111-4111-8111-111111111111',
    manufacturerDeviceId: 'jiangzhi-device-1',
    bindingEpoch: 9
  }]);

  const retryRepository = memoryRobotResetRepository();
  const retryResetIds = [];
  let remoteAvailable = false;
  const retryConfig = {
    verifyAppToken,
    robotRepository: retryRepository,
    actionGateway: {
      async fenceRobotBinding() {}
    },
    async resetManufacturerRobot(request) {
      retryResetIds.push(request.resetId);
      if (!remoteAvailable) throw new Error('manufacturer unavailable');
    }
  };
  const failedReset = await invoke(retryConfig, {
    method: 'DELETE',
    url: '/v1/devices/home-robots/robot%3A1',
    headers: { Authorization: 'Bearer app-session', 'X-Device-Pairing-Token': 'pairing-token' }
  });
  assert.equal(failedReset.status, 502);
  assert.equal(retryRepository.state.lifecycleState, 'reset_pending');
  remoteAvailable = true;
  const retriedReset = await invoke(retryConfig, {
    method: 'DELETE',
    url: '/v1/devices/home-robots/robot%3A1',
    headers: { Authorization: 'Bearer app-session', 'X-Device-Pairing-Token': 'pairing-token' }
  });
  assert.equal(retriedReset.status, 204);
  assert.deepEqual(retryResetIds, [
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111'
  ]);

  const acknowledgements = [];
  const acknowledged = await invoke({
    manufacturerApiKey: 'manufacturer-secret',
    actionGateway: {
      async acknowledgeRobot(actionId, ack, context) {
        acknowledgements.push({ actionId, ack, context });
        return context.bindingEpoch === 7;
      }
    }
  }, {
    method: 'POST',
    url: '/v1/manufacturer/robot/ack',
    headers: { 'X-Manufacturer-Api-Key': 'manufacturer-secret' },
    body: { action_id: '11111111-1111-4111-8111-111111111111', binding_epoch: 7, ok: true }
  });
  assert.equal(acknowledged.status, 204);
  assert.equal(acknowledgements[0].actionId, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(acknowledgements[0].context, {
    adapterId: 'manufacturer-default',
    bindingEpoch: 7
  });

  const staleAcknowledgement = await invoke({
    manufacturerApiKey: 'manufacturer-secret',
    actionGateway: {
      async acknowledgeRobot(_actionId, _ack, context) { return context.bindingEpoch === 7; }
    }
  }, {
    method: 'POST',
    url: '/v1/manufacturer/robot/ack',
    headers: { 'X-Manufacturer-Api-Key': 'manufacturer-secret' },
    body: { action_id: '11111111-1111-4111-8111-111111111111', binding_epoch: 6, ok: true }
  });
  assert.equal(staleAcknowledgement.status, 404);

  const missingEpoch = await invoke({
    manufacturerApiKey: 'manufacturer-secret',
    actionGateway: { async acknowledgeRobot() { throw new Error('must not run'); } }
  }, {
    method: 'POST',
    url: '/v1/manufacturer/robot/ack',
    headers: { 'X-Manufacturer-Api-Key': 'manufacturer-secret' },
    body: { action_id: '11111111-1111-4111-8111-111111111111', ok: true }
  });
  assert.equal(missingEpoch.status, 400);

  let routed = false;
  const splitProcessAction = await invoke({
    httpOnlyDeployment: true,
    verifyAppToken,
    actionGateway: { async route() { routed = true; } }
  }, {
    method: 'POST',
    url: '/v1/device-actions',
    headers: { Authorization: 'Bearer app-session' },
    body: { action: 'check_medication', device_type: 'home_robot', device_id: 'robot-1' }
  });
  assert.equal(splitProcessAction.status, 503);
  assert.equal(routed, false);
});

test('mixed-vendor pairing, telemetry, and callbacks stay adapter-bound', async () => {
  const calls = [];
  const robotAdapterRuntime = {
    async verifyPairingCode(selector, qrCode) {
      calls.push(['pair', selector, qrCode]);
      return {
        adapterId: selector === 'jiangzhi' ? 'edge-deployment-1' : 'cloud-deployment-1',
        hardwareSerial: 'PRIVATE-SERIAL-001',
        manufacturerDeviceId: 'manufacturer-device-1',
        oneTime: true,
        expiresAt: Date.now() + 60_000
      };
    },
    async getDeviceStatus(adapterId, deviceId) {
      calls.push(['status', adapterId, deviceId]);
      return { online: true, hardware_status: 'online', reported_at: Date.now() };
    },
    async getTelemetrySnapshot(adapterId, deviceId) {
      calls.push(['snapshot', adapterId, deviceId]);
      return {
        online: true,
        hardware_status: 'online',
        reported_at: Date.now(),
        battery: { percentage: 81, charging: true, observed_at: Date.now() },
        navigation_path: [[103.8, 1.3], [103.81, 1.31]]
      };
    },
    authenticateCallback(adapterId, key) {
      return adapterId === 'edge-deployment-1' && key === 'edge-callback-secret';
    }
  };
  let binding;
  const robotRepository = {
    async resumeBinding() { return null; },
    async consumeAndBind(userId, _claimHash, record) {
      binding = { userId, ...record };
      return record;
    },
    async verifyPairingToken() { return true; },
    async resolveRobotBinding() {
      return { manufacturerDeviceId: 'manufacturer-device-1', adapterId: 'edge-deployment-1' };
    }
  };
  const verifyAppToken = async () => ({ sub: 'google:user-1' });

  const paired = await invoke({
    verifyAppToken,
    robotAdapterRuntime,
    robotRepository,
    robotPairingTokenSecret: 'test-robot-pairing-secret-at-least-32-characters'
  }, {
    method: 'POST',
    url: '/v1/devices/home-robots/pair',
    headers: { Authorization: 'Bearer app-session' },
    body: { qr_code: 'manufacturer-one-time-code', robot_vendor: 'jiangzhi' }
  });
  assert.equal(paired.status, 201);
  assert.equal(binding.adapterId, 'edge-deployment-1');
  assert.deepEqual(calls[0], ['pair', 'jiangzhi', 'manufacturer-one-time-code']);

  const telemetry = await invoke({ verifyAppToken, robotAdapterRuntime, robotRepository }, {
    method: 'GET',
    url: `/v1/devices/${encodeURIComponent(paired.json.robot_id)}/telemetry`,
    headers: { Authorization: 'Bearer app-session', 'X-Device-Pairing-Token': paired.json.pairing_token }
  });
  assert.equal(telemetry.status, 200);
  assert.deepEqual(calls[1], ['snapshot', 'edge-deployment-1', 'manufacturer-device-1']);
  assert.equal(telemetry.json.battery.percentage, 81);
  assert.deepEqual(telemetry.json.navigation_path, [[103.8, 1.3], [103.81, 1.31]]);

  const acknowledgements = [];
  const actionGateway = {
    async acknowledgeRobot(actionId, ack, context) {
      acknowledgements.push({ actionId, ack, context });
      return true;
    }
  };
  const wrongVendor = await invoke({ robotAdapterRuntime, actionGateway }, {
    method: 'POST', url: '/v1/manufacturer/robot/ack',
    headers: { 'X-Robot-Adapter-Id': 'cloud-deployment-1', 'X-Robot-Callback-Key': 'edge-callback-secret' },
    body: { action_id: '11111111-1111-4111-8111-111111111111', binding_epoch: 4, ok: true }
  });
  assert.equal(wrongVendor.status, 401);

  const accepted = await invoke({ robotAdapterRuntime, actionGateway }, {
    method: 'POST', url: '/v1/manufacturer/robot/ack',
    headers: { 'X-Robot-Adapter-Id': 'edge-deployment-1', 'X-Robot-Callback-Key': 'edge-callback-secret' },
    body: { action_id: '11111111-1111-4111-8111-111111111111', binding_epoch: 4, ok: true }
  });
  assert.equal(accepted.status, 204);
  assert.deepEqual(acknowledgements[0].context, { adapterId: 'edge-deployment-1', bindingEpoch: 4 });

  const legacyAccepted = await invoke({
    robotAdapterRuntime,
    actionGateway,
    manufacturerApiKey: 'legacy-callback-secret'
  }, {
    method: 'POST', url: '/v1/manufacturer/robot/ack',
    headers: { 'X-Manufacturer-Api-Key': 'legacy-callback-secret' },
    body: { action_id: '22222222-2222-4222-8222-222222222222', binding_epoch: 2, ok: true }
  });
  assert.equal(legacyAccepted.status, 204);
  assert.deepEqual(acknowledgements[1].context, { adapterId: 'manufacturer-default', bindingEpoch: 2 });

  const ambiguous = await invoke({
    robotAdapterRuntime,
    actionGateway,
    manufacturerApiKey: 'legacy-callback-secret'
  }, {
    method: 'POST', url: '/v1/manufacturer/robot/ack',
    headers: {
      'X-Robot-Adapter-Id': 'edge-deployment-1',
      'X-Robot-Callback-Key': 'edge-callback-secret',
      'X-Manufacturer-Api-Key': 'legacy-callback-secret'
    },
    body: { action_id: '33333333-3333-4333-8333-333333333333', binding_epoch: 5, ok: true }
  });
  assert.equal(ambiguous.status, 401);
});
