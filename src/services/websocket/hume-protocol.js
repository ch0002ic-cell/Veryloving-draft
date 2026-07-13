export const HUME_DIRECT_WS_URL = 'wss://api.hume.ai/v0/evi/chat';

const RESUME_UNAVAILABLE_SERVER_CODES = new Set(['E0708', 'E0720']);

// These errors require a user, credential, policy, or configuration change. Retrying
// the same handshake cannot recover and can create a tight reconnect loop.
const TERMINAL_SERVER_CODES = new Set([
  'E0100', 'E0101',
  'E0200', 'E0201', 'E0202',
  'E0300', 'E0301',
  'E0400',
  'E0600', 'E0602', 'E0603',
  'E0700', 'E0701', 'E0702', 'E0703', 'E0704', 'E0707', 'E0709', 'E0711',
  'E0713', 'E0714', 'E0715', 'E0716', 'E0717',
  'E0721', 'E0722', 'E0723', 'E0725', 'E0726', 'E0728', 'E0729', 'E0730'
]);

const TERMINAL_CLOSE_CODES = new Set([1000, 1002, 1003, 1007, 1008, 1009, 1010, 4001]);
const RETRYABLE_TRANSPORT_CLOSE_CODES = new Set([1001, 1006, 1011, 1012, 1013, 1014, 4000]);

export function normalizeHumeConfigId(value) {
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}

export function appendHumeParams(baseUrl, params) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  if (!query) return baseUrl;
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${query}`;
}

export function buildHumeWebSocketURL({ proxyURL, appAccessToken, humeAccessToken, apiKey, configId, voiceId, resumedChatGroupId }) {
  const normalizedConfigId = normalizeHumeConfigId(configId);
  if (proxyURL) {
    return appendHumeParams(proxyURL, {
      token: appAccessToken,
      config_id: normalizedConfigId,
      voice_id: voiceId,
      resumed_chat_group_id: resumedChatGroupId
    });
  }
  return appendHumeParams(HUME_DIRECT_WS_URL, {
    access_token: humeAccessToken,
    api_key: humeAccessToken ? undefined : apiKey,
    config_id: normalizedConfigId,
    voice_id: voiceId,
    resumed_chat_group_id: resumedChatGroupId
  });
}

export function createSessionSettingsPayload(sessionConfig = {}) {
  const payload = {
    type: 'session_settings',
    audio: { format: 'linear16', sample_rate: 48000, channels: 1 }
  };
  if (sessionConfig.systemPrompt) payload.system_prompt = sessionConfig.systemPrompt;
  if (sessionConfig.context) payload.context = { text: sessionConfig.context, type: 'persistent' };
  if (sessionConfig.customSessionId) payload.custom_session_id = sessionConfig.customSessionId;
  if (sessionConfig.variables) payload.variables = sessionConfig.variables;
  return payload;
}

export function createToolResponsePayload({ toolCallId, content, toolCall = {}, customSessionId }) {
  return {
    type: 'tool_response',
    tool_call_id: toolCallId,
    tool_name: toolCall.name,
    tool_type: toolCall.tool_type || 'function',
    custom_session_id: customSessionId,
    content: typeof content === 'string' ? content : JSON.stringify(content)
  };
}

export function createToolErrorPayload({ toolCallId, error, fallbackContent }) {
  return {
    type: 'tool_error',
    tool_call_id: toolCallId,
    error,
    fallback_content: fallbackContent,
    level: 'warn'
  };
}

export function classifyHumeClose({ closeCode, closeReason, serverErrorCode } = {}) {
  const parsedCloseCode = closeCode === undefined || closeCode === null || closeCode === ''
    ? undefined
    : Number(closeCode);
  const normalizedCloseCode = Number.isFinite(parsedCloseCode) ? parsedCloseCode : undefined;

  // Hume uses 1000 for intentional hang-up, inactivity, and maximum-duration
  // termination. A normal close is always authoritative, even if an earlier
  // message contained a recoverable error.
  if (TERMINAL_CLOSE_CODES.has(normalizedCloseCode)) {
    return { shouldReconnect: false, category: `terminal-close-${normalizedCloseCode}` };
  }

  if (TERMINAL_SERVER_CODES.has(serverErrorCode)) {
    return { shouldReconnect: false, category: `terminal-server-${serverErrorCode}` };
  }

  const normalizedReason = typeof closeReason === 'string' ? closeReason.trim() : '';
  if (/\b(?:401|403|unauthori[sz]ed|forbidden|authentication(?: failed)?|invalid (?:api[ _-]?key|access[ _-]?token|token))\b/i.test(normalizedReason)) {
    return { shouldReconnect: false, category: 'terminal-auth' };
  }

  // Resume failures are recoverable only because the caller removes the stale
  // chat-group identifier before intentionally closing the socket with 4002.
  if (RESUME_UNAVAILABLE_SERVER_CODES.has(serverErrorCode) && normalizedCloseCode === 4002) {
    return { shouldReconnect: true, category: 'resume-without-chat-group' };
  }

  if (
    normalizedCloseCode === undefined
    || RETRYABLE_TRANSPORT_CLOSE_CODES.has(normalizedCloseCode)
    || (typeof serverErrorCode === 'string' && serverErrorCode.startsWith('I'))
  ) {
    return { shouldReconnect: true, category: 'transient-transport' };
  }

  return { shouldReconnect: false, category: `unclassified-close-${normalizedCloseCode}` };
}

export function reconnectDelay(baseDelay, attempt) {
  return baseDelay * Math.pow(2, Math.max(0, attempt - 1));
}
