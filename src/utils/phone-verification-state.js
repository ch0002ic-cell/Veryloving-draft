export const PHONE_VERIFICATION_STATE_VERSION = 1;
const MAX_PHONE_VERIFICATION_LIFETIME_MS = 10 * 60 * 1000;

export function createPhoneVerificationState(challenge, { now = Date.now } = {}) {
  const timestamp = now();
  if (
    typeof challenge?.verificationId !== 'string'
    || !challenge.verificationId
    || challenge.verificationId.length > 4096
    || typeof challenge?.phone !== 'string'
    || !/^\+[1-9]\d{7,14}$/.test(challenge.phone)
    || typeof challenge?.countryCode !== 'string'
    || !/^[A-Z]{2}$/.test(challenge.countryCode)
    || !Number.isFinite(challenge?.expiresAt)
    || challenge.expiresAt <= timestamp
    || challenge.expiresAt > timestamp + MAX_PHONE_VERIFICATION_LIFETIME_MS
  ) return null;

  return {
    version: PHONE_VERIFICATION_STATE_VERSION,
    verificationId: challenge.verificationId,
    phone: challenge.phone,
    countryCode: challenge.countryCode,
    expiresAt: challenge.expiresAt
  };
}

export function parsePhoneVerificationState(rawState, options) {
  if (!rawState) return null;
  try {
    const state = typeof rawState === 'string' ? JSON.parse(rawState) : rawState;
    if (state?.version !== PHONE_VERIFICATION_STATE_VERSION) return null;
    return createPhoneVerificationState(state, options);
  } catch {
    return null;
  }
}
