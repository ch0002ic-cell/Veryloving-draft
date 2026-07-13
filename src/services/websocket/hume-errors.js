const HUME_CONFIGURATION_CODES = new Set([
  'E0400',
  'E0600',
  'E0602',
  'E0603',
  'E0701',
  'E0703',
  'E0709',
  'E0711',
  'E0716',
  'E0722',
  'E0725',
  'E0726',
  'E0728'
]);

export const HUME_CONFIGURATION_USER_MESSAGE = 'Voice AI is not configured yet. Please contact support.';

export class HumeConfigurationError extends Error {
  constructor(kind = 'invalid', { humeCode } = {}) {
    super(HUME_CONFIGURATION_USER_MESSAGE);
    this.name = 'HumeConfigurationError';
    this.code = kind === 'missing'
      ? 'VOICE_CONFIGURATION_MISSING'
      : 'VOICE_CONFIGURATION_INVALID';
    this.humeCode = humeCode;
  }
}

export function isHumeConfigurationErrorCode(code) {
  return HUME_CONFIGURATION_CODES.has(code);
}

export function createHumeServerError(message = 'Hume voice service returned an error.', code) {
  if (isHumeConfigurationErrorCode(code)) {
    return new HumeConfigurationError('invalid', { humeCode: code });
  }
  const error = new Error(message);
  error.code = code;
  return error;
}
