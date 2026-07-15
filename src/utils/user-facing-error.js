import { translate } from '../i18n/core';

const AUTH_PATTERN = /\b(401|403|auth|credential|access token|api key|unauthori[sz]ed)\b/i;
const BILLING_PATTERN = /\b(credit|billing|quota|E0300|E0301)\b/i;
const CONFIGURATION_PATTERN = /\b(VOICE_CONFIGURATION_(?:MISSING|INVALID)|HumeConfigurationError|E0703|E0709|E0716|E0722|E0725|E0726|E0728)\b/i;
const MICROPHONE_PATTERN = /\b(microphone|recording permission|audio permission)\b/i;
const TIMEOUT_PATTERN = /\b(timeout|timed out|chat_metadata)\b/i;
const NETWORK_PATTERN = /\b(network|offline|socket|websocket|connection|failed to fetch)\b/i;

export const voiceCallCopyKeys = Object.freeze({
  offline: 'errors.voiceOffline',
  queued: 'errors.voiceQueued',
  retrying: 'errors.voiceRetrying',
  connecting: 'errors.voiceConnecting'
});

export const voiceCallCopy = {
  get offline() { return translate(voiceCallCopyKeys.offline); },
  get queued() { return translate(voiceCallCopyKeys.queued); },
  get retrying() { return translate(voiceCallCopyKeys.retrying); },
  get connecting() { return translate(voiceCallCopyKeys.connecting); }
};

export function userFacingVoiceErrorKey(error, { isOnline = true } = {}) {
  if (!isOnline) return voiceCallCopyKeys.offline;
  const raw = [error?.code, error?.name, error?.message, String(error || '')].filter(Boolean).join(' ');

  if (CONFIGURATION_PATTERN.test(raw)) {
    return 'releaseCritical.voiceConfiguration';
  }
  if (MICROPHONE_PATTERN.test(raw)) {
    return 'errors.microphone';
  }
  if (BILLING_PATTERN.test(raw)) {
    return 'errors.billing';
  }
  if (AUTH_PATTERN.test(raw)) {
    return 'errors.authentication';
  }
  if (TIMEOUT_PATTERN.test(raw)) {
    return 'errors.timeout';
  }
  if (NETWORK_PATTERN.test(raw)) {
    return 'errors.network';
  }
  return 'errors.genericVoice';
}

export function userFacingVoiceError(error, options) {
  return translate(userFacingVoiceErrorKey(error, options));
}
