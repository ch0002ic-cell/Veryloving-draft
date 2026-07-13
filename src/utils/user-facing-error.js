import { translate } from '../i18n/core';
import { HUME_CONFIGURATION_USER_MESSAGE } from '../services/websocket/hume-errors';

const AUTH_PATTERN = /\b(401|403|auth|credential|access token|api key|unauthori[sz]ed)\b/i;
const BILLING_PATTERN = /\b(credit|billing|quota|E0300|E0301)\b/i;
const CONFIGURATION_PATTERN = /\b(VOICE_CONFIGURATION_(?:MISSING|INVALID)|HumeConfigurationError|E0703|E0709|E0716|E0722|E0725|E0726|E0728)\b/i;
const MICROPHONE_PATTERN = /\b(microphone|recording permission|audio permission)\b/i;
const TIMEOUT_PATTERN = /\b(timeout|timed out|chat_metadata)\b/i;
const NETWORK_PATTERN = /\b(network|offline|socket|websocket|connection|failed to fetch)\b/i;

export const voiceCallCopy = {
  get offline() { return translate('errors.voiceOffline'); },
  get queued() { return translate('errors.voiceQueued'); },
  get retrying() { return translate('errors.voiceRetrying'); },
  get connecting() { return translate('errors.voiceConnecting'); }
};

export function userFacingVoiceError(error, { isOnline = true } = {}) {
  if (!isOnline) return voiceCallCopy.offline;
  const raw = [error?.code, error?.name, error?.message, String(error || '')].filter(Boolean).join(' ');

  if (CONFIGURATION_PATTERN.test(raw)) {
    return HUME_CONFIGURATION_USER_MESSAGE;
  }
  if (MICROPHONE_PATTERN.test(raw)) {
    return translate('errors.microphone');
  }
  if (BILLING_PATTERN.test(raw)) {
    return translate('errors.billing');
  }
  if (AUTH_PATTERN.test(raw)) {
    return translate('errors.authentication');
  }
  if (TIMEOUT_PATTERN.test(raw)) {
    return translate('errors.timeout');
  }
  if (NETWORK_PATTERN.test(raw)) {
    return translate('errors.network');
  }
  return translate('errors.genericVoice');
}
