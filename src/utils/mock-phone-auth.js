export const MOCK_PHONE_VERIFICATION_CODE = '123456';
export const MOCK_PHONE_VERIFICATION_TTL_MS = 5 * 60 * 1000;

export function isDevelopmentMockEnabled({ requested, isDev, nodeEnv } = {}) {
  return Boolean(requested) && (Boolean(isDev) || nodeEnv === 'test');
}

export function createMockPhoneVerification(
  { phone, countryCode },
  { now = Date.now, random = Math.random } = {}
) {
  if (!phone || !countryCode) throw new Error('A valid phone number is required.');
  const issuedAt = now();
  return {
    verificationId: `mock-phone-${issuedAt}-${random().toString(36).slice(2, 10)}`,
    phone,
    countryCode,
    expiresAt: issuedAt + MOCK_PHONE_VERIFICATION_TTL_MS
  };
}

export function isValidMockPhoneVerification(
  challenge,
  { verificationId, code },
  now = Date.now
) {
  if (!challenge || !verificationId || challenge.verificationId !== verificationId) return false;
  if (!Number.isFinite(challenge.expiresAt) || challenge.expiresAt <= now()) return false;
  return /^\d{6}$/.test(String(code || '')) && code === MOCK_PHONE_VERIFICATION_CODE;
}
