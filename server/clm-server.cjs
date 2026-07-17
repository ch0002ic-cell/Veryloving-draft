'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const {
  profileFromClaims,
  signRefreshJWT,
  signSessionJWT,
  verifyProviderIdentityToken,
  verifyRefreshJWT,
  verifySessionJWT
} = require('./auth-session.cjs');
const {
  PHONE_AUTH_CODES,
  PhoneAuthError,
  phoneSubject,
  startPhoneVerification,
  validatePhoneAuthConfig,
  verifyPhoneVerification
} = require('./phone-auth.cjs');
const { createDynamoSafetyRepository, handleSafetyAPI } = require('./safety-api.cjs');
const {
  ActionGateway,
  createDynamoActionOutboxRepository,
  deriveEd25519PublicKey,
  parseWearableCommandPayloads
} = require('./action-gateway.cjs');
const { createDynamoRobotRepository, pairRobot } = require('./robot-pairing.cjs');
const { createManufacturerPairingVerifier, createManufacturerRobotStatusClient } = require('./manufacturer-client.cjs');
const { createDynamoPushRepository, createExpoPushNotifier, validatePushToken } = require('./push-notifications.cjs');
const { ACTION_TOOL_SCHEMAS } = require('./device-action-tools.cjs');
const {
  SAFETY_SYSTEM_PROMPT,
  createLocalCompanionResponse,
  getSafetyTips,
  hasImmediateDanger,
  inferScenario,
  latestToolResult,
  latestUserText,
  responseForToolResult,
  shouldRequestSafetyTips
} = require('./safety-companion.cjs');

const MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_PORT = 8787;
const HUME_API_BASE_URL = 'https://api.hume.ai';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envConfig(overrides = {}) {
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    // This switch is code-owned rather than environment-owned. Only the
    // Vercel entrypoint disables raw WebSocket gateway validation; container
    // deployments keep the complete voice configuration fail-closed.
    httpOnlyDeployment: false,
    clmBearerToken: process.env.HUME_CLM_BEARER_TOKEN || '',
    humeApiKey: process.env.HUME_API_KEY || '',
    humeConfigId: process.env.HUME_CONFIG_ID || '',
    humeAllowedVoiceIds: process.env.HUME_ALLOWED_VOICE_IDS || '',
    humeAllowClientResume: process.env.HUME_ALLOW_CLIENT_RESUME === 'true',
    appAuthVerifyURL: process.env.APP_AUTH_VERIFY_URL || '',
    authExchangeEnabled: process.env.AUTH_EXCHANGE_ENABLED === 'true',
    phoneAuthEnabled: process.env.PHONE_AUTH_ENABLED === 'true',
    sessionJWTSecret: process.env.SESSION_JWT_SECRET || '',
    sessionJWTIssuer: process.env.SESSION_JWT_ISSUER || 'https://api.veryloving.ai',
    sessionJWTAudience: process.env.SESSION_JWT_AUDIENCE || 'veryloving-mobile',
    sessionJWTTTLSeconds: positiveNumber(process.env.SESSION_JWT_TTL_SECONDS, 3600),
    sessionJWTRefreshTTLSeconds: positiveNumber(process.env.SESSION_REFRESH_TTL_SECONDS, 30 * 86400),
    appleClientIds: process.env.APPLE_CLIENT_IDS || '',
    googleTokenAudiences: process.env.GOOGLE_TOKEN_AUDIENCES || '',
    googleAuthorizedParties: process.env.GOOGLE_AUTHORIZED_PARTIES || '',
    phoneAuthChallengeSecret: process.env.PHONE_AUTH_CHALLENGE_SECRET || '',
    phoneAuthSubjectSecret: process.env.PHONE_AUTH_SUBJECT_SECRET || '',
    phoneAuthChallengeTTLSeconds: positiveNumber(process.env.PHONE_AUTH_CHALLENGE_TTL_SECONDS, 300),
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
    twilioVerifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || '',
    safetyApiEnabled: process.env.SAFETY_API_ENABLED === 'true',
    safetyTableName: process.env.SAFETY_TABLE_NAME || '',
    safetyRetentionDays: Math.min(365, positiveNumber(process.env.SAFETY_RETENTION_DAYS, 30)),
    awsRegion: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '',
    deviceTableName: process.env.DEVICE_TABLE_NAME || process.env.SAFETY_TABLE_NAME || '',
    actionSigningPrivateKey: process.env.ACTION_SIGNING_PRIVATE_KEY || '',
    actionSigningPublicKey: process.env.ACTION_SIGNING_PUBLIC_KEY || '',
    wearableCommandPayloads: process.env.WEARABLE_COMMAND_PAYLOADS_JSON || '',
    manufacturerWebhookURL: process.env.MANUFACTURER_WEBHOOK_URL || '',
    manufacturerPairingVerifyURL: process.env.MANUFACTURER_PAIRING_VERIFY_URL || '',
    manufacturerStatusURL: process.env.MANUFACTURER_STATUS_URL || '',
    manufacturerApiKey: process.env.MANUFACTURER_API_KEY || '',
    actionRequestTimeoutMs: positiveNumber(process.env.ACTION_REQUEST_TIMEOUT_MS, 5000),
    robotAckTimeoutMs: positiveNumber(process.env.ROBOT_ACK_TIMEOUT_MS, 30000),
    wearableAckTimeoutMs: positiveNumber(process.env.WEARABLE_ACK_TIMEOUT_MS, 5000),
    upstreamURL: process.env.CLM_UPSTREAM_URL || '',
    upstreamApiKey: process.env.CLM_UPSTREAM_API_KEY || '',
    upstreamModel: process.env.CLM_UPSTREAM_MODEL || '',
    upstreamTimeoutMs: positiveNumber(process.env.CLM_UPSTREAM_TIMEOUT_MS, 25000),
    fetchImpl: globalThis.fetch,
    logger: console,
    ...overrides
  };
}

function validateServerURL(value, name, { production = false } = {}) {
  if (!value) return;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${name} must use HTTP or HTTPS`);
  if (production && parsed.protocol !== 'https:') throw new Error(`${name} must use HTTPS in production`);
  if (parsed.username || parsed.password) throw new Error(`${name} must not contain embedded credentials`);
  if ([...parsed.searchParams.keys()].some((key) => /token|secret|password|api[_-]?key/i.test(key))) {
    throw new Error(`${name} must not contain credential query parameters`);
  }
}

function validateServerConfig(config) {
  const production = config.nodeEnv === 'production';
  const voiceGatewayRequired = config.httpOnlyDeployment !== true;
  validateServerURL(config.appAuthVerifyURL, 'APP_AUTH_VERIFY_URL', { production });
  validateServerURL(config.upstreamURL, 'CLM_UPSTREAM_URL', { production });
  validateServerURL(config.manufacturerWebhookURL, 'MANUFACTURER_WEBHOOK_URL', { production });
  validateServerURL(config.manufacturerPairingVerifyURL, 'MANUFACTURER_PAIRING_VERIFY_URL', { production });
  validateServerURL(config.manufacturerStatusURL, 'MANUFACTURER_STATUS_URL', { production });
  if (production) {
    if (!config.authExchangeEnabled) throw new Error('AUTH_EXCHANGE_ENABLED must be true in production');
    if (!config.phoneAuthEnabled) throw new Error('PHONE_AUTH_ENABLED must be true in production');
    if (!config.safetyApiEnabled) throw new Error('SAFETY_API_ENABLED must be true in production');
    if (!config.appleClientIds || !config.googleTokenAudiences || !config.googleAuthorizedParties) {
      throw new Error(
        'APPLE_CLIENT_IDS, GOOGLE_TOKEN_AUDIENCES, and GOOGLE_AUTHORIZED_PARTIES are required in production'
      );
    }
    if (voiceGatewayRequired) {
      if (!config.humeApiKey || !config.humeConfigId || !config.clmBearerToken) {
        throw new Error('HUME_API_KEY, HUME_CONFIG_ID, and HUME_CLM_BEARER_TOKEN are required in production');
      }
      if (!config.humeAllowedVoiceIds) throw new Error('HUME_ALLOWED_VOICE_IDS is required in production');
      if (!UUID_PATTERN.test(config.humeConfigId)) {
        throw new Error('HUME_CONFIG_ID must be a canonical UUID in production');
      }
      const allowedVoiceIds = String(config.humeAllowedVoiceIds)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (allowedVoiceIds.length === 0 || allowedVoiceIds.some((value) => !UUID_PATTERN.test(value))) {
        throw new Error('HUME_ALLOWED_VOICE_IDS must contain only canonical UUIDs in production');
      }
      if (config.humeAllowClientResume) {
        throw new Error('HUME_ALLOW_CLIENT_RESUME must remain false until chat ownership is enforced');
      }
    }
  }
  if (config.authExchangeEnabled) {
    if (typeof config.sessionJWTSecret !== 'string' || config.sessionJWTSecret.length < 32) {
      throw new Error('SESSION_JWT_SECRET must contain at least 32 characters when auth exchange is enabled');
    }
    if (!config.appleClientIds && !config.googleTokenAudiences) {
      throw new Error('At least one provider token audience must be configured when auth exchange is enabled');
    }
    if (config.googleTokenAudiences && !config.googleAuthorizedParties) {
      throw new Error('GOOGLE_AUTHORIZED_PARTIES is required when Google auth exchange is enabled');
    }
  }
  validatePhoneAuthConfig(config);
  if (config.safetyApiEnabled && !config.safetyRepository && !config.safetyTableName) {
    throw new Error('SAFETY_TABLE_NAME is required when the safety API is enabled');
  }
  if (config.safetyApiEnabled) {
    if (!config.authExchangeEnabled && !config.phoneAuthEnabled) {
      throw new Error('Authentication must be enabled when the safety API is enabled');
    }
    if (typeof config.sessionJWTSecret !== 'string' || config.sessionJWTSecret.length < 32) {
      throw new Error('SESSION_JWT_SECRET is required when the safety API is enabled');
    }
  }
  const actionRoutingConfigured = Boolean(config.actionSigningPrivateKey || config.actionSigningPublicKey || config.manufacturerWebhookURL || config.wearableCommandPayloads);
  if (actionRoutingConfigured) {
    let derivedPublicKey;
    try { derivedPublicKey = deriveEd25519PublicKey(config.actionSigningPrivateKey); } catch (error) {
      throw new Error(error.message);
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(config.actionSigningPublicKey || '') || !safeEqual(derivedPublicKey, config.actionSigningPublicKey)) {
      throw new Error('ACTION_SIGNING_PUBLIC_KEY must match ACTION_SIGNING_PRIVATE_KEY');
    }
    const payloads = parseWearableCommandPayloads(config.wearableCommandPayloads);
    if (!['deploy_barrier', 'emit_alarm', 'trigger_sos'].every((action) => payloads[action])) {
      throw new Error('WEARABLE_COMMAND_PAYLOADS_JSON must configure every wearable action');
    }
  }
  if (production && voiceGatewayRequired && !actionRoutingConfigured) {
    throw new Error('Production voice gateway requires dual-device action routing');
  }
  if (production && actionRoutingConfigured && (!config.manufacturerWebhookURL || !config.manufacturerPairingVerifyURL || !config.manufacturerStatusURL || !config.manufacturerApiKey || !config.deviceTableName)) {
    throw new Error('MANUFACTURER_WEBHOOK_URL, MANUFACTURER_PAIRING_VERIFY_URL, MANUFACTURER_STATUS_URL, MANUFACTURER_API_KEY, and DEVICE_TABLE_NAME are required for production action routing');
  }
  return config;
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function bearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return match?.[1] || '';
}

async function readJson(req) {
  const contentType = req.headers['content-type'];
  const mediaType = typeof contentType === 'string'
    ? contentType.split(';', 1)[0].trim().toLowerCase()
    : '';
  const jsonMediaType = mediaType === 'application/json'
    || /^application\/[!#$%&'*+.^_`|~0-9a-z-]+\+json$/.test(mediaType);
  if (!jsonMediaType) {
    const error = new Error('Content-Type must be application/json');
    error.statusCode = 415;
    throw error;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(bytes);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.statusCode = 400;
    throw error;
  }
}

function openSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
}

function writeSSE(res, data) {
  res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
}

function baseChunk(model, sessionId, id) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    system_fingerprint: sessionId || null
  };
}

function streamTextCompletion(res, { text, model, sessionId }) {
  openSSE(res);
  const id = `chatcmpl_${crypto.randomUUID().replaceAll('-', '')}`;
  writeSSE(res, { ...baseChunk(model, sessionId, id), choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
  const chunks = [];
  for (let index = 0; index < text.length; index += 100) chunks.push(text.slice(index, index + 100));
  for (const content of chunks) {
    writeSSE(res, { ...baseChunk(model, sessionId, id), choices: [{ index: 0, delta: { content }, finish_reason: null }] });
  }
  writeSSE(res, { ...baseChunk(model, sessionId, id), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  writeSSE(res, '[DONE]');
  res.end();
}

function streamToolCall(res, { model, sessionId, scenario }) {
  openSSE(res);
  const id = `chatcmpl_${crypto.randomUUID().replaceAll('-', '')}`;
  const toolCallId = `call_${crypto.randomUUID().replaceAll('-', '')}`;
  writeSSE(res, {
    ...baseChunk(model, sessionId, id),
    choices: [{
      index: 0,
      delta: {
        role: 'assistant',
        tool_calls: [{
          index: 0,
          id: toolCallId,
          type: 'function',
          function: { name: 'get_safety_tips', arguments: JSON.stringify({ scenario }) }
        }]
      },
      finish_reason: null
    }]
  });
  writeSSE(res, { ...baseChunk(model, sessionId, id), choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  writeSSE(res, '[DONE]');
  res.end();
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-100).flatMap((message) => {
    const role = message?.role || message?.message?.role;
    const content = typeof message?.content === 'string' ? message.content : message?.message?.content;
    if (!role || (typeof content !== 'string' && !message?.tool_calls)) return [];
    const normalized = { role, content: typeof content === 'string' ? content.slice(0, 12000) : null };
    if (message.name) normalized.name = message.name;
    if (message.tool_call_id) normalized.tool_call_id = message.tool_call_id;
    if (Array.isArray(message.tool_calls)) normalized.tool_calls = message.tool_calls;
    return [normalized];
  });
}

function hasSafetyTool(tools) {
  return Array.isArray(tools) && tools.some((tool) => tool?.function?.name === 'get_safety_tips' || tool?.name === 'get_safety_tips');
}

function sessionHash(sessionId) {
  return sessionId ? crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 12) : 'none';
}

async function pipeUpstreamSSE(upstreamResponse, res, sessionId) {
  openSSE(res);
  const reader = upstreamResponse.body?.getReader();
  if (!reader) throw new Error('Upstream response did not provide a readable stream');
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;

  const writeEvent = (event) => {
    const dataLines = event.split(/\r?\n/).filter((line) => line.startsWith('data:'));
    if (!dataLines.length) return;
    const rawData = dataLines.map((line) => line.slice(5).trimStart()).join('\n');
    if (rawData === '[DONE]') {
      sawDone = true;
      writeSSE(res, '[DONE]');
      return;
    }
    try {
      const payload = JSON.parse(rawData);
      payload.system_fingerprint = sessionId || null;
      writeSSE(res, payload);
    } catch {
      // Ignore malformed upstream events instead of forwarding untrusted bytes.
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';
    events.forEach(writeEvent);
    if (done) break;
  }
  if (buffer.trim()) writeEvent(buffer);
  if (!sawDone) writeSSE(res, '[DONE]');
  res.end();
}

async function callUpstream(body, config, res, sessionId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, config.upstreamTimeoutMs || 25000));
  const normalizedMessages = normalizeMessages(body.messages);
  const priorSystem = normalizedMessages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
  const messages = [
    { role: 'system', content: priorSystem ? `${SAFETY_SYSTEM_PROMPT}\n\nAdditional configured context:\n${priorSystem}` : SAFETY_SYSTEM_PROMPT },
    ...normalizedMessages.filter((message) => message.role !== 'system')
  ];
  const requestBody = {
    model: config.upstreamModel,
    messages,
    stream: true,
    temperature: 0.35,
    parallel_tool_calls: true
  };
  if (Array.isArray(body.tools)) requestBody.tools = body.tools;
  if (body.tool_choice) requestBody.tool_choice = body.tool_choice;

  try {
    const response = await config.fetchImpl(config.upstreamURL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.upstreamApiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`);
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      const payload = await response.json();
      const text = payload?.choices?.[0]?.message?.content;
      if (!text) throw new Error('Upstream returned no assistant content');
      streamTextCompletion(res, { text, model: config.upstreamModel, sessionId });
      return;
    }
    await pipeUpstreamSSE(response, res, sessionId);
  } finally {
    clearTimeout(timeout);
  }
}

async function authenticateApp(req, config) {
  const token = bearerToken(req);
  if (!token) return false;
  const session = verifySessionJWT(token, config);
  if (session) return session;
  if (typeof config.verifyAppToken === 'function') {
    const verified = await config.verifyAppToken(token);
    if (!verified) return false;
    return typeof verified === 'object' ? verified : { sub: null, externallyVerified: true };
  }
  if (config.appAuthVerifyURL) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await config.fetchImpl(config.appAuthVerifyURL, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });
      if (!response.ok || typeof response.json !== 'function') return false;
      const claims = await response.json();
      return claims && typeof claims.sub === 'string' && claims.sub ? claims : false;
    } finally {
      clearTimeout(timeout);
    }
  }
  return false;
}

function appAuthConfigured(config) {
  return (typeof config.sessionJWTSecret === 'string' && config.sessionJWTSecret.length >= 32)
    || typeof config.verifyAppToken === 'function'
    || Boolean(config.appAuthVerifyURL);
}

async function exchangeIdentity(body, config) {
  const provider = body?.provider;
  const idToken = body?.idToken;
  const nonce = body?.nonce;
  if (!['apple', 'google'].includes(provider) || typeof idToken !== 'string' || !idToken) {
    const error = new Error('provider and idToken are required');
    error.statusCode = 400;
    throw error;
  }
  if (nonce !== undefined && (typeof nonce !== 'string' || nonce.length > 256)) {
    const error = new Error('nonce is invalid');
    error.statusCode = 400;
    throw error;
  }
  if (provider === 'apple' && (typeof nonce !== 'string' || nonce.length < 32)) {
    const error = new Error('nonce is required for Apple authentication');
    error.statusCode = 400;
    throw error;
  }
  let claims;
  try {
    claims = typeof config.verifyProviderToken === 'function'
      ? await config.verifyProviderToken({ provider, idToken, nonce })
      : await verifyProviderIdentityToken({ provider, idToken, nonce }, {
        appleClientIds: config.appleClientIds,
        googleTokenAudiences: config.googleTokenAudiences,
        googleAuthorizedParties: config.googleAuthorizedParties,
        fetchImpl: config.fetchImpl
      });
  } catch {
    const error = new Error('Identity token verification failed');
    error.statusCode = 401;
    throw error;
  }
  if (!claims?.sub) {
    const error = new Error('Identity token verification failed');
    error.statusCode = 401;
    throw error;
  }
  const user = profileFromClaims(provider, claims, body?.displayName);
  const session = signSessionJWT({ provider, subject: claims.sub }, config);
  const refresh = signRefreshJWT({
    subject: session.payload.sub,
    sessionId: session.payload.sid
  }, config);
  return {
    accessToken: session.token,
    expiresAt: session.payload.exp * 1000,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.payload.exp * 1000,
    user
  };
}

async function verifyPhoneIdentity(body, config) {
  const claims = await verifyPhoneVerification(body, config);
  const subject = `phone:${phoneSubject(claims.phone, config.phoneAuthSubjectSecret)}`;
  const session = signSessionJWT({ subjectClaim: subject }, config);
  const refresh = signRefreshJWT({
    subject: session.payload.sub,
    sessionId: session.payload.sid
  }, config);
  return {
    accessToken: session.token,
    expiresAt: session.payload.exp * 1000,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.payload.exp * 1000,
    user: {
      id: subject,
      name: null,
      phone: claims.phone,
      countryCode: claims.countryCode,
      provider: 'phone'
    }
  };
}

function refreshIdentity(body, config) {
  const claims = verifyRefreshJWT(body?.refreshToken, config);
  if (!claims) {
    const error = new Error('Refresh session is invalid or expired');
    error.statusCode = 401;
    throw error;
  }
  const session = signSessionJWT({
    subjectClaim: claims.sub,
    sessionId: claims.sid
  }, config);
  const refresh = signRefreshJWT({ subject: claims.sub, sessionId: claims.sid }, config);
  return {
    accessToken: session.token,
    expiresAt: session.payload.exp * 1000,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.payload.exp * 1000
  };
}

async function configureHumeSession(chatId, config) {
  if (!config.humeApiKey || !config.clmBearerToken) throw new Error('Hume control-plane secrets are not configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await config.fetchImpl(`${HUME_API_BASE_URL}/v0/evi/chat/${encodeURIComponent(chatId)}/send`, {
      method: 'POST',
      headers: {
        'X-Hume-Api-Key': config.humeApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ type: 'session_settings', language_model_api_key: config.clmBearerToken }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Hume control plane returned HTTP ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

function prepareDeviceServices(config) {
  if (!config.robotRepository && config.deviceTableName) {
    config.robotRepository = createDynamoRobotRepository({ tableName: config.deviceTableName, region: config.awsRegion });
  }
  if (!config.pushRepository && config.deviceTableName) {
    config.pushRepository = createDynamoPushRepository({ tableName: config.deviceTableName, region: config.awsRegion });
  }
  if (!config.verifyRobotPairingCode && config.manufacturerPairingVerifyURL && config.manufacturerApiKey) {
    config.verifyRobotPairingCode = createManufacturerPairingVerifier({
      url: config.manufacturerPairingVerifyURL,
      apiKey: config.manufacturerApiKey,
      fetchImpl: config.fetchImpl,
      timeoutMs: config.actionRequestTimeoutMs
    });
  }
  if (!config.getManufacturerRobotStatus && config.manufacturerStatusURL && config.manufacturerApiKey) {
    config.getManufacturerRobotStatus = createManufacturerRobotStatusClient({
      url: config.manufacturerStatusURL,
      apiKey: config.manufacturerApiKey,
      fetchImpl: config.fetchImpl,
      timeoutMs: config.actionRequestTimeoutMs
    });
  }
  if (!config.notifyUser && config.pushRepository) {
    config.notifyUser = createExpoPushNotifier({
      repository: config.pushRepository,
      fetchImpl: config.fetchImpl,
      timeoutMs: config.actionRequestTimeoutMs
    });
  }
  if (!config.actionOutboxRepository && config.deviceTableName && config.actionSigningPrivateKey) {
    config.actionOutboxRepository = createDynamoActionOutboxRepository({
      tableName: config.deviceTableName,
      region: config.awsRegion
    });
  }
  if (!config.actionGateway && config.actionSigningPrivateKey) {
    config.actionGateway = new ActionGateway({
      signingPrivateKey: config.actionSigningPrivateKey,
      wearableCommandPayloads: config.wearableCommandPayloads,
      manufacturerWebhookURL: config.manufacturerWebhookURL,
      manufacturerApiKey: config.manufacturerApiKey,
      fetchImpl: config.fetchImpl,
      requestTimeoutMs: config.actionRequestTimeoutMs,
      robotAckTimeoutMs: config.robotAckTimeoutMs,
      wearableAckTimeoutMs: config.wearableAckTimeoutMs,
      notifyUser: config.notifyUser,
      authorizeDevice: config.robotRepository?.owns ? (userId, deviceId) => config.robotRepository.owns(userId, deviceId) : undefined,
      resolveManufacturerDeviceId: config.robotRepository?.resolveManufacturerDeviceId
        ? (userId, deviceId) => config.robotRepository.resolveManufacturerDeviceId(userId, deviceId)
        : undefined,
      getDeviceStatus: config.getManufacturerRobotStatus,
      outboxRepository: config.actionOutboxRepository,
      logger: config.logger
    });
  }
  if (config.actionGateway?.recoverPendingCommands && !config.actionRecoveryPromise) {
    config.actionRecoveryPromise = config.actionGateway.recoverPendingCommands();
    config.actionRecoveryPromise.catch(() => {});
  }
  return config;
}

function createHandler(overrides = {}) {
  const config = prepareDeviceServices(validateServerConfig(envConfig(overrides)));
  if (config.safetyApiEnabled && !config.safetyRepository) {
    config.safetyRepository = createDynamoSafetyRepository({
      tableName: config.safetyTableName,
      region: config.awsRegion
    });
  }
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, { status: 'ok', service: 'veryloving-hume-clm' });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/chat/completions') {
        if (!config.clmBearerToken) {
          json(res, 503, { error: 'CLM authentication is not configured' });
          return;
        }
        if (!safeEqual(bearerToken(req), config.clmBearerToken)) {
          json(res, 401, { error: 'Unauthorized' });
          return;
        }
        const body = await readJson(req);
        if (!Array.isArray(body.messages)) {
          json(res, 400, { error: 'messages must be an array' });
          return;
        }
        const sessionId = url.searchParams.get('custom_session_id') || '';
        const model = body.model || 'veryloving-safety-clm';
        config.logger.info('[VeryLovingCLM] completion', { session: sessionHash(sessionId), messages: body.messages.length });

        const toolResult = latestToolResult(body.messages);
        const userText = latestUserText(body.messages);
        if (toolResult) {
          streamTextCompletion(res, { text: responseForToolResult(toolResult), model, sessionId });
          return;
        }
        if (hasImmediateDanger(userText)) {
          streamTextCompletion(res, { text: createLocalCompanionResponse(body.messages), model, sessionId });
          return;
        }
        if (shouldRequestSafetyTips(userText) && hasSafetyTool(body.tools)) {
          streamToolCall(res, { model, sessionId, scenario: inferScenario(userText) });
          return;
        }
        if (config.upstreamURL && config.upstreamApiKey && config.upstreamModel) {
          try {
            await callUpstream(body, config, res, sessionId);
            return;
          } catch (error) {
            config.logger.error('[VeryLovingCLM] upstream unavailable', { name: error.name });
            if (res.headersSent) {
              writeSSE(res, '[DONE]');
              res.end();
              return;
            }
          }
        }
        streamTextCompletion(res, { text: createLocalCompanionResponse(body.messages), model, sessionId });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/auth/exchange') {
        if (!config.authExchangeEnabled) {
          json(res, 503, { error: 'Production authentication is not configured' });
          return;
        }
        const body = await readJson(req);
        json(res, 200, await exchangeIdentity(body, config));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/auth/phone/start') {
        if (!config.phoneAuthEnabled) {
          json(res, 503, {
            error: 'Phone authentication is not configured',
            code: PHONE_AUTH_CODES.NOT_CONFIGURED
          });
          return;
        }
        const body = await readJson(req);
        json(res, 202, await startPhoneVerification(body, config));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/auth/phone/verify') {
        if (!config.phoneAuthEnabled) {
          json(res, 503, {
            error: 'Phone authentication is not configured',
            code: PHONE_AUTH_CODES.NOT_CONFIGURED
          });
          return;
        }
        const body = await readJson(req);
        json(res, 200, await verifyPhoneIdentity(body, config));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/auth/refresh') {
        if (!config.authExchangeEnabled && !config.phoneAuthEnabled) {
          json(res, 503, { error: 'Production authentication is not configured' });
          return;
        }
        const body = await readJson(req);
        json(res, 200, refreshIdentity(body, config));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/device-actions') {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        if (config.httpOnlyDeployment === true) { json(res, 503, { error: 'Device actions require the authenticated voice gateway' }); return; }
        if (!config.actionGateway) { json(res, 503, { error: 'Action gateway is not configured' }); return; }
        json(res, 202, await config.actionGateway.route(principal.sub, await readJson(req)));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/manufacturer/robot/ack') {
        if (!config.actionGateway || !config.manufacturerApiKey || !safeEqual(req.headers['x-manufacturer-api-key'] || '', config.manufacturerApiKey)) {
          json(res, 401, { error: 'Unauthorized' }); return;
        }
        const body = await readJson(req);
        const accepted = await config.actionGateway.acknowledgeRobot(body.action_id, {
          ok: body.ok,
          error_code: body.error_code
        });
        if (!accepted) { json(res, 404, { error: 'Action acknowledgement was not found' }); return; }
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/devices/home-robots') {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        if (!config.robotRepository?.list) { json(res, 503, { error: 'Robot registry is not configured' }); return; }
        json(res, 200, { devices: await config.robotRepository.list(principal.sub) });
        return;
      }

      const robotTelemetryMatch = /^\/v1\/devices\/([^/]{1,384})\/telemetry$/.exec(url.pathname);
      if (req.method === 'GET' && robotTelemetryMatch) {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        let robotId;
        try { robotId = decodeURIComponent(robotTelemetryMatch[1]); } catch { robotId = ''; }
        if (!/^[A-Za-z0-9._:-]{1,128}$/.test(robotId)) { json(res, 400, { error: 'Robot identifier is invalid' }); return; }
        let manufacturerDeviceId = robotId;
        if (config.robotRepository?.resolveManufacturerDeviceId) {
          manufacturerDeviceId = await config.robotRepository.resolveManufacturerDeviceId(principal.sub, robotId);
          if (!/^[A-Za-z0-9._:-]{1,128}$/.test(manufacturerDeviceId || '')) {
            json(res, 404, { error: 'Robot was not found' }); return;
          }
        } else if (!config.robotRepository?.owns || !await config.robotRepository.owns(principal.sub, robotId)) {
          json(res, 404, { error: 'Robot was not found' }); return;
        }
        if (!config.getManufacturerRobotStatus) { json(res, 503, { error: 'Robot telemetry is not configured' }); return; }
        json(res, 200, await config.getManufacturerRobotStatus(manufacturerDeviceId));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/devices/home-robots/pair') {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        if (!config.robotRepository || typeof config.verifyRobotPairingCode !== 'function') {
          json(res, 503, { error: 'Robot pairing is not configured' }); return;
        }
        const body = await readJson(req);
        json(res, 201, await pairRobot({ userId: principal.sub, qrCode: body.qr_code, verifier: config.verifyRobotPairingCode, repository: config.robotRepository, logger: config.logger }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/devices/push-token') {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        if (!config.pushRepository) { json(res, 503, { error: 'Push registration is not configured' }); return; }
        const body = await readJson(req);
        await config.pushRepository.register(principal.sub, validatePushToken(body.token));
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      if (
        url.pathname === '/v1/emergency-contacts'
        || url.pathname.startsWith('/v1/emergency-contacts/')
        || url.pathname === '/v1/sos-events'
        || url.pathname.startsWith('/v1/safety-sessions')
        || url.pathname.startsWith('/v1/privacy/')
      ) {
        if (!config.safetyApiEnabled) {
          json(res, 503, { error: 'The production safety API is not configured' });
          return;
        }
        const principal = await authenticateApp(req, config);
        const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : {};
        if (await handleSafetyAPI({
          req,
          res,
          url,
          body,
          principal,
          repository: config.safetyRepository,
          retentionDays: config.safetyRetentionDays,
          json
        })) return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/safety/tips') {
        if (!appAuthConfigured(config)) {
          json(res, 503, { error: 'Application authentication is not configured' });
          return;
        }
        if (!await authenticateApp(req, config)) {
          json(res, 401, { error: 'Unauthorized' });
          return;
        }
        const body = await readJson(req);
        json(res, 200, getSafetyTips(body.scenario));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/hume/session/configure') {
        if (config.nodeEnv === 'production') {
          json(res, 410, { error: 'Voice sessions are configured by the authenticated gateway' });
          return;
        }
        if (!appAuthConfigured(config)) {
          json(res, 503, { error: 'Application authentication is not configured' });
          return;
        }
        if (!await authenticateApp(req, config)) {
          json(res, 401, { error: 'Unauthorized' });
          return;
        }
        const body = await readJson(req);
        if (!UUID_PATTERN.test(body.chatId || '')) {
          json(res, 400, { error: 'chatId must be a UUID' });
          return;
        }
        await configureHumeSession(body.chatId, config);
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      json(res, 404, { error: 'Not found' });
    } catch (error) {
      config.logger.error('[VeryLovingCLM] request failed', {
        path: url.pathname,
        name: error.name,
        ...(error instanceof PhoneAuthError ? { code: error.code } : {})
      });
      if (!res.headersSent) {
        const phoneRequest = url.pathname.startsWith('/v1/auth/phone/');
        const statusCode = error.statusCode || 500;
        const payload = { error: error.statusCode ? error.message : 'Internal server error' };
        if (phoneRequest) {
          payload.code = error instanceof PhoneAuthError
            ? error.code
            : (error.statusCode ? PHONE_AUTH_CODES.INVALID : PHONE_AUTH_CODES.PROVIDER_UNAVAILABLE);
        }
        json(res, statusCode, payload);
      }
      else res.end();
    }
  };
}

function createVeryLovingCLMServer(options = {}) {
  const { attachVoiceGateway } = require('./voice-gateway.cjs');
  const config = prepareDeviceServices(validateServerConfig(envConfig(options)));
  const server = http.createServer(createHandler(config));
  attachVoiceGateway(server, config);
  server.requestTimeout = 35000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  createVeryLovingCLMServer().listen(port, () => console.log(`[VeryLovingCLM] listening on ${port}`));
}

module.exports = {
  ACTION_TOOL_SCHEMAS,
  createHandler,
  createVeryLovingCLMServer,
  envConfig,
  exchangeIdentity,
  verifyPhoneIdentity,
  refreshIdentity,
  normalizeMessages,
  safeEqual,
  validateServerConfig,
  validateServerURL,
  streamTextCompletion,
  streamToolCall
};
