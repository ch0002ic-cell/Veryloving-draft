import { chooseOfflineResponse } from '../../mocks/offlineResponses';
import { logger } from '../../utils/logger';

export class MockEVIService {
  constructor() {
    this.state = 'disconnected';
    this.messageHandler = {};
    this.stateHandler = {};
  }
  setMessageHandler(handler) { this.messageHandler = handler || {}; }
  setStateHandler(handler) { this.stateHandler = handler || {}; }
  setState(state) { this.state = state; this.stateHandler.onStateChange?.(state); }
  getState() { return this.state; }
  isConnected() { return this.state === 'connected'; }
  async connect() {
    if (!__DEV__) throw new Error('Mock EVI service is available only in development builds.');
    logger.info('[MockEVIService] Mock mode active; Hume API calls are simulated');
    this.setState('connecting');
    setTimeout(() => this.setState('connected'), 600);
  }
  async startMicrophone() { logger.info('[MockEVIService] Microphone disabled in offline mode'); }
  async stopMicrophone() {}
  sendText(text) {
    const response = chooseOfflineResponse(text);
    this.messageHandler.onUserMessage?.(text, {});
    setTimeout(() => {
      this.messageHandler.onAssistantMessage?.(response.text, {});
      this.messageHandler.onAssistantEnd?.();
    }, 700);
  }
  async disconnect() { this.setState('disconnected'); }
  setAudioEnabled() {}
}

export const mockEVIService = new MockEVIService();
