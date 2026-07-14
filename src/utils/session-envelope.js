import { decodeBase64URLJSON } from './base64';

export const SESSION_ENVELOPE_VERSION = 1;

export const SESSION_ENVELOPE_FAILURE = Object.freeze({
  MALFORMED: 'SESSION_ENVELOPE_MALFORMED',
  UNSUPPORTED_VERSION: 'SESSION_ENVELOPE_UNSUPPORTED_VERSION',
  ACCESS_TOKEN_INVALID: 'SESSION_ENVELOPE_ACCESS_TOKEN_INVALID',
  REFRESH_TOKEN_INVALID: 'SESSION_ENVELOPE_REFRESH_TOKEN_INVALID',
  ACCESS_TOKEN_EXPIRED: 'SESSION_ENVELOPE_ACCESS_TOKEN_EXPIRED',
  REFRESH_TOKEN_EXPIRED: 'SESSION_ENVELOPE_REFRESH_TOKEN_EXPIRED',
  MIXED_ACCOUNT: 'SESSION_ENVELOPE_MIXED_ACCOUNT',
  PROFILE_MISMATCH: 'SESSION_ENVELOPE_PROFILE_MISMATCH',
  EXPIRY_MISMATCH: 'SESSION_ENVELOPE_EXPIRY_MISMATCH'
});

const MAX_SERIALIZED_ENVELOPE_LENGTH = 64 * 1024;
const MAX_TOKEN_LENGTH = 20_000;
const MAX_USER_LENGTH = 8 * 1024;
const JWT_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

function failure(reason) {
  return Object.freeze({ ok: false, reason });
}

function safeNow(options) {
  const value = typeof options?.now === 'function' ? options.now() : Date.now();
  return Number.isFinite(value) ? value : Date.now();
}

function safeSkewSeconds(options) {
  const value = Number(options?.skewSeconds);
  if (!Number.isFinite(value)) return 30;
  return Math.min(300, Math.max(0, value));
}

function decodeToken(token, expectedType, nowSeconds, skewSeconds, { allowExpired = false } = {}) {
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) {
    return { valid: false, expired: false };
  }
  const segments = token.split('.');
  if (
    segments.length !== 3
    || segments.some((segment) => !segment || !JWT_SEGMENT_PATTERN.test(segment))
  ) {
    return { valid: false, expired: false };
  }
  let header;
  let claims;
  try {
    header = decodeBase64URLJSON(segments[0]);
    claims = decodeBase64URLJSON(segments[1]);
  } catch {
    return { valid: false, expired: false };
  }
  if (
    !header
    || typeof header !== 'object'
    || Array.isArray(header)
    || header.alg !== 'HS256'
    || !claims
    || typeof claims !== 'object'
    || Array.isArray(claims)
  ) {
    return { valid: false, expired: false };
  }
  if (segments[2].length !== 43) {
    return { valid: false, expired: false };
  }
  if (expectedType === 'access' && header.typ !== 'JWT') {
    return { valid: false, expired: false };
  }
  if (
    expectedType === 'refresh'
    && (header.typ !== 'refresh+jwt' || claims.scope !== 'session:refresh')
  ) {
    return { valid: false, expired: false };
  }
  if (
    typeof claims.sub !== 'string'
    || !claims.sub
    || claims.sub.length > 512
    || typeof claims.sid !== 'string'
    || !claims.sid
    || claims.sid.length > 256
    || !Number.isSafeInteger(claims.exp)
    || claims.exp <= 0
    || claims.exp > Math.floor(Number.MAX_SAFE_INTEGER / 1000)
  ) {
    return { valid: false, expired: false };
  }
  if (
    (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > nowSeconds + skewSeconds))
    || (claims.iat !== undefined && (!Number.isFinite(claims.iat) || claims.iat > nowSeconds + skewSeconds))
  ) {
    return { valid: false, expired: false };
  }
  if (claims.exp <= nowSeconds + skewSeconds) {
    return { valid: allowExpired, expired: true, claims };
  }
  return { valid: true, claims };
}

function safeUser(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    if (!serialized || serialized.length > MAX_USER_LENGTH) return null;
    const user = JSON.parse(serialized);
    if (!user || typeof user !== 'object' || Array.isArray(user)) return null;
    return user;
  } catch {
    return null;
  }
}

function candidateFrom(value) {
  if (typeof value === 'string') {
    if (!value || value.length > MAX_SERIALIZED_ENVELOPE_LENGTH) return null;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function inspectSessionEnvelope(value, options = {}) {
  const candidate = candidateFrom(value);
  if (!candidate) return failure(SESSION_ENVELOPE_FAILURE.MALFORMED);
  if (candidate.version !== SESSION_ENVELOPE_VERSION) {
    return failure(SESSION_ENVELOPE_FAILURE.UNSUPPORTED_VERSION);
  }
  const nowSeconds = Math.floor(safeNow(options) / 1000);
  const skewSeconds = safeSkewSeconds(options);
  const access = decodeToken(candidate.accessToken, 'access', nowSeconds, skewSeconds, {
    allowExpired: options.allowExpiredAccess === true
  });
  if (!access.valid) {
    return failure(access.expired
      ? SESSION_ENVELOPE_FAILURE.ACCESS_TOKEN_EXPIRED
      : SESSION_ENVELOPE_FAILURE.ACCESS_TOKEN_INVALID);
  }
  const refresh = decodeToken(candidate.refreshToken, 'refresh', nowSeconds, skewSeconds);
  if (!refresh.valid) {
    return failure(refresh.expired
      ? SESSION_ENVELOPE_FAILURE.REFRESH_TOKEN_EXPIRED
      : SESSION_ENVELOPE_FAILURE.REFRESH_TOKEN_INVALID);
  }
  if (access.claims.sub !== refresh.claims.sub || access.claims.sid !== refresh.claims.sid) {
    return failure(SESSION_ENVELOPE_FAILURE.MIXED_ACCOUNT);
  }
  const user = safeUser(candidate.user);
  if (
    !user
    || typeof user.id !== 'string'
    || user.id !== access.claims.sub
    || (
      user.provider !== undefined
      && (
        !['apple', 'google', 'phone'].includes(user.provider)
        || !user.id.startsWith(`${user.provider}:`)
      )
    )
  ) {
    return failure(SESSION_ENVELOPE_FAILURE.PROFILE_MISMATCH);
  }
  const expiresAt = access.claims.exp * 1000;
  const refreshExpiresAt = refresh.claims.exp * 1000;
  if (candidate.expiresAt !== expiresAt || candidate.refreshExpiresAt !== refreshExpiresAt) {
    return failure(SESSION_ENVELOPE_FAILURE.EXPIRY_MISMATCH);
  }
  const envelope = Object.freeze({
    version: SESSION_ENVELOPE_VERSION,
    accessToken: candidate.accessToken,
    refreshToken: candidate.refreshToken,
    user: Object.freeze(user),
    expiresAt,
    refreshExpiresAt
  });
  return Object.freeze({ ok: true, value: envelope });
}

export function parseSessionEnvelope(value, options) {
  const result = inspectSessionEnvelope(value, options);
  return result.ok ? result.value : null;
}

export function createSessionEnvelope({ accessToken, refreshToken, user } = {}, options = {}) {
  const nowSeconds = Math.floor(safeNow(options) / 1000);
  const skewSeconds = safeSkewSeconds(options);
  const access = decodeToken(accessToken, 'access', nowSeconds, skewSeconds, {
    allowExpired: options.allowExpiredAccess === true
  });
  const refresh = decodeToken(refreshToken, 'refresh', nowSeconds, skewSeconds);
  if (!access.valid || !refresh.valid) return null;
  return parseSessionEnvelope({
    version: SESSION_ENVELOPE_VERSION,
    accessToken,
    refreshToken,
    user,
    expiresAt: access.claims.exp * 1000,
    refreshExpiresAt: refresh.claims.exp * 1000
  }, options);
}

export function serializeSessionEnvelope(session, options) {
  const envelope = createSessionEnvelope(session, options);
  return envelope ? JSON.stringify(envelope) : null;
}

export function migrateLegacySession({ accessToken, refreshToken, user } = {}, options) {
  let profile = user;
  if (typeof user === 'string') {
    try {
      profile = JSON.parse(user);
    } catch {
      return null;
    }
  }
  return createSessionEnvelope({ accessToken, refreshToken, user: profile }, options);
}
