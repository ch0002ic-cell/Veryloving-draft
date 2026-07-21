'use strict';

const crypto = require('node:crypto');
const { URLSearchParams } = require('node:url');
const { cancelResponseBody, readBoundedJSONResponse } = require('./bounded-response.cjs');

const TWILIO_VERIFY_BASE_URL = 'https://verify.twilio.com/v2';
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const VERIFICATION_CODE_PATTERN = /^\d{6}$/;
const CHALLENGE_TYPE = 'phone-auth+jwt';
const CHALLENGE_PURPOSE = 'phone:verify';
const MIN_SECRET_LENGTH = 32;
const DEFAULT_CHALLENGE_TTL_SECONDS = 300;
const MIN_CHALLENGE_TTL_SECONDS = 60;
const MAX_CHALLENGE_TTL_SECONDS = 600;
const MAX_CHALLENGE_LENGTH = 4096;
const PROVIDER_TIMEOUT_MS = 7000;
const MAX_PROVIDER_TIMEOUT_MS = 30000;
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;

const PHONE_AUTH_CODES = Object.freeze({
  INVALID: 'PHONE_AUTH_INVALID',
  NOT_CONFIGURED: 'PHONE_AUTH_NOT_CONFIGURED',
  PROVIDER_UNAVAILABLE: 'PHONE_AUTH_PROVIDER_UNAVAILABLE',
  RATE_LIMITED: 'PHONE_AUTH_RATE_LIMITED',
  USED: 'PHONE_AUTH_CHALLENGE_USED'
});

class PhoneAuthError extends Error {
  constructor(message, { code, statusCode, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PhoneAuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function phoneAuthError(code, statusCode, message, cause) {
  return new PhoneAuthError(message, { code, statusCode, cause });
}

function invalidPhoneAuth(message = 'Phone verification request is invalid', statusCode = 400) {
  return phoneAuthError(PHONE_AUTH_CODES.INVALID, statusCode, message);
}

function challengeTTL(config) {
  const configured = Number(config.phoneAuthChallengeTTLSeconds);
  if (!Number.isFinite(configured)) return DEFAULT_CHALLENGE_TTL_SECONDS;
  return Math.min(MAX_CHALLENGE_TTL_SECONDS, Math.max(MIN_CHALLENGE_TTL_SECONDS, configured));
}

function providerTimeout(config) {
  const selected = config.phoneAuthProviderTimeoutMs === undefined
    ? PROVIDER_TIMEOUT_MS
    : Number(config.phoneAuthProviderTimeoutMs);
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > MAX_PROVIDER_TIMEOUT_MS) {
    throw new Error('Phone verification provider timeout is invalid');
  }
  return selected;
}

function nowMilliseconds(config) {
  return typeof config.now === 'function' ? config.now() : Date.now();
}

function normalizedPhone(value) {
  const phone = typeof value === 'string' ? value.trim() : '';
  if (!PHONE_PATTERN.test(phone)) throw invalidPhoneAuth('Enter a valid international phone number');
  return phone;
}

function normalizedCountryCode(value) {
  const countryCode = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!COUNTRY_CODE_PATTERN.test(countryCode)) throw invalidPhoneAuth('Country code is invalid');
  return countryCode;
}

function normalizedVerificationCode(value) {
  const code = typeof value === 'string' ? value.trim() : '';
  if (!VERIFICATION_CODE_PATTERN.test(code)) {
    throw invalidPhoneAuth('Verification code is invalid or expired', 401);
  }
  return code;
}

function configuredSecret(value) {
  return typeof value === 'string' && value.length >= MIN_SECRET_LENGTH;
}

function twilioConfigurationIsValid(config) {
  return /^AC[a-f0-9]{32}$/i.test(config.twilioAccountSid || '')
    && /^VA[a-f0-9]{32}$/i.test(config.twilioVerifyServiceSid || '')
    && typeof config.twilioAuthToken === 'string'
    && config.twilioAuthToken.length >= 16
    && typeof config.fetchImpl === 'function';
}

function validatePhoneAuthConfig(config) {
  if (!config.phoneAuthEnabled) return config;
  if (!configuredSecret(config.phoneAuthChallengeSecret)) {
    throw new Error('PHONE_AUTH_CHALLENGE_SECRET must contain at least 32 characters when phone auth is enabled');
  }
  if (!configuredSecret(config.sessionJWTSecret)) {
    throw new Error('SESSION_JWT_SECRET must contain at least 32 characters when phone auth is enabled');
  }
  if (!configuredSecret(config.phoneAuthSubjectSecret)) {
    throw new Error('PHONE_AUTH_SUBJECT_SECRET must contain at least 32 characters when phone auth is enabled');
  }
  if (!/^AC[a-f0-9]{32}$/i.test(config.twilioAccountSid || '')) {
    throw new Error('TWILIO_ACCOUNT_SID is invalid when phone auth is enabled');
  }
  if (typeof config.twilioAuthToken !== 'string' || config.twilioAuthToken.length < 16) {
    throw new Error('TWILIO_AUTH_TOKEN is invalid when phone auth is enabled');
  }
  if (!/^VA[a-f0-9]{32}$/i.test(config.twilioVerifyServiceSid || '')) {
    throw new Error('TWILIO_VERIFY_SERVICE_SID is invalid when phone auth is enabled');
  }
  if (typeof config.fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required when phone auth is enabled');
  }
  return config;
}

function assertPhoneAuthConfigured(config) {
  if (
    !config.phoneAuthEnabled
    || !configuredSecret(config.phoneAuthChallengeSecret)
    || !configuredSecret(config.sessionJWTSecret)
    || !configuredSecret(config.phoneAuthSubjectSecret)
    || !twilioConfigurationIsValid(config)
  ) {
    throw phoneAuthError(
      PHONE_AUTH_CODES.NOT_CONFIGURED,
      503,
      'Phone authentication is not configured'
    );
  }
}

function encodeJSON(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeJSON(value) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw invalidPhoneAuth('Phone verification challenge is invalid');
  }
}

function signPhoneChallenge({ phone, countryCode }, config) {
  assertPhoneAuthConfigured(config);
  const safePhone = normalizedPhone(phone);
  const safeCountryCode = normalizedCountryCode(countryCode);
  const issuedAt = Math.floor(nowMilliseconds(config) / 1000);
  const expiresAt = issuedAt + challengeTTL(config);
  const header = { alg: 'HS256', typ: CHALLENGE_TYPE };
  const payload = {
    purpose: CHALLENGE_PURPOSE,
    phone: safePhone,
    countryCode: safeCountryCode,
    jti: (config.randomUUID || crypto.randomUUID)(),
    iat: issuedAt,
    exp: expiresAt
  };
  const signingInput = `${encodeJSON(header)}.${encodeJSON(payload)}`;
  const signature = crypto
    .createHmac('sha256', config.phoneAuthChallengeSecret)
    .update(signingInput)
    .digest('base64url');
  return {
    verificationId: `${signingInput}.${signature}`,
    expiresAt: expiresAt * 1000,
    payload
  };
}

function verifyPhoneChallenge(verificationId, config) {
  assertPhoneAuthConfigured(config);
  if (typeof verificationId !== 'string' || !verificationId || verificationId.length > MAX_CHALLENGE_LENGTH) {
    throw invalidPhoneAuth('Phone verification challenge is invalid');
  }
  const segments = verificationId.split('.');
  if (segments.length !== 3 || segments.some((segment) => !segment)) {
    throw invalidPhoneAuth('Phone verification challenge is invalid');
  }
  const header = decodeJSON(segments[0]);
  const payload = decodeJSON(segments[1]);
  if (header.alg !== 'HS256' || header.typ !== CHALLENGE_TYPE) {
    throw invalidPhoneAuth('Phone verification challenge is invalid');
  }
  const signature = Buffer.from(segments[2], 'base64url');
  const expected = crypto
    .createHmac('sha256', config.phoneAuthChallengeSecret)
    .update(`${segments[0]}.${segments[1]}`)
    .digest();
  if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) {
    throw invalidPhoneAuth('Phone verification challenge is invalid');
  }
  const nowSeconds = Math.floor(nowMilliseconds(config) / 1000);
  if (
    payload.purpose !== CHALLENGE_PURPOSE
    || !PHONE_PATTERN.test(payload.phone || '')
    || !COUNTRY_CODE_PATTERN.test(payload.countryCode || '')
    || typeof payload.jti !== 'string'
    || !Number.isFinite(payload.iat)
    || !Number.isFinite(payload.exp)
    || payload.iat > nowSeconds + 30
    || payload.exp <= nowSeconds
    || payload.exp - payload.iat > MAX_CHALLENGE_TTL_SECONDS
  ) {
    throw invalidPhoneAuth('Phone verification challenge is invalid or expired', 401);
  }
  return payload;
}

function phoneSubject(phone, secret) {
  if (!configuredSecret(secret)) throw new Error('Phone subject hashing is not configured');
  const safePhone = normalizedPhone(phone);
  return crypto
    .createHmac('sha256', secret)
    .update(`veryloving-phone-subject:v1:${safePhone}`)
    .digest('base64url');
}

async function safeJSON(response, signal) {
  try {
    return await readBoundedJSONResponse(response, {
      context: 'Phone verification provider',
      maxBytes: MAX_PROVIDER_RESPONSE_BYTES,
      signal
    });
  } catch (error) {
    if (error?.code === 'UPSTREAM_RESPONSE_TOO_LARGE') throw error;
    return null;
  }
}

function providerError(operation, status, cause) {
  if (status === 429) {
    return phoneAuthError(
      PHONE_AUTH_CODES.RATE_LIMITED,
      429,
      'Too many phone verification attempts. Please wait and try again.',
      cause
    );
  }
  if (operation === 'verify' && [400, 404].includes(status)) {
    return phoneAuthError(
      PHONE_AUTH_CODES.INVALID,
      401,
      'Verification code is invalid or expired',
      cause
    );
  }
  return phoneAuthError(
    PHONE_AUTH_CODES.PROVIDER_UNAVAILABLE,
    502,
    'Phone verification is temporarily unavailable',
    cause
  );
}

async function requestTwilioVerify(operation, fields, config) {
  const service = encodeURIComponent(config.twilioVerifyServiceSid);
  const endpoint = operation === 'start' ? 'Verifications' : 'VerificationCheck';
  const timeoutMs = providerTimeout(config);
  const controller = new AbortController();
  let timedOut = false;
  let timeoutHandle;
  let providerResponse;
  const request = (async () => {
    let response;
    try {
      response = await config.fetchImpl(`${TWILIO_VERIFY_BASE_URL}/Services/${service}/${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json'
        },
        body: new URLSearchParams(fields).toString(),
        redirect: 'error',
        signal: controller.signal
      });
      providerResponse = response;
    } catch (error) {
      throw providerError(operation, 0, error);
    }
    if (timedOut) {
      await cancelResponseBody(response);
      throw providerError(operation, 0, new Error('Phone verification provider timed out'));
    }
    let payload;
    try {
      payload = await safeJSON(response, controller.signal);
    } catch (error) {
      throw providerError(operation, 0, error);
    }
    if (timedOut) throw providerError(operation, 0, new Error('Phone verification provider timed out'));
    if (!response.ok) throw providerError(operation, response.status, payload);
    return payload;
  })();
  void request.catch(() => {});
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      void cancelResponseBody(providerResponse);
      reject(providerError(operation, 0, new Error('Phone verification provider timed out')));
    }, timeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function startPhoneVerification(body, config) {
  assertPhoneAuthConfigured(config);
  const phone = normalizedPhone(body?.phone);
  const countryCode = normalizedCountryCode(body?.countryCode);
  const provider = await requestTwilioVerify('start', { To: phone, Channel: 'sms' }, config);
  if (provider?.status !== 'pending') throw providerError('start', 502, provider);
  const challenge = signPhoneChallenge({ phone, countryCode }, config);
  return {
    verificationId: challenge.verificationId,
    phone,
    countryCode,
    expiresAt: challenge.expiresAt
  };
}

async function verifyPhoneVerification(body, config) {
  assertPhoneAuthConfigured(config);
  const challenge = verifyPhoneChallenge(body?.verificationId, config);
  const code = normalizedVerificationCode(body?.code);
  const provider = await requestTwilioVerify('verify', { To: challenge.phone, Code: code }, config);
  if (provider?.status !== 'approved') {
    throw phoneAuthError(
      PHONE_AUTH_CODES.INVALID,
      401,
      'Verification code is invalid or expired'
    );
  }
  return challenge;
}

async function consumePhoneVerificationChallenge(challenge, config) {
  const repository = config.phoneChallengeRepository || config.authSessionRepository;
  if (typeof repository?.consumePhoneChallenge === 'function') {
    try {
      await repository.consumePhoneChallenge({
        jti: challenge.jti,
        expiresAt: challenge.exp * 1000,
        now: nowMilliseconds(config)
      });
    } catch (error) {
      if (error?.code === PHONE_AUTH_CODES.USED) {
        throw phoneAuthError(PHONE_AUTH_CODES.USED, 410, 'Phone verification challenge has already been used');
      }
      throw error;
    }
    return true;
  }
  if (config.nodeEnv === 'production') {
    throw phoneAuthError(PHONE_AUTH_CODES.NOT_CONFIGURED, 503, 'Phone authentication is not configured');
  }
  // Development/demo servers deliberately avoid external persistence. Keep a
  // bounded process-local replay fence so concurrent requests still cannot
  // mint two sessions from the same approved verification challenge.
  const cache = config.phoneChallengeReplayCache instanceof Map
    ? config.phoneChallengeReplayCache
    : (config.phoneChallengeReplayCache = new Map());
  const timestamp = nowMilliseconds(config);
  for (const [jti, expiresAt] of cache) {
    if (expiresAt <= timestamp) cache.delete(jti);
  }
  if (cache.has(challenge.jti)) {
    throw phoneAuthError(PHONE_AUTH_CODES.USED, 410, 'Phone verification challenge has already been used');
  }
  if (cache.size >= 10000) {
    throw phoneAuthError(
      PHONE_AUTH_CODES.PROVIDER_UNAVAILABLE,
      503,
      'Phone verification is temporarily unavailable'
    );
  }
  cache.set(challenge.jti, challenge.exp * 1000);
  return true;
}

module.exports = {
  PHONE_AUTH_CODES,
  PHONE_PATTERN,
  PhoneAuthError,
  TWILIO_VERIFY_BASE_URL,
  phoneSubject,
  signPhoneChallenge,
  startPhoneVerification,
  consumePhoneVerificationChallenge,
  validatePhoneAuthConfig,
  verifyPhoneChallenge,
  verifyPhoneVerification
};
