'use strict';

const SERVER_INTEGER_ENVIRONMENT = Object.freeze({
  SESSION_JWT_TTL_SECONDS: Object.freeze({ configKey: 'sessionJWTTTLSeconds', fallback: 3600, min: 300, max: 86400 }),
  SESSION_REFRESH_TTL_SECONDS: Object.freeze({ configKey: 'sessionJWTRefreshTTLSeconds', fallback: 30 * 86400, min: 86400, max: 90 * 86400 }),
  PHONE_AUTH_CHALLENGE_TTL_SECONDS: Object.freeze({ configKey: 'phoneAuthChallengeTTLSeconds', fallback: 300, min: 60, max: 600 }),
  SAFETY_RETENTION_DAYS: Object.freeze({ configKey: 'safetyRetentionDays', fallback: 30, min: 1, max: 365 }),
  ACTION_REQUEST_TIMEOUT_MS: Object.freeze({ configKey: 'actionRequestTimeoutMs', fallback: 5000, min: 1, max: 120000 }),
  ROBOT_ACK_TIMEOUT_MS: Object.freeze({ configKey: 'robotAckTimeoutMs', fallback: 30000, min: 1, max: 300000 }),
  WEARABLE_ACK_TIMEOUT_MS: Object.freeze({ configKey: 'wearableAckTimeoutMs', fallback: 5000, min: 1, max: 60000 }),
  CLM_UPSTREAM_TIMEOUT_MS: Object.freeze({ configKey: 'upstreamTimeoutMs', fallback: 25000, min: 1, max: 30000 }),
  ROBOT_ADAPTER_TIMEOUT_MS: Object.freeze({ configKey: 'robotAdapterTimeoutMs', fallback: 5000, min: 1, max: 120000 }),
  ROBOT_ADAPTER_MAX_ATTEMPTS: Object.freeze({ configKey: 'robotAdapterMaxAttempts', fallback: 3, min: 1, max: 5 }),
  ROBOT_ADAPTER_RETRY_BASE_MS: Object.freeze({ configKey: 'robotAdapterRetryBaseMs', fallback: 100, min: 0, max: 30000 }),
  ROBOT_ADAPTER_RETRY_MAX_MS: Object.freeze({ configKey: 'robotAdapterRetryMaxMs', fallback: 2000, min: 0, max: 60000 }),
  MOCK_MANUFACTURER_PORT: Object.freeze({ configKey: 'mockManufacturerPort', fallback: 3001, min: 0, max: 65535 }),
  MOCK_MANUFACTURER_LATENCY_MIN_MS: Object.freeze({ configKey: 'mockManufacturerLatencyMinMs', fallback: 50, min: 0, max: 60000 }),
  MOCK_MANUFACTURER_LATENCY_MAX_MS: Object.freeze({ configKey: 'mockManufacturerLatencyMaxMs', fallback: 200, min: 0, max: 60000 }),
  ROBOT_SOAK_DURATION_MS: Object.freeze({ configKey: 'robotSoakDurationMs', fallback: 60000, min: 100, max: 86400000 }),
  ROBOT_SOAK_MAX_HEAP_GROWTH_BYTES: Object.freeze({ configKey: 'robotSoakMaxHeapGrowthBytes', fallback: 33554432, min: 1048576, max: 536870912 })
});

function parseBoundedServerInteger(name, value) {
  const definition = SERVER_INTEGER_ENVIRONMENT[name];
  if (!definition) throw new Error(`Unknown server integer environment field: ${name}`);
  if (value === undefined || value === null || String(value).trim() === '') return definition.fallback;
  const normalized = String(value).trim();
  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) {
    throw new Error(`${name} must be a base-10 integer between ${definition.min} and ${definition.max}`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < definition.min || parsed > definition.max) {
    throw new Error(`${name} must be a safe integer between ${definition.min} and ${definition.max}`);
  }
  return parsed;
}

function validateServerIntegerConfig(config) {
  for (const [name, definition] of Object.entries(SERVER_INTEGER_ENVIRONMENT)) {
    const value = config?.[definition.configKey];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < definition.min || value > definition.max) {
      throw new Error(`${name} must be a safe integer between ${definition.min} and ${definition.max}`);
    }
  }
  return config;
}

module.exports = {
  SERVER_INTEGER_ENVIRONMENT,
  parseBoundedServerInteger,
  validateServerIntegerConfig
};
