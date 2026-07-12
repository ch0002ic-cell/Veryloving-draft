export const HUME_DIRECT_WS_URL = 'wss://api.hume.ai/v0/evi/chat';

export function appendHumeParams(baseUrl, params) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  if (!query) return baseUrl;
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${query}`;
}

export function buildHumeWebSocketURL({ proxyURL, appAccessToken, humeAccessToken, apiKey, configId, voiceId, resumedChatGroupId }) {
  if (proxyURL) {
    return appendHumeParams(proxyURL, {
      token: appAccessToken,
      config_id: configId,
      voice_id: voiceId,
      resumed_chat_group_id: resumedChatGroupId
    });
  }
  return appendHumeParams(HUME_DIRECT_WS_URL, {
    access_token: humeAccessToken,
    api_key: humeAccessToken ? undefined : apiKey,
    config_id: configId,
    voice_id: voiceId,
    resumed_chat_group_id: resumedChatGroupId
  });
}

export function createSessionSettingsPayload(sessionConfig = {}) {
  const payload = {
    type: 'session_settings',
    audio: { encoding: 'linear16', sample_rate: 48000, channels: 1 }
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

export function createToolErrorPayload({ toolCallId, error, content, customSessionId }) {
  return {
    type: 'tool_error',
    tool_call_id: toolCallId,
    tool_type: 'function',
    custom_session_id: customSessionId,
    error,
    content,
    level: 'warn'
  };
}

export function reconnectDelay(baseDelay, attempt) {
  return baseDelay * Math.pow(2, Math.max(0, attempt - 1));
}
