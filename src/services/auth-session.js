import { config } from '../utils/config';

const AUTH_EXCHANGE_TIMEOUT_MS = 10000;

async function requestAuthenticationSession(path, body, { fetchImpl = globalThis.fetch } = {}) {
  if (!config.apiBaseUrl) throw new Error('Production authentication is not configured for this build.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_EXCHANGE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${config.apiBaseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error || 'Sign-in could not be verified.');
      error.code = `AUTH_HTTP_${response.status}`;
      throw error;
    }
    if (
      !payload?.accessToken
      || !payload?.refreshToken
      || !Number.isFinite(payload?.expiresAt)
      || !Number.isFinite(payload?.refreshExpiresAt)
    ) {
      throw new Error('The authentication server returned an invalid session.');
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Sign-in verification timed out. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function exchangeProviderIdentity({ provider, idToken, nonce, displayName }) {
  if (!['apple', 'google'].includes(provider) || !idToken) throw new Error('A valid identity provider token is required.');
  const payload = await requestAuthenticationSession('/v1/auth/exchange', {
    provider,
    idToken,
    nonce,
    displayName
  });
  if (!payload.user?.id) throw new Error('The authentication server returned an invalid profile.');
  return payload;
}

export function refreshApplicationSession(refreshToken, options) {
  if (!refreshToken) throw new Error('A refresh session is required.');
  return requestAuthenticationSession('/v1/auth/refresh', { refreshToken }, options);
}
