'use strict';

const crypto = require('node:crypto');

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const JWKS_CACHE_MS = 60 * 60 * 1000;
const UNKNOWN_KID_REFRESH_COOLDOWN_MS = 60 * 1000;
const jwksCache = new Map();
const unknownKidRefreshAt = new Map();

function decodeJSON(segment, label) {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new Error(`${label} is invalid`);
  }
}

function parseJWT(token) {
  if (typeof token !== 'string' || token.length > 20000) throw new Error('Identity token is invalid');
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some((segment) => !segment)) throw new Error('Identity token is invalid');
  return {
    header: decodeJSON(segments[0], 'Identity token header'),
    payload: decodeJSON(segments[1], 'Identity token payload'),
    signature: Buffer.from(segments[2], 'base64url'),
    signingInput: `${segments[0]}.${segments[1]}`
  };
}

function stringList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

async function loadJWKS(url, { fetchImpl = globalThis.fetch, now = Date.now, forceRefresh = false } = {}) {
  const cached = jwksCache.get(url);
  if (!forceRefresh && cached && cached.expiresAt > now()) return cached.keys;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error('Identity provider keys are unavailable');
    const body = await response.json();
    if (!Array.isArray(body?.keys) || !body.keys.length) throw new Error('Identity provider keys are invalid');
    jwksCache.set(url, { keys: body.keys, expiresAt: now() + JWKS_CACHE_MS });
    return body.keys;
  } finally {
    clearTimeout(timeout);
  }
}

function hasAudience(claimAudience, allowedAudiences) {
  const audiences = Array.isArray(claimAudience) ? claimAudience : [claimAudience];
  return audiences.some((audience) => allowedAudiences.includes(audience));
}

function validateProviderClaims(provider, payload, {
  appleClientIds,
  googleTokenAudiences,
  googleAuthorizedParties,
  nonce,
  nowSeconds
}) {
  const allowedAudiences = provider === 'apple'
    ? stringList(appleClientIds)
    : stringList(googleTokenAudiences);
  if (!allowedAudiences.length) throw new Error(`${provider} authentication is not configured`);
  if (provider === 'apple' && payload.iss !== 'https://appleid.apple.com') throw new Error('Identity token issuer is invalid');
  if (provider === 'google' && !GOOGLE_ISSUERS.has(payload.iss)) throw new Error('Identity token issuer is invalid');
  if (!hasAudience(payload.aud, allowedAudiences)) throw new Error('Identity token audience is invalid');
  if (provider === 'google') {
    const allowedAuthorizedParties = stringList(googleAuthorizedParties);
    const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.azp && !allowedAuthorizedParties.includes(payload.azp)) {
      throw new Error('Identity token authorized party is invalid');
    }
    if (tokenAudiences.length > 1 && !payload.azp) {
      throw new Error('Identity token authorized party is required');
    }
  }
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('Identity token subject is invalid');
  if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) throw new Error('Identity token has expired');
  if (payload.iat && (!Number.isFinite(payload.iat) || payload.iat > nowSeconds + 300)) {
    throw new Error('Identity token issue time is invalid');
  }
  if (nonce && payload.nonce !== nonce) throw new Error('Identity token nonce is invalid');
}

async function verifyProviderIdentityToken({ provider, idToken, nonce }, options = {}) {
  if (!['apple', 'google'].includes(provider)) throw new Error('Authentication provider is not supported');
  const parsed = parseJWT(idToken);
  if (parsed.header.alg !== 'RS256' || !parsed.header.kid) throw new Error('Identity token algorithm is invalid');
  const jwksURL = provider === 'apple' ? APPLE_JWKS_URL : GOOGLE_JWKS_URL;
  let keys = await loadJWKS(jwksURL, options);
  let jwk = keys.find((candidate) => candidate.kid === parsed.header.kid && candidate.kty === 'RSA');
  if (!jwk) {
    // Provider keys rotate. Refresh once for an unknown key ID, while a short
    // per-provider cooldown prevents an attacker from turning random `kid`
    // values into an unbounded outbound request stream.
    const nowMs = options.now?.() || Date.now();
    const lastRefresh = unknownKidRefreshAt.get(jwksURL) || 0;
    if (nowMs - lastRefresh >= UNKNOWN_KID_REFRESH_COOLDOWN_MS) {
      unknownKidRefreshAt.set(jwksURL, nowMs);
      keys = await loadJWKS(jwksURL, { ...options, forceRefresh: true });
      jwk = keys.find((candidate) => candidate.kid === parsed.header.kid && candidate.kty === 'RSA');
    }
  }
  if (!jwk) throw new Error('Identity token signing key is unavailable');
  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    throw new Error('Identity token signing key is invalid');
  }
  const validSignature = crypto.verify(
    'RSA-SHA256',
    Buffer.from(parsed.signingInput),
    publicKey,
    parsed.signature
  );
  if (!validSignature) throw new Error('Identity token signature is invalid');
  const nowSeconds = Math.floor((options.now?.() || Date.now()) / 1000);
  validateProviderClaims(provider, parsed.payload, { ...options, nonce, nowSeconds });
  return parsed.payload;
}

function sessionJWTConfig(config) {
  const configuredTTL = Number(config.sessionJWTTTLSeconds);
  const configuredRefreshTTL = Number(config.sessionJWTRefreshTTLSeconds);
  return {
    secret: config.sessionJWTSecret,
    issuer: config.sessionJWTIssuer || 'https://api.veryloving.ai',
    audience: config.sessionJWTAudience || 'veryloving-mobile',
    // Bound a bad deployment value so it cannot accidentally mint sessions
    // that are effectively permanent (or serialize Infinity as a null exp).
    ttlSeconds: Math.min(86400, Math.max(300, Number.isFinite(configuredTTL) ? configuredTTL : 3600)),
    refreshTTLSeconds: Math.min(
      90 * 86400,
      Math.max(86400, Number.isFinite(configuredRefreshTTL) ? configuredRefreshTTL : 30 * 86400)
    )
  };
}

function signSessionJWT(identity, config, { now = Date.now, randomUUID = crypto.randomUUID } = {}) {
  const jwt = sessionJWTConfig(config);
  if (typeof jwt.secret !== 'string' || jwt.secret.length < 32) throw new Error('Session signing is not configured');
  const issuedAt = Math.floor(now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: jwt.issuer,
    aud: jwt.audience,
    sub: identity.subjectClaim || `${identity.provider}:${identity.subject}`,
    sid: identity.sessionId || randomUUID(),
    jti: randomUUID(),
    scope: 'voice:connect safety:read safety:write',
    iat: issuedAt,
    nbf: issuedAt - 5,
    exp: issuedAt + jwt.ttlSeconds
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', jwt.secret).update(signingInput).digest('base64url');
  return { token: `${signingInput}.${signature}`, payload };
}

function signRefreshJWT(identity, config, { now = Date.now, randomUUID = crypto.randomUUID } = {}) {
  const jwt = sessionJWTConfig(config);
  if (typeof jwt.secret !== 'string' || jwt.secret.length < 32) throw new Error('Session signing is not configured');
  if (!identity?.subject || !identity?.sessionId) throw new Error('Refresh session identity is invalid');
  const issuedAt = Math.floor(now() / 1000);
  const header = { alg: 'HS256', typ: 'refresh+jwt' };
  const payload = {
    iss: jwt.issuer,
    aud: `${jwt.audience}:refresh`,
    sub: identity.subject,
    sid: identity.sessionId,
    jti: randomUUID(),
    scope: 'session:refresh',
    iat: issuedAt,
    nbf: issuedAt - 5,
    exp: issuedAt + jwt.refreshTTLSeconds
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', jwt.secret).update(signingInput).digest('base64url');
  return { token: `${signingInput}.${signature}`, payload };
}

function verifySessionJWT(token, config, { now = Date.now } = {}) {
  try {
    const jwt = sessionJWTConfig(config);
    if (typeof jwt.secret !== 'string' || jwt.secret.length < 32) return null;
    const parsed = parseJWT(token);
    if (parsed.header.alg !== 'HS256' || parsed.header.typ !== 'JWT') return null;
    const expected = crypto.createHmac('sha256', jwt.secret).update(parsed.signingInput).digest();
    if (expected.length !== parsed.signature.length || !crypto.timingSafeEqual(expected, parsed.signature)) return null;
    const nowSeconds = Math.floor(now() / 1000);
    if (parsed.payload.iss !== jwt.issuer || parsed.payload.aud !== jwt.audience) return null;
    if (!parsed.payload.sub || !parsed.payload.sid || !Number.isFinite(parsed.payload.exp)) return null;
    if (parsed.payload.exp <= nowSeconds || (parsed.payload.nbf && parsed.payload.nbf > nowSeconds)) return null;
    return parsed.payload;
  } catch {
    return null;
  }
}

function verifyRefreshJWT(token, config, { now = Date.now } = {}) {
  try {
    const jwt = sessionJWTConfig(config);
    if (typeof jwt.secret !== 'string' || jwt.secret.length < 32) return null;
    const parsed = parseJWT(token);
    if (parsed.header.alg !== 'HS256' || parsed.header.typ !== 'refresh+jwt') return null;
    const expected = crypto.createHmac('sha256', jwt.secret).update(parsed.signingInput).digest();
    if (expected.length !== parsed.signature.length || !crypto.timingSafeEqual(expected, parsed.signature)) return null;
    const nowSeconds = Math.floor(now() / 1000);
    if (parsed.payload.iss !== jwt.issuer || parsed.payload.aud !== `${jwt.audience}:refresh`) return null;
    if (!parsed.payload.sub || !parsed.payload.sid || !parsed.payload.jti || !Number.isFinite(parsed.payload.exp)) return null;
    if (parsed.payload.scope !== 'session:refresh') return null;
    if (parsed.payload.exp <= nowSeconds || (parsed.payload.nbf && parsed.payload.nbf > nowSeconds)) return null;
    return parsed.payload;
  } catch {
    return null;
  }
}

function profileFromClaims(provider, claims, displayName) {
  const safeDisplayName = typeof displayName === 'string' && displayName.trim().length <= 100
    ? displayName.trim()
    : null;
  return {
    id: `${provider}:${claims.sub}`,
    name: typeof claims.name === 'string' ? claims.name.slice(0, 100) : safeDisplayName,
    email: (claims.email_verified === true || claims.email_verified === 'true')
      && typeof claims.email === 'string'
      && claims.email.length <= 254
      ? claims.email
      : null,
    provider
  };
}

module.exports = {
  APPLE_JWKS_URL,
  GOOGLE_JWKS_URL,
  parseJWT,
  profileFromClaims,
  signRefreshJWT,
  signSessionJWT,
  stringList,
  verifyProviderIdentityToken,
  verifyRefreshJWT,
  verifySessionJWT
};
