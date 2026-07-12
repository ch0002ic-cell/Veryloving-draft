'use strict';

(function installVeryLovingHumePatch() {
  const MARKER = '__verylovingHumeEVIReadyPatch';
  const CHAT_METADATA_TIMEOUT_MS = 10000;
  const SOCKET_OPEN = 1;

  const log = (...args) => console.log('[HumeEVIService]', ...args);
  const warn = (...args) => console.warn('[HumeEVIService]', ...args);
  const err = (...args) => console.error('[HumeEVIService]', ...args);
  const sanitizeUrl = (url) => String(url || '').replace(/([?&](token|access_token|api_key|apikey|key|secret|client_secret|authorization)=)[^&]+/gi, '$1[REDACTED]');
  const isOpen = (service) => !!(service && service.socket && service.socket.readyState === SOCKET_OPEN);

  function clearMetadataTimeout(service) {
    if (service.chatMetadataTimeout) clearTimeout(service.chatMetadataTimeout);
    service.chatMetadataTimeout = null;
  }

  function notify(service, message, cause) {
    err(message, cause ? String(cause) : '');
    try { service.messageHandler?.onError?.(new Error(message)); } catch (_) {}
  }

  function looksLikeService(value) {
    return !!(value && typeof value.connect === 'function' && typeof value.handleMessage === 'function' && typeof value.startMicrophone === 'function');
  }

  function findCandidate() {
    const direct = [globalThis.humeEVIService, globalThis.HumeEVIService, globalThis.__humeEVIService, globalThis.verylovingHumeEVIService];
    for (const candidate of direct) {
      if (looksLikeService(candidate)) return candidate;
      if (looksLikeService(candidate?.prototype)) return candidate.prototype;
    }
    for (const key of Object.getOwnPropertyNames(globalThis)) {
      let value;
      try { value = globalThis[key]; } catch (_) { continue; }
      if (looksLikeService(value)) return value;
      if (looksLikeService(value?.prototype)) return value.prototype;
    }
    return null;
  }

  function patch(service) {
    if (!service || service[MARKER]) return !!service;
    service[MARKER] = true;

    const originalConnect = service.connect;
    const originalHandleOpen = service.handleOpen;
    const originalHandleMessage = service.handleMessage;
    const originalHandleError = service.handleError;
    const originalHandleClose = service.handleClose;
    const originalStartMicrophone = service.startMicrophone;
    const originalSendSessionSettings = service.sendSessionSettings;
    const originalSendAudio = service.sendAudio;
    const originalSendText = service.sendText;

    service.connect = function patchedConnect(config) {
      this.maxReconnectAttempts = 5;
      this.reconnectDelay = this.reconnectDelay || 1000;
      this.connectionAttemptId = (this.connectionAttemptId || 0) + 1;
      clearMetadataTimeout(this);
      this.chatMetadataReceived = false;
      this.pendingMicrophoneStart = false;
      log('Starting WebSocket connection attempt', JSON.stringify({ attemptId: this.connectionAttemptId, reconnectAttempt: this.reconnectAttempts || 0 }));
      return originalConnect.call(this, config);
    };

    service.handleOpen = function patchedHandleOpen() {
      log('WebSocket OPEN; waiting for chat_metadata before enabling microphone');
      this.chatMetadataReceived = false;
      originalSendSessionSettings?.call(this);
      clearMetadataTimeout(this);
      this.chatMetadataTimeout = setTimeout(() => {
        if (this.chatMetadataReceived) return;
        err('chat_metadata timeout after 10s', sanitizeUrl(this.socket?.url));
        notify(this, 'Voice connection timed out while preparing the chat session. Please try again.');
        if (isOpen(this)) this.socket.close(4000, 'chat_metadata timeout');
        this.setState?.('error');
      }, CHAT_METADATA_TIMEOUT_MS);
    };

    service.handleMessage = function patchedHandleMessage(event) {
      let parsed = null;
      try { if (typeof event?.data === 'string') parsed = JSON.parse(event.data); } catch (_) {}
      if (parsed?.type === 'chat_metadata') {
        const shouldStart = this.pendingMicrophoneStart;
        clearMetadataTimeout(this);
        this.chatMetadataReceived = true;
        this.pendingMicrophoneStart = false;
        this.reconnectAttempts = 0;
        log('chat_metadata received; microphone may start now', parsed.chat_group_id || parsed.chatGroupId || 'no id');
        this.setState?.('connected');
        this.startKeepAlive?.();
        if (shouldStart) this.startMicrophone?.();
      }
      return originalHandleMessage.call(this, event);
    };

    service.handleError = function patchedHandleError(event) {
      if (event?.target && this.socket && event.target !== this.socket) return warn('Ignoring stale WebSocket error from an old socket');
      const result = originalHandleError.call(this, event);
      if (!this.chatMetadataReceived) notify(this, 'Voice connection failed before the chat session was ready. Please check your connection and try again.', event);
      return result;
    };

    service.handleClose = function patchedHandleClose(event) {
      if (event?.target && this.socket && event.target !== this.socket) return warn('Ignoring stale WebSocket close from an old socket');
      clearMetadataTimeout(this);
      this.chatMetadataReceived = false;
      return originalHandleClose.call(this, event);
    };

    service.startMicrophone = function patchedStartMicrophone() {
      if (!this.chatMetadataReceived || !isOpen(this)) {
        this.pendingMicrophoneStart = true;
        warn('Deferring microphone start until chat_metadata confirms the chat session');
        return Promise.resolve();
      }
      return originalStartMicrophone.call(this);
    };

    service.sendAudio = function patchedSendAudio(data) {
      if (!this.chatMetadataReceived || !isOpen(this) || this.state !== 'connected') return warn('Cannot send audio - chat session is not ready');
      return originalSendAudio.call(this, data);
    };

    service.sendText = function patchedSendText(text) {
      if (!this.chatMetadataReceived || !isOpen(this) || this.state !== 'connected') return notify(this, 'Voice chat is still connecting. Please wait a moment and try again.');
      return originalSendText.call(this, text);
    };

    log('Runtime patch installed');
    return true;
  }

  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (patch(findCandidate()) || tries > 60) clearInterval(timer);
  }, 500);
})();
