import { decodeBase64URLJSON } from "./base64";

export function sessionTokenClaims(token) {
  if (typeof token !== "string") return null;
  const segments = token.split(".");
  if (segments.length !== 3) return null;
  try {
    return decodeBase64URLJSON(segments[1]);
  } catch {
    return null;
  }
}

export function isSessionTokenUsable(
  token,
  { now = Date.now, skewSeconds = 30 } = {},
) {
  const claims = sessionTokenClaims(token);
  if (!claims?.sub || !Number.isFinite(claims.exp)) return false;
  return claims.exp > Math.floor(now() / 1000) + skewSeconds;
}

function tryExpoRandomValues(bytes) {
  try {
    // Keep this lazy and guarded. A static expo-crypto import evaluates
    // requireNativeModule("ExpoCrypto") immediately, which prevents the Web
    // Crypto fallback from running when an installed development client is
    // stale or otherwise missing the native module.
    const expoCrypto = require("expo-crypto");
    if (typeof expoCrypto?.getRandomValues !== "function") return false;
    expoCrypto.getRandomValues(bytes);
    return true;
  } catch {
    return false;
  }
}

function tryWebRandomValues(bytes) {
  try {
    const webCrypto = globalThis.crypto;
    if (typeof webCrypto?.getRandomValues !== "function") return false;
    // Web Crypto implementations require their method receiver to be the
    // Crypto object, so do not detach getRandomValues before invoking it.
    webCrypto.getRandomValues(bytes);
    return true;
  } catch {
    return false;
  }
}

function fillDefaultRandomValues(bytes) {
  if (tryExpoRandomValues(bytes) || tryWebRandomValues(bytes)) return bytes;
  const error = new Error("Secure random values are unavailable on this device.");
  error.code = "SECURE_RANDOM_UNAVAILABLE";
  throw error;
}

export function createAuthenticationNonce(cryptoImpl) {
  if (cryptoImpl !== undefined && typeof cryptoImpl?.getRandomValues !== "function") {
    throw new Error("Secure random values are unavailable on this device.");
  }
  const bytes = new Uint8Array(32);
  if (cryptoImpl === undefined) fillDefaultRandomValues(bytes);
  else cryptoImpl.getRandomValues(bytes);
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
