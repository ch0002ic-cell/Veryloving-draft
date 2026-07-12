const AUTH_PATTERN = /\b(401|403|auth|credential|access token|api key|unauthori[sz]ed)\b/i;
const BILLING_PATTERN = /\b(credit|billing|quota|E0300|E0301)\b/i;
const MICROPHONE_PATTERN = /\b(microphone|recording permission|audio permission)\b/i;
const TIMEOUT_PATTERN = /\b(timeout|timed out|chat_metadata)\b/i;
const NETWORK_PATTERN = /\b(network|offline|socket|websocket|connection|failed to fetch)\b/i;

export const voiceCallCopy = {
  offline: 'You seem offline. Your message will be sent when you reconnect.',
  queued: 'Message saved. It will be sent when the voice companion reconnects.',
  retrying: 'Trying to send your message again...',
  connecting: 'Connecting securely to your voice companion...'
};

export function userFacingVoiceError(error, { isOnline = true } = {}) {
  if (!isOnline) return voiceCallCopy.offline;
  const raw = [error?.code, error?.name, error?.message, String(error || '')].filter(Boolean).join(' ');

  if (MICROPHONE_PATTERN.test(raw)) {
    return 'Microphone access is needed for voice calls. You can enable it in Settings, or type a message instead.';
  }
  if (BILLING_PATTERN.test(raw)) {
    return 'The online voice companion is temporarily unavailable. You can continue with the offline companion.';
  }
  if (AUTH_PATTERN.test(raw)) {
    return 'The voice companion could not verify this session. Sign in again or use the offline companion for now.';
  }
  if (TIMEOUT_PATTERN.test(raw)) {
    return 'The voice companion took too long to respond. Check your connection and try again.';
  }
  if (NETWORK_PATTERN.test(raw)) {
    return 'We could not reach the voice companion. Check your connection, then try again or continue offline.';
  }
  return 'Something interrupted the voice call. Try again, or continue with the offline companion.';
}
