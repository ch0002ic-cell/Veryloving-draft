'use strict';

const crypto = require('node:crypto');

const ROBOT_ACTION_TYPE = 'ROBOT_ACTION';
const ROBOT_ACTION_ISSUER = 'veryloving-robotics-gateway';
const ROBOT_ACTION_AUDIENCE = 'veryloving-robotics-mobile';
const ROBOT_ACTION_TTL_SECONDS = 30;
const ROBOTICS_TOOL_NAMES = new Set([
  'navigate_robo_cane',
  'robot_stop',
  'stop_robo_cane',
  'find_robot',
  'set_robot_speed'
]);

function base64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

function normalizeToolCall(message) {
  if (!message || message.type !== 'tool_call') return null;
  const name = message.name || message.tool_name || message.function?.name;
  if (!ROBOTICS_TOOL_NAMES.has(name)) return null;
  let parameters = message.parameters ?? message.arguments ?? message.function?.arguments ?? {};
  if (typeof parameters === 'string') {
    try { parameters = JSON.parse(parameters); } catch { return null; }
  }
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return null;
  return {
    id: message.tool_call_id || message.toolCallId || crypto.randomUUID(),
    name,
    parameters
  };
}

function signRobotAction(action, claims, config, now = Date.now()) {
  if (typeof config?.sessionJWTSecret !== 'string' || config.sessionJWTSecret.length < 32) {
    throw new Error('SESSION_JWT_SECRET is required to sign robot actions');
  }
  if (!claims?.sub || !claims?.sid) throw new Error('Authenticated session claims are required');
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
    action
  };
  const signingInput = `${base64url(header)}.${base64url(payload)}`;
  const signature = crypto.createHmac('sha256', config.sessionJWTSecret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function verifyRobotActionToken(token, claims, config, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 20000) return null;
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = segments;
  const expected = crypto.createHmac('sha256', config.sessionJWTSecret || '')
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url'));
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url'));
  } catch { return null; }
  const nowSeconds = Math.floor(now / 1000);
  if (
    header?.alg !== 'HS256'
    || header.typ !== 'robot-action+jwt'
    || payload?.iss !== ROBOT_ACTION_ISSUER
    || payload?.aud !== ROBOT_ACTION_AUDIENCE
    || payload?.sub !== claims?.sub
    || payload?.sid !== claims?.sid
    || !Number.isSafeInteger(payload?.exp)
    || payload.exp <= nowSeconds
    || payload.exp > nowSeconds + ROBOT_ACTION_TTL_SECONDS
    || !payload.action
  ) return null;
  return payload;
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
  ROBOT_ACTION_ISSUER,
  ROBOT_ACTION_TYPE,
  ROBOTICS_TOOL_NAMES,
  createRobotActionEnvelope,
  inspectRoboticsToolFrame,
  normalizeToolCall,
  signRobotAction,
  verifyRobotActionToken
};
