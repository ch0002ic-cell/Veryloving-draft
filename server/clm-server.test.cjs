'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const { createHandler, validateServerConfig } = require('./clm-server.cjs');
const { SAFETY_SYSTEM_PROMPT, getSafetyTips, inferScenario } = require('./safety-companion.cjs');
const { signSessionJWT, verifySessionJWT } = require('./auth-session.cjs');

const silentLogger = { info() {}, warn() {}, error() {} };
const VALID_HUME_CONFIG_ID = '11111111-1111-4111-8111-111111111111';
const VALID_HUME_VOICE_ID = '22222222-2222-4222-8222-222222222222';
const ACTION_KEY_PAIR = crypto.generateKeyPairSync('ed25519');
const ACTION_SIGNING_PRIVATE_KEY = ACTION_KEY_PAIR.privateKey.export({ format: 'pem', type: 'pkcs8' });
const ACTION_SIGNING_PUBLIC_KEY = ACTION_KEY_PAIR.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');

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
    getAccountDeletionState: async () => 'active'
  };
  const safetyRepository = {
    listContacts: async () => [],
    createContact: async (_userId, contact) => contact,
    updateContact: async (_userId, _contactId, contact) => contact,
    deleteContact: async () => undefined,
    acceptSOS: async (_userId, event) => event,
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
    register: async () => undefined,
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

async function invoke(options, { method = 'GET', url = '/', headers = {}, body, rawBody } = {}) {
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
  await createHandler({ logger: silentLogger, ...options })(req, res);
  const text = Buffer.concat(chunks).toString('utf8');
  const contentType = res.headers['Content-Type'] || res.headers['content-type'] || '';
  return {
    status: res.statusCode,
    headers: res.headers,
    text,
    json: text && contentType.includes('application/json') ? JSON.parse(text) : null
  };
}

test('health endpoint reports the CLM service', async () => {
  const response = await invoke({}, { url: '/health' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { status: 'ok', service: 'veryloving-hume-clm' });
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
    wearableCommandPayloads: JSON.stringify({ deploy_barrier: 'AQ==', emit_alarm: 'Ag==', trigger_sos: 'Aw==', stop: 'BA==' }),
    manufacturerWebhookURL: 'https://manufacturer.example.test/v1/commands',
    manufacturerPairingVerifyURL: 'https://manufacturer.example.test/v1/pairing/verify',
    manufacturerStatusURL: 'https://manufacturer.example.test/v1/status',
    manufacturerResetURL: 'https://manufacturer.example.test/v1/reset',
    manufacturerApiKey: 'manufacturer-server-key',
    deviceTableName: 'veryloving-devices',
    actionOutboxUserIndexName: 'user-index'
  });
  assert.doesNotThrow(() => validateServerConfig(voiceGateway));
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
    async startSafetySession(_userId, session) { records.sessions.push(session); return session; },
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
    safetyRetentionDays: 9999,
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
  const reset = await invoke({
    verifyAppToken,
    robotRepository: {
      async verifyPairingToken(_userId, _robotId, token) { return token === 'pairing-token'; },
      async resolveManufacturerDeviceId(userId, robotId) {
        return userId === 'google:user-1' && robotId === 'robot:1' ? 'manufacturer:1' : null;
      },
      async unbind(userId, robotId) { resetCalls.push(['unbind', userId, robotId]); return { manufacturerDeviceId: 'manufacturer:1' }; }
    },
    async resetManufacturerRobot(robotId) { resetCalls.push(['reset', robotId]); }
  }, {
    method: 'DELETE',
    url: '/v1/devices/home-robots/robot%3A1',
    headers: { Authorization: 'Bearer app-session', 'X-Device-Pairing-Token': 'pairing-token' }
  });
  assert.equal(reset.status, 204);
  assert.deepEqual(resetCalls, [
    ['reset', 'manufacturer:1'],
    ['unbind', 'google:user-1', 'robot:1']
  ]);

  let unboundAfterFailure = false;
  const failedReset = await invoke({
    verifyAppToken,
    robotRepository: {
      async verifyPairingToken(_userId, _robotId, token) { return token === 'pairing-token'; },
      async resolveManufacturerDeviceId() { return 'manufacturer:1'; },
      async unbind() { unboundAfterFailure = true; }
    },
    async resetManufacturerRobot() { throw new Error('manufacturer unavailable'); }
  }, {
    method: 'DELETE',
    url: '/v1/devices/home-robots/robot%3A1',
    headers: { Authorization: 'Bearer app-session', 'X-Device-Pairing-Token': 'pairing-token' }
  });
  assert.equal(failedReset.status, 500);
  assert.equal(unboundAfterFailure, false);

  const acknowledgements = [];
  const acknowledged = await invoke({
    manufacturerApiKey: 'manufacturer-secret',
    actionGateway: {
      async acknowledgeRobot(actionId, ack) { acknowledgements.push({ actionId, ack }); return true; }
    }
  }, {
    method: 'POST',
    url: '/v1/manufacturer/robot/ack',
    headers: { 'X-Manufacturer-Api-Key': 'manufacturer-secret' },
    body: { action_id: '11111111-1111-4111-8111-111111111111', ok: true }
  });
  assert.equal(acknowledged.status, 204);
  assert.equal(acknowledgements[0].actionId, '11111111-1111-4111-8111-111111111111');

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
