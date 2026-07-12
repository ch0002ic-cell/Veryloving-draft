import { audioService } from '../audio';
import { config } from '../../utils/config';
import { logger, sanitizeUrl } from '../../utils/logger';
import {
  buildHumeWebSocketURL,
  createSessionSettingsPayload,
  createToolErrorPayload,
  createToolResponsePayload,
  normalizeHumeConfigId,
  reconnectDelay
} from './hume-protocol';

const SOCKET_OPEN = 1;
const CHAT_METADATA_TIMEOUT_MS = 10000;
const RESUME_UNAVAILABLE_CODES = new Set(['E0708', 'E0720']);
const NON_RETRYABLE_SERVER_CODES = new Set(['E0300', 'E0301', 'E0709', 'E0716']);

export class HumeEVIService {
  constructor() {
    this.socket = null;
    this.state = 'disconnected';
    this.messageHandler = {};
    this.stateHandler = {};
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.isRecording = false;
    this.sessionConfig = null;
    this.intentionallyConnected = false;
    this.chatMetadataReceived = false;
    this.chatMetadataTimeout = null;
    this.reconnectTimer = null;
    this.connectionAttemptId = 0;
    this.pendingMicrophoneStart = false;
    this.chatId = null;
    this.chatGroupId = null;
    this.toolCallGeneration = 0;
    this.activeToolAbortController = null;
    this.lastServerErrorCode = null;
  }

  setMessageHandler(handler) { this.messageHandler = handler || {}; }
  setStateHandler(handler) { this.stateHandler = handler || {}; }
  getState() { return this.state; }
  isConnected() { return this.state === 'connected'; }
  isConnecting() { return this.state === 'connecting'; }
  isMicrophoneActive() { return this.isRecording; }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    logger.voice('[HumeEVIService] State changed:', state);
    this.stateHandler.onStateChange?.(state);
  }

  clearChatMetadataTimeout() {
    if (this.chatMetadataTimeout) {
      clearTimeout(this.chatMetadataTimeout);
      this.chatMetadataTimeout = null;
    }
  }

  resetChatReadiness() {
    this.clearChatMetadataTimeout();
    this.chatMetadataReceived = false;
    this.pendingMicrophoneStart = false;
    this.chatId = null;
    this.chatGroupId = null;
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  cancelActiveToolCall() {
    this.toolCallGeneration += 1;
    this.activeToolAbortController?.abort();
    this.activeToolAbortController = null;
  }

  buildWebSocketURL({ appAccessToken, humeAccessToken, apiKey, configId, voiceId, resumedChatGroupId }) {
    return buildHumeWebSocketURL({
      proxyURL: config.humeWSProxyURL,
      appAccessToken,
      humeAccessToken,
      apiKey,
      configId,
      voiceId,
      resumedChatGroupId
    });
  }

  async connect(sessionConfig = {}) {
    if (this.state === 'connected' || this.state === 'connecting') {
      logger.warn('[HumeEVIService] Already connected or connecting', { state: this.state });
      return;
    }

    this.connectionAttemptId += 1;
    this.clearReconnectTimer();
    this.resetChatReadiness();
    this.intentionallyConnected = true;
    this.sessionConfig = sessionConfig;
    this.lastServerErrorCode = null;
    this.setState('connecting');

    const usesProxy = Boolean(config.humeWSProxyURL);
    const appAccessToken = sessionConfig.accessToken;
    const humeAccessToken = sessionConfig.humeAccessToken;
    const apiKey = config.humeApiKey;
    if (usesProxy && !appAccessToken) {
      const error = new Error('User not authenticated — cannot connect to voice proxy');
      this.setState('error');
      this.messageHandler.onError?.(error);
      throw error;
    }
    if (!usesProxy && !humeAccessToken && !apiKey) {
      const error = new Error('A Hume access token is required. Configure the production voice proxy or a development API key.');
      this.setState('error');
      this.messageHandler.onError?.(error);
      throw error;
    }
    if (!usesProxy && !humeAccessToken && apiKey && !__DEV__) {
      const error = new Error('Direct Hume API keys are disabled in production. Configure the authenticated voice proxy.');
      this.setState('error');
      this.messageHandler.onError?.(error);
      throw error;
    }

    const configId = normalizeHumeConfigId(sessionConfig.configId)
      || normalizeHumeConfigId(config.humeConfigId);
    if (!configId) {
      logger.warn('[HumeEVIService] No config_id provided – using Hume default config (if available)');
    }

    const url = this.buildWebSocketURL({
      appAccessToken,
      humeAccessToken,
      apiKey,
      configId,
      voiceId: sessionConfig.voiceId,
      resumedChatGroupId: sessionConfig.resumedChatGroupId
    });

    logger.voice('[HumeEVIService] WebSocket connect diagnostic:', {
      attemptId: this.connectionAttemptId,
      reconnectAttempt: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      url: sanitizeUrl(url),
      configId: configId ? '[present]' : 'none',
      voiceId: sessionConfig.voiceId ? '[present]' : 'none',
      resumedChat: sessionConfig.resumedChatGroupId ? '[present]' : 'none'
    });

    this.socket = new WebSocket(String(url));
    const socket = this.socket;

    const connectTimer = setTimeout(() => {
      if (socket.readyState === 0) {
        logger.error('[HumeEVIService] Connection timeout after 10s');
        socket.close();
      }
    }, 10000);

    socket.onopen = () => {
      clearTimeout(connectTimer);
      this.handleOpen(socket);
    };
    socket.onmessage = (event) => {
      this.handleMessage(event, socket).catch((error) => logger.error('[HumeEVIService] Message handling failed:', error));
    };
    socket.onerror = (event) => {
      clearTimeout(connectTimer);
      this.handleError(event, socket);
    };
    socket.onclose = (event) => {
      clearTimeout(connectTimer);
      this.handleClose(event, socket);
    };
  }

  handleOpen(openedSocket = this.socket) {
    if (openedSocket !== this.socket) {
      logger.warn('[HumeEVIService] Ignoring stale WebSocket open');
      return;
    }
    logger.voice('[HumeEVIService] WebSocket OPEN; waiting for chat_metadata before enabling microphone');
    this.chatMetadataReceived = false;
    this.sendSessionSettings();
    this.clearChatMetadataTimeout();
    this.chatMetadataTimeout = setTimeout(() => {
      if (this.chatMetadataReceived) return;
      logger.error('[HumeEVIService] chat_metadata timeout after 10s', {
        socketReadyState: this.socket?.readyState,
        socketURL: sanitizeUrl(this.socket?.url)
      });
      this.messageHandler.onError?.(new Error('Voice connection timed out while preparing the chat session. Please try again.'));
      if (this.socket?.readyState === SOCKET_OPEN) this.socket.close(4000, 'chat_metadata timeout');
      this.setState('error');
    }, CHAT_METADATA_TIMEOUT_MS);
  }

  sendSessionSettings() {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN || !this.sessionConfig) {
      logger.warn('[HumeEVIService] Cannot send session settings - WebSocket is not open');
      return;
    }
    this.socket.send(JSON.stringify(createSessionSettingsPayload(this.sessionConfig)));
  }

  async handleMessage(event, sourceSocket = this.socket) {
    if (sourceSocket !== this.socket) {
      logger.warn('[HumeEVIService] Ignoring message from a stale WebSocket');
      return;
    }
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      logger.error('[HumeEVIService] Message parse error:', error);
      return;
    }

    switch (message.type) {
      case 'chat_metadata': {
        const shouldStartMicrophone = this.pendingMicrophoneStart;
        this.clearChatMetadataTimeout();
        const metadata = {
          chatId: message.chat_id || message.chatId,
          chatGroupId: message.chat_group_id || message.chatGroupId,
          customSessionId: message.custom_session_id || message.customSessionId || this.sessionConfig?.customSessionId
        };
        try {
          await this.messageHandler.onChatMetadata?.(metadata);
        } catch (error) {
          logger.error('[HumeEVIService] Chat setup after metadata failed:', error);
          this.messageHandler.onError?.(new Error('The voice companion could not finish secure session setup. Please try again.'));
          if (sourceSocket === this.socket && sourceSocket.readyState === SOCKET_OPEN) sourceSocket.close(4001, 'secure session setup failed');
          this.setState('error');
          return;
        }
        if (sourceSocket !== this.socket || !this.intentionallyConnected) return;
        this.chatId = metadata.chatId;
        this.chatGroupId = metadata.chatGroupId;
        this.sessionConfig = { ...this.sessionConfig, resumedChatGroupId: metadata.chatGroupId };
        this.chatMetadataReceived = true;
        this.pendingMicrophoneStart = false;
        this.reconnectAttempts = 0;
        logger.voice('[HumeEVIService] chat_metadata received; microphone may start now', {
          chatId: metadata.chatId,
          chatGroupId: metadata.chatGroupId,
          customSessionId: metadata.customSessionId ? '[present]' : 'none'
        });
        this.setState('connected');
        if (shouldStartMicrophone) this.startMicrophone().catch((error) => logger.error('[HumeEVIService] Pending microphone start failed:', error));
        break;
      }
      case 'user_message':
        this.messageHandler.onUserMessage?.(message.message?.content || '', message.models?.prosody?.scores || {});
        break;
      case 'assistant_message':
        this.messageHandler.onAssistantMessage?.(message.message?.content || '', message.models?.prosody?.scores || {});
        break;
      case 'audio_output':
        this.messageHandler.onAudioOutput?.(message.data);
        audioService.playBase64Audio(message.data, 'wav').catch((error) => logger.error('[HumeEVIService] Audio playback failed:', error));
        break;
      case 'assistant_end':
        this.messageHandler.onAssistantEnd?.();
        break;
      case 'user_interruption':
        audioService.cancelAndClearQueue().catch(() => {});
        break;
      case 'tool_call':
        await this.handleToolCall(message, sourceSocket);
        break;
      case 'tool_response':
        this.messageHandler.onToolResponse?.(message);
        break;
      case 'tool_error':
        logger.warn('[HumeEVIService] Tool error received:', { code: message.code, level: message.level, toolCallId: message.tool_call_id });
        this.messageHandler.onToolError?.(message);
        break;
      case 'error':
        this.handleServerError(message);
        break;
      default:
        logger.warn('[HumeEVIService] Unknown message type:', message.type);
    }
  }

  async handleToolCall(message, sourceSocket = this.socket) {
    if (!message.response_required) {
      this.messageHandler.onToolCallObserved?.(message);
      return;
    }
    const toolCallId = message.tool_call_id || message.toolCallId;
    if (!toolCallId || typeof this.messageHandler.onToolCall !== 'function') {
      this.sendToolError(toolCallId || 'unknown', 'No handler is registered for this tool.', 'I could not access that safety resource.', sourceSocket);
      return;
    }

    this.cancelActiveToolCall();
    const generation = this.toolCallGeneration;
    const controller = new AbortController();
    this.activeToolAbortController = controller;
    try {
      const content = await this.messageHandler.onToolCall(message, { signal: controller.signal });
      if (generation !== this.toolCallGeneration || sourceSocket !== this.socket || controller.signal.aborted) return;
      if (content === undefined || content === null) throw new Error('Tool returned no content.');
      this.sendToolResponse(toolCallId, content, message, sourceSocket);
    } catch (error) {
      if (generation !== this.toolCallGeneration || sourceSocket !== this.socket || controller.signal.aborted) return;
      logger.error('[HumeEVIService] Tool execution failed:', { name: message.name, error: error.message });
      this.sendToolError(toolCallId, error.message || 'Tool execution failed.', 'That safety resource is temporarily unavailable.', sourceSocket);
    } finally {
      if (generation === this.toolCallGeneration) this.activeToolAbortController = null;
    }
  }

  sendToolResponse(toolCallId, content, toolCall = {}, targetSocket = this.socket) {
    if (!this.chatMetadataReceived || targetSocket !== this.socket || targetSocket?.readyState !== SOCKET_OPEN) return false;
    targetSocket.send(JSON.stringify(createToolResponsePayload({
      toolCallId,
      content,
      toolCall,
      customSessionId: this.sessionConfig?.customSessionId
    })));
    return true;
  }

  sendToolError(toolCallId, error, content, targetSocket = this.socket) {
    if (!toolCallId || targetSocket !== this.socket || targetSocket?.readyState !== SOCKET_OPEN) return false;
    targetSocket.send(JSON.stringify(createToolErrorPayload({
      toolCallId,
      error,
      content,
      customSessionId: this.sessionConfig?.customSessionId
    })));
    return true;
  }

  handleError(event, sourceSocket = this.socket) {
    if (sourceSocket !== this.socket || (event?.target && event.target !== sourceSocket)) {
      logger.warn('[HumeEVIService] Ignoring stale WebSocket error from an old socket');
      return;
    }
    logger.error('[HumeEVIService] WebSocket error:', event?.message || event?.type || event);
    this.setState('error');
    if (!this.chatMetadataReceived) {
      this.messageHandler.onError?.(new Error('Voice connection failed before the chat session was ready. Please check your connection and try again.'));
    }
  }

  handleServerError(message) {
    const readable = message.message || 'Hume voice service returned an error.';
    this.lastServerErrorCode = message.code;
    logger.error('[HumeEVIService] Server error:', { code: message.code, slug: message.slug, message: readable });
    this.messageHandler.onError?.(new Error(readable));
    if (RESUME_UNAVAILABLE_CODES.has(message.code) && this.sessionConfig?.resumedChatGroupId) {
      logger.warn('[HumeEVIService] Stored chat group cannot be resumed; retrying as a new Hume chat');
      this.sessionConfig = { ...this.sessionConfig, resumedChatGroupId: undefined };
      if (this.socket?.readyState === SOCKET_OPEN) this.socket.close(4002, 'resume unavailable');
      return;
    }
    if (message.code === 'E0714') this.scheduleReconnect('inactivity timeout');
  }

  handleClose(event, closedSocket = this.socket) {
    if (closedSocket !== this.socket || (event?.target && event.target !== closedSocket)) {
      logger.warn('[HumeEVIService] Ignoring stale WebSocket close from an old socket');
      return;
    }
    logger.voice('[HumeEVIService] WebSocket close:', { code: event?.code, reason: event?.reason, attempts: this.reconnectAttempts });
    const wasReady = this.chatMetadataReceived;
    this.socket = null;
    this.clearChatMetadataTimeout();
    this.cancelActiveToolCall();
    this.chatMetadataReceived = false;
    if (this.isRecording) this.stopMicrophone().catch(() => {});

    const retryable = !NON_RETRYABLE_SERVER_CODES.has(this.lastServerErrorCode);
    if (retryable && this.intentionallyConnected && this.sessionConfig && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect('close');
      return;
    }

    this.setState('disconnected');
    if (this.intentionallyConnected && !wasReady) {
      this.messageHandler.onError?.(new Error('Voice connection could not be established. Please try again in a moment.'));
    }
  }

  scheduleReconnect(reason) {
    if (this.reconnectTimer || !this.intentionallyConnected || !this.sessionConfig || this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts += 1;
    const delay = reconnectDelay(this.reconnectDelay, this.reconnectAttempts);
    this.setState('reconnecting');
    logger.voice('[HumeEVIService] Reconnecting', { reason, attempt: this.reconnectAttempts, delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionallyConnected && this.sessionConfig) this.connect(this.sessionConfig).catch((error) => logger.error('[HumeEVIService] Reconnect failed:', error));
    }, delay);
  }

  async startMicrophone() {
    if (this.isRecording) return;
    if (!this.chatMetadataReceived || !this.socket || this.socket.readyState !== SOCKET_OPEN) {
      this.pendingMicrophoneStart = true;
      logger.warn('[HumeEVIService] Deferring microphone start until chat_metadata confirms the chat session', {
        chatMetadataReceived: this.chatMetadataReceived,
        readyState: this.socket?.readyState,
        state: this.state
      });
      return;
    }
    audioService.setAudioChunkCallback((chunk) => this.sendAudio(chunk));
    await audioService.startRecording();
    this.isRecording = true;
    logger.voice('[HumeEVIService] Microphone started');
  }

  async stopMicrophone() {
    if (!this.isRecording) return;
    audioService.setAudioChunkCallback(null);
    await audioService.stopRecording();
    this.isRecording = false;
  }

  sendAudio(data) {
    if (!data) return;
    if (!this.chatMetadataReceived || !this.socket || this.socket.readyState !== SOCKET_OPEN || this.state !== 'connected') {
      logger.warn('[HumeEVIService] Cannot send audio - chat session is not ready');
      return;
    }
    this.socket.send(JSON.stringify({ type: 'audio_input', data }));
  }

  sendText(text) {
    if (!this.chatMetadataReceived || !this.socket || this.socket.readyState !== SOCKET_OPEN || this.state !== 'connected') {
      this.messageHandler.onError?.(new Error('Voice chat is still connecting. Please wait a moment and try again.'));
      return false;
    }
    this.socket.send(JSON.stringify({ type: 'user_input', text }));
    logger.voice('[HumeEVIService] Text sent', { characters: text.length });
    return true;
  }

  async disconnect() {
    this.intentionallyConnected = false;
    this.clearReconnectTimer();
    this.cancelActiveToolCall();
    this.resetChatReadiness();
    await this.stopMicrophone().catch(() => {});
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      this.socket.close(1000, 'Client disconnected');
      this.socket = null;
    }
    await audioService.cancelAndClearQueue().catch(() => {});
    this.setState('disconnected');
  }
}

export const humeEVIService = new HumeEVIService();
export default humeEVIService;
