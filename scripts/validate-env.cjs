#!/usr/bin/env node

const { existsSync, readFileSync } = require('node:fs');
const { isAbsolute, resolve } = require('node:path');
const { URL } = require('node:url');
const {
  SERVER_INTEGER_ENVIRONMENT,
  parseBoundedServerInteger
} = require('../server/environment-schema.cjs');

const PROJECT_ROOT = resolve(__dirname, '..');
const VALID_PROFILES = new Set(['development', 'preview', 'production', 'testflight']);
const BOOLEAN_VARIABLES = new Set([
  'EXPO_PUBLIC_PHONE_AUTH_ENABLED',
  'EXPO_PUBLIC_DEMO_AUTH_ENABLED',
  'EXPO_PUBLIC_HUME_CLM_ENABLED',
  'EXPO_PUBLIC_ENABLE_OFFLINE_MODE',
  'EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES',
  'EXPO_PUBLIC_SHOW_ALL_LANGUAGES',
  'EXPO_PUBLIC_SAFETY_BACKEND_ENABLED',
  'EXPO_PUBLIC_VL01_ENABLED'
]);
const ROOT_VARIABLES = [
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_ACTION_GATEWAY_URL',
  'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
  'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
  'EXPO_PUBLIC_PHONE_AUTH_ENABLED',
  'EXPO_PUBLIC_DEMO_AUTH_ENABLED',
  'EXPO_PUBLIC_HUME_WS_PROXY_URL',
  'EXPO_PUBLIC_HUME_CONFIG_ID',
  'EXPO_PUBLIC_HUME_CUSTOMIZATION_URL',
  'EXPO_PUBLIC_HUME_CLM_ENABLED',
  'EXPO_PUBLIC_HUME_BRANDED_VOICE_ID',
  'EXPO_PUBLIC_HUME_API_KEY',
  'EXPO_PUBLIC_ACTION_SIGNING_PUBLIC_KEY',
  'EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN',
  'EXPO_PUBLIC_ENABLE_OFFLINE_MODE',
  'EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES',
  'EXPO_PUBLIC_SHOW_ALL_LANGUAGES',
  'EXPO_PUBLIC_SAFETY_BACKEND_ENABLED',
  'EXPO_PUBLIC_VL01_ENABLED',
  'EXPO_PUBLIC_VL01_SERVICE_UUID',
  'EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID',
  'EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID',
  'EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID',
  'EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID',
  'RNMAPBOX_MAPS_DOWNLOAD_TOKEN',
  'VERYLOVING_BUILD_PROFILE',
  'VERYLOVING_CONFIG_DIAGNOSTICS'
];
const SERVER_VARIABLES = [
  'NODE_ENV',
  'PORT',
  'HUME_API_KEY',
  'HUME_CONFIG_ID',
  'HUME_ALLOWED_VOICE_IDS',
  'HUME_PERSONA_MAP_JSON',
  'HUME_DEFAULT_PERSONA_ID',
  'HUME_ALLOW_CLIENT_RESUME',
  'HUME_CLM_BEARER_TOKEN',
  'HUME_CLM_URL',
  'HUME_TOOL_ID',
  'HUME_CUSTOM_VOICE_ID',
  'HUME_VOICE_NAME',
  'AUTH_EXCHANGE_ENABLED',
  'SESSION_JWT_SECRET',
  'SESSION_JWT_ISSUER',
  'SESSION_JWT_AUDIENCE',
  'SESSION_JWT_TTL_SECONDS',
  'SESSION_REFRESH_TTL_SECONDS',
  'APPLE_CLIENT_IDS',
  'GOOGLE_TOKEN_AUDIENCES',
  'GOOGLE_AUTHORIZED_PARTIES',
  'PHONE_AUTH_ENABLED',
  'PHONE_AUTH_CHALLENGE_SECRET',
  'PHONE_AUTH_SUBJECT_SECRET',
  'PHONE_AUTH_CHALLENGE_TTL_SECONDS',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_VERIFY_SERVICE_SID',
  'SAFETY_API_ENABLED',
  'SAFETY_TABLE_NAME',
  'AUTH_SESSION_TABLE_NAME',
  'SAFETY_RETENTION_DAYS',
  'AWS_REGION',
  'AI_NATIVE_ENABLED',
  'AI_NATIVE_DATA_LIFECYCLE_ENABLED',
  'AI_NATIVE_SINGLE_REPLICA',
  'AI_NATIVE_PRODUCTION_MODULE',
  'AI_NATIVE_DEMO_USER_ID',
  'ACTION_SIGNING_PRIVATE_KEY',
  'ACTION_SIGNING_PUBLIC_KEY',
  'ROBOT_PAIRING_TOKEN_SECRET',
  'ACTION_GATEWAY_SINGLE_REPLICA',
  'WEARABLE_COMMAND_PAYLOADS_JSON',
  'MANUFACTURER_WEBHOOK_URL',
  'MANUFACTURER_PAIRING_VERIFY_URL',
  'MANUFACTURER_STATUS_URL',
  'MANUFACTURER_RESET_URL',
  'MANUFACTURER_PRIVACY_EXPORT_URL',
  'MANUFACTURER_PRIVACY_DELETE_URL',
  'MANUFACTURER_API_KEY',
  'MOCK_MANUFACTURER_URL',
  'MOCK_MANUFACTURER_PORT',
  'MOCK_MANUFACTURER_LATENCY_MIN_MS',
  'MOCK_MANUFACTURER_LATENCY_MAX_MS',
  'MOCK_MANUFACTURER_FAILURE_RATE',
  'MOCK_MANUFACTURER_TELEMETRY_INTERVAL_MS',
  'MOCK_MANUFACTURER_SEED',
  'MOCK_MANUFACTURER_FALL_EVENT_RATE',
  'MOCK_MANUFACTURER_STRESS_EVENT_RATE',
  'MOCK_MANUFACTURER_MEDICATION_REMINDER_EVERY_TICKS',
  'MOCK_MANUFACTURER_MAX_SIMULATED_DEVICES',
  'MOCK_MANUFACTURER_API_KEY',
  'MOCK_MANUFACTURER_MAX_REQUEST_BYTES',
  'MOCK_MANUFACTURER_REQUEST_TIMEOUT_MS',
  'MOCK_MANUFACTURER_MAX_QUEUE_KEYS',
  'MOCK_MANUFACTURER_MAX_QUEUED_COMMANDS_TOTAL',
  'MOCK_MANUFACTURER_MAX_CONNECTIONS',
  'MOCK_MANUFACTURER_MAX_CONCURRENT_REQUESTS',
  'MOCK_MANUFACTURER_MAX_TELEMETRY_STREAMS',
  'MOCK_MANUFACTURER_MAX_DASHBOARD_STREAMS',
  'MOCK_MANUFACTURER_ACK_CALLBACK_URL',
  'MOCK_MANUFACTURER_ACK_DELAY_MS',
  'MOCK_MANUFACTURER_ACK_TIMEOUT_MS',
  'MOCK_MANUFACTURER_ACK_MAX_REQUEST_BYTES',
  'MOCK_MANUFACTURER_ACK_MAX_RESPONSE_BYTES',
  'MOCK_MAIN_SERVER_URL',
  'MOCK_MAIN_SERVER_TIMEOUT_MS',
  'MOCK_MAIN_SERVER_MAX_RESPONSE_BYTES',
  'YONGYIDA_ADAPTER_ENABLED',
  'YONGYIDA_ADAPTER_ID',
  'YONGYIDA_BRIDGE_URL',
  'YONGYIDA_BRIDGE_API_KEY',
  'YONGYIDA_CALLBACK_API_KEY',
  'YONGYIDA_PAIRING_VERIFY_URL',
  'YONGYIDA_RESET_URL',
  'YONGYIDA_PRIVACY_EXPORT_URL',
  'YONGYIDA_PRIVACY_DELETE_URL',
  'JIANGZHI_ADAPTER_ENABLED',
  'JIANGZHI_ADAPTER_ID',
  'JIANGZHI_BRIDGE_URL',
  'JIANGZHI_BRIDGE_API_KEY',
  'JIANGZHI_CALLBACK_API_KEY',
  'JIANGZHI_PAIRING_VERIFY_URL',
  'JIANGZHI_RESET_URL',
  'JIANGZHI_PRIVACY_EXPORT_URL',
  'JIANGZHI_PRIVACY_DELETE_URL',
  'ROBOT_ADAPTER_TIMEOUT_MS',
  'ROBOT_ADAPTER_MAX_ATTEMPTS',
  'ROBOT_ADAPTER_RETRY_BASE_MS',
  'ROBOT_ADAPTER_RETRY_MAX_MS',
  'ROBOT_ADAPTER_ALLOW_INSECURE_HTTP',
  'DEVICE_TABLE_NAME',
  'ACTION_OUTBOX_USER_INDEX_NAME',
  'ROBOT_RESET_RECOVERY_INDEX_NAME',
  'ACTION_REQUEST_TIMEOUT_MS',
  'ROBOT_ACK_TIMEOUT_MS',
  'WEARABLE_ACK_TIMEOUT_MS',
  'APP_AUTH_VERIFY_URL',
  'CLM_UPSTREAM_URL',
  'CLM_UPSTREAM_API_KEY',
  'CLM_UPSTREAM_MODEL',
  'CLM_UPSTREAM_TIMEOUT_MS',
  'ROBOT_SOAK_DURATION_MS',
  'ROBOT_SOAK_MAX_HEAP_GROWTH_BYTES'
];
const SERVER_SECRET_NAMES = new Set([
  'HUME_API_KEY',
  'HUME_SECRET_KEY',
  'HUME_CLM_BEARER_TOKEN',
  'SESSION_JWT_SECRET',
  'PHONE_AUTH_CHALLENGE_SECRET',
  'PHONE_AUTH_SUBJECT_SECRET',
  'TWILIO_AUTH_TOKEN',
  'CLM_UPSTREAM_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'ACTION_SIGNING_PRIVATE_KEY',
  'ROBOT_PAIRING_TOKEN_SECRET',
  'MANUFACTURER_API_KEY',
  'MOCK_MANUFACTURER_API_KEY',
  'YONGYIDA_BRIDGE_API_KEY',
  'YONGYIDA_CALLBACK_API_KEY',
  'JIANGZHI_BRIDGE_API_KEY',
  'JIANGZHI_CALLBACK_API_KEY'
]);
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_PATTERN = /^(?:[0-9a-f]{4}|[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const SENSITIVE_QUERY_PATTERN = /token|secret|password|api[_-]?key/i;
const SERVER_BOOLEAN_VARIABLES = Object.freeze([
  'HUME_ALLOW_CLIENT_RESUME',
  'AUTH_EXCHANGE_ENABLED',
  'PHONE_AUTH_ENABLED',
  'SAFETY_API_ENABLED',
  'AI_NATIVE_ENABLED',
  'AI_NATIVE_DATA_LIFECYCLE_ENABLED',
  'AI_NATIVE_SINGLE_REPLICA',
  'ACTION_GATEWAY_SINGLE_REPLICA',
  'YONGYIDA_ADAPTER_ENABLED',
  'JIANGZHI_ADAPTER_ENABLED',
  'ROBOT_ADAPTER_ALLOW_INSECURE_HTTP'
]);
const SERVER_URL_VARIABLES = Object.freeze([
  'SESSION_JWT_ISSUER',
  'MANUFACTURER_WEBHOOK_URL',
  'MANUFACTURER_PAIRING_VERIFY_URL',
  'MANUFACTURER_STATUS_URL',
  'MANUFACTURER_RESET_URL',
  'MANUFACTURER_PRIVACY_EXPORT_URL',
  'MANUFACTURER_PRIVACY_DELETE_URL',
  'YONGYIDA_BRIDGE_URL',
  'YONGYIDA_PAIRING_VERIFY_URL',
  'YONGYIDA_RESET_URL',
  'YONGYIDA_PRIVACY_EXPORT_URL',
  'YONGYIDA_PRIVACY_DELETE_URL',
  'JIANGZHI_BRIDGE_URL',
  'JIANGZHI_PAIRING_VERIFY_URL',
  'JIANGZHI_RESET_URL',
  'JIANGZHI_PRIVACY_EXPORT_URL',
  'JIANGZHI_PRIVACY_DELETE_URL',
  'APP_AUTH_VERIFY_URL',
  'CLM_UPSTREAM_URL'
]);

function parseDotEnv(source) {
  const parsed = {};
  for (const originalLine of String(source).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    let line = originalLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trimStart();
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(separator + 1).trim();
    const quote = value[0];
    let closingQuote = -1;
    if (quote === '"' || quote === "'") {
      for (let index = 1; index < value.length; index += 1) {
        if (value[index] !== quote) continue;
        let precedingSlashes = 0;
        for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) precedingSlashes += 1;
        if (quote === '"' && precedingSlashes % 2 === 1) continue;
        closingQuote = index;
        break;
      }
    }
    const quoteSuffix = closingQuote >= 0 ? value.slice(closingQuote + 1).trim() : '';
    if (closingQuote >= 0 && (!quoteSuffix || quoteSuffix.startsWith('#'))) {
      value = value.slice(1, closingQuote);
      if (quote === '"') {
        value = value
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
    } else {
      // Match Expo/dotenv semantics: an unquoted # starts a comment even when
      // it directly follows the value. Literal hashes must be quoted.
      value = value.replace(/#.*$/, '').trimEnd();
    }
    parsed[key] = value;
  }
  return parsed;
}

function isConfigured(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!normalized) return false;
  return !(
    /^<[^>]+>$/.test(normalized)
    || /^(?:replace|your)[-_]/i.test(normalized)
    || /^(?:todo|tbd|changeme)$/i.test(normalized)
  );
}

function enabled(env, key) {
  return env[key] === 'true';
}

function endpointProblem(value, requiredProtocol, { allowLocalDevelopment = false } = {}) {
  try {
    const endpoint = new URL(value);
    const hostname = endpoint.hostname.replace(/^\[|\]$/g, '');
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(hostname);
    const localProtocol = requiredProtocol === 'https:' ? 'http:' : requiredProtocol === 'wss:' ? 'ws:' : null;
    const allowedLocalEndpoint = allowLocalDevelopment
      && localHost
      && endpoint.protocol === localProtocol;
    if (endpoint.protocol !== requiredProtocol && !allowedLocalEndpoint) {
      return `must use ${requiredProtocol.replace(':', '')}`;
    }
    if (endpoint.username || endpoint.password) return 'must not contain embedded credentials';
    if ([...endpoint.searchParams.keys()].some((key) => SENSITIVE_QUERY_PATTERN.test(key))) {
      return 'must not contain credential-like query parameters';
    }
    if (endpoint.search || endpoint.hash) return 'must not contain query parameters or fragments';
    return null;
  } catch {
    return 'must be a valid URL';
  }
}

function makeResult(name, level, message) {
  return { name, level, message };
}

function probabilityProblem(value) {
  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value)) return 'must be a decimal probability between 0 and 1';
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? null
    : 'must be a decimal probability between 0 and 1';
}

function parseHumePersonaMap(value) {
  if (!isConfigured(value)) return { personas: new Map(), problem: null };
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { personas: new Map(), problem: 'must be valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { personas: new Map(), problem: 'must be an object keyed by persona ID' };
  }
  const personas = new Map();
  for (const [personaId, definition] of Object.entries(parsed)) {
    const voiceId = definition?.voice_id;
    const instructions = definition?.instructions;
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(personaId) || !CANONICAL_UUID_PATTERN.test(String(voiceId || ''))) {
      return { personas: new Map(), problem: 'must contain only valid persona IDs and canonical voice UUIDs' };
    }
    if (instructions !== undefined && (
      typeof instructions !== 'string'
      || !instructions.trim()
      || instructions.length > 500
    )) {
      return { personas: new Map(), problem: 'persona instructions must be non-empty strings of at most 500 characters' };
    }
    personas.set(personaId, voiceId);
  }
  return { personas, problem: null };
}

function validateEnvironment(env, { profile = 'development', fileEnvironment = {} } = {}) {
  const results = [];
  const production = profile === 'production' || profile === 'testflight';
  const preview = profile === 'preview';
  const fullCatalogLanguagesAllowed = profile === 'development' || profile === 'testflight';
  const remoteEASBuild = env.EAS_BUILD === '1' || env.EAS_BUILD === 'true';
  const strictTransport = production || preview;
  const required = new Map();

  if (production) {
    for (const [name, reason] of [
      ['EXPO_PUBLIC_API_BASE_URL', 'required by production auth, safety, and privacy flows'],
      ['EXPO_PUBLIC_ACTION_GATEWAY_URL', 'required for production robot action delivery'],
      ['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', 'required for production Google token validation'],
      ['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', 'required for production iOS Google Sign-In'],
      ['EXPO_PUBLIC_HUME_WS_PROXY_URL', 'required for production live voice'],
      ['EXPO_PUBLIC_HUME_CONFIG_ID', 'required for the production EVI configuration'],
      ['EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN', 'required for production maps']
    ]) required.set(name, reason);
    if (remoteEASBuild) {
      required.set('RNMAPBOX_MAPS_DOWNLOAD_TOKEN', 'required on the remote production native builder');
    }
  }

  if (enabled(env, 'EXPO_PUBLIC_PHONE_AUTH_ENABLED')) {
    required.set('EXPO_PUBLIC_API_BASE_URL', 'required when phone authentication is enabled');
  }
  if (enabled(env, 'EXPO_PUBLIC_SAFETY_BACKEND_ENABLED')) {
    required.set('EXPO_PUBLIC_API_BASE_URL', 'required when the safety backend is enabled');
  }
  if (production || enabled(env, 'EXPO_PUBLIC_HUME_CLM_ENABLED')) {
    required.set('EXPO_PUBLIC_HUME_WS_PROXY_URL', 'required when custom Hume CLM is enabled');
    required.set('EXPO_PUBLIC_HUME_CONFIG_ID', 'required when custom Hume CLM is enabled');
    if (!isConfigured(env.EXPO_PUBLIC_HUME_CUSTOMIZATION_URL) && !isConfigured(env.EXPO_PUBLIC_API_BASE_URL)) {
      required.set('EXPO_PUBLIC_HUME_CUSTOMIZATION_URL', 'required when custom Hume CLM is enabled and no API-base fallback exists');
    }
  }
  if (production || enabled(env, 'EXPO_PUBLIC_VL01_ENABLED')) {
    required.set('EXPO_PUBLIC_VL01_SERVICE_UUID', 'required when the VL01 protocol is enabled');
    required.set('EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID', 'required when the VL01 protocol is enabled');
    required.set('EXPO_PUBLIC_ACTION_SIGNING_PUBLIC_KEY', 'required to verify wearable command signatures');
    if (production) {
      required.set('EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID', 'required by the production VL01 registry');
      required.set('EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID', 'required by the production VL01 registry');
      required.set('EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID', 'required by the production VL01 registry');
    }
  }

  if (production) {
    for (const [name, description] of [
      ['EXPO_PUBLIC_PHONE_AUTH_ENABLED', 'must be true for production phone authentication'],
      ['EXPO_PUBLIC_HUME_CLM_ENABLED', 'must be true for the production custom voice path'],
      ['EXPO_PUBLIC_SAFETY_BACKEND_ENABLED', 'must be true for durable production safety flows'],
      ['EXPO_PUBLIC_VL01_ENABLED', 'must be true after the production firmware registry is approved']
    ]) {
      if (!enabled(env, name)) results.push(makeResult(name, 'error', description));
    }
  }

  for (const name of ROOT_VARIABLES) {
    if (results.some((result) => result.name === name && result.level === 'error')) continue;
    const value = env[name];
    const configured = isConfigured(value);

    if (required.has(name) && !configured) {
      results.push(makeResult(name, 'error', required.get(name)));
      continue;
    }

    if (name === 'EXPO_PUBLIC_HUME_API_KEY') {
      if (configured && (production || preview)) {
        results.push(makeResult(name, 'error', 'must be absent outside controlled development because public values are bundled'));
      } else if (configured) {
        results.push(makeResult(name, 'warn', 'configured for development; prefer the server gateway and never ship this value'));
      } else {
        results.push(makeResult(name, 'ok', 'absent as recommended'));
      }
      continue;
    }

    if (!configured) {
      if (name === 'EXPO_PUBLIC_HUME_CUSTOMIZATION_URL' && isConfigured(env.EXPO_PUBLIC_API_BASE_URL)) {
        results.push(makeResult(name, 'ok', 'uses the configured API-base fallback'));
      } else if (name === 'VERYLOVING_BUILD_PROFILE') {
        results.push(makeResult(name, 'ok', `uses the ${profile} command/default profile`));
      } else if (name === 'VERYLOVING_CONFIG_DIAGNOSTICS') {
        results.push(makeResult(name, 'ok', 'optional redacted diagnostics remain disabled'));
      } else if (name === 'RNMAPBOX_MAPS_DOWNLOAD_TOKEN' && production) {
        results.push(makeResult(name, 'warn', 'build-only secret is not locally verifiable; confirm it on the EAS builder'));
      } else {
        results.push(makeResult(name, 'warn', 'optional for this profile and currently missing'));
      }
      continue;
    }

    if (/(^|[^\\])\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)/.test(value)) {
      results.push(makeResult(name, 'error', 'must be a concrete value; dotenv interpolation is not accepted by this validator'));
      continue;
    }

    if (BOOLEAN_VARIABLES.has(name) && !/^(?:true|false)$/.test(value)) {
      results.push(makeResult(name, 'error', 'must be exactly true or false'));
      continue;
    }

    if (name === 'VERYLOVING_BUILD_PROFILE' && !VALID_PROFILES.has(value)) {
      results.push(makeResult(name, 'error', 'must be development, preview, or production'));
      continue;
    }

    if (name === 'VERYLOVING_CONFIG_DIAGNOSTICS' && !/^(?:0|1|true|false)$/.test(value)) {
      results.push(makeResult(name, 'error', 'must be 0, 1, true, or false'));
      continue;
    }

    if (name === 'EXPO_PUBLIC_ENABLE_OFFLINE_MODE' && production && enabled(env, name)) {
      results.push(makeResult(name, 'error', 'must be false for a production release'));
      continue;
    }

    if (name === 'EXPO_PUBLIC_DEMO_AUTH_ENABLED' && profile !== 'development' && enabled(env, name)) {
      results.push(makeResult(name, 'error', 'must be false outside the development profile'));
      continue;
    }

    if (name === 'EXPO_PUBLIC_SHOW_ALL_LANGUAGES' && !fullCatalogLanguagesAllowed && enabled(env, name)) {
      results.push(makeResult(name, 'error', 'must be false outside development or the dedicated TestFlight catalog-QA profile'));
      continue;
    }

    if (name === 'EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN' && !value.startsWith('pk.')) {
      results.push(makeResult(name, 'error', 'must be a Mapbox public pk.* runtime token'));
      continue;
    }

    if (name === 'RNMAPBOX_MAPS_DOWNLOAD_TOKEN' && !value.startsWith('sk.')) {
      results.push(makeResult(name, 'error', 'must be a Mapbox secret sk.* downloads token'));
      continue;
    }

    if ((name === 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID' || name === 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID')
      && !value.endsWith('.apps.googleusercontent.com')) {
      results.push(makeResult(name, 'error', 'must be a Google OAuth client ID'));
      continue;
    }

    if ((name === 'EXPO_PUBLIC_HUME_CONFIG_ID' || name === 'EXPO_PUBLIC_HUME_BRANDED_VOICE_ID')
      && !CANONICAL_UUID_PATTERN.test(value)) {
      results.push(makeResult(name, 'error', 'must be a canonical Hume UUID'));
      continue;
    }

    if (name === 'EXPO_PUBLIC_ACTION_SIGNING_PUBLIC_KEY' && !/^[A-Za-z0-9_-]{43}$/.test(value)) {
      results.push(makeResult(name, 'error', 'must be a base64url-encoded 32-byte Ed25519 public key'));
      continue;
    }

    if (name.startsWith('EXPO_PUBLIC_VL01_') && name.endsWith('_UUID') && !UUID_PATTERN.test(value)) {
      results.push(makeResult(name, 'error', 'must be a 4-, 8-, or canonical 128-bit hexadecimal UUID'));
      continue;
    }

    let problem = null;
    if (name === 'EXPO_PUBLIC_API_BASE_URL' || name === 'EXPO_PUBLIC_ACTION_GATEWAY_URL' || name === 'EXPO_PUBLIC_HUME_CUSTOMIZATION_URL') {
      problem = endpointProblem(value, 'https:', { allowLocalDevelopment: !strictTransport });
    } else if (name === 'EXPO_PUBLIC_HUME_WS_PROXY_URL') {
      problem = endpointProblem(value, 'wss:', { allowLocalDevelopment: !strictTransport });
    }
    if (problem) {
      results.push(makeResult(name, 'error', problem));
      continue;
    }

    results.push(makeResult(name, 'ok', 'configured'));
  }

  if (strictTransport && isConfigured(env.EXPO_PUBLIC_ACTION_GATEWAY_URL) && isConfigured(env.EXPO_PUBLIC_HUME_WS_PROXY_URL)) {
    try {
      if (new URL(env.EXPO_PUBLIC_ACTION_GATEWAY_URL).host !== new URL(env.EXPO_PUBLIC_HUME_WS_PROXY_URL).host) {
        results.push(makeResult('EXPO_PUBLIC_ACTION_GATEWAY_URL', 'error', 'must share the long-lived voice gateway host'));
      }
    } catch {}
  }

  for (const name of SERVER_SECRET_NAMES) {
    if (isConfigured(fileEnvironment[name])) {
      results.push(makeResult(name, 'error', 'server secret is misplaced in the root environment file'));
    }
  }

  return results;
}

function validateServerEnvironment(env, { profile = 'development', dryRun = false } = {}) {
  const results = [];
  const production = profile === 'production' || profile === 'testflight';
  const addConfiguredResult = (name, problem) => {
    results.push(makeResult(name, problem ? 'error' : 'ok', problem || 'configured'));
  };

  const nodeEnvironment = env.NODE_ENV || 'development';
  const productionServerRuntime = nodeEnvironment === 'production';
  const strictTransport = production || productionServerRuntime;
  if (!['development', 'test', 'production'].includes(nodeEnvironment)) {
    results.push(makeResult('NODE_ENV', 'error', 'must be development, test, or production'));
  } else if (production && nodeEnvironment !== 'production') {
    results.push(makeResult('NODE_ENV', 'error', 'must be production for a production or TestFlight profile'));
  } else {
    results.push(makeResult('NODE_ENV', 'ok', 'configured'));
  }
  if (isConfigured(env.PORT)) {
    const value = Number(env.PORT);
    addConfiguredResult('PORT', Number.isSafeInteger(value) && value >= 1 && value <= 65535
      ? null
      : 'must be a safe integer between 1 and 65535');
  } else {
    results.push(makeResult('PORT', 'warn', 'uses the server default port'));
  }

  for (const name of SERVER_BOOLEAN_VARIABLES) {
    if (!isConfigured(env[name])) {
      results.push(makeResult(name, 'warn', 'optional for this dry-run configuration and currently missing'));
      continue;
    }
    addConfiguredResult(name, /^(?:true|false)$/.test(env[name]) ? null : 'must be exactly true or false');
  }
  for (const name of Object.keys(SERVER_INTEGER_ENVIRONMENT)) {
    if (!isConfigured(env[name])) {
      results.push(makeResult(name, 'warn', 'uses the bounded server default'));
      continue;
    }
    try {
      parseBoundedServerInteger(name, env[name]);
      addConfiguredResult(name, null);
    } catch (error) {
      addConfiguredResult(name, error.message);
    }
  }

  for (const name of SERVER_URL_VARIABLES) {
    if (!isConfigured(env[name])) continue;
    addConfiguredResult(name, endpointProblem(env[name], 'https:', { allowLocalDevelopment: !strictTransport }));
  }
  for (const name of ['MOCK_MANUFACTURER_URL', 'MOCK_MAIN_SERVER_URL']) {
    if (!isConfigured(env[name])) continue;
    let problem = endpointProblem(env[name], 'https:', { allowLocalDevelopment: !strictTransport });
    try {
      const hostname = new URL(env[name]).hostname.replace(/^\[|\]$/g, '');
      if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) problem = 'must use a loopback host';
    } catch {}
    addConfiguredResult(name, problem);
  }

  for (const name of [
    'MOCK_MANUFACTURER_FAILURE_RATE',
    'MOCK_MANUFACTURER_FALL_EVENT_RATE',
    'MOCK_MANUFACTURER_STRESS_EVENT_RATE'
  ]) {
    if (!isConfigured(env[name])) continue;
    addConfiguredResult(name, probabilityProblem(env[name]));
  }

  const parsedInteger = (name) => {
    try {
      return parseBoundedServerInteger(name, env[name]);
    } catch {
      return null;
    }
  };
  const latencyMin = parsedInteger('MOCK_MANUFACTURER_LATENCY_MIN_MS');
  const latencyMax = parsedInteger('MOCK_MANUFACTURER_LATENCY_MAX_MS');
  if (latencyMin !== null && latencyMax !== null && latencyMax < latencyMin) {
    results.push(makeResult(
      'MOCK_MANUFACTURER_LATENCY_MAX_MS',
      'error',
      'must be greater than or equal to MOCK_MANUFACTURER_LATENCY_MIN_MS'
    ));
  }
  const retryBase = parsedInteger('ROBOT_ADAPTER_RETRY_BASE_MS');
  const retryMax = parsedInteger('ROBOT_ADAPTER_RETRY_MAX_MS');
  if (retryBase !== null && retryMax !== null && retryMax < retryBase) {
    results.push(makeResult(
      'ROBOT_ADAPTER_RETRY_MAX_MS',
      'error',
      'must be greater than or equal to ROBOT_ADAPTER_RETRY_BASE_MS'
    ));
  }

  if (isConfigured(env.MOCK_MANUFACTURER_ACK_CALLBACK_URL)) {
    let problem = endpointProblem(env.MOCK_MANUFACTURER_ACK_CALLBACK_URL, 'https:', {
      allowLocalDevelopment: !strictTransport
    });
    try {
      const callback = new URL(env.MOCK_MANUFACTURER_ACK_CALLBACK_URL);
      const hostname = callback.hostname.replace(/^\[|\]$/g, '');
      if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
        problem = 'must use a loopback host';
      } else if (callback.pathname !== '/v1/manufacturer/robot/ack') {
        problem = 'must target /v1/manufacturer/robot/ack';
      }
    } catch {}
    addConfiguredResult('MOCK_MANUFACTURER_ACK_CALLBACK_URL', problem);
  }

  for (const name of ['HUME_CONFIG_ID', 'HUME_TOOL_ID', 'HUME_CUSTOM_VOICE_ID']) {
    if (!isConfigured(env[name])) continue;
    addConfiguredResult(name, CANONICAL_UUID_PATTERN.test(env[name]) ? null : 'must be a canonical Hume UUID');
  }
  let allowedVoiceIds = [];
  if (isConfigured(env.HUME_ALLOWED_VOICE_IDS)) {
    allowedVoiceIds = env.HUME_ALLOWED_VOICE_IDS.split(',').map((item) => item.trim()).filter(Boolean);
    addConfiguredResult(
      'HUME_ALLOWED_VOICE_IDS',
      allowedVoiceIds.length > 0 && allowedVoiceIds.every((voiceId) => CANONICAL_UUID_PATTERN.test(voiceId))
        ? null
        : 'must contain only comma-separated canonical Hume UUIDs'
    );
  }
  if (isConfigured(env.HUME_DEFAULT_PERSONA_ID)) {
    addConfiguredResult(
      'HUME_DEFAULT_PERSONA_ID',
      /^[A-Za-z0-9_-]{1,40}$/.test(env.HUME_DEFAULT_PERSONA_ID)
        ? null
        : 'must be a 1-40 character persona ID'
    );
  }
  const personaMap = parseHumePersonaMap(env.HUME_PERSONA_MAP_JSON);
  if (isConfigured(env.HUME_PERSONA_MAP_JSON)) {
    addConfiguredResult('HUME_PERSONA_MAP_JSON', personaMap.problem);
  }
  if (!personaMap.problem && isConfigured(env.HUME_PERSONA_MAP_JSON)) {
    if (strictTransport && personaMap.personas.size === 0) {
      results.push(makeResult('HUME_PERSONA_MAP_JSON', 'error', 'must define at least one persona in production'));
    }
    if (isConfigured(env.HUME_DEFAULT_PERSONA_ID) && !personaMap.personas.has(env.HUME_DEFAULT_PERSONA_ID)) {
      results.push(makeResult('HUME_DEFAULT_PERSONA_ID', 'error', 'must select a persona in HUME_PERSONA_MAP_JSON'));
    }
    const allowed = new Set(allowedVoiceIds);
    if (allowed.size > 0 && [...personaMap.personas.values()].some((voiceId) => !allowed.has(voiceId))) {
      results.push(makeResult('HUME_ALLOWED_VOICE_IDS', 'error', 'must include every voice in HUME_PERSONA_MAP_JSON'));
    }
  }
  if (isConfigured(env.HUME_CLM_URL)) {
    let problem = endpointProblem(env.HUME_CLM_URL, 'https:');
    if (!problem) {
      try {
        if (!new URL(env.HUME_CLM_URL).pathname.endsWith('/chat/completions')) {
          problem = 'must end with /chat/completions';
        }
      } catch {}
    }
    addConfiguredResult('HUME_CLM_URL', problem);
  }
  if (isConfigured(env.HUME_VOICE_NAME)) {
    addConfiguredResult(
      'HUME_VOICE_NAME',
      env.HUME_VOICE_NAME.length <= 120
        && env.HUME_VOICE_NAME.trim() === env.HUME_VOICE_NAME
        && !/[\u0000-\u001f\u007f]/u.test(env.HUME_VOICE_NAME)
        ? null
        : 'must be a trimmed string of at most 120 characters without control characters'
    );
  }

  if (strictTransport) {
    const humeRequired = [
      ['HUME_API_KEY', 'required by the production Hume gateway'],
      ['HUME_CONFIG_ID', 'required by the production Hume gateway'],
      ['HUME_ALLOWED_VOICE_IDS', 'required by the production Hume voice allowlist'],
      ['HUME_PERSONA_MAP_JSON', 'required by the production Hume persona registry'],
      ['HUME_DEFAULT_PERSONA_ID', 'required by the production Hume persona registry']
    ];
    for (const [name, reason] of humeRequired) {
      if (!isConfigured(env[name])) results.push(makeResult(name, dryRun ? 'warn' : 'error', reason));
    }
  }

  const provisioningConfigured = [
    'HUME_CLM_URL',
    'HUME_TOOL_ID',
    'HUME_CUSTOM_VOICE_ID',
    'HUME_VOICE_NAME'
  ].some((name) => isConfigured(env[name]));
  if (provisioningConfigured) {
    for (const name of ['HUME_API_KEY', 'HUME_CLM_URL']) {
      if (!isConfigured(env[name])) {
        results.push(makeResult(
          name,
          dryRun ? 'warn' : 'error',
          `required when Hume provisioning operator inputs are configured${dryRun
            ? '; credential presence is deferred by dry-run mode'
            : ''}`
        ));
      }
    }
  }

  const requireWhenEnabled = (flag, dependencies) => {
    if (env[flag] !== 'true') return;
    for (const name of dependencies) {
      if (isConfigured(env[name])) continue;
      results.push(makeResult(
        name,
        dryRun ? 'warn' : 'error',
        `required when ${flag}=true${dryRun ? '; credential presence is deferred by dry-run mode' : ''}`
      ));
    }
  };
  requireWhenEnabled('AUTH_EXCHANGE_ENABLED', [
    'SESSION_JWT_SECRET', 'APPLE_CLIENT_IDS', 'GOOGLE_TOKEN_AUDIENCES', 'AUTH_SESSION_TABLE_NAME'
  ]);
  requireWhenEnabled('PHONE_AUTH_ENABLED', [
    'SESSION_JWT_SECRET', 'PHONE_AUTH_CHALLENGE_SECRET', 'PHONE_AUTH_SUBJECT_SECRET',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID'
  ]);
  requireWhenEnabled('SAFETY_API_ENABLED', ['SAFETY_TABLE_NAME', 'AUTH_SESSION_TABLE_NAME']);
  requireWhenEnabled('YONGYIDA_ADAPTER_ENABLED', [
    'YONGYIDA_BRIDGE_URL', 'YONGYIDA_BRIDGE_API_KEY', 'YONGYIDA_CALLBACK_API_KEY'
  ]);
  requireWhenEnabled('JIANGZHI_ADAPTER_ENABLED', [
    'JIANGZHI_BRIDGE_URL', 'JIANGZHI_BRIDGE_API_KEY', 'JIANGZHI_CALLBACK_API_KEY'
  ]);

  if (env.AI_NATIVE_ENABLED === 'true' && env.AI_NATIVE_DATA_LIFECYCLE_ENABLED !== 'true') {
    results.push(makeResult('AI_NATIVE_DATA_LIFECYCLE_ENABLED', 'error', 'must be true when AI_NATIVE_ENABLED=true'));
  }
  const aiNativeStateEnabled = env.AI_NATIVE_ENABLED === 'true'
    || env.AI_NATIVE_DATA_LIFECYCLE_ENABLED === 'true';
  if (isConfigured(env.AI_NATIVE_PRODUCTION_MODULE)) {
    const modulePath = env.AI_NATIVE_PRODUCTION_MODULE;
    if (!productionServerRuntime) {
      results.push(makeResult(
        'AI_NATIVE_PRODUCTION_MODULE',
        'warn',
        'ignored outside production and TestFlight server validation'
      ));
    } else {
      addConfiguredResult('AI_NATIVE_PRODUCTION_MODULE', (
        modulePath.length <= 1024
        && !/[\u0000-\u001f\u007f]/u.test(modulePath)
        && isAbsolute(modulePath)
      ) ? null : 'must be a bounded absolute path');
    }
  } else if (productionServerRuntime && aiNativeStateEnabled) {
    results.push(makeResult(
      'AI_NATIVE_PRODUCTION_MODULE',
      dryRun ? 'warn' : 'error',
      `required for production AI-native runtime or data lifecycle state${dryRun
        ? '; image-owned path presence is deferred by dry-run mode'
        : ''}`
    ));
  } else {
    results.push(makeResult(
      'AI_NATIVE_PRODUCTION_MODULE',
      'warn',
      'optional unless production AI-native runtime or lifecycle state is enabled'
    ));
  }
  if (productionServerRuntime && env.AI_NATIVE_ENABLED === 'true' && env.AI_NATIVE_SINGLE_REPLICA !== 'true') {
    results.push(makeResult('AI_NATIVE_SINGLE_REPLICA', 'error', 'must be true for the current production scheduler'));
  }
  if (dryRun) {
    results.push(makeResult('SERVER_CONFIG_DRY_RUN', 'ok', 'structure validated without requiring credential values'));
  }
  return results;
}

function parseArguments(argv) {
  const options = {
    file: '.env',
    serverFile: undefined,
    serverDryRun: false,
    profile: undefined,
    color: !process.env.NO_COLOR
  };
  const optionValue = (index, option) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--file') {
      options.file = optionValue(index, '--file');
      index += 1;
    } else if (argument === '--server-file') {
      options.serverFile = optionValue(index, '--server-file');
      index += 1;
    } else if (argument === '--server-dry-run') {
      options.serverDryRun = true;
    } else if (argument === '--profile') {
      options.profile = optionValue(index, '--profile');
      index += 1;
    } else if (argument === '--no-color') {
      options.color = false;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.file) throw new Error('--file requires a path');
  if (options.serverDryRun && !options.serverFile) options.serverFile = 'server/.env.example';
  if (options.profile && !VALID_PROFILES.has(options.profile)) {
    throw new Error('--profile must be development, preview, production, or testflight');
  }
  return options;
}

function colors(enabledColor) {
  const wrap = (code) => (text) => enabledColor ? `\u001b[${code}m${text}\u001b[0m` : text;
  return {
    green: wrap('32'),
    yellow: wrap('33'),
    red: wrap('31'),
    cyan: wrap('36'),
    bold: wrap('1')
  };
}

function renderReport({ results, profile, filePath, fileFound, color = true }) {
  const paint = colors(color);
  const lines = [
    paint.bold('VeryLoving environment validation'),
    `Profile: ${paint.cyan(profile)}`,
    `Source: ${fileFound ? filePath : `${filePath} (not found; process environment only)`}`,
    ''
  ];
  if (!fileFound) lines.push(paint.yellow('⚠ Environment file not found; validating process variables only.'), '');

  for (const result of results) {
    if (result.level === 'ok') {
      const label = result.message === 'configured' ? '✓ SET' : '✓ OK';
      lines.push(`${paint.green(label)}${label === '✓ SET' ? '   ' : '    '}${result.name} — ${result.message}`);
    }
    if (result.level === 'warn') lines.push(`${paint.yellow('⚠ WARN')}  ${result.name} — ${result.message}`);
    if (result.level === 'error') lines.push(`${paint.red('✖ ERROR')} ${result.name} — ${result.message}`);
  }

  const counts = results.reduce((summary, result) => {
    summary[result.level] += 1;
    return summary;
  }, { ok: 0, warn: 0, error: 0 });
  lines.push('', `Summary: ${paint.green(`${counts.ok} ok`)} · ${paint.yellow(`${counts.warn} warnings`)} · ${paint.red(`${counts.error} errors`)}`);
  lines.push(counts.error ? paint.red('Environment validation failed.') : paint.green('Environment validation passed.'));
  return lines.join('\n');
}

function usage() {
  return [
    'Usage: npm run validate-env -- [--file <path>] [--server-file <path>] [--server-dry-run] [--profile development|preview|production|testflight] [--no-color]',
    '',
    'The environment file is loaded first and explicit process variables override it.',
    'Only variable names and validation states are printed; values are never printed.',
    '--server-dry-run validates server configuration structure while deferring real credential presence.'
  ].join('\n');
}

function run(argv = process.argv.slice(2), processEnvironment = process.env) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const filePath = resolve(PROJECT_ROOT, options.file);
  const fileFound = existsSync(filePath);
  const fileEnvironment = fileFound ? parseDotEnv(readFileSync(filePath, 'utf8')) : {};
  const environment = { ...fileEnvironment, ...processEnvironment };
  const profile = options.profile || environment.VERYLOVING_BUILD_PROFILE || 'development';
  if (!VALID_PROFILES.has(profile)) {
    process.stderr.write('Effective profile must be development, preview, production, or testflight.\n');
    return 2;
  }
  environment.VERYLOVING_BUILD_PROFILE = profile;
  const results = validateEnvironment(environment, { profile, fileEnvironment });
  const reports = [renderReport({ results, profile, filePath, fileFound, color: options.color })];
  let serverResults = [];
  if (options.serverFile) {
    const serverFilePath = resolve(PROJECT_ROOT, options.serverFile);
    const serverFileFound = existsSync(serverFilePath);
    const serverFileEnvironment = serverFileFound ? parseDotEnv(readFileSync(serverFilePath, 'utf8')) : {};
    const serverEnvironment = { ...serverFileEnvironment, ...processEnvironment };
    serverResults = validateServerEnvironment(serverEnvironment, {
      profile,
      dryRun: options.serverDryRun
    });
    reports.push(renderReport({
      results: serverResults,
      profile,
      filePath: serverFilePath,
      fileFound: serverFileFound,
      color: options.color
    }).replace('VeryLoving environment validation', options.serverDryRun
      ? 'VeryLoving server environment dry-run'
      : 'VeryLoving server environment validation'));
  }
  process.stdout.write(`${reports.join('\n\n')}\n`);
  return [...results, ...serverResults].some((result) => result.level === 'error') ? 1 : 0;
}

if (require.main === module) process.exitCode = run();

module.exports = {
  ROOT_VARIABLES,
  SERVER_VARIABLES,
  parseDotEnv,
  isConfigured,
  endpointProblem,
  validateEnvironment,
  validateServerEnvironment,
  parseArguments,
  renderReport,
  run
};
