export const PHONE_VERIFICATION_STATE_VERSION = 1;
const MAX_PHONE_VERIFICATION_LIFETIME_MS = 10 * 60 * 1000;

export function createPhoneVerificationState(challenge, { now = Date.now } = {}) {
  const timestamp = now();
  const createdAt = Number.isFinite(challenge?.createdAt)
    ? challenge.createdAt
    : timestamp;
  if (
    typeof challenge?.verificationId !== 'string'
    || !challenge.verificationId
    || challenge.verificationId.length > 4096
    || typeof challenge?.phone !== 'string'
    || !/^\+[1-9]\d{7,14}$/.test(challenge.phone)
    || typeof challenge?.countryCode !== 'string'
    || !/^[A-Z]{2}$/.test(challenge.countryCode)
    || !Number.isFinite(challenge?.expiresAt)
    || !Number.isFinite(createdAt)
    || createdAt > timestamp
    || challenge.expiresAt <= timestamp
    || challenge.expiresAt > createdAt + MAX_PHONE_VERIFICATION_LIFETIME_MS
  ) return null;

  return {
    version: PHONE_VERIFICATION_STATE_VERSION,
    verificationId: challenge.verificationId,
    phone: challenge.phone,
    countryCode: challenge.countryCode,
    createdAt,
    expiresAt: challenge.expiresAt
  };
}

export function parsePhoneVerificationState(rawState, options) {
  if (!rawState) return null;
  try {
    const state = typeof rawState === 'string' ? JSON.parse(rawState) : rawState;
    if (state?.version !== PHONE_VERIFICATION_STATE_VERSION) return null;
    const normalized = createPhoneVerificationState(state, options);
    if (!normalized || Number.isFinite(state.createdAt)) return normalized;
    // Version-one challenges written before `createdAt` was introduced remain
    // usable during an uninterrupted signed-out flow. They cannot, however,
    // be proven newer than a logout tombstone and are excluded by
    // restorePhoneVerificationState in that case.
    const { createdAt: _createdAt, ...legacyState } = normalized;
    return legacyState;
  } catch {
    return null;
  }
}

export function restorePhoneVerificationState(
  rawState,
  { signedOutMarker = null, ...options } = {}
) {
  const state = parsePhoneVerificationState(rawState, options);
  if (!state || !signedOutMarker) return state;

  try {
    const marker = typeof signedOutMarker === 'string'
      ? JSON.parse(signedOutMarker)
      : signedOutMarker;
    if (
      marker?.version !== 1
      || !Number.isFinite(marker.signedOutAt)
      || !Number.isFinite(state.createdAt)
      || state.createdAt <= marker.signedOutAt
    ) return null;
    return state;
  } catch {
    return null;
  }
}
