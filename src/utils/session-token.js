import { decodeBase64URLJSON } from './base64';

export function sessionTokenClaims(token) {
  if (typeof token !== 'string') return null;
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  try {
    return decodeBase64URLJSON(segments[1]);
  } catch {
    return null;
  }
}

export function isSessionTokenUsable(token, { now = Date.now, skewSeconds = 30 } = {}) {
  const claims = sessionTokenClaims(token);
  if (!claims?.sub || !Number.isFinite(claims.exp)) return false;
  return claims.exp > Math.floor(now() / 1000) + skewSeconds;
}

function nativeRandomValues(bytes) {
  // Lazy loading keeps this pure utility testable in Node while Metro bundles
  // Expo's native CSPRNG for Hermes, where a browser-style global crypto object
  // is not guaranteed to exist.
  return require('expo-crypto').getRandomValues(bytes);
}

export function createAuthenticationNonce(cryptoImpl) {
  const getRandomValues = cryptoImpl === undefined
    ? nativeRandomValues
    : cryptoImpl?.getRandomValues?.bind(cryptoImpl);
  if (typeof getRandomValues !== 'function') {
    throw new Error('Secure random values are unavailable on this device.');
  }
  const bytes = new Uint8Array(32);
  getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}
