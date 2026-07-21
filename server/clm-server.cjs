'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const {
  isValidAccountSubject,
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
  consumePhoneVerificationChallenge,
  phoneSubject,
  startPhoneVerification,
  validatePhoneAuthConfig,
  verifyPhoneVerification
} = require('./phone-auth.cjs');
const { createDynamoSafetyRepository, handleSafetyAPI } = require('./safety-api.cjs');
const { createPrivacyDataCoordinator } = require('./privacy-data.cjs');
const {
  createDynamoManufacturerPrivacyDeletionRepository
} = require('./manufacturer-privacy-deletion.cjs');
const { createRedactedLogger } = require('./redacted-logger.cjs');
const { readBoundedJSONResponse } = require('./bounded-response.cjs');
const {
  parseBoundedServerInteger,
  validateServerIntegerConfig
} = require('./environment-schema.cjs');
const {
  ActionGateway,
  createDynamoActionOutboxRepository,
  deriveEd25519PublicKey,
  parseWearableCommandPayloads
} = require('./action-gateway.cjs');
const { createDynamoRobotRepository, pairRobot } = require('./robot-pairing.cjs');
const { createRobotResetCoordinator } = require('./robot-reset.cjs');
const {
  createManufacturerPairingVerifier,
  createManufacturerPrivacyClient,
  createManufacturerPrivacyRepository,
  createManufacturerRobotResetClient,
  createManufacturerRobotStatusClient,
  createRoutedManufacturerPrivacyRepository
} = require('./manufacturer-client.cjs');
const {
  adapterConfigurationsFromEnv,
  createRobotAdapterRuntime
} = require('./robot-adapter-runtime.cjs');
const {
  createDynamoPushRepository,
  createEmergencyContactPushNotifier,
  createExpoPushNotifier,
  validatePushToken
} = require('./push-notifications.cjs');
const { createDynamoAuthSessionRepository } = require('./auth-session-repository.cjs');
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
const PUSH_RECEIPT_RATE_WINDOW_MS = 60 * 1000;
const PUSH_RECEIPT_RATE_LIMIT = 30;
const MAX_PUSH_RECEIPT_RATE_KEYS = 10000;
const MAX_UPSTREAM_SSE_EVENT_BYTES = 256 * 1024;
const MAX_UPSTREAM_JSON_BYTES = 256 * 1024;
const MAX_AUTH_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_PORT = 8787;
const HUME_API_BASE_URL = 'https://api.hume.ai';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROBOT_RESET_REPOSITORY_METHODS = Object.freeze([
  'beginFactoryReset',
  'claimFactoryReset',
  'markFactoryResetRemoteComplete',
  'recordFactoryResetFailure',
  'completeFactoryReset',
  'listRecoverableFactoryResets'
]);

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
    humePersonaMapJSON: process.env.HUME_PERSONA_MAP_JSON || '',
    humeDefaultPersonaId: process.env.HUME_DEFAULT_PERSONA_ID || '',
    humeAllowClientResume: process.env.HUME_ALLOW_CLIENT_RESUME === 'true',
    appAuthVerifyURL: process.env.APP_AUTH_VERIFY_URL || '',
    authExchangeEnabled: process.env.AUTH_EXCHANGE_ENABLED === 'true',
    phoneAuthEnabled: process.env.PHONE_AUTH_ENABLED === 'true',
    sessionJWTSecret: process.env.SESSION_JWT_SECRET || '',
    sessionJWTIssuer: process.env.SESSION_JWT_ISSUER || 'https://api.veryloving.ai',
    sessionJWTAudience: process.env.SESSION_JWT_AUDIENCE || 'veryloving-mobile',
    sessionJWTTTLSeconds: parseBoundedServerInteger('SESSION_JWT_TTL_SECONDS', process.env.SESSION_JWT_TTL_SECONDS),
    sessionJWTRefreshTTLSeconds: parseBoundedServerInteger('SESSION_REFRESH_TTL_SECONDS', process.env.SESSION_REFRESH_TTL_SECONDS),
    appleClientIds: process.env.APPLE_CLIENT_IDS || '',
    googleTokenAudiences: process.env.GOOGLE_TOKEN_AUDIENCES || '',
    googleAuthorizedParties: process.env.GOOGLE_AUTHORIZED_PARTIES || '',
    phoneAuthChallengeSecret: process.env.PHONE_AUTH_CHALLENGE_SECRET || '',
    phoneAuthSubjectSecret: process.env.PHONE_AUTH_SUBJECT_SECRET || '',
    phoneAuthChallengeTTLSeconds: parseBoundedServerInteger('PHONE_AUTH_CHALLENGE_TTL_SECONDS', process.env.PHONE_AUTH_CHALLENGE_TTL_SECONDS),
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
    twilioVerifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || '',
    safetyApiEnabled: process.env.SAFETY_API_ENABLED === 'true',
    aiNativeEnabled: process.env.AI_NATIVE_ENABLED === 'true',
    aiNativeDataLifecycleEnabled: process.env.AI_NATIVE_DATA_LIFECYCLE_ENABLED === 'true',
    aiNativeSingleReplica: process.env.AI_NATIVE_SINGLE_REPLICA === 'true',
    safetyTableName: process.env.SAFETY_TABLE_NAME || '',
    authSessionTableName: process.env.AUTH_SESSION_TABLE_NAME || process.env.SAFETY_TABLE_NAME || '',
    safetyRetentionDays: parseBoundedServerInteger('SAFETY_RETENTION_DAYS', process.env.SAFETY_RETENTION_DAYS),
    awsRegion: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '',
    deviceTableName: process.env.DEVICE_TABLE_NAME || process.env.SAFETY_TABLE_NAME || '',
    actionOutboxUserIndexName: process.env.ACTION_OUTBOX_USER_INDEX_NAME || '',
    robotResetRecoveryIndexName: process.env.ROBOT_RESET_RECOVERY_INDEX_NAME || '',
    actionSigningPrivateKey: process.env.ACTION_SIGNING_PRIVATE_KEY || '',
    actionSigningPublicKey: process.env.ACTION_SIGNING_PUBLIC_KEY || '',
    robotPairingTokenSecret: process.env.ROBOT_PAIRING_TOKEN_SECRET || '',
    actionGatewaySingleReplica: process.env.ACTION_GATEWAY_SINGLE_REPLICA === 'true',
    wearableCommandPayloads: process.env.WEARABLE_COMMAND_PAYLOADS_JSON || '',
    manufacturerWebhookURL: process.env.MANUFACTURER_WEBHOOK_URL || '',
    manufacturerPairingVerifyURL: process.env.MANUFACTURER_PAIRING_VERIFY_URL || '',
    manufacturerStatusURL: process.env.MANUFACTURER_STATUS_URL || '',
    manufacturerResetURL: process.env.MANUFACTURER_RESET_URL || '',
    manufacturerPrivacyExportURL: process.env.MANUFACTURER_PRIVACY_EXPORT_URL || '',
    manufacturerPrivacyDeleteURL: process.env.MANUFACTURER_PRIVACY_DELETE_URL || '',
    manufacturerApiKey: process.env.MANUFACTURER_API_KEY || '',
    robotAdapterConfigurations: adapterConfigurationsFromEnv(process.env, {
      production: (process.env.NODE_ENV || 'development') === 'production'
    }),
    actionRequestTimeoutMs: parseBoundedServerInteger('ACTION_REQUEST_TIMEOUT_MS', process.env.ACTION_REQUEST_TIMEOUT_MS),
    robotAckTimeoutMs: parseBoundedServerInteger('ROBOT_ACK_TIMEOUT_MS', process.env.ROBOT_ACK_TIMEOUT_MS),
    wearableAckTimeoutMs: parseBoundedServerInteger('WEARABLE_ACK_TIMEOUT_MS', process.env.WEARABLE_ACK_TIMEOUT_MS),
    upstreamURL: process.env.CLM_UPSTREAM_URL || '',
    upstreamApiKey: process.env.CLM_UPSTREAM_API_KEY || '',
    upstreamModel: process.env.CLM_UPSTREAM_MODEL || '',
    upstreamTimeoutMs: parseBoundedServerInteger('CLM_UPSTREAM_TIMEOUT_MS', process.env.CLM_UPSTREAM_TIMEOUT_MS),
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
  validateServerIntegerConfig(config);
  const production = config.nodeEnv === 'production';
  const voiceGatewayRequired = config.httpOnlyDeployment !== true;
  if (config.aiNativeEnabled && !config.aiNativeSystem) {
    throw new Error('AI_NATIVE_ENABLED requires an injected durable AI-native system');
  }
  if (config.aiNativeEnabled && config.aiNativeDataLifecycleEnabled !== true) {
    throw new Error('AI_NATIVE_ENABLED requires AI_NATIVE_DATA_LIFECYCLE_ENABLED=true');
  }
  if (production && config.aiNativeDataLifecycleEnabled
    && !config.aiNativeSystem
    && !config.aiNativePrivacyRepository) {
    throw new Error('AI-native data lifecycle requires an injected durable privacy repository');
  }
  if (production && config.aiNativeEnabled) {
    if (config.aiNativeSingleReplica !== true) {
      throw new Error('AI_NATIVE_SINGLE_REPLICA=true is required until distributed scenario admission leases are implemented');
    }
    if (typeof config.resolveEdgeDeviceBinding !== 'function') {
      throw new Error('AI-native wearable ingress requires an account-bound device resolver');
    }
    if (typeof config.authenticateRobotEdgeIngress !== 'function') {
      throw new Error('AI-native robot ingress requires manufacturer/device authentication');
    }
    if (typeof config.resolveScenarioDevices !== 'function') {
      throw new Error('AI-native user and voice scenarios require a server-side device resolver');
    }
    if (typeof config.authenticateScenarioIngress !== 'function') {
      throw new Error('AI-native scheduled context ingress requires service authentication');
    }
  }
  validateServerURL(config.appAuthVerifyURL, 'APP_AUTH_VERIFY_URL', { production });
  validateServerURL(config.upstreamURL, 'CLM_UPSTREAM_URL', { production });
  validateServerURL(config.manufacturerWebhookURL, 'MANUFACTURER_WEBHOOK_URL', { production });
  validateServerURL(config.manufacturerPairingVerifyURL, 'MANUFACTURER_PAIRING_VERIFY_URL', { production });
  validateServerURL(config.manufacturerStatusURL, 'MANUFACTURER_STATUS_URL', { production });
  validateServerURL(config.manufacturerResetURL, 'MANUFACTURER_RESET_URL', { production });
  validateServerURL(config.manufacturerPrivacyExportURL, 'MANUFACTURER_PRIVACY_EXPORT_URL', { production });
  validateServerURL(config.manufacturerPrivacyDeleteURL, 'MANUFACTURER_PRIVACY_DELETE_URL', { production });
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
    if (production && !config.authSessionRepository && !config.authSessionTableName) {
      throw new Error('AUTH_SESSION_TABLE_NAME is required for production refresh rotation and revocation');
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
  const vendorAdaptersConfigured = Array.isArray(config.robotAdapterConfigurations)
    && config.robotAdapterConfigurations.length > 0;
  const actionRoutingConfigured = Boolean(
    config.actionSigningPrivateKey
    || config.actionSigningPublicKey
    || config.manufacturerWebhookURL
    || config.wearableCommandPayloads
    || vendorAdaptersConfigured
  );
  if (actionRoutingConfigured) {
    let derivedPublicKey;
    try { derivedPublicKey = deriveEd25519PublicKey(config.actionSigningPrivateKey); } catch (error) {
      throw new Error(error.message);
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(config.actionSigningPublicKey || '') || !safeEqual(derivedPublicKey, config.actionSigningPublicKey)) {
      throw new Error('ACTION_SIGNING_PUBLIC_KEY must match ACTION_SIGNING_PRIVATE_KEY');
    }
    const payloads = parseWearableCommandPayloads(config.wearableCommandPayloads);
    if (!['deploy_barrier', 'emit_alarm', 'trigger_sos', 'stop'].every((action) => payloads[action])) {
      throw new Error('WEARABLE_COMMAND_PAYLOADS_JSON must configure every wearable action');
    }
  }
  if (production && voiceGatewayRequired && !actionRoutingConfigured) {
    throw new Error('Production voice gateway requires dual-device action routing');
  }
  if (production && voiceGatewayRequired && actionRoutingConfigured && config.actionGatewaySingleReplica !== true) {
    throw new Error('ACTION_GATEWAY_SINGLE_REPLICA=true is required until distributed per-device delivery leases are implemented');
  }
  const legacyManufacturerConfigured = Boolean(
    config.manufacturerWebhookURL
    && config.manufacturerPairingVerifyURL
    && config.manufacturerStatusURL
    && config.manufacturerResetURL
    && config.manufacturerApiKey
  );
  const adapterPairingConfigured = vendorAdaptersConfigured
    && config.robotAdapterConfigurations.every((entry) => entry.pairingVerifyURL);
  const adapterLifecycleConfigured = vendorAdaptersConfigured
    && config.robotAdapterConfigurations.every((entry) => (
      entry.pairingVerifyURL
      && entry.resetURL
      && entry.privacyExportURL
      && entry.privacyDeleteURL
    ));
  if ((legacyManufacturerConfigured || adapterPairingConfigured)
    && (typeof config.robotPairingTokenSecret !== 'string' || config.robotPairingTokenSecret.length < 32)) {
    throw new Error('ROBOT_PAIRING_TOKEN_SECRET must contain at least 32 characters when robot pairing is configured');
  }
  if (production && actionRoutingConfigured && (
    (!legacyManufacturerConfigured && !adapterPairingConfigured)
    || !config.deviceTableName
    || !config.actionOutboxUserIndexName
    || !config.robotResetRecoveryIndexName
  )) {
    throw new Error('A complete legacy manufacturer gateway or enabled vendor adapters with pairing URLs, plus DEVICE_TABLE_NAME, ACTION_OUTBOX_USER_INDEX_NAME, and ROBOT_RESET_RECOVERY_INDEX_NAME, is required for production action routing');
  }
  if (production && vendorAdaptersConfigured && !adapterLifecycleConfigured) {
    throw new Error('Every enabled robot adapter requires pairing, reset, privacy export, and privacy deletion URLs in production');
  }
  const legacyPrivacyConfigured = Boolean(
    config.deviceTableName
    && config.manufacturerApiKey
    && config.manufacturerPrivacyExportURL
    && config.manufacturerPrivacyDeleteURL
  );
  const adapterPrivacyConfigured = Boolean(config.deviceTableName && adapterLifecycleConfigured);
  if (
    production
    && config.safetyApiEnabled
    && !config.privacyCoordinator
    && !legacyPrivacyConfigured
    && !adapterPrivacyConfigured
  ) {
    throw new Error('Production robot privacy requires DEVICE_TABLE_NAME and either a complete legacy privacy client or complete adapter lifecycle endpoints');
  }
  return config;
}

function requireMethods(value, label, methods) {
  const missing = methods.filter((method) => typeof value?.[method] !== 'function');
  if (missing.length) throw new Error(`${label} is missing required methods: ${missing.join(', ')}`);
}

function validatePreparedServices(config) {
  if (config.nodeEnv !== 'production') return config;
  requireMethods(config.authSessionRepository, 'Production auth session repository', [
    'create', 'rotate', 'revoke', 'isActive', 'exportUserData', 'deleteUserData',
    'beginAccountDeletion', 'completeAccountDeletion', 'finalizeAccountDeletion', 'getAccountDeletionState',
    'consumePhoneChallenge'
  ]);
  requireMethods(config.safetyRepository, 'Production safety repository', [
    'listContacts', 'createContact', 'updateContact', 'deleteContact', 'acceptSOS', 'getSOS',
    'claimSOSDelivery', 'recordSOSDelivery', 'getMedicationEscalation',
    'acceptMedicationEscalation', 'claimMedicationEscalationDelivery',
    'recordMedicationEscalationDelivery',
    'startSafetySession', 'getSafetySession', 'exportUserData', 'deleteUserData'
  ]);
  requireMethods(config.privacyCoordinator, 'Production privacy coordinator', [
    'missingRepositories', 'exportUserData', 'deleteUserData'
  ]);
  requireMethods(config.pushRepository, 'Production push repository', [
    'register', 'unregister', 'unregisterByReceipt', 'list', 'exportUserData', 'deleteUserData'
  ]);
  if (config.safetyApiEnabled && typeof config.notifyEmergencyContacts !== 'function') {
    throw new Error('Production emergency-contact push delivery is not configured');
  }
  if (config.actionGateway || config.actionSigningPrivateKey) {
    requireMethods(config.robotRepository, 'Production robot repository', [
      'owns', 'resolveManufacturerDeviceId', 'resolveRobotBinding', 'list', 'listManufacturerDeviceIds',
      'listManufacturerRobotBindings', 'verifyPairingToken', 'resumeBinding', 'consumeAndBind', 'unbind',
      'beginFactoryReset', 'claimFactoryReset', 'markFactoryResetRemoteComplete',
      'recordFactoryResetFailure', 'completeFactoryReset', 'listRecoverableFactoryResets',
      'isRobotBindingActive',
      'exportUserData', 'deleteUserData'
    ]);
    requireMethods(config.actionOutboxRepository, 'Production action outbox repository', [
      'enqueue', 'markDelivering', 'markPendingAck', 'markDelivered', 'markFailed',
      'acknowledge', 'listPending', 'failPendingForBinding', 'failPendingForUser',
      'exportUserData', 'deleteUserData'
    ]);
    requireMethods(config.actionGateway, 'Production action gateway', [
      'route', 'acknowledgeRobot', 'recoverPendingCommands', 'fenceRobotBinding', 'fenceUserActions'
    ]);
    requireMethods(config.robotResetCoordinator, 'Production robot reset coordinator', [
      'requestReset', 'resume', 'recover'
    ]);
  }
  if (config.aiNativeEnabled) {
    requireMethods(config.scenarioEngine, 'Production AI-native scenario engine', [
      'startScenario', 'getExecution', 'cancelScenario'
    ]);
    requireMethods(config.edgeScenarioRouter, 'Production AI-native edge router', [
      'ingestWearableInference', 'ingestRobotInference', 'ingestContextEvent', 'confirmCancellation'
    ]);
    requireMethods(config.aiNativePrivacyRepository, 'Production AI-native privacy repository', [
      'exportUserData', 'deleteUserData'
    ]);
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

function normalizeHTTPError(error) {
  const candidate = Number(error?.statusCode);
  const statusCode = Number.isSafeInteger(candidate) && candidate >= 400 && candidate <= 599
    ? candidate
    : 500;
  if (statusCode >= 500) {
    return { statusCode, message: 'Internal server error' };
  }
  const message = typeof error?.message === 'string'
    && error.message.length > 0
    && error.message.length <= 512
    && !/[\u0000\r\n]/.test(error.message)
    ? error.message
    : 'Request could not be completed';
  return { statusCode, message };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function allowPushReceiptAttempt(rateState, req, now = Date.now()) {
  const address = String(req.socket?.remoteAddress || 'unknown').slice(0, 128);
  const current = rateState.get(address);
  if (!current || now - current.startedAt >= PUSH_RECEIPT_RATE_WINDOW_MS) {
    if (!current && rateState.size >= MAX_PUSH_RECEIPT_RATE_KEYS) {
      const oldest = rateState.keys().next().value;
      if (oldest !== undefined) rateState.delete(oldest);
    }
    rateState.delete(address);
    rateState.set(address, { startedAt: now, attempts: 1 });
    return true;
  }
  if (current.attempts >= PUSH_RECEIPT_RATE_LIMIT) return false;
  current.attempts += 1;
  return true;
}

const AI_NATIVE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function httpError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function assertExactObjectKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.has(key))) {
    throw httpError(400, 'AI_NATIVE_REQUEST_INVALID', `${label} is invalid`);
  }
}

function normalizeScenarioBinding(value, { requiredSource, sourceDeviceRef } = {}) {
  const targets = value?.targets;
  if (!targets || typeof targets !== 'object' || Array.isArray(targets)) {
    throw httpError(503, 'SCENARIO_BINDING_UNAVAILABLE', 'Scenario device binding is unavailable');
  }
  const wearableId = targets.wearableId;
  const homeRobotId = targets.homeRobotId;
  if ((wearableId !== undefined && !AI_NATIVE_IDENTIFIER_PATTERN.test(wearableId))
    || (homeRobotId !== undefined && !AI_NATIVE_IDENTIFIER_PATTERN.test(homeRobotId))
    || (!wearableId && !homeRobotId)) {
    throw httpError(503, 'SCENARIO_BINDING_UNAVAILABLE', 'Scenario device binding is unavailable');
  }
  const wearableSourceRef = value.wearableSourceRef;
  const homeRobotSourceRef = value.homeRobotSourceRef;
  if ((wearableSourceRef !== undefined && !AI_NATIVE_IDENTIFIER_PATTERN.test(wearableSourceRef))
    || (homeRobotSourceRef !== undefined && !AI_NATIVE_IDENTIFIER_PATTERN.test(homeRobotSourceRef))) {
    throw httpError(503, 'SCENARIO_BINDING_UNAVAILABLE', 'Scenario source binding is unavailable');
  }
  if (requiredSource === 'wearable' && wearableSourceRef !== sourceDeviceRef) {
    throw httpError(403, 'EDGE_SOURCE_MISMATCH', 'Wearable source is not bound to this account');
  }
  if (requiredSource === 'home_robot' && homeRobotSourceRef !== sourceDeviceRef) {
    throw httpError(403, 'EDGE_SOURCE_MISMATCH', 'Robot source is not bound to this account');
  }
  return Object.freeze({
    targets: Object.freeze({
      ...(wearableId ? { wearableId } : {}),
      ...(homeRobotId ? { homeRobotId } : {})
    }),
    ...(wearableSourceRef ? { wearableSourceRef } : {}),
    ...(homeRobotSourceRef ? { homeRobotSourceRef } : {})
  });
}

function normalizeInferenceContext(raw) {
  if (raw === undefined) return Object.freeze({});
  assertExactObjectKeys(raw, new Set(['location_context']), 'Inference context');
  if (!['home', 'away', 'unknown'].includes(raw.location_context)) {
    throw httpError(400, 'AI_NATIVE_REQUEST_INVALID', 'Inference location context is invalid');
  }
  return Object.freeze({ locationContext: raw.location_context });
}

function parseUserScenarioRequest(body) {
  assertExactObjectKeys(body, new Set(['scenario_id', 'request_id', 'occurred_at']), 'Scenario request');
  if (body.scenario_id !== 'ai_angel_auto_dial'
    || !AI_NATIVE_IDENTIFIER_PATTERN.test(body.request_id ?? '')
    || !Number.isSafeInteger(body.occurred_at)) {
    throw httpError(400, 'AI_NATIVE_REQUEST_INVALID', 'Scenario request is invalid');
  }
  return Object.freeze({
    scenarioId: 'ai_angel_auto_dial',
    event: Object.freeze({
      eventId: body.request_id,
      type: 'panic_button',
      occurredAt: body.occurred_at,
      data: Object.freeze({})
    })
  });
}

function parseScheduledContextEvent(body) {
  assertExactObjectKeys(body, new Set(['event_id', 'type', 'occurred_at', 'data']), 'Context event');
  if (!AI_NATIVE_IDENTIFIER_PATTERN.test(body.event_id ?? '')
    || !['medication_due', 'bedroom_inactivity'].includes(body.type)
    || !Number.isSafeInteger(body.occurred_at)) {
    throw httpError(400, 'AI_NATIVE_REQUEST_INVALID', 'Context event is invalid');
  }
  const data = body.data ?? {};
  assertExactObjectKeys(
    data,
    body.type === 'medication_due' ? new Set(['medication_id', 'scheduled_at']) : new Set(),
    'Context event data'
  );
  if (data.medication_id !== undefined && !AI_NATIVE_IDENTIFIER_PATTERN.test(data.medication_id)) {
    throw httpError(400, 'AI_NATIVE_REQUEST_INVALID', 'Medication reference is invalid');
  }
  if (data.scheduled_at !== undefined && !Number.isSafeInteger(data.scheduled_at)) {
    throw httpError(400, 'AI_NATIVE_REQUEST_INVALID', 'Medication schedule is invalid');
  }
  return Object.freeze({
    eventId: body.event_id,
    type: body.type,
    occurredAt: body.occurred_at,
    data: Object.freeze({
      ...(data.medication_id ? { medicationId: data.medication_id } : {}),
      ...(data.scheduled_at !== undefined ? { scheduledAt: data.scheduled_at } : {})
    })
  });
}

async function authenticateRobotEdgeRequest(req, config, envelope) {
  if (bearerToken(req)) return false;
  const adapterId = req.headers['x-robot-adapter-id'];
  const credential = req.headers['x-robot-callback-key'];
  if (!AI_NATIVE_IDENTIFIER_PATTERN.test(adapterId ?? '')
    || typeof credential !== 'string' || !credential || credential.length > 4096
    || !AI_NATIVE_IDENTIFIER_PATTERN.test(envelope?.sourceDeviceRef ?? '')
    || typeof config.authenticateRobotEdgeIngress !== 'function') return false;
  const authenticated = await config.authenticateRobotEdgeIngress({
    adapterId,
    credential,
    sourceDeviceRef: envelope.sourceDeviceRef
  });
  if (!authenticated
    || !isValidAccountSubject(authenticated.accountId)) return false;
  await assertAccountAvailable(config, authenticated.accountId);
  return Object.freeze({
    accountId: authenticated.accountId,
    binding: normalizeScenarioBinding(authenticated.binding, {
      requiredSource: 'home_robot',
      sourceDeviceRef: envelope.sourceDeviceRef
    })
  });
}

function bearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return match?.[1] || '';
}

async function requireRobotPairingCredential(req, repository, userId, robotId) {
  if (typeof repository?.verifyPairingToken !== 'function') {
    throw Object.assign(new Error('Robot credential verification is not configured'), { statusCode: 503 });
  }
  const token = req.headers['x-device-pairing-token'];
  if (!await repository.verifyPairingToken(userId, robotId, token)) {
    throw Object.assign(new Error('Robot pairing credential is invalid'), { statusCode: 401 });
  }
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

async function readBoundedResponseJson(response, maxBytes, label = 'Upstream', signal) {
  return readBoundedJSONResponse(response, { context: label, maxBytes, signal });
}

function responseMediaType(response) {
  return String(response?.headers?.get?.('content-type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

function upstreamTimeoutError(label) {
  const error = new Error(`${label} timed out`);
  error.name = 'TimeoutError';
  error.code = 'UPSTREAM_TIMEOUT';
  return error;
}

async function fetchWithDeadline(fetchImpl, url, init, {
  timeoutMs,
  label = 'Upstream request',
  controller = new AbortController(),
  consume = async (response) => response
} = {}) {
  if (typeof fetchImpl !== 'function' || typeof consume !== 'function') {
    throw new TypeError('Upstream transport is not configured');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new TypeError('Upstream timeout is invalid');
  }
  let response;
  let timedOut = false;
  let timeoutHandle;
  const operation = Promise.resolve().then(async () => {
    response = await fetchImpl(url, {
      ...init,
      redirect: init?.redirect || 'error',
      signal: controller.signal
    });
    if (timedOut) {
      try { await response?.body?.cancel?.(); } catch {}
      throw upstreamTimeoutError(label);
    }
    return consume(response, controller.signal);
  });
  // A custom/injected transport may ignore AbortSignal and settle after the
  // caller's deadline. Keep its eventual rejection observed.
  void operation.catch(() => {});
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      const timeoutError = upstreamTimeoutError(label);
      controller.abort(timeoutError);
      try {
        // ReadableStream.cancel() is invalid while getReader() owns the lock;
        // the consumer's abort listener cancels through that reader instead.
        const cancellation = response?.body?.locked === true
          ? undefined
          : response?.body?.cancel?.();
        if (cancellation && typeof cancellation.catch === 'function') void cancellation.catch(() => {});
      } catch {}
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timeoutHandle);
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
  return res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
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

function streamToolCall(res, { model, sessionId, name = 'get_safety_tips', parameters }) {
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
          function: { name, arguments: JSON.stringify(parameters || {}) }
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

function hasTool(tools, name) {
  return Array.isArray(tools) && tools.some((tool) => tool?.function?.name === name || tool?.name === name);
}

function sessionHash(sessionId) {
  return sessionId ? crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 12) : 'none';
}

async function pipeUpstreamSSE(upstreamResponse, res, sessionId, signal) {
  openSSE(res);
  const reader = upstreamResponse.body?.getReader();
  if (!reader) throw new Error('Upstream response did not provide a readable stream');
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;
  let responseErrored = false;
  let readerCancelled = false;
  let readerCancellation;
  let readerReleased = false;
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  // The downstream may close before the read loop starts. Keep the abort
  // promise observed even when responseClosed() causes the loop to be skipped.
  void aborted.catch(() => {});
  const cancelReader = () => {
    if (readerCancelled) return readerCancellation;
    readerCancelled = true;
    try {
      readerCancellation = Promise.resolve(reader.cancel?.()).catch(() => {});
    } catch {
      readerCancellation = Promise.resolve();
    }
    return readerCancellation;
  };
  const releaseReader = () => {
    if (readerReleased) return;
    try {
      reader.releaseLock?.();
      readerReleased = true;
    } catch {}
  };
  const abortReader = () => {
    cancelReader();
    const reason = signal?.reason instanceof Error
      ? signal.reason
      : Object.assign(new Error('Upstream response stream was aborted'), { name: 'AbortError' });
    rejectAbort(reason);
  };
  const markResponseError = () => { responseErrored = true; };
  res.once?.('error', markResponseError);
  if (signal?.aborted) abortReader();
  else signal?.addEventListener?.('abort', abortReader, { once: true });

  const responseClosed = () => responseErrored || res.destroyed === true || res.writableEnded === true;
  const writeWithBackpressure = async (data) => {
    if (responseClosed()) return false;
    if (writeSSE(res, data) !== false) return true;
    if (typeof res.once !== 'function') return false;
    await new Promise((resolve) => {
      const cleanup = () => {
        res.removeListener?.('drain', onDrain);
        res.removeListener?.('close', onClose);
        res.removeListener?.('error', onError);
      };
      const onDrain = () => { cleanup(); resolve(); };
      const onClose = () => { cleanup(); resolve(); };
      const onError = () => { responseErrored = true; cleanup(); resolve(); };
      res.once('drain', onDrain);
      res.once('close', onClose);
      res.once('error', onError);
    });
    return !responseClosed();
  };

  const writeEvent = async (event) => {
    const dataLines = event.split(/\r?\n/).filter((line) => line.startsWith('data:'));
    if (!dataLines.length) return true;
    const rawData = dataLines.map((line) => line.slice(5).trimStart()).join('\n');
    if (rawData === '[DONE]') {
      sawDone = true;
      return writeWithBackpressure('[DONE]');
    }
    try {
      const payload = JSON.parse(rawData);
      payload.system_fingerprint = sessionId || null;
      return writeWithBackpressure(payload);
    } catch {
      // Ignore malformed upstream events instead of forwarding untrusted bytes.
      return true;
    }
  };

  try {
    while (!responseClosed()) {
      // An injected fetch implementation can ignore AbortSignal, and cancelling
      // a locked ReadableStream through response.body.cancel() is invalid. Race
      // the read itself and cancel through its owning reader so the request
      // deadline and downstream disconnect paths always release this pipeline.
      const read = Promise.resolve().then(() => reader.read());
      void read.catch(() => {});
      const { done, value } = signal
        ? await Promise.race([read, aborted])
        : await read;
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      if (Buffer.byteLength(buffer) > MAX_UPSTREAM_SSE_EVENT_BYTES
        || events.some((event) => Buffer.byteLength(event) > MAX_UPSTREAM_SSE_EVENT_BYTES)) {
        throw Object.assign(new Error('Upstream SSE event exceeded the limit'), {
          code: 'UPSTREAM_EVENT_TOO_LARGE'
        });
      }
      for (const event of events) {
        if (!await writeEvent(event)) return;
      }
      if (done) break;
    }
    if (responseClosed()) return;
    if (buffer.trim() && !await writeEvent(buffer)) return;
    if (!sawDone && !await writeWithBackpressure('[DONE]')) return;
    if (!responseClosed()) res.end();
  } finally {
    signal?.removeEventListener?.('abort', abortReader);
    const cancellation = cancelReader();
    releaseReader();
    // A standards-compliant reader can keep a read request pending until its
    // cancellation promise settles. Retry release then without holding the HTTP
    // request open on a non-compliant/injected cancel implementation.
    if (!readerReleased && cancellation) void cancellation.then(releaseReader);
    res.removeListener?.('error', markResponseError);
  }
}

async function callUpstream(body, config, res, sessionId) {
  const controller = new AbortController();
  const abortOnClose = () => controller.abort();
  res.once?.('close', abortOnClose);
  res.once?.('error', abortOnClose);
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
    await fetchWithDeadline(config.fetchImpl, config.upstreamURL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.upstreamApiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify(requestBody)
    }, {
      timeoutMs: Math.max(1, config.upstreamTimeoutMs || 25000),
      label: 'Model upstream',
      controller,
      consume: async (response, signal) => {
        if (!response.ok) {
          try { await response.body?.cancel?.(); } catch {}
          throw new Error(`Upstream returned HTTP ${response.status}`);
        }
        if (responseMediaType(response) !== 'text/event-stream') {
          const payload = await readBoundedResponseJson(response, MAX_UPSTREAM_JSON_BYTES, 'Model upstream', signal);
          const text = payload?.choices?.[0]?.message?.content;
          if (!text) throw new Error('Upstream returned no assistant content');
          streamTextCompletion(res, { text, model: config.upstreamModel, sessionId });
          return;
        }
        await pipeUpstreamSSE(response, res, sessionId, signal);
      }
    });
  } finally {
    res.removeListener?.('close', abortOnClose);
    res.removeListener?.('error', abortOnClose);
  }
}

async function accountDeletionState(config, subject) {
  return typeof config.authSessionRepository?.getAccountDeletionState === 'function'
    ? config.authSessionRepository.getAccountDeletionState(subject)
    : 'active';
}

async function assertAccountAvailable(config, subject, { allowDeleting = false } = {}) {
  const state = await accountDeletionState(config, subject);
  if (state === 'deleted') {
    throw Object.assign(new Error('Account has been deleted'), { statusCode: 410, code: 'ACCOUNT_DELETED' });
  }
  if (state === 'deleting' && !allowDeleting) {
    throw Object.assign(new Error('Account deletion is in progress'), {
      statusCode: 423,
      code: 'ACCOUNT_DELETION_IN_PROGRESS'
    });
  }
}

async function authenticateApp(req, config, { allowDeleting = false } = {}) {
  const token = bearerToken(req);
  if (!token) return false;
  const session = verifySessionJWT(token, config);
  if (session) {
    if (config.authSessionRepository?.isActive
      && !await config.authSessionRepository.isActive(session.sub, session.sid)) return false;
    await assertAccountAvailable(config, session.sub, { allowDeleting });
    return session;
  }
  if (typeof config.verifyAppToken === 'function') {
    const verified = await config.verifyAppToken(token);
    if (!verified) return false;
    const principal = typeof verified === 'object' ? verified : { sub: null, externallyVerified: true };
    if (principal?.sub && !isValidAccountSubject(principal.sub)) return false;
    if (principal?.sub) await assertAccountAvailable(config, principal.sub, { allowDeleting });
    return principal;
  }
  if (config.appAuthVerifyURL) {
    return fetchWithDeadline(config.fetchImpl, config.appAuthVerifyURL, {
      headers: { Authorization: `Bearer ${token}` }
    }, {
      timeoutMs: 5000,
      label: 'Authentication verifier',
      consume: async (response, signal) => {
        if (!response.ok) {
          try { await response.body?.cancel?.(); } catch {}
          return false;
        }
        const claims = await readBoundedResponseJson(response, MAX_AUTH_RESPONSE_BYTES, 'Authentication verifier', signal);
        if (!isValidAccountSubject(claims?.sub)) return false;
        await assertAccountAvailable(config, claims.sub, { allowDeleting });
        return claims;
      }
    });
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
  if (!isValidAccountSubject(claims?.sub) || claims.sub.length > 240) {
    const error = new Error('Identity token verification failed');
    error.statusCode = 401;
    throw error;
  }
  const user = profileFromClaims(provider, claims, body?.displayName);
  await assertAccountAvailable(config, user.id);
  const session = signSessionJWT({ provider, subject: claims.sub }, config);
  const refresh = signRefreshJWT({
    subject: session.payload.sub,
    sessionId: session.payload.sid
  }, config);
  await config.authSessionRepository?.create?.({
    subject: session.payload.sub,
    sessionId: session.payload.sid,
    refreshJti: refresh.payload.jti,
    expiresAt: refresh.payload.exp * 1000
  });
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
  await consumePhoneVerificationChallenge(claims, config);
  const subject = `phone:${phoneSubject(claims.phone, config.phoneAuthSubjectSecret)}`;
  await assertAccountAvailable(config, subject);
  const session = signSessionJWT({ subjectClaim: subject }, config);
  const refresh = signRefreshJWT({
    subject: session.payload.sub,
    sessionId: session.payload.sid
  }, config);
  await config.authSessionRepository?.create?.({
    subject: session.payload.sub,
    sessionId: session.payload.sid,
    refreshJti: refresh.payload.jti,
    expiresAt: refresh.payload.exp * 1000
  });
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

async function refreshIdentity(body, config) {
  const claims = verifyRefreshJWT(body?.refreshToken, config);
  if (!claims) {
    const error = new Error('Refresh session is invalid or expired');
    error.statusCode = 401;
    throw error;
  }
  await assertAccountAvailable(config, claims.sub);
  const session = signSessionJWT({
    subjectClaim: claims.sub,
    sessionId: claims.sid
  }, config);
  // The original refresh expiry is the absolute family lifetime. Rotation
  // cannot slide a session indefinitely beyond that boundary.
  const refresh = signRefreshJWT(
    { subject: claims.sub, sessionId: claims.sid },
    config,
    { absoluteExpiresAtSeconds: claims.exp }
  );
  if (config.authSessionRepository?.rotate) {
    const rotated = await config.authSessionRepository.rotate({
      subject: claims.sub,
      sessionId: claims.sid,
      currentJti: claims.jti,
      nextJti: refresh.payload.jti,
      expiresAt: refresh.payload.exp * 1000
    });
    if (!rotated) {
      const error = new Error('Refresh session reuse was detected');
      error.statusCode = 401;
      error.code = 'REFRESH_REUSE_DETECTED';
      throw error;
    }
  }
  return {
    accessToken: session.token,
    expiresAt: session.payload.exp * 1000,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.payload.exp * 1000
  };
}

async function configureHumeSession(chatId, config) {
  if (!config.humeApiKey || !config.clmBearerToken) throw new Error('Hume control-plane secrets are not configured');
  return fetchWithDeadline(config.fetchImpl, `${HUME_API_BASE_URL}/v0/evi/chat/${encodeURIComponent(chatId)}/send`, {
      method: 'POST',
      headers: {
        'X-Hume-Api-Key': config.humeApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ type: 'session_settings', language_model_api_key: config.clmBearerToken })
    }, {
      timeoutMs: 7000,
      label: 'Hume control plane',
      consume: async (response) => {
        try {
          if (!response.ok) throw new Error(`Hume control plane returned HTTP ${response.status}`);
        } finally {
          try { await response.body?.cancel?.(); } catch {}
        }
      }
    });
}

function prepareDeviceServices(config) {
  config.logger = createRedactedLogger(config.logger);
  if ((config.aiNativeEnabled || config.aiNativeDataLifecycleEnabled) && config.aiNativeSystem) {
    const system = config.aiNativeSystem;
    const runtimeIncomplete = config.aiNativeEnabled && (
      !system.scenarioEngine
      || !system.edgeScenarioRouter
      || typeof system.getVoiceContext !== 'function'
      || typeof system.memory?.list !== 'function'
      || typeof system.memory?.delete !== 'function'
      || typeof system.memory?.deleteAll !== 'function'
    );
    const privacyIncomplete = config.aiNativeDataLifecycleEnabled && (
      typeof system.privacyRepository?.exportUserData !== 'function'
      || typeof system.privacyRepository?.deleteUserData !== 'function'
    );
    if (runtimeIncomplete || privacyIncomplete) {
      throw new Error('Injected AI-native system is incomplete');
    }
    if (config.aiNativeEnabled) {
      config.scenarioEngine = system.scenarioEngine;
      config.edgeScenarioRouter = system.edgeScenarioRouter;
    }
    if (config.aiNativeDataLifecycleEnabled) {
      config.aiNativePrivacyRepository = system.privacyRepository;
    }
  }
  if (!config.robotAdapterRuntime && Array.isArray(config.robotAdapterConfigurations) && config.robotAdapterConfigurations.length) {
    config.robotAdapterRuntime = createRobotAdapterRuntime({
      configurations: config.robotAdapterConfigurations,
      fetchImpl: config.fetchImpl,
      logger: config.logger,
      pairingIdempotencySecret: config.robotPairingTokenSecret,
      production: config.nodeEnv === 'production'
    });
  }
  if (config.safetyApiEnabled && !config.safetyRepository && config.safetyTableName) {
    config.safetyRepository = createDynamoSafetyRepository({
      tableName: config.safetyTableName,
      region: config.awsRegion,
      client: config.safetyRepositoryClient,
      accountStateTableName: config.authSessionTableName
    });
  }
  if (!config.authSessionRepository && config.authSessionTableName) {
    config.authSessionRepository = createDynamoAuthSessionRepository({
      tableName: config.authSessionTableName,
      region: config.awsRegion
    });
  }
  if (!config.verifyVoiceToken) {
    // Raw WebSocket upgrades do not pass through the HTTP auth middleware.
    // Reuse the same repository-aware verifier so logout and refresh-replay
    // revocation prevent new voice sessions immediately, not only at JWT exp.
    config.verifyVoiceToken = (token) => authenticateApp({
      headers: { authorization: `Bearer ${token}` }
    }, config);
  }
  if (!config.robotRepository && config.deviceTableName) {
    config.robotRepository = createDynamoRobotRepository({
      tableName: config.deviceTableName,
      region: config.awsRegion,
      resetRecoveryIndexName: config.robotResetRecoveryIndexName,
      accountStateTableName: config.authSessionTableName
    });
  }
  if (!config.pushRepository && config.deviceTableName) {
    config.pushRepository = createDynamoPushRepository({
      tableName: config.deviceTableName,
      region: config.awsRegion,
      client: config.pushRepositoryClient,
      accountStateTableName: config.authSessionTableName,
      ...(typeof config.sessionJWTSecret === 'string' && config.sessionJWTSecret.length >= 32
        ? { unregisterReceiptSecret: config.sessionJWTSecret }
        : {})
    });
  }
  if (!config.verifyRobotPairingCode && config.manufacturerPairingVerifyURL && config.manufacturerApiKey) {
    config.verifyRobotPairingCode = createManufacturerPairingVerifier({
      url: config.manufacturerPairingVerifyURL,
      apiKey: config.manufacturerApiKey,
      idempotencySecret: config.robotPairingTokenSecret || config.manufacturerApiKey,
      fetchImpl: config.fetchImpl,
      timeoutMs: config.actionRequestTimeoutMs
    });
  }
  if (!config.verifyRobotPairingCodeForAdapter && config.robotAdapterRuntime?.verifyPairingCode) {
    config.verifyRobotPairingCodeForAdapter = (adapterId, qrCode) => (
      config.robotAdapterRuntime.verifyPairingCode(adapterId, qrCode)
    );
  }
  if (!config.getManufacturerRobotStatus && config.manufacturerStatusURL && config.manufacturerApiKey) {
    config.getManufacturerRobotStatus = createManufacturerRobotStatusClient({
      url: config.manufacturerStatusURL,
      apiKey: config.manufacturerApiKey,
      fetchImpl: config.fetchImpl,
      timeoutMs: config.actionRequestTimeoutMs
    });
  }
  if (!config.resetManufacturerRobot && config.manufacturerResetURL && config.manufacturerApiKey) {
    config.resetManufacturerRobot = createManufacturerRobotResetClient({
      url: config.manufacturerResetURL,
      apiKey: config.manufacturerApiKey,
      fetchImpl: config.fetchImpl,
      timeoutMs: config.actionRequestTimeoutMs
    });
  }
  const legacyManufacturerPrivacyClient = config.manufacturerPrivacyExportURL
    && config.manufacturerPrivacyDeleteURL
    && config.manufacturerApiKey
    ? createManufacturerPrivacyClient({
      exportURL: config.manufacturerPrivacyExportURL,
      deleteURL: config.manufacturerPrivacyDeleteURL,
      apiKey: config.manufacturerApiKey,
      fetchImpl: config.fetchImpl,
      timeoutMs: config.actionRequestTimeoutMs
    }) : null;
  if (!config.manufacturerPrivacyDeletionRepository
    && config.deviceTableName
    && config.robotPairingTokenSecret
    && (legacyManufacturerPrivacyClient || config.robotAdapterRuntime)) {
    config.manufacturerPrivacyDeletionRepository = createDynamoManufacturerPrivacyDeletionRepository({
      tableName: config.deviceTableName,
      region: config.awsRegion,
      secret: config.robotPairingTokenSecret
    });
  }
  if (!config.manufacturerPrivacyRepository && config.robotRepository?.listManufacturerRobotBindings
    && (legacyManufacturerPrivacyClient || config.robotAdapterRuntime)) {
    config.manufacturerPrivacyRepository = createRoutedManufacturerPrivacyRepository({
      listManufacturerRobotBindings: (userId) => config.robotRepository.listManufacturerRobotBindings(userId),
      legacyClient: legacyManufacturerPrivacyClient,
      robotAdapterRuntime: config.robotAdapterRuntime,
      deletionRepository: config.manufacturerPrivacyDeletionRepository
    });
  } else if (
    !config.manufacturerPrivacyRepository
    && legacyManufacturerPrivacyClient
    && config.robotRepository?.listManufacturerDeviceIds
  ) {
    // Backward-compatible dependency-injection path for legacy-only callers.
    config.manufacturerPrivacyRepository = createManufacturerPrivacyRepository({
      exportURL: config.manufacturerPrivacyExportURL,
      deleteURL: config.manufacturerPrivacyDeleteURL,
      apiKey: config.manufacturerApiKey,
      listManufacturerDeviceIds: (userId) => config.robotRepository.listManufacturerDeviceIds(userId),
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
  if (!config.notifyEmergencyContacts && config.notifyUser && config.safetyRepository) {
    config.notifyEmergencyContacts = createEmergencyContactPushNotifier({
      safetyRepository: config.safetyRepository,
      notifyUser: config.notifyUser,
      resolvePhoneAccountId: (phone) => `phone:${phoneSubject(phone, config.phoneAuthSubjectSecret)}`
    });
  }
  if (!config.actionOutboxRepository && config.deviceTableName) {
    config.actionOutboxRepository = createDynamoActionOutboxRepository({
      tableName: config.deviceTableName,
      region: config.awsRegion,
      userIndexName: config.actionOutboxUserIndexName
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
      resolveRobotBinding: config.robotRepository?.resolveRobotBinding
        ? (userId, deviceId) => config.robotRepository.resolveRobotBinding(userId, deviceId)
        : undefined,
      isRobotBindingActive: config.robotRepository?.isRobotBindingActive
        ? (userId, deviceId, expectedBinding) => (
            config.robotRepository.isRobotBindingActive(userId, deviceId, expectedBinding)
          )
        : undefined,
      isAccountActionAllowed: async (userId) => (await accountDeletionState(config, userId)) === 'active',
      resolveManufacturerDeviceId: config.robotRepository?.resolveManufacturerDeviceId
        ? (userId, deviceId) => config.robotRepository.resolveManufacturerDeviceId(userId, deviceId)
        : undefined,
      requireBoundRobotResolver: config.nodeEnv === 'production',
      robotAdapterRuntime: config.robotAdapterRuntime,
      getDeviceStatus: config.robotAdapterRuntime
        || config.getManufacturerRobotStatus
        ? (manufacturerDeviceId, adapterId) => (
            config.robotAdapterRuntime && adapterId !== 'manufacturer-default'
              ? config.robotAdapterRuntime.getDeviceStatus(adapterId, manufacturerDeviceId)
              : config.getManufacturerRobotStatus
                ? config.getManufacturerRobotStatus(manufacturerDeviceId)
                : { online: false, hardware_status: 'offline' }
          )
        : undefined,
      outboxRepository: config.actionOutboxRepository,
      scenarioEngine: config.aiNativeEnabled ? config.scenarioEngine : undefined,
      logger: config.logger
    });
  }
  const resetRepositoryReady = ROBOT_RESET_REPOSITORY_METHODS.every(
    (method) => typeof config.robotRepository?.[method] === 'function'
  );
  if (!config.robotResetCoordinator
    && resetRepositoryReady
    && typeof config.actionGateway?.fenceRobotBinding === 'function') {
    config.robotResetCoordinator = createRobotResetCoordinator({
      repository: config.robotRepository,
      gateway: config.actionGateway,
      resetHandler: async ({ adapterId, manufacturerDeviceId, resetId, bindingEpoch }) => {
        const resetRequest = { resetId, manufacturerDeviceId, bindingEpoch };
        if (adapterId === 'manufacturer-default') {
          if (typeof config.resetManufacturerRobot !== 'function') {
            throw Object.assign(new Error('Legacy manufacturer reset is not configured'), {
              statusCode: 503,
              code: 'ROBOT_RESET_NOT_CONFIGURED'
            });
          }
          return config.resetManufacturerRobot(resetRequest);
        }
        if (typeof config.robotAdapterRuntime?.resetRobot !== 'function') {
          throw Object.assign(new Error('Robot adapter reset is not configured'), {
            statusCode: 503,
            code: 'ROBOT_ADAPTER_RESET_NOT_CONFIGURED'
          });
        }
        return config.robotAdapterRuntime.resetRobot(adapterId, resetRequest);
      },
      logger: config.logger
    });
  }
  if (config.robotResetCoordinator?.recover && !config.robotResetRecoveryPromise) {
    config.robotResetRecoveryPromise = Promise.resolve().then(() => (
      typeof config.robotResetCoordinator.startRecoveryWorker === 'function'
        ? config.robotResetCoordinator.startRecoveryWorker()
        : config.robotResetCoordinator.recover()
    ));
    config.robotResetRecoveryPromise.catch(() => {});
  }
  if (config.actionGateway?.recoverPendingCommands && !config.actionRecoveryPromise) {
    const resetRecovery = config.robotResetCoordinator
      ? (config.robotResetRecoveryPromise || Promise.reject(new Error('Robot reset recovery is not configured')))
      : (config.nodeEnv === 'production'
          ? Promise.reject(new Error('Robot reset coordinator is not configured'))
          : Promise.resolve());
    // A failed reset recovery must prevent action recovery. Pending actions
    // cannot be replayed safely when binding lifecycle state is unavailable.
    config.actionRecoveryPromise = resetRecovery.then(() => config.actionGateway.recoverPendingCommands());
    config.actionRecoveryPromise.catch(() => {});
  }
  if (!config.privacyCoordinator && config.safetyApiEnabled) {
    config.privacyCoordinator = createPrivacyDataCoordinator({
      safetyRepository: config.safetyRepository,
      robotRepository: config.robotRepository,
      actionOutboxRepository: config.actionOutboxRepository,
      pushRepository: config.pushRepository,
      manufacturerPrivacyRepository: config.manufacturerPrivacyRepository,
      includeAINative: config.aiNativeDataLifecycleEnabled === true,
      aiNativePrivacyRepository: config.aiNativePrivacyRepository,
      authSessionRepository: config.authSessionRepository,
      beforeAccountDeletion: typeof config.actionGateway?.fenceUserActions === 'function'
        ? (userId) => config.actionGateway.fenceUserActions(userId)
        : undefined
    });
  }
  if (config.nodeEnv === 'production' && config.safetyApiEnabled) {
    const missingPrivacyRepositories = config.privacyCoordinator?.missingRepositories?.() || [];
    if (missingPrivacyRepositories.length) {
      throw new Error(`Production privacy repositories are incomplete: ${missingPrivacyRepositories.join(', ')}`);
    }
  }
  return validatePreparedServices(config);
}

function createHandler(overrides = {}) {
  const config = prepareDeviceServices(validateServerConfig(envConfig(overrides)));
  const pushReceiptRateState = new Map();
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
          if (config.aiNativeEnabled
            && config.edgeScenarioRouter
            && typeof config.resolveScenarioDevices === 'function'
            && hasTool(body.tools, 'trigger_ai_angel')) {
            streamToolCall(res, { model, sessionId, name: 'trigger_ai_angel' });
            return;
          }
          if (hasTool(body.tools, 'request_help_dial')) {
            streamToolCall(res, { model, sessionId, name: 'request_help_dial' });
            return;
          }
          streamTextCompletion(res, { text: createLocalCompanionResponse(body.messages), model, sessionId });
          return;
        }
        if (shouldRequestSafetyTips(userText) && hasSafetyTool(body.tools)) {
          streamToolCall(res, {
            model,
            sessionId,
            name: 'get_safety_tips',
            parameters: { scenario: inferScenario(userText) }
          });
          return;
        }
        if (config.upstreamURL && config.upstreamApiKey && config.upstreamModel) {
          try {
            await callUpstream(body, config, res, sessionId);
            return;
          } catch (error) {
            config.logger.error('[VeryLovingCLM] upstream unavailable', { name: error.name });
            if (res.destroyed || res.writableEnded) return;
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
        json(res, 200, await refreshIdentity(body, config));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/auth/logout') {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        await config.authSessionRepository?.revoke?.({ subject: principal.sub, sessionId: principal.sid });
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/device-actions') {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        if (config.httpOnlyDeployment === true) { json(res, 503, { error: 'Device actions require the authenticated voice gateway' }); return; }
        if (!config.actionGateway) { json(res, 503, { error: 'Action gateway is not configured' }); return; }
        const body = await readJson(req);
        if (body?.device_type === 'home_robot') {
          await requireRobotPairingCredential(req, config.robotRepository, principal.sub, body.device_id);
        }
        json(res, 202, await config.actionGateway.route(principal.sub, body));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/scenarios') {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        if (!config.aiNativeEnabled
          || !config.edgeScenarioRouter
          || typeof config.resolveScenarioDevices !== 'function') {
          json(res, 503, { error: 'AI-native scenarios are not configured' }); return;
        }
        const body = await readJson(req);
        const request = parseUserScenarioRequest(body);
        const binding = normalizeScenarioBinding(await config.resolveScenarioDevices({
          accountId: principal.sub,
          scenarioId: request.scenarioId,
          source: 'authenticated_app'
        }));
        json(res, 202, await config.edgeScenarioRouter.ingestContextEvent(
          principal.sub,
          request.event,
          binding
        ));
        return;
      }

      const scenarioMatch = /^\/v1\/scenarios\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if (req.method === 'GET' && scenarioMatch) {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        if (!config.aiNativeEnabled || !config.scenarioEngine) {
          json(res, 503, { error: 'AI-native scenarios are not configured' }); return;
        }
        const execution = await config.scenarioEngine.getExecution(principal.sub, scenarioMatch[1]);
        if (!execution) { json(res, 404, { error: 'Scenario execution was not found' }); return; }
        json(res, 200, execution);
        return;
      }

      const scenarioCancelMatch = /^\/v1\/scenarios\/([0-9a-f-]{36})\/cancel$/i.exec(url.pathname);
      if (req.method === 'POST' && scenarioCancelMatch) {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        if (!config.aiNativeEnabled || !config.edgeScenarioRouter) {
          json(res, 503, { error: 'AI-native cancellation is not configured' }); return;
        }
        const body = await readJson(req);
        assertExactObjectKeys(body, new Set(['confirmed', 'occurred_at']), 'Cancellation request');
        if (body.confirmed !== true || !Number.isSafeInteger(body.occurred_at)) {
          json(res, 400, { error: 'Explicit cancellation confirmation is required' }); return;
        }
        json(res, 200, await config.edgeScenarioRouter.confirmCancellation(
          principal.sub,
          scenarioCancelMatch[1],
          {
            confirmed: true,
            source: 'authenticated_user',
            occurredAt: body.occurred_at
          }
        ));
        return;
      }

      const edgeIngress = {
        '/v1/edge/wearable/inference': ['wearable', 'ingestWearableInference'],
        '/v1/edge/robot/inference': ['home_robot', 'ingestRobotInference']
      }[url.pathname];
      if (req.method === 'POST' && edgeIngress) {
        if (!config.aiNativeEnabled || !config.edgeScenarioRouter) {
          json(res, 503, { error: 'Authenticated edge ingress is not configured' }); return;
        }
        const body = await readJson(req);
        let accountId;
        let binding;
        if (edgeIngress[0] === 'wearable') {
          if (req.headers['x-robot-adapter-id'] || req.headers['x-robot-callback-key']) {
            json(res, 401, { error: 'Unauthorized' }); return;
          }
          const principal = await authenticateApp(req, config);
          if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
          assertExactObjectKeys(body, new Set(['envelope', 'context']), 'Edge inference request');
          if (typeof config.resolveEdgeDeviceBinding !== 'function') {
            json(res, 503, { error: 'Authenticated edge ingress is not configured' }); return;
          }
          accountId = principal.sub;
          binding = normalizeScenarioBinding(await config.resolveEdgeDeviceBinding({
            accountId,
            deviceType: 'wearable',
            sourceDeviceRef: body?.envelope?.sourceDeviceRef
          }), {
            requiredSource: 'wearable',
            sourceDeviceRef: body?.envelope?.sourceDeviceRef
          });
        } else {
          const authenticated = await authenticateRobotEdgeRequest(req, config, body?.envelope);
          if (!authenticated) { json(res, 401, { error: 'Unauthorized' }); return; }
          assertExactObjectKeys(body, new Set(['envelope', 'context']), 'Edge inference request');
          accountId = authenticated.accountId;
          binding = authenticated.binding;
        }
        const context = normalizeInferenceContext(body.context);
        const result = await config.edgeScenarioRouter[edgeIngress[1]](
          accountId,
          body?.envelope,
          binding,
          context
        );
        json(res, 202, result);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/scenarios/context-events') {
        if (!config.aiNativeEnabled
          || !config.edgeScenarioRouter
          || typeof config.authenticateScenarioIngress !== 'function'
          || typeof config.resolveScenarioDevices !== 'function') {
          json(res, 503, { error: 'Authenticated scenario ingress is not configured' }); return;
        }
        const body = await readJson(req);
        const headerCredential = req.headers['x-scenario-ingress-key'] || '';
        if (bearerToken(req) || typeof headerCredential !== 'string' || !headerCredential) {
          json(res, 401, { error: 'Unauthorized' }); return;
        }
        const authenticated = await config.authenticateScenarioIngress({
          credential: headerCredential,
          eventType: typeof body?.type === 'string' ? body.type : undefined
        });
        if (!authenticated || !isValidAccountSubject(authenticated.accountId)) {
          json(res, 401, { error: 'Unauthorized' }); return;
        }
        const event = parseScheduledContextEvent(body);
        await assertAccountAvailable(config, authenticated.accountId);
        const binding = normalizeScenarioBinding(await config.resolveScenarioDevices({
          accountId: authenticated.accountId,
          scenarioId: event.type === 'medication_due' ? 'medication_adherence' : 'cognitive_engagement',
          source: 'trusted_scheduler'
        }));
        json(res, 202, await config.edgeScenarioRouter.ingestContextEvent(
          authenticated.accountId,
          event,
          binding
        ));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/ai-native/memories') {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        if (!config.aiNativeEnabled || typeof config.aiNativeSystem?.memory?.list !== 'function') {
          json(res, 503, { error: 'AI-native memory is not configured' }); return;
        }
        const supported = new Set(['kind', 'offset', 'limit']);
        if ([...url.searchParams.keys()].some((key) => !supported.has(key))
          || [...supported].some((key) => url.searchParams.getAll(key).length > 1)) {
          json(res, 400, { error: 'Memory query is invalid' }); return;
        }
        const kind = url.searchParams.get('kind') || undefined;
        if (kind !== undefined
          && !['conversation_summary', 'health_trend', 'life_event', 'preference'].includes(kind)) {
          json(res, 400, { error: 'Memory query is invalid' }); return;
        }
        const parseQueryInteger = (name, fallback, maximum) => {
          const raw = url.searchParams.get(name);
          if (raw === null) return fallback;
          if (!/^(?:0|[1-9][0-9]*)$/.test(raw)) return null;
          const value = Number(raw);
          return Number.isSafeInteger(value) && value >= (name === 'limit' ? 1 : 0) && value <= maximum
            ? value
            : null;
        };
        const offset = parseQueryInteger('offset', 0, 100_000);
        const limit = parseQueryInteger('limit', 100, 500);
        if (offset === null || limit === null) { json(res, 400, { error: 'Memory query is invalid' }); return; }
        const memories = await config.aiNativeSystem.memory.list(principal.sub, { kind, offset, limit });
        json(res, 200, { memories });
        return;
      }

      if (req.method === 'DELETE' && url.pathname === '/v1/ai-native/memories') {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        if (!config.aiNativeEnabled || typeof config.aiNativeSystem?.memory?.deleteAll !== 'function') {
          json(res, 503, { error: 'AI-native memory is not configured' }); return;
        }
        const body = await readJson(req);
        assertExactObjectKeys(body, new Set(['confirmed']), 'Memory deletion request');
        if (body.confirmed !== true) {
          json(res, 400, { error: 'Explicit memory deletion confirmation is required' }); return;
        }
        await config.aiNativeSystem.memory.deleteAll(principal.sub);
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      const memoryMatch = /^\/v1\/ai-native\/memories\/([^/]{1,384})$/.exec(url.pathname);
      if (req.method === 'DELETE' && memoryMatch) {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        if (!config.aiNativeEnabled || typeof config.aiNativeSystem?.memory?.delete !== 'function') {
          json(res, 503, { error: 'AI-native memory is not configured' }); return;
        }
        let memoryId;
        try { memoryId = decodeURIComponent(memoryMatch[1]); } catch { memoryId = ''; }
        if (!AI_NATIVE_IDENTIFIER_PATTERN.test(memoryId)) {
          json(res, 400, { error: 'Memory identifier is invalid' }); return;
        }
        const deleted = await config.aiNativeSystem.memory.delete(principal.sub, memoryId);
        if (!deleted) { json(res, 404, { error: 'Memory was not found' }); return; }
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/manufacturer/robot/ack') {
        const adapterId = req.headers['x-robot-adapter-id'] || '';
        const adapterCredential = req.headers['x-robot-callback-key'] || '';
        const adapterAuthenticated = Boolean(
          config.robotAdapterRuntime
          && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(adapterId)
          && config.robotAdapterRuntime.authenticateCallback(adapterId, adapterCredential)
        );
        const legacyAuthenticated = Boolean(
          config.manufacturerApiKey
          && safeEqual(req.headers['x-manufacturer-api-key'] || '', config.manufacturerApiKey)
        );
        if (!config.actionGateway
          || (!adapterAuthenticated && !legacyAuthenticated)
          || (adapterAuthenticated && legacyAuthenticated)) {
          json(res, 401, { error: 'Unauthorized' }); return;
        }
        const body = await readJson(req);
        if (!Number.isSafeInteger(body.binding_epoch) || body.binding_epoch <= 0) {
          json(res, 400, { error: 'binding_epoch must be a positive integer' }); return;
        }
        const accepted = await config.actionGateway.acknowledgeRobot(body.action_id, {
          ok: body.ok,
          error_code: body.error_code,
          camera_ready: body.camera_ready,
          camera_session_ref: body.camera_session_ref
        }, {
          adapterId: adapterAuthenticated ? adapterId : 'manufacturer-default',
          bindingEpoch: body.binding_epoch
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

      const robotBindingMatch = /^\/v1\/devices\/home-robots\/([^/]{1,384})$/.exec(url.pathname);
      if (req.method === 'DELETE' && robotBindingMatch) {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        let robotId;
        try { robotId = decodeURIComponent(robotBindingMatch[1]); } catch { robotId = ''; }
        if (!/^[A-Za-z0-9._:-]{1,128}$/.test(robotId)) { json(res, 400, { error: 'Robot identifier is invalid' }); return; }
        if (typeof config.robotResetCoordinator?.requestReset !== 'function') {
          json(res, 503, { error: 'Robot reset is not configured' }); return;
        }
        const result = await config.robotResetCoordinator.requestReset({
          userId: principal.sub,
          robotId,
          pairingToken: req.headers['x-device-pairing-token']
        });
        if (result?.completed !== true || result?.lifecycleState !== 'unbound') {
          json(res, 409, {
            error: 'Robot reset is in progress',
            code: 'ROBOT_RESET_IN_PROGRESS',
            ...(Number.isSafeInteger(result?.retryAt) ? { retry_at: result.retryAt } : {})
          });
          return;
        }
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      const robotTelemetryMatch = /^\/v1\/devices\/([^/]{1,384})\/telemetry$/.exec(url.pathname);
      if (req.method === 'GET' && robotTelemetryMatch) {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        let robotId;
        try { robotId = decodeURIComponent(robotTelemetryMatch[1]); } catch { robotId = ''; }
        if (!/^[A-Za-z0-9._:-]{1,128}$/.test(robotId)) { json(res, 400, { error: 'Robot identifier is invalid' }); return; }
        await requireRobotPairingCredential(req, config.robotRepository, principal.sub, robotId);
        let manufacturerDeviceId = robotId;
        let adapterId = 'manufacturer-default';
        if (config.robotRepository?.resolveRobotBinding) {
          const binding = await config.robotRepository.resolveRobotBinding(principal.sub, robotId);
          manufacturerDeviceId = binding?.manufacturerDeviceId;
          adapterId = binding?.adapterId;
          if (!/^[A-Za-z0-9._:-]{1,128}$/.test(manufacturerDeviceId || '')
            || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(adapterId || '')) {
            json(res, 404, { error: 'Robot was not found' }); return;
          }
        } else if (config.robotRepository?.resolveManufacturerDeviceId) {
          manufacturerDeviceId = await config.robotRepository.resolveManufacturerDeviceId(principal.sub, robotId);
          if (!/^[A-Za-z0-9._:-]{1,128}$/.test(manufacturerDeviceId || '')) {
            json(res, 404, { error: 'Robot was not found' }); return;
          }
        } else if (!config.robotRepository?.owns || !await config.robotRepository.owns(principal.sub, robotId)) {
          json(res, 404, { error: 'Robot was not found' }); return;
        }
        const getStatus = config.robotAdapterRuntime && adapterId !== 'manufacturer-default'
          ? (deviceId) => config.robotAdapterRuntime.getTelemetrySnapshot(adapterId, deviceId)
          : config.getManufacturerRobotStatus;
        if (!getStatus) { json(res, 503, { error: 'Robot telemetry is not configured' }); return; }
        json(res, 200, await getStatus(manufacturerDeviceId));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/devices/home-robots/pair') {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        if (!config.robotRepository || (
          typeof config.verifyRobotPairingCode !== 'function'
          && typeof config.verifyRobotPairingCodeForAdapter !== 'function'
        )) {
          json(res, 503, { error: 'Robot pairing is not configured' }); return;
        }
        const body = await readJson(req);
        let verifier = config.verifyRobotPairingCode;
        if (config.verifyRobotPairingCodeForAdapter) {
          if (!['yongyida', 'jiangzhi'].includes(body.robot_vendor)) {
            json(res, 400, { error: 'Robot manufacturer selection is required' }); return;
          }
          verifier = (qrCode) => config.verifyRobotPairingCodeForAdapter(body.robot_vendor, qrCode);
        }
        json(res, 201, await pairRobot({
          userId: principal.sub,
          qrCode: body.qr_code,
          pairingScope: body.robot_vendor || 'manufacturer-default',
          pairingTokenSecret: config.robotPairingTokenSecret,
          verifier,
          repository: config.robotRepository,
          logger: config.logger
        }));
        return;
      }

      if (req.method === 'DELETE' && url.pathname === '/v1/devices/push-token/receipt') {
        if (!config.pushRepository?.unregisterByReceipt) {
          json(res, 503, { error: 'Push registration is not configured' }); return;
        }
        if (!allowPushReceiptAttempt(pushReceiptRateState, req)) {
          json(res, 429, { error: 'Too many push unregistration attempts' }); return;
        }
        const body = await readJson(req);
        await config.pushRepository.unregisterByReceipt(body.receipt);
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/devices/push-token') {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        if (!config.pushRepository) { json(res, 503, { error: 'Push registration is not configured' }); return; }
        const body = await readJson(req);
        const registration = await config.pushRepository.register(principal.sub, validatePushToken(body.token));
        json(res, 200, registration);
        return;
      }

      if (req.method === 'DELETE' && url.pathname === '/v1/devices/push-token') {
        const principal = await authenticateApp(req, config);
        if (!principal?.sub) { json(res, 401, { error: 'Unauthorized' }); return; }
        if (!config.pushRepository?.unregister) { json(res, 503, { error: 'Push registration is not configured' }); return; }
        const body = await readJson(req);
        await config.pushRepository.unregister(principal.sub, validatePushToken(body.token));
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      if (
        url.pathname === '/v1/emergency-contacts'
        || url.pathname.startsWith('/v1/emergency-contacts/')
        || url.pathname === '/v1/sos-events'
        || url.pathname === '/v1/medication-escalations'
        || url.pathname.startsWith('/v1/safety-sessions')
        || url.pathname.startsWith('/v1/privacy/')
      ) {
        if (!config.safetyApiEnabled) {
          json(res, 503, { error: 'The production safety API is not configured' });
          return;
        }
        const principal = await authenticateApp(req, config, {
          allowDeleting: req.method === 'DELETE' && url.pathname === '/v1/privacy/data'
        });
        const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : {};
        if (await handleSafetyAPI({
          req,
          res,
          url,
          body,
          principal,
          repository: config.safetyRepository,
          privacyCoordinator: config.privacyCoordinator,
          notifyEmergencyContacts: config.notifyEmergencyContacts,
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
        const { statusCode, message } = normalizeHTTPError(error);
        const payload = { error: message };
        if (phoneRequest) {
          payload.code = error instanceof PhoneAuthError
            ? error.code
            : (statusCode < 500 ? PHONE_AUTH_CODES.INVALID : PHONE_AUTH_CODES.PROVIDER_UNAVAILABLE);
        }
        json(res, statusCode, payload);
      }
      else res.end();
    }
  };
}

function createVeryLovingCLMServer(options = {}) {
  const { attachVoiceGateway, closeVoiceGateway } = require('./voice-gateway.cjs');
  const config = prepareDeviceServices(validateServerConfig(envConfig(options)));
  const server = http.createServer(createHandler(config));
  const voiceGateway = attachVoiceGateway(server, config);
  server.closeVoiceGateway = () => closeVoiceGateway(voiceGateway);
  server.requestTimeout = 35000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (require.main === module) {
  const { createGracefulShutdown, installProcessSignalHandlers, parseListenPort } = require('./graceful-shutdown.cjs');
  const port = parseListenPort(process.env.PORT, DEFAULT_PORT);
  const server = createVeryLovingCLMServer();
  const shutdown = createGracefulShutdown(server, { cleanup: () => server.closeVoiceGateway() });
  installProcessSignalHandlers(shutdown);
  server.listen(port, () => console.log(`[VeryLovingCLM] listening on ${port}`));
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
  readBoundedResponseJson,
  fetchWithDeadline,
  safeEqual,
  validateServerConfig,
  validateServerURL,
  streamTextCompletion,
  streamToolCall
};
