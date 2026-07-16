'use strict';

const crypto = require('node:crypto');

const ROBOT_ACTION_TYPE = 'ROBOT_ACTION';
const ROBOT_ACTION_ISSUER = 'veryloving-robotics-gateway';
const ROBOT_ACTION_AUDIENCE = 'veryloving-robotics-mobile';
const ROBOT_ACTION_TTL_SECONDS = 30;
const ROBOT_ACTION_CLOCK_TOLERANCE_SECONDS = 30;
const ROBOT_ACTION_REFRESH_WINDOW_SECONDS = 60;
const MAX_TOKEN_LENGTH = 20000;
const MAX_ACTION_ID_LENGTH = 256;
const MAX_REASON_LENGTH = 120;
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

function base64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

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
  if (name === 'navigate_robo_cane') {
    if (
      !Number.isFinite(parameters.latitude)
      || parameters.latitude < -90
      || parameters.latitude > 90
      || !Number.isFinite(parameters.longitude)
      || parameters.longitude < -180
      || parameters.longitude > 180
    ) return null;
  }
  if (name === 'set_robot_speed' && !Object.hasOwn(parameters, 'speed')) return null;
  const normalized = {};
  for (const key of keys) normalized[key] = parameters[key];
  return normalized;
}

function normalizeRobotAction(action) {
  if (!isPlainObject(action)) return null;
  const keys = Object.keys(action);
  if (keys.some((key) => !['id', 'name', 'parameters', 'responseRequired'].includes(key))) return null;
  if (
    typeof action.id !== 'string'
    || !action.id.trim()
    || action.id.length > MAX_ACTION_ID_LENGTH
    || !ROBOTICS_TOOL_NAMES.has(action.name)
  ) return null;
  if ('responseRequired' in action && typeof action.responseRequired !== 'boolean') return null;
  const parameters = normalizeActionParameters(action.name, action.parameters);
  if (!parameters) return null;
  return {
    id: action.id,
    name: action.name,
    parameters,
    ...('responseRequired' in action ? { responseRequired: action.responseRequired } : {})
  };
}

function normalizeToolCall(message) {
  if (!message || message.type !== 'tool_call') return null;
  const name = message.name || message.tool_name || message.function?.name;
  if (!ROBOTICS_TOOL_NAMES.has(name)) return null;
  let parameters = message.parameters ?? message.arguments ?? message.function?.arguments ?? {};
  if (typeof parameters === 'string') {
    try { parameters = JSON.parse(parameters); } catch { return null; }
  }
  const id = message.tool_call_id || message.toolCallId;
  return normalizeRobotAction({
    id,
    name,
    parameters,
    responseRequired: message.response_required !== false
  });
}

function signRobotAction(action, claims, config, now = Date.now()) {
  if (typeof config?.sessionJWTSecret !== 'string' || config.sessionJWTSecret.length < 32) {
    throw new Error('SESSION_JWT_SECRET is required to sign robot actions');
  }
  if (!claims?.sub || !claims?.sid) throw new Error('Authenticated session claims are required');
  const normalizedAction = normalizeRobotAction(action);
  if (!normalizedAction) throw new Error('Robot action is invalid');
  const issuedAt = Math.floor(now / 1000);
  const header = { alg: 'HS256', typ: 'robot-action+jwt' };
  const payload = {
    iss: ROBOT_ACTION_ISSUER,
    aud: ROBOT_ACTION_AUDIENCE,
    sub: claims.sub,
    sid: claims.sid,
    iat: issuedAt,
    exp: issuedAt + ROBOT_ACTION_TTL_SECONDS,
    jti: crypto.randomUUID(),
    action: normalizedAction
  };
  const signingInput = `${base64url(header)}.${base64url(payload)}`;
  const signature = crypto.createHmac('sha256', config.sessionJWTSecret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function verificationFailure(config, reason) {
  config?.logger?.warn?.('[RoboticsGateway] robot action verification rejected', { reason });
  return { valid: false, reason };
}

function inspectRobotActionToken(token, claims, config, now = Date.now(), {
  maxExpiredSeconds = ROBOT_ACTION_CLOCK_TOLERANCE_SECONDS
} = {}) {
  if (typeof config?.sessionJWTSecret !== 'string' || config.sessionJWTSecret.length < 32) {
    return verificationFailure(config, 'secret_unconfigured');
  }
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) {
    return verificationFailure(config, 'token_invalid');
  }
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))) {
    return verificationFailure(config, 'token_invalid');
  }
  const [encodedHeader, encodedPayload, signature] = segments;
  let receivedSignature;
  try { receivedSignature = Buffer.from(signature, 'base64url'); } catch {
    return verificationFailure(config, 'signature_invalid');
  }
  const expectedSignature = crypto.createHmac('sha256', config.sessionJWTSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  if (
    receivedSignature.length !== expectedSignature.length
    || !crypto.timingSafeEqual(receivedSignature, expectedSignature)
  ) return verificationFailure(config, 'signature_invalid');

  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url'));
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url'));
  } catch {
    return verificationFailure(config, 'claims_invalid');
  }
  if (header?.alg !== 'HS256' || header.typ !== 'robot-action+jwt') {
    return verificationFailure(config, 'header_invalid');
  }
  if (payload?.iss !== ROBOT_ACTION_ISSUER || payload?.aud !== ROBOT_ACTION_AUDIENCE) {
    return verificationFailure(config, 'issuer_or_audience_invalid');
  }
  if (
    typeof claims?.sub !== 'string'
    || typeof claims?.sid !== 'string'
    || payload?.sub !== claims.sub
    || payload?.sid !== claims.sid
  ) return verificationFailure(config, 'session_mismatch');
  if (
    !Number.isSafeInteger(payload?.iat)
    || !Number.isSafeInteger(payload?.exp)
    || payload.exp <= payload.iat
    || payload.exp - payload.iat > ROBOT_ACTION_TTL_SECONDS
    || typeof payload?.jti !== 'string'
    || !ROBOT_ACTION_JTI_PATTERN.test(payload.jti)
  ) return verificationFailure(config, 'claims_invalid');

  const nowSeconds = Math.floor(now / 1000);
  if (payload.iat > nowSeconds + ROBOT_ACTION_CLOCK_TOLERANCE_SECONDS) {
    return verificationFailure(config, 'token_not_yet_valid');
  }
  if (payload.exp < nowSeconds - maxExpiredSeconds) {
    return verificationFailure(config, 'token_expired');
  }
  const action = normalizeRobotAction(payload.action);
  if (!action) return verificationFailure(config, 'action_invalid');
  return { valid: true, payload: { ...payload, action } };
}

function verifyRobotActionToken(token, claims, config, now = Date.now()) {
  const inspected = inspectRobotActionToken(token, claims, config, now);
  return inspected.valid ? inspected.payload : null;
}

function refreshRobotActionEnvelope(token, claims, config, now = Date.now()) {
  const inspected = inspectRobotActionToken(token, claims, config, now, {
    maxExpiredSeconds: ROBOT_ACTION_REFRESH_WINDOW_SECONDS
  });
  if (!inspected.valid) return null;
  return {
    type: ROBOT_ACTION_TYPE,
    token: signRobotAction(inspected.payload.action, claims, config, now)
  };
}

function createRobotActionEnvelope(message, claims, config, now) {
  const action = normalizeToolCall(message);
  if (!action) return null;
  return {
    type: ROBOT_ACTION_TYPE,
    token: signRobotAction(action, claims, config, now)
  };
}

function inspectRoboticsToolFrame(payload, isBinary, claims, config) {
  if (isBinary) return null;
  let message;
  try {
    message = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8'));
  } catch {
    return null;
  }
  return createRobotActionEnvelope(message, claims, config);
}

module.exports = {
  ROBOT_ACTION_AUDIENCE,
  ROBOT_ACTION_CLOCK_TOLERANCE_SECONDS,
  ROBOT_ACTION_ISSUER,
  ROBOT_ACTION_REFRESH_WINDOW_SECONDS,
  ROBOT_ACTION_TYPE,
  ROBOTICS_TOOL_NAMES,
  createRobotActionEnvelope,
  inspectRobotActionToken,
  inspectRoboticsToolFrame,
  normalizeRobotAction,
  normalizeToolCall,
  refreshRobotActionEnvelope,
  signRobotAction,
  verifyRobotActionToken
};
