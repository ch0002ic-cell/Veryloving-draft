import { decodeBase64URLJSON } from '../utils/base64';
import { logger } from '../utils/logger';

const MAX_TOKEN_LENGTH = 20000;
const MAX_ACTION_ID_LENGTH = 256;
const MAX_REASON_LENGTH = 120;
const ROBOT_ACTION_TTL_SECONDS = 30;
const CLOCK_TOLERANCE_SECONDS = 30;
const REFRESH_WINDOW_SECONDS = 60;
const DEFAULT_VERIFY_TIMEOUT_MS = 6000;
const ROBOT_ACTION_JTI_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROBOTICS_TOOL_NAMES = new Set([
  'navigate_robo_cane',
  'robot_stop',
  'stop_robo_cane',
  'find_robot',
  'set_robot_speed'
]);
const RESERVED_PARAMETER_NAMES = new Set([
  'action',
  'id',
  'name',
  'priority',
  'tool_call_id',
  'toolCallId',
  'type'
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function allowedParameterNames(name) {
  if (name === 'navigate_robo_cane') return new Set(['latitude', 'longitude', 'speed', 'reason']);
  if (name === 'set_robot_speed') return new Set(['speed', 'reason']);
  return new Set(['reason']);
}

function normalizeActionParameters(name, parameters) {
  if (!isPlainObject(parameters)) return null;
  const keys = Object.keys(parameters);
  const allowed = allowedParameterNames(name);
  if (keys.some((key) => RESERVED_PARAMETER_NAMES.has(key) || !allowed.has(key))) return null;
  if ('reason' in parameters && (
    typeof parameters.reason !== 'string'
    || parameters.reason.length > MAX_REASON_LENGTH
  )) return null;
  if ('speed' in parameters && (
    !Number.isFinite(parameters.speed)
    || parameters.speed < 0.1
    || parameters.speed > 2
  )) return null;
  if (name === 'navigate_robo_cane' && (
    !Number.isFinite(parameters.latitude)
    || parameters.latitude < -90
    || parameters.latitude > 90
    || !Number.isFinite(parameters.longitude)
    || parameters.longitude < -180
    || parameters.longitude > 180
  )) return null;
  if (name === 'set_robot_speed' && !Object.hasOwn(parameters, 'speed')) return null;
  const normalized = {};
  for (const key of keys) normalized[key] = parameters[key];
  return normalized;
}

function normalizeRobotAction(action) {
  if (
    !isPlainObject(action)
    || Object.keys(action).some((key) => !['id', 'name', 'parameters', 'responseRequired'].includes(key))
  ) {
    return null;
  }
  if (
    typeof action.id !== 'string'
    || !action.id.trim()
    || action.id.length > MAX_ACTION_ID_LENGTH
    || !ROBOTICS_TOOL_NAMES.has(action.name)
  ) return null;
  if ('responseRequired' in action && typeof action.responseRequired !== 'boolean') return null;
  const parameters = normalizeActionParameters(action.name, action.parameters);
  return parameters ? {
    id: action.id,
    name: action.name,
    parameters,
    ...('responseRequired' in action ? { responseRequired: action.responseRequired } : {})
  } : null;
}

export function inspectRobotActionEnvelope(envelope, {
  accessToken,
  now = Date.now(),
  expirationToleranceSeconds = CLOCK_TOLERANCE_SECONDS
} = {}) {
  if (
    envelope?.type !== 'ROBOT_ACTION'
    || typeof envelope.token !== 'string'
    || !envelope.token
    || envelope.token.length > MAX_TOKEN_LENGTH
  ) return null;
  const segments = envelope.token.split('.');
  if (segments.length !== 3 || !segments.every((segment) => /^[A-Za-z0-9_-]+$/.test(segment))) return null;
  let header;
  let payload;
  let session;
  try {
    header = decodeBase64URLJSON(segments[0]);
    payload = decodeBase64URLJSON(segments[1]);
    session = decodeBase64URLJSON(String(accessToken || '').split('.')[1]);
  } catch { return null; }
  const nowSeconds = Math.floor(now / 1000);
  const action = normalizeRobotAction(payload?.action);
  if (
    header?.alg !== 'HS256'
    || header.typ !== 'robot-action+jwt'
    || payload?.iss !== 'veryloving-robotics-gateway'
    || payload?.aud !== 'veryloving-robotics-mobile'
    || typeof session?.sub !== 'string'
    || typeof session?.sid !== 'string'
    || payload?.sub !== session.sub
    || payload?.sid !== session.sid
    || !Number.isSafeInteger(payload?.iat)
    || !Number.isSafeInteger(payload?.exp)
    || payload.exp <= payload.iat
    || payload.exp - payload.iat > ROBOT_ACTION_TTL_SECONDS
    || payload.iat > nowSeconds + CLOCK_TOLERANCE_SECONDS
    || payload.exp < nowSeconds - expirationToleranceSeconds
    || typeof payload?.jti !== 'string'
    || !ROBOT_ACTION_JTI_PATTERN.test(payload.jti)
    || !action
  ) return null;
  return {
    token: envelope.token,
    action,
    signedExpiresAt: payload.exp * 1000,
    // Queue expiry uses the same bounded skew allowance as verification so a
    // device clock that is slightly ahead cannot authorize and then drop work.
    expiresAt: (payload.exp + CLOCK_TOLERANCE_SECONDS) * 1000
  };
}

export async function verifyRobotActionEnvelope(envelope, { accessToken, verifySignature, now } = {}) {
  const inspected = inspectRobotActionEnvelope(envelope, { accessToken, now });
  if (!inspected || typeof verifySignature !== 'function') return null;
  let verified;
  try { verified = await verifySignature(inspected.token); } catch { return null; }
  if (!verified?.valid) return null;
  // The verifier confirms the signature; it is never an authority for replacing
  // the action that was decoded from the signed token.
  return inspected.action;
}

async function postRobotAction(path, token, {
  accessToken,
  apiBaseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_VERIFY_TIMEOUT_MS,
  loggerImpl = logger
} = {}) {
  if (!accessToken || !apiBaseUrl || typeof fetchImpl !== 'function') return { valid: false };
  const controller = new AbortController();
  const boundedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.min(timeoutMs, 30000)
    : DEFAULT_VERIFY_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), boundedTimeoutMs);
  try {
    const response = await fetchImpl(`${apiBaseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: controller.signal
    });
    if (!response.ok) return { valid: false, code: 'ROBOT_ACTION_INVALID' };
    const body = await response.json();
    return body && typeof body === 'object' ? body : { valid: false };
  } catch (error) {
    loggerImpl.warn?.('[RoboticsAuth] gateway request failed', {
      reason: error?.name === 'AbortError' ? 'request_timeout' : 'request_failed'
    });
    return { valid: false, code: 'ROBOT_ACTION_VERIFY_UNAVAILABLE' };
  } finally {
    clearTimeout(timeout);
  }
}

export function verifyRobotActionWithGateway(token, options = {}) {
  return postRobotAction('/v1/robotics/actions/verify', token, options);
}

export function refreshRobotActionWithGateway(token, options = {}) {
  return postRobotAction('/v1/robotics/actions/refresh', token, options);
}

export async function verifyRobotActionEnvelopeWithRefresh(envelope, options = {}) {
  const loggerImpl = options.loggerImpl || logger;
  const inspected = inspectRobotActionEnvelope(envelope, {
    accessToken: options.accessToken,
    now: options.now,
    expirationToleranceSeconds: REFRESH_WINDOW_SECONDS
  });
  if (!inspected) return null;

  const verified = await verifyRobotActionWithGateway(inspected.token, options);
  if (verified?.valid) {
    return { action: inspected.action, expiresAt: inspected.expiresAt, envelope, refreshed: false };
  }
  loggerImpl.warn?.('[RoboticsAuth] action verification rejected', { reason: 'verification_failed' });

  // A rejected action gets exactly one refresh attempt. The refresh endpoint
  // independently rechecks the original signature and session binding.
  const refreshedEnvelope = await refreshRobotActionWithGateway(inspected.token, options);
  const refreshed = inspectRobotActionEnvelope(refreshedEnvelope, {
    accessToken: options.accessToken,
    now: options.now
  });
  if (!refreshed) return null;
  const refreshedVerification = await verifyRobotActionWithGateway(refreshed.token, options);
  if (!refreshedVerification?.valid) return null;
  return {
    action: refreshed.action,
    expiresAt: refreshed.expiresAt,
    envelope: refreshedEnvelope,
    refreshed: true
  };
}
