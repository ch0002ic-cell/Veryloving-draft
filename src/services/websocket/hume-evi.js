import { audioService, MAX_PLAYBACK_SEGMENT_BASE64_CHARACTERS } from '../audio';
import { config } from '../../utils/config';
import { logger, sanitizeUrl } from '../../utils/logger';
import { normalizeVoiceText } from '../../utils/voice-text';
import {
  createHumeServerError,
  HumeConfigurationError
} from './hume-errors';
import {
  buildHumeWebSocketURL,
  classifyHumeClose,
  createDeviceUpdatePayload,
  createProxyAuthenticationPayload,
  createSessionSettingsPayload,
  createToolErrorPayload,
  createToolResponsePayload,
  normalizeHumeConfigId,
  reconnectDelay
} from './hume-protocol';

const SOCKET_OPEN = 1;
const CHAT_METADATA_TIMEOUT_MS = 10000;
const MAX_AUDIO_BUFFERED_BYTES = 256 * 1024;
const DEVICE_ACTION_REQUEST_TIMEOUT_MS = 20000;
const INTERACTION_COMPLETION_TIMEOUT_MS = 5000;
const AI_ANGEL_TOOL_NAME = 'trigger_ai_angel';
const RESUME_UNAVAILABLE_CODES = new Set(['E0708', 'E0720']);
const ACTION_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_:-]{0,79}$/;
const ACTION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const INTERACTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

function stableActionRequestId(scope, toolCallId) {
  const hash = (value) => {
    let result = 2166136261;
    for (const character of String(value)) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
    return (result >>> 0).toString(36);
  };
  const suffix = String(toolCallId).replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 80);
  return `action-${hash(scope)}-${hash(toolCallId)}-${suffix}`;
}

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
    this.microphoneState = 'idle';
    this.microphoneGeneration = 0;
    this.microphoneStartPromise = null;
    this.microphoneStopPromise = null;
    this.sessionConfig = null;
    this.intentionallyConnected = false;
    this.chatMetadataReceived = false;
    this.chatMetadataTimeout = null;
    this.reconnectTimer = null;
    this.connectionAttemptId = 0;
    this.pendingMicrophoneStart = false;
    this.chatId = null;
    this.chatGroupId = null;
    this.activeToolAbortControllers = new Map();
    this.pendingActionRequests = new Map();
    this.pendingInteractionCompletion = null;
    this.scenarioRequestTimes = new Map();
    this.inFlightDeviceActionIds = new Set();
    this.processedDeviceActionIds = new Set();
    this.lastServerErrorCode = null;
    this.usesProxy = false;
    this.proxyAuthenticated = false;
    this.proxyAuthenticationFailed = false;
    this.assistantAudioInterrupted = false;
  }

  setMessageHandler(handler) { this.messageHandler = handler || {}; }
  setStateHandler(handler) { this.stateHandler = handler || {}; }
  getState() { return this.state; }
  isConnected() { return this.state === 'connected'; }
  isConnecting() { return this.state === 'connecting'; }
  isMicrophoneActive() { return this.isRecording; }

  sendSocketPayload(payload, {
    targetSocket = this.socket,
    operation = 'message'
  } = {}) {
    if (targetSocket !== this.socket || targetSocket?.readyState !== SOCKET_OPEN) return false;
    try {
      targetSocket.send(JSON.stringify(payload));
      return true;
    } catch (error) {
      logger.warn('[HumeEVIService] WebSocket send failed', {
        operation,
        name: error?.name || 'WebSocketSendError'
      });
      return false;
    }
  }

  handleHandshakeSendFailure(targetSocket, stage) {
    const error = new Error('The voice connection was interrupted during secure setup. Please try again.');
    error.code = 'VOICE_HANDSHAKE_SEND_FAILED';
    this.messageHandler.onError?.(error);
    this.setState('error');
    try {
      if (targetSocket === this.socket && targetSocket?.readyState === SOCKET_OPEN) {
        targetSocket.close(4000, 'voice handshake send failed');
      }
    } catch {
      if (targetSocket === this.socket) this.handleClose({ code: 1006, reason: stage }, targetSocket);
    }
    return false;
  }

  failConnection(error, context = {}) {
    logger.error('[HumeEVIService] Connection setup failed', {
      errorCode: error?.code || error?.name || 'VOICE_CONNECTION_SETUP_FAILED',
      humeCode: error?.humeCode,
      attemptId: this.connectionAttemptId,
      reconnectAttempt: this.reconnectAttempts,
      state: this.state,
      ...context
    });
    this.intentionallyConnected = false;
    this.setState('error');
    this.messageHandler.onError?.(error);
    return error;
  }

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
    for (const controller of this.activeToolAbortControllers.values()) controller.abort();
    this.activeToolAbortControllers.clear();
  }

  cancelPendingActionRequests(error = new Error('The device action connection closed.')) {
    for (const pending of this.pendingActionRequests.values()) {
      clearTimeout(pending.timeout);
      pending.unlinkAbort?.();
      pending.reject(error);
    }
    this.pendingActionRequests.clear();
    this.inFlightDeviceActionIds.clear();
  }

  cancelPendingInteractionCompletion(error = Object.assign(
    new Error('The voice interaction completion could not be confirmed.'),
    { code: 'VOICE_INTERACTION_COMPLETION_CANCELLED' }
  )) {
    const pending = this.pendingInteractionCompletion;
    if (!pending) return;
    pending.reject(error);
  }

  buildWebSocketURL({ humeAccessToken, apiKey, configId, voiceId, resumedChatGroupId }) {
    return buildHumeWebSocketURL({
      proxyURL: config.humeWSProxyURL,
      humeAccessToken,
      apiKey,
      configId,
      voiceId,
      resumedChatGroupId
    });
  }

  async connect(sessionConfig = {}, { isReconnect = false } = {}) {
    if (this.state === 'connected' || this.state === 'connecting') {
      logger.warn('[HumeEVIService] Already connected or connecting', { state: this.state });
      return;
    }

    this.connectionAttemptId += 1;
    if (!isReconnect) this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.resetChatReadiness();
    this.intentionallyConnected = true;
    this.sessionConfig = sessionConfig;
    this.lastServerErrorCode = null;
    this.setState('connecting');

    const usesProxy = Boolean(config.humeWSProxyURL);
    this.usesProxy = usesProxy;
    this.proxyAuthenticated = false;
    this.proxyAuthenticationFailed = false;
    this.assistantAudioInterrupted = false;
    const appAccessToken = sessionConfig.accessToken;
    const humeAccessToken = sessionConfig.humeAccessToken;
    const apiKey = config.humeApiKey;
    if (usesProxy && !appAccessToken) {
      const error = new Error('Sign in again to use the online voice companion, or continue with the offline companion.');
      error.code = 'VOICE_AUTHENTICATION_MISSING';
      throw this.failConnection(error, { transport: 'proxy', hasAppAccessToken: false });
    }
    if (!usesProxy && !humeAccessToken && !apiKey) {
      throw this.failConnection(new HumeConfigurationError('missing'), {
        transport: 'direct',
        hasHumeAccessToken: false,
        hasDevelopmentApiKey: false
      });
    }
    if (!usesProxy && !humeAccessToken && apiKey && !__DEV__) {
      throw this.failConnection(new HumeConfigurationError('invalid'), {
        transport: 'direct',
        productionApiKeyRejected: true
      });
    }

    const configId = normalizeHumeConfigId(sessionConfig.configId)
      || normalizeHumeConfigId(config.humeConfigId);
    if (!configId) {
      logger.warn('[HumeEVIService] No config_id provided – using Hume default config (if available)');
    }

    const url = this.buildWebSocketURL({
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

    try {
      this.socket = new WebSocket(String(url));
    } catch {
      throw this.failConnection(new HumeConfigurationError('invalid'), {
        transport: usesProxy ? 'proxy' : 'direct',
        invalidWebSocketEndpoint: true,
        sanitizedURL: sanitizeUrl(String(url))
      });
    }
    const socket = this.socket;

    const connectTimer = setTimeout(() => {
      if (socket.readyState === 0) {
        logger.error('[HumeEVIService] Connection timeout after 10s');
        socket.close(4000, 'connection timeout');
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
    logger.voice('[HumeEVIService] WebSocket OPEN; starting secure voice handshake');
    this.chatMetadataReceived = false;
    if (this.usesProxy) {
      const authenticated = this.sendSocketPayload(createProxyAuthenticationPayload({
        accessToken: this.sessionConfig?.accessToken,
        configId: this.sessionConfig?.configId || config.humeConfigId,
        voiceId: this.sessionConfig?.voiceId,
        personaId: this.sessionConfig?.personaId,
        locale: this.sessionConfig?.locale,
        resumedChatGroupId: this.sessionConfig?.resumedChatGroupId,
        devices: this.sessionConfig?.devices
      }), { targetSocket: openedSocket, operation: 'proxy-authentication' });
      if (!authenticated) return this.handleHandshakeSendFailure(openedSocket, 'proxy-authentication');
      this.startReadinessTimeout('gateway authentication');
      return;
    }
    this.beginHumeSession();
  }

  startReadinessTimeout(stage = 'chat metadata') {
    this.clearChatMetadataTimeout();
    this.chatMetadataTimeout = setTimeout(() => {
      if (this.chatMetadataReceived) return;
      logger.error('[HumeEVIService] Voice handshake timeout after 10s', {
        stage,
        socketReadyState: this.socket?.readyState,
        socketURL: sanitizeUrl(this.socket?.url)
      });
      this.messageHandler.onError?.(new Error('Voice connection timed out while preparing the chat session. Please try again.'));
      if (this.socket?.readyState === SOCKET_OPEN) this.socket.close(4000, 'chat_metadata timeout');
      this.setState('error');
    }, CHAT_METADATA_TIMEOUT_MS);
  }

  beginHumeSession() {
    if (!this.sendSessionSettings()) {
      return this.handleHandshakeSendFailure(this.socket, 'session-settings');
    }
    this.startReadinessTimeout('chat metadata');
    return true;
  }

  sendSessionSettings() {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN || !this.sessionConfig) {
      logger.warn('[HumeEVIService] Cannot send session settings - WebSocket is not open');
      return false;
    }
    return this.sendSocketPayload(createSessionSettingsPayload(this.sessionConfig), {
      operation: 'session-settings'
    });
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
      case 'auth_ok':
        if (!this.usesProxy || this.proxyAuthenticated) return;
        this.proxyAuthenticated = true;
        this.beginHumeSession();
        break;
      case 'auth_error':
        this.clearChatMetadataTimeout();
        this.proxyAuthenticationFailed = true;
        this.messageHandler.onError?.(new Error('The voice gateway could not verify this session. Sign in again.'));
        if (sourceSocket.readyState === SOCKET_OPEN) sourceSocket.close(4001, 'voice authentication failed');
        this.setState('error');
        break;
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
          logger.error('[HumeEVIService] Chat setup after metadata failed', {
            errorCode: error?.code || error?.name || 'CHAT_SETUP_FAILED',
            attemptId: this.connectionAttemptId,
            hasChatId: Boolean(metadata.chatId),
            hasChatGroupId: Boolean(metadata.chatGroupId)
          });
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
        logger.voice('[HumeEVIService] chat_metadata received; microphone may start now', {
          hasChatId: Boolean(metadata.chatId),
          hasChatGroupId: Boolean(metadata.chatGroupId),
          hasCustomSessionId: Boolean(metadata.customSessionId)
        });
        this.setState('connected');
        if (shouldStartMicrophone) this.startMicrophone().catch((error) => logger.error('[HumeEVIService] Pending microphone start failed:', error));
        break;
      }
      case 'user_message':
        // Hume emits this when the user starts a new turn. Treat it as a
        // barge-in even if a separate user_interruption frame is delayed.
        this.assistantAudioInterrupted = true;
        audioService.cancelAndClearQueue().catch(() => {});
        this.messageHandler.onUserMessage?.(message.message?.content || '', message.models?.prosody?.scores || {});
        break;
      case 'assistant_message':
        // An assistant message begins a new turn. Until this boundary arrives,
        // discard any audio frames that were already in flight when the user
        // interrupted the previous turn.
        this.assistantAudioInterrupted = false;
        this.messageHandler.onAssistantMessage?.(message.message?.content || '', message.models?.prosody?.scores || {});
        break;
      case 'audio_output':
        if (this.assistantAudioInterrupted) break;
        if (typeof message.data !== 'string' || message.data.length > MAX_PLAYBACK_SEGMENT_BASE64_CHARACTERS) {
          logger.warn('[HumeEVIService] Dropped an invalid or oversized assistant audio frame');
          break;
        }
        this.messageHandler.onAudioOutput?.(message.data);
        audioService.playBase64Audio(message.data, 'wav').catch((error) => logger.error('[HumeEVIService] Audio playback failed:', error));
        break;
      case 'assistant_end':
        this.messageHandler.onAssistantEnd?.();
        break;
      case 'user_interruption':
        this.assistantAudioInterrupted = true;
        audioService.cancelAndClearQueue().catch(() => {});
        break;
      case 'tool_call':
        await this.handleToolCall(message, sourceSocket);
        break;
      case 'tool_response':
        this.messageHandler.onToolResponse?.(message);
        break;
      case 'tool_error':
        logger.warn('[HumeEVIService] Tool error received:', { code: message.code, level: message.level, hasToolCallId: Boolean(message.tool_call_id) });
        this.messageHandler.onToolError?.(message);
        break;
      case 'action_response':
      case 'scenario_response':
        this.handleActionResponse(message);
        break;
      case 'interaction_completed':
        this.handleInteractionCompleted(message);
        break;
      case 'devices_updated':
        break;
      case 'device_action': {
        if (!this.usesProxy || !this.proxyAuthenticated) throw new Error('Device actions require an authenticated gateway.');
        const actionId = message.envelope?.id;
        if (typeof actionId !== 'string' || !ACTION_ID_PATTERN.test(actionId)) return;
        if (this.processedDeviceActionIds.has(actionId)) {
          this.sendDeviceActionAcknowledgement(actionId, true, sourceSocket);
          return;
        }
        if (this.inFlightDeviceActionIds.has(actionId)) return;
        this.inFlightDeviceActionIds.add(actionId);
        try {
          await this.messageHandler.onDeviceAction?.(message);
          this.processedDeviceActionIds.add(actionId);
          if (this.processedDeviceActionIds.size > 200) this.processedDeviceActionIds.delete(this.processedDeviceActionIds.values().next().value);
          this.sendDeviceActionAcknowledgement(actionId, true, sourceSocket);
        } catch (error) {
          logger.error('[HumeEVIService] Wearable action failed:', { actionId, name: error?.name || 'WearableActionError' });
          this.sendDeviceActionAcknowledgement(actionId, false, sourceSocket, error?.code || 'WEARABLE_ACTION_FAILED');
          this.messageHandler.onError?.(new Error('The wearable action failed. Please check the wearable connection.'));
        } finally {
          this.inFlightDeviceActionIds.delete(actionId);
        }
        break;
      }
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

    const controller = new AbortController();
    this.activeToolAbortControllers.get(toolCallId)?.abort();
    this.activeToolAbortControllers.set(toolCallId, controller);
    try {
      const content = await this.messageHandler.onToolCall(message, { signal: controller.signal });
      if (this.activeToolAbortControllers.get(toolCallId) !== controller || sourceSocket !== this.socket || controller.signal.aborted) return;
      if (content === undefined || content === null) throw new Error('Tool returned no content.');
      this.sendToolResponse(toolCallId, content, message, sourceSocket);
    } catch (error) {
      if (this.activeToolAbortControllers.get(toolCallId) !== controller || sourceSocket !== this.socket || controller.signal.aborted) return;
      logger.error('[HumeEVIService] Tool execution failed:', { name: message.name, error: error.message });
      this.sendToolError(toolCallId, error.message || 'Tool execution failed.', 'That safety resource is temporarily unavailable.', sourceSocket);
    } finally {
      if (this.activeToolAbortControllers.get(toolCallId) === controller) this.activeToolAbortControllers.delete(toolCallId);
    }
  }

  requestDeviceAction(toolCall, { signal, timeoutMs = DEVICE_ACTION_REQUEST_TIMEOUT_MS } = {}) {
    if (!this.usesProxy || !this.proxyAuthenticated || this.socket?.readyState !== SOCKET_OPEN) {
      return Promise.reject(new Error('The authenticated device action gateway is unavailable.'));
    }
    let toolParameters;
    try {
      toolParameters = typeof toolCall?.parameters === 'string'
        ? JSON.parse(toolCall.parameters)
        : toolCall?.parameters;
    } catch {
      return Promise.reject(new Error('Device action parameters were invalid.'));
    }
    const toolCallId = toolCall?.tool_call_id || toolCall?.toolCallId;
    if (typeof toolCallId !== 'string' || !toolCallId) {
      return Promise.reject(new Error('Device action tool call identity was invalid.'));
    }
    const requestScope = this.sessionConfig?.customSessionId
      || this.sessionConfig?.resumedChatGroupId
      || this.chatGroupId
      || 'voice';
    const requestId = stableActionRequestId(requestScope, toolCallId);
    const isAIAngelScenario = toolCall?.name === AI_ANGEL_TOOL_NAME;
    if (isAIAngelScenario && (
      !toolParameters
      || typeof toolParameters !== 'object'
      || Array.isArray(toolParameters)
      || Object.keys(toolParameters).length
    )) {
      return Promise.reject(new Error('AI Angel does not accept device identifiers or action parameters.'));
    }
    const existing = this.pendingActionRequests.get(requestId);
    if (existing) return existing.promise;
    const socket = this.socket;
    let pendingRecord;
    const actionPromise = new Promise((resolve, reject) => {
      let abortHandler;
      const finish = (callback, value) => {
        const pending = this.pendingActionRequests.get(requestId);
        if (!pending) return;
        this.pendingActionRequests.delete(requestId);
        clearTimeout(pending.timeout);
        pending.unlinkAbort?.();
        callback(value);
      };
      const timeout = setTimeout(() => finish(reject, new Error('The device action gateway timed out.')), timeoutMs);
      if (signal) {
        abortHandler = () => {
          const error = new Error('The device action was cancelled.');
          error.name = 'AbortError';
          finish(reject, error);
        };
        signal.addEventListener?.('abort', abortHandler, { once: true });
      }
      pendingRecord = {
        resolve: (value) => finish(resolve, value),
        reject: (error) => finish(reject, error),
        timeout,
        unlinkAbort: () => signal?.removeEventListener?.('abort', abortHandler)
      };
      this.pendingActionRequests.set(requestId, pendingRecord);
      if (signal?.aborted) {
        abortHandler?.();
        return;
      }
      try {
        if (isAIAngelScenario) {
          if (!this.scenarioRequestTimes.has(requestId)) {
            this.scenarioRequestTimes.set(requestId, Date.now());
            if (this.scenarioRequestTimes.size > 200) {
              this.scenarioRequestTimes.delete(this.scenarioRequestTimes.keys().next().value);
            }
          }
          const sent = this.sendSocketPayload({
            type: 'scenario_request',
            request_id: requestId,
            scenario: 'ai_angel_auto_dial',
            occurred_at: this.scenarioRequestTimes.get(requestId)
          }, { targetSocket: socket, operation: 'scenario-request' });
          if (!sent) finish(reject, new Error('The device action request could not be sent.'));
        } else {
          const sent = this.sendSocketPayload({
            type: 'action_request',
            request_id: requestId,
            action: toolCall?.name,
            ...(toolParameters && typeof toolParameters === 'object' ? toolParameters : {})
          }, { targetSocket: socket, operation: 'action-request' });
          if (!sent) finish(reject, new Error('The device action request could not be sent.'));
        }
      } catch {
        finish(reject, new Error('The device action request could not be sent.'));
      }
    });
    pendingRecord.promise = actionPromise;
    return actionPromise;
  }

  requestAINativeScenario(toolCall, options = {}) {
    return this.requestDeviceAction(toolCall, options);
  }

  handleActionResponse(message) {
    const requestId = typeof message?.request_id === 'string' && message.request_id.length <= 240
      ? message.request_id
      : null;
    if (!requestId) return;
    const pending = this.pendingActionRequests.get(requestId);
    if (!pending) return;
    if (message.ok === true) pending.resolve(JSON.stringify(message.result || { status: 'accepted' }));
    else {
      const suppliedStatus = Number(message.status);
      const status = Number.isInteger(suppliedStatus) && suppliedStatus >= 400 && suppliedStatus <= 599
        ? suppliedStatus
        : 500;
      const error = new Error(`Device action service returned ${status}.`);
      error.code = typeof message.error_code === 'string' && ACTION_ERROR_CODE_PATTERN.test(message.error_code)
        ? message.error_code
        : 'DEVICE_ACTION_FAILED';
      pending.reject(error);
    }
  }

  completeInteraction(
    interactionId = this.sessionConfig?.customSessionId,
    { timeoutMs = INTERACTION_COMPLETION_TIMEOUT_MS } = {}
  ) {
    if (!INTERACTION_ID_PATTERN.test(interactionId ?? '')
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
      return Promise.reject(Object.assign(
        new Error('The voice interaction identity is invalid.'),
        { code: 'VOICE_INTERACTION_INVALID' }
      ));
    }
    if (!this.usesProxy || !this.proxyAuthenticated || !this.chatMetadataReceived
      || this.socket?.readyState !== SOCKET_OPEN) {
      return Promise.reject(Object.assign(
        new Error('The secure voice interaction is not connected.'),
        { code: 'VOICE_INTERACTION_NOT_CONNECTED' }
      ));
    }
    if (this.pendingInteractionCompletion) {
      if (this.pendingInteractionCompletion.interactionId === interactionId) {
        return this.pendingInteractionCompletion.promise;
      }
      return Promise.reject(Object.assign(
        new Error('Another voice interaction completion is pending.'),
        { code: 'VOICE_INTERACTION_COMPLETION_BUSY' }
      ));
    }

    let pending;
    const promise = new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        if (this.pendingInteractionCompletion !== pending) return;
        this.pendingInteractionCompletion = null;
        clearTimeout(pending.timeout);
        callback(value);
      };
      pending = {
        interactionId,
        resolve: (value) => finish(resolve, value),
        reject: (error) => finish(reject, error),
        timeout: setTimeout(() => finish(reject, Object.assign(
          new Error('The voice interaction completion timed out.'),
          { code: 'VOICE_INTERACTION_COMPLETION_TIMEOUT' }
        )), timeoutMs),
        promise: null
      };
      this.pendingInteractionCompletion = pending;
      if (!this.sendSocketPayload({
        type: 'interaction_complete',
        interaction_id: interactionId
      }, { operation: 'interaction-complete' })) {
        finish(reject, Object.assign(
          new Error('The voice interaction completion could not be sent.'),
          { code: 'VOICE_INTERACTION_COMPLETION_SEND_FAILED' }
        ));
      }
    });
    pending.promise = promise;
    return promise;
  }

  handleInteractionCompleted(message) {
    const pending = this.pendingInteractionCompletion;
    if (!pending || message?.interaction_id !== pending.interactionId) return;
    if (message.ok === true) {
      pending.resolve(true);
      return;
    }
    pending.reject(Object.assign(
      new Error('The voice interaction completion was rejected.'),
      { code: 'VOICE_INTERACTION_COMPLETION_REJECTED' }
    ));
  }

  sendDeviceActionAcknowledgement(actionId, ok, targetSocket = this.socket, errorCode) {
    if (typeof actionId !== 'string' || !ACTION_ID_PATTERN.test(actionId)) return false;
    const normalizedErrorCode = typeof errorCode === 'string' && ACTION_ERROR_CODE_PATTERN.test(errorCode)
      ? errorCode
      : errorCode ? 'WEARABLE_ACTION_FAILED' : undefined;
    return this.sendSocketPayload({
      type: 'device_action_ack',
      action_id: actionId,
      ok,
      ...(normalizedErrorCode ? { error_code: normalizedErrorCode } : {})
    }, { targetSocket, operation: 'device-action-acknowledgement' });
  }

  updateDevices(devices = []) {
    this.sessionConfig = { ...(this.sessionConfig || {}), devices };
    if (!this.usesProxy || !this.proxyAuthenticated || this.socket?.readyState !== SOCKET_OPEN) return false;
    return this.sendSocketPayload(createDeviceUpdatePayload(devices), {
      operation: 'device-update'
    });
  }

  sendToolResponse(toolCallId, content, toolCall = {}, targetSocket = this.socket) {
    if (!this.chatMetadataReceived || targetSocket !== this.socket || targetSocket?.readyState !== SOCKET_OPEN) return false;
    return this.sendSocketPayload(createToolResponsePayload({
      toolCallId,
      content,
      toolCall,
      customSessionId: this.sessionConfig?.customSessionId
    }), { targetSocket, operation: 'tool-response' });
  }

  sendToolError(toolCallId, error, fallbackContent, targetSocket = this.socket) {
    if (!toolCallId || targetSocket !== this.socket || targetSocket?.readyState !== SOCKET_OPEN) return false;
    return this.sendSocketPayload(createToolErrorPayload({
      toolCallId,
      error,
      fallbackContent
    }), { targetSocket, operation: 'tool-error' });
  }

  handleError(event, sourceSocket = this.socket) {
    if (sourceSocket !== this.socket || (event?.target && event.target !== sourceSocket)) {
      logger.warn('[HumeEVIService] Ignoring stale WebSocket error from an old socket');
      return;
    }
    logger.error('[HumeEVIService] WebSocket error', {
      eventType: event?.type || 'error',
      attemptId: this.connectionAttemptId,
      reconnectAttempt: this.reconnectAttempts,
      state: this.state,
      chatReady: this.chatMetadataReceived,
      sanitizedURL: sanitizeUrl(sourceSocket?.url)
    });
    this.setState('error');
    if (!this.chatMetadataReceived) {
      this.messageHandler.onError?.(new Error('Voice connection failed before the chat session was ready. Please check your connection and try again.'));
    }
  }

  handleServerError(message) {
    const readable = message.message || 'Hume voice service returned an error.';
    this.lastServerErrorCode = message.code;
    const error = createHumeServerError(readable, message.code);
    logger.error('[HumeEVIService] Server error', {
      errorCode: error.code || error.name,
      humeCode: message.code,
      slug: message.slug,
      attemptId: this.connectionAttemptId,
      reconnectAttempt: this.reconnectAttempts,
      state: this.state,
      chatReady: this.chatMetadataReceived
    });
    this.messageHandler.onError?.(error);
    if (RESUME_UNAVAILABLE_CODES.has(message.code) && this.sessionConfig?.resumedChatGroupId) {
      logger.warn('[HumeEVIService] Stored chat group cannot be resumed; retrying as a new Hume chat');
      this.sessionConfig = { ...this.sessionConfig, resumedChatGroupId: undefined };
      if (this.socket?.readyState === SOCKET_OPEN) this.socket.close(4002, 'resume unavailable');
      return;
    }
  }

  handleClose(event, closedSocket = this.socket) {
    if (closedSocket !== this.socket || (event?.target && event.target !== closedSocket)) {
      logger.warn('[HumeEVIService] Ignoring stale WebSocket close from an old socket');
      return;
    }
    logger.voice('[HumeEVIService] WebSocket close:', {
      code: event?.code,
      hasReason: Boolean(event?.reason),
      attempts: this.reconnectAttempts,
      humeCode: this.lastServerErrorCode
    });
    const wasReady = this.chatMetadataReceived;
    this.socket = null;
    this.clearChatMetadataTimeout();
    this.cancelActiveToolCall();
    this.cancelPendingActionRequests();
    this.cancelPendingInteractionCompletion();
    this.chatMetadataReceived = false;
    this.stopMicrophone().catch((error) => logger.warn('[HumeEVIService] Microphone cleanup after close failed:', error));

    const classification = classifyHumeClose({
      closeCode: event?.code,
      closeReason: event?.reason,
      serverErrorCode: this.lastServerErrorCode
    });
    if (classification.shouldReconnect && this.intentionallyConnected && this.sessionConfig && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect(classification.category);
      return;
    }

    const connectionWasRequested = this.intentionallyConnected;
    this.intentionallyConnected = false;
    this.setState('disconnected');
    if (connectionWasRequested && !wasReady && !this.proxyAuthenticationFailed) {
      let connectionError;
      if (this.lastServerErrorCode) {
        connectionError = createHumeServerError(
          'The voice service rejected this connection. Please try again in a moment.',
          this.lastServerErrorCode
        );
      } else if (classification.category === 'terminal-auth' && !config.humeWSProxyURL) {
        connectionError = new HumeConfigurationError('invalid');
      } else {
        connectionError = new Error('Voice connection could not be established. Please try again in a moment.');
      }
      this.messageHandler.onError?.(connectionError);
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
      if (this.intentionallyConnected && this.sessionConfig) {
        this.connect(this.sessionConfig, { isReconnect: true }).catch((error) => logger.error('[HumeEVIService] Reconnect failed:', error));
      }
    }, delay);
  }

  async startMicrophone() {
    if (this.microphoneState === 'recording') return;
    if (this.microphoneState === 'starting') return this.microphoneStartPromise;
    if (this.microphoneState === 'stopping') {
      await this.microphoneStopPromise?.catch(() => {});
      return this.startMicrophone();
    }
    if (!this.chatMetadataReceived || !this.socket || this.socket.readyState !== SOCKET_OPEN) {
      this.pendingMicrophoneStart = this.intentionallyConnected;
      logger.warn('[HumeEVIService] Deferring microphone start until chat_metadata confirms the chat session', {
        chatMetadataReceived: this.chatMetadataReceived,
        readyState: this.socket?.readyState,
        state: this.state
      });
      return;
    }
    this.pendingMicrophoneStart = false;
    const generation = ++this.microphoneGeneration;
    this.microphoneState = 'starting';
    this.isRecording = false;
    audioService.setAudioChunkCallback((chunk) => {
      if (generation === this.microphoneGeneration && this.microphoneState !== 'stopping') this.sendAudio(chunk);
    });

    let startPromise;
    startPromise = (async () => {
      try {
        await audioService.startRecording();
        if (
          generation !== this.microphoneGeneration
          || !this.intentionallyConnected
          || !this.chatMetadataReceived
          || this.socket?.readyState !== SOCKET_OPEN
        ) {
          logger.voice('[HumeEVIService] Microphone start became stale before it completed');
          return false;
        }
        this.microphoneState = 'recording';
        this.isRecording = true;
        logger.voice('[HumeEVIService] Microphone started');
        return true;
      } catch (error) {
        if (generation === this.microphoneGeneration) {
          audioService.setAudioChunkCallback(null);
          this.microphoneState = 'idle';
          this.isRecording = false;
        }
        throw error;
      } finally {
        if (this.microphoneStartPromise === startPromise) this.microphoneStartPromise = null;
      }
    })();
    this.microphoneStartPromise = startPromise;
    return startPromise;
  }

  async stopMicrophone() {
    this.pendingMicrophoneStart = false;
    audioService.setAudioChunkCallback(null);
    if (this.microphoneStopPromise) return this.microphoneStopPromise;
    if (this.microphoneState === 'idle' && !this.microphoneStartPromise) {
      this.isRecording = false;
      return;
    }

    const pendingStart = this.microphoneStartPromise;
    ++this.microphoneGeneration;
    this.microphoneState = 'stopping';
    this.isRecording = false;

    let stopPromise;
    stopPromise = (async () => {
      try {
        await pendingStart?.catch((error) => logger.warn('[HumeEVIService] Microphone start failed during cleanup:', error));
        return await audioService.stopRecording();
      } finally {
        audioService.setAudioChunkCallback(null);
        this.microphoneState = 'idle';
        this.isRecording = false;
        if (this.microphoneStopPromise === stopPromise) this.microphoneStopPromise = null;
      }
    })();
    this.microphoneStopPromise = stopPromise;
    return stopPromise;
  }

  sendAudio(data) {
    if (!data) return false;
    if (!this.chatMetadataReceived || !this.socket || this.socket.readyState !== SOCKET_OPEN || this.state !== 'connected') {
      logger.warn('[HumeEVIService] Cannot send audio - chat session is not ready');
      return false;
    }
    if (Number(this.socket.bufferedAmount) > MAX_AUDIO_BUFFERED_BYTES) {
      logger.warn('[HumeEVIService] Dropping microphone audio while the socket is backpressured');
      return false;
    }
    try {
      this.socket.send(JSON.stringify({ type: 'audio_input', data }));
      return true;
    } catch (error) {
      logger.warn('[HumeEVIService] Microphone audio send failed', { name: error?.name || 'WebSocketSendError' });
      return false;
    }
  }

  sendText(text) {
    let normalized;
    try {
      normalized = normalizeVoiceText(text);
    } catch (error) {
      this.messageHandler.onError?.(error);
      return false;
    }
    if (!normalized) return false;
    if (!this.chatMetadataReceived || !this.socket || this.socket.readyState !== SOCKET_OPEN || this.state !== 'connected') {
      this.messageHandler.onError?.(new Error('Voice chat is still connecting. Please wait a moment and try again.'));
      return false;
    }
    try {
      // The socket can close between the readiness check and native send(). A
      // false return lets the caller take its durable offline-queue path exactly
      // once instead of losing the text to a thrown bridge exception.
      this.socket.send(JSON.stringify({ type: 'user_input', text: normalized }));
      logger.voice('[HumeEVIService] Text sent', { characters: normalized.length });
      return true;
    } catch (nativeError) {
      logger.warn('[HumeEVIService] Text send failed after the socket readiness check', {
        name: nativeError?.name || 'WebSocketSendError'
      });
      const error = new Error('The voice connection was interrupted while sending your message.');
      error.code = 'VOICE_TEXT_SEND_FAILED';
      this.messageHandler.onError?.(error);
      return false;
    }
  }

  async disconnect() {
    this.intentionallyConnected = false;
    this.clearReconnectTimer();
    this.cancelActiveToolCall();
    this.cancelPendingActionRequests();
    this.cancelPendingInteractionCompletion();
    this.resetChatReadiness();
    // Detach the transport before awaiting native microphone cleanup. An iOS
    // audio stop can take time during interruption/background transitions;
    // no late assistant/tool frame should update or persist a call after the
    // user has closed it.
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close(1000, 'Client disconnected');
      } catch (error) {
        logger.warn('[HumeEVIService] Native WebSocket close failed during cleanup', {
          name: error?.name || 'WebSocketCloseError'
        });
      }
    }
    await Promise.all([
      this.stopMicrophone().catch(() => {}),
      audioService.cancelAndClearQueue().catch(() => {})
    ]);
    this.setState('disconnected');
  }
}

export const humeEVIService = new HumeEVIService();
export default humeEVIService;
