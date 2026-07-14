import { config } from '../utils/config';
import { createAuthError } from '../utils/auth-configuration';
import { isSessionTokenUsable, sessionTokenClaims } from '../utils/session-token';

const AUTH_EXCHANGE_TIMEOUT_MS = 10000;

function authenticationEndpoint(path, apiBaseUrl) {
  if (!apiBaseUrl) {
    throw createAuthError(
      'AUTH_CONFIGURATION_MISSING',
      'Authentication requires a valid backend URL.'
    );
  }
  try {
    const base = new globalThis.URL(apiBaseUrl);
    const developmentRuntime = typeof __DEV__ !== 'undefined' && __DEV__;
    if (
      !['http:', 'https:'].includes(base.protocol)
      || base.username
      || base.password
      || base.search
      || base.hash
      || (base.protocol !== 'https:' && !developmentRuntime)
    ) throw new Error();
    base.pathname = `${base.pathname.replace(/\/$/, '')}${path}`;
    return base.toString();
  } catch {
    throw createAuthError(
      'AUTH_CONFIGURATION_INVALID',
      'Authentication requires a valid backend URL.'
    );
  }
}

function validateSession(payload) {
  const accessClaims = sessionTokenClaims(payload?.accessToken);
  const refreshClaims = sessionTokenClaims(payload?.refreshToken);
  if (
    !payload?.accessToken
    || !payload?.refreshToken
    || !Number.isFinite(payload?.expiresAt)
    || !Number.isFinite(payload?.refreshExpiresAt)
    || !isSessionTokenUsable(payload.accessToken, { skewSeconds: 0 })
    || !isSessionTokenUsable(payload.refreshToken, { skewSeconds: 0 })
    || accessClaims.sub !== refreshClaims.sub
    || !accessClaims.sid
    || accessClaims.sid !== refreshClaims.sid
    || Math.abs(accessClaims.exp * 1000 - payload.expiresAt) > 5000
    || Math.abs(refreshClaims.exp * 1000 - payload.refreshExpiresAt) > 5000
  ) {
    const error = new Error('The authentication server returned an invalid session.');
    error.code = 'AUTH_RESPONSE_INVALID';
    throw error;
  }
  return payload;
}

async function requestAuthenticationSession(
  path,
  body,
  { fetchImpl = globalThis.fetch, apiBaseUrl = config.apiBaseUrl } = {}
) {
  const endpoint = authenticationEndpoint(path, apiBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_EXCHANGE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error || 'Sign-in could not be verified.');
      error.code = `AUTH_HTTP_${response.status}`;
      if (path === '/v1/auth/phone/start') error.operation = 'phone-start';
      if (path === '/v1/auth/phone/verify') error.operation = 'phone-verify';
      if (typeof payload?.code === 'string' && /^PHONE_AUTH_[A-Z_]+$/.test(payload.code)) {
        error.serverCode = payload.code;
      }
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw createAuthError('AUTH_TIMEOUT', 'Sign-in verification timed out. Please try again.', error);
    }
    if (!error.code && error instanceof TypeError) {
      throw createAuthError('AUTH_NETWORK_ERROR', 'The authentication backend could not be reached.', error);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function exchangeProviderIdentity({ provider, idToken, nonce, displayName }) {
  if (!['apple', 'google'].includes(provider) || !idToken) throw new Error('A valid identity provider token is required.');
  const payload = validateSession(await requestAuthenticationSession('/v1/auth/exchange', {
    provider,
    idToken,
    nonce,
    displayName
  }));
  if (!payload.user?.id || payload.user.id !== sessionTokenClaims(payload.accessToken)?.sub) {
    throw new Error('The authentication server returned an invalid profile.');
  }
  return payload;
}

export function refreshApplicationSession(refreshToken, options) {
  if (!refreshToken) throw new Error('A refresh session is required.');
  return requestAuthenticationSession('/v1/auth/refresh', { refreshToken }, options)
    .then(validateSession);
}

export async function requestPhoneVerification({ phone, countryCode }, options) {
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || !/^[A-Z]{2}$/.test(countryCode)) {
    throw createAuthError('PHONE_NUMBER_INVALID', 'Enter a valid international phone number.');
  }
  const payload = await requestAuthenticationSession('/v1/auth/phone/start', {
    phone,
    countryCode
  }, options);
  if (
    typeof payload?.verificationId !== 'string'
    || !payload.verificationId
    || typeof payload.phone !== 'string'
    || typeof payload.countryCode !== 'string'
    || !Number.isFinite(payload.expiresAt)
    || payload.verificationId.length > 4096
    || payload.phone !== phone
    || payload.countryCode !== countryCode
    || !/^\+[1-9]\d{7,14}$/.test(payload.phone)
    || !/^[A-Z]{2}$/.test(payload.countryCode)
    || payload.expiresAt <= Date.now()
    || payload.expiresAt > Date.now() + 10 * 60 * 1000
  ) {
    const error = new Error('The phone verification server returned an invalid challenge.');
    error.code = 'AUTH_RESPONSE_INVALID';
    throw error;
  }
  return payload;
}

export async function confirmPhoneVerification({ verificationId, code }, options) {
  if (typeof verificationId !== 'string' || !verificationId || !/^\d{6}$/.test(code)) {
    throw createAuthError('PHONE_AUTH_CODE_INVALID', 'The verification code is invalid or expired.');
  }
  const payload = validateSession(await requestAuthenticationSession('/v1/auth/phone/verify', {
    verificationId,
    code
  }, options));
  if (
    !payload.user?.id
    || payload.user.provider !== 'phone'
    || payload.user.id !== sessionTokenClaims(payload.accessToken)?.sub
  ) {
    const error = new Error('The authentication server returned an invalid phone profile.');
    error.code = 'AUTH_RESPONSE_INVALID';
    throw error;
  }
  return payload;
}
