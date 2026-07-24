import { chooseOfflineResponse } from '../../mocks/offlineResponses';
import { logger } from '../../utils/logger';
import { normalizeVoiceText } from '../../utils/voice-text';

export class OfflineEVIService {
  constructor({
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    connectionDelayMs = 400,
    responseDelayMs = 500
  } = {}) {
    this.state = 'disconnected';
    this.messageHandler = {};
    this.stateHandler = {};
    this.messageHandlerGeneration = 0;
    this.connectionTimer = null;
    this.connectionResolve = null;
    this.responseTimers = new Set();
    this.sessionConfig = {};
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.connectionDelayMs = connectionDelayMs;
    this.responseDelayMs = responseDelayMs;
  }

  setMessageHandler(handler) {
    this.messageHandler = handler || {};
    this.messageHandlerGeneration += 1;
  }
  setStateHandler(handler) { this.stateHandler = handler || {}; }
  setState(state) { this.state = state; this.stateHandler.onStateChange?.(state); }
  getState() { return this.state; }
  isConnected() { return this.state === 'connected'; }

  async connect(sessionConfig = {}) {
    logger.info('[OfflineEVIService] Offline companion mode active');
    this.sessionConfig = {
      locale: sessionConfig.locale,
      personaId: sessionConfig.personaId
    };
    if (this.state === 'connected') return;
    if (this.connectionTimer) this.clearTimeoutImpl(this.connectionTimer);
    this.connectionResolve?.();
    this.setState('connecting');
    await new Promise((resolve) => {
      this.connectionResolve = resolve;
      this.connectionTimer = this.setTimeoutImpl(() => {
        this.connectionTimer = null;
        this.connectionResolve = null;
        this.setState('connected');
        resolve();
      }, this.connectionDelayMs);
    });
  }

  async startMicrophone() {
    logger.info('[OfflineEVIService] Microphone streaming is unavailable in offline mode');
  }

  async stopMicrophone() {}

  sendText(text, { emitUser = true } = {}) {
    if (this.state !== 'connected') {
      this.messageHandler.onError?.(new Error('Offline companion is still getting ready.'));
      return false;
    }
    let normalized;
    try {
      normalized = normalizeVoiceText(text);
    } catch (error) {
      this.messageHandler.onError?.(error);
      return false;
    }
    if (!normalized) return false;
    const response = chooseOfflineResponse(normalized, this.sessionConfig.locale);
    const handler = this.messageHandler;
    const handlerGeneration = this.messageHandlerGeneration;
    if (emitUser) handler.onUserMessage?.(normalized, {});
    let timer;
    timer = this.setTimeoutImpl(() => {
      this.responseTimers.delete(timer);
      // Handler replacement means another mounted call now owns this singleton.
      // Never deliver an earlier caller's delayed response into the new call.
      if (
        handlerGeneration !== this.messageHandlerGeneration
        || handler !== this.messageHandler
      ) return;
      handler.onAssistantMessage?.(response.text, {});
      handler.onAssistantEnd?.();
    }, this.responseDelayMs);
    this.responseTimers.add(timer);
    return true;
  }

  async disconnect() {
    if (this.connectionTimer) this.clearTimeoutImpl(this.connectionTimer);
    this.connectionTimer = null;
    this.connectionResolve?.();
    this.connectionResolve = null;
    this.responseTimers.forEach((timer) => this.clearTimeoutImpl(timer));
    this.responseTimers.clear();
    this.setState('disconnected');
  }

  setAudioEnabled() {}
}

export const offlineEVIService = new OfflineEVIService();
