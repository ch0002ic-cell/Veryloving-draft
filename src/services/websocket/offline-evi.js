import { chooseOfflineResponse } from '../../mocks/offlineResponses';
import { logger } from '../../utils/logger';

export class OfflineEVIService {
  constructor() {
    this.state = 'disconnected';
    this.messageHandler = {};
    this.stateHandler = {};
    this.connectionTimer = null;
    this.connectionResolve = null;
    this.responseTimers = new Set();
  }

  setMessageHandler(handler) { this.messageHandler = handler || {}; }
  setStateHandler(handler) { this.stateHandler = handler || {}; }
  setState(state) { this.state = state; this.stateHandler.onStateChange?.(state); }
  getState() { return this.state; }
  isConnected() { return this.state === 'connected'; }

  async connect() {
    logger.info('[OfflineEVIService] Offline companion mode active');
    if (this.state === 'connected') return;
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    this.connectionResolve?.();
    this.setState('connecting');
    await new Promise((resolve) => {
      this.connectionResolve = resolve;
      this.connectionTimer = setTimeout(() => {
        this.connectionTimer = null;
        this.connectionResolve = null;
        this.setState('connected');
        resolve();
      }, 400);
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
    const response = chooseOfflineResponse(text);
    if (emitUser) this.messageHandler.onUserMessage?.(text, {});
    const timer = setTimeout(() => {
      this.responseTimers.delete(timer);
      this.messageHandler.onAssistantMessage?.(response.text, {});
      this.messageHandler.onAssistantEnd?.();
    }, 500);
    this.responseTimers.add(timer);
    return true;
  }

  async disconnect() {
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
    this.connectionResolve?.();
    this.connectionResolve = null;
    this.responseTimers.forEach(clearTimeout);
    this.responseTimers.clear();
    this.setState('disconnected');
  }

  setAudioEnabled() {}
}

export const offlineEVIService = new OfflineEVIService();
