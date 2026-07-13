import { useCallback, useEffect, useRef, useState } from 'react';
import { useNetworkState } from 'expo-network';
import { config } from '../utils/config';
import humeEVIService from '../services/websocket/hume-evi';
import { offlineEVIService } from '../services/websocket/offline-evi';
import { useAuth } from '../context/AuthContext';
import { useAppState } from '../context/AppContext';
import {
  appendConversationMessage,
  createConversationSessionId,
  ensureConversationSession,
  loadConversationSession,
  updateConversationMessage,
  updateConversationSessionMetadata
} from '../services/conversation-history';
import {
  flushOfflineMessageQueue,
  queueOfflineMessage,
  queuedMessageCount,
  retryQueuedMessage
} from '../services/offline-message-queue';
import { configureHumeCustomSession } from '../services/hume-session';
import { executeHumeTool } from '../services/hume-tools';
import { logger } from '../utils/logger';
import { userFacingVoiceError, voiceCallCopy } from '../utils/user-facing-error';

function normalizeSessionId(value) {
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function voiceOverride(selectedVoice) {
  if (config.humeBrandedVoiceId) return config.humeBrandedVoiceId;
  if (config.humeWSProxyURL) return selectedVoice.humeVoiceID;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(selectedVoice.humeVoiceID || '') ? selectedVoice.humeVoiceID : undefined;
}

export function useHumeVoiceCall({ initialSessionId } = {}) {
  const { accessToken } = useAuth();
  const { selectedVoice, settings } = useAppState();
  const networkState = useNetworkState();
  const isOnline = networkState.isConnected !== false && networkState.isInternetReachable !== false;
  const forcedOffline = config.enableOfflineMode || settings.offlineMode;
  const serviceRef = useRef(forcedOffline ? offlineEVIService : humeEVIService);
  const sessionIdRef = useRef(normalizeSessionId(initialSessionId) || createConversationSessionId());
  const suppressedUserEchoesRef = useRef(new Map());
  const mountedRef = useRef(true);
  const startInFlightRef = useRef(false);
  const flushPendingMessagesRef = useRef(null);
  const queueRetryTimerRef = useRef(null);
  const [status, setStatus] = useState(serviceRef.current.getState());
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [fallbackAvailable, setFallbackAvailable] = useState(false);
  const [pendingMessageCount, setPendingMessageCount] = useState(0);

  const presentError = useCallback((nextError) => {
    if (!mountedRef.current) return;
    setError({ message: userFacingVoiceError(nextError, { isOnline }) });
  }, [isOnline]);

  const refreshPendingCount = useCallback(async () => {
    const count = await queuedMessageCount(sessionIdRef.current);
    if (mountedRef.current) setPendingMessageCount(count);
  }, []);

  const appendMessage = useCallback((role, text, options = {}) => {
    if (!text?.trim()) return null;
    const message = {
      id: options.id || `${Date.now()}-${role}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      text: text.trim(),
      source: options.source,
      deliveryStatus: options.deliveryStatus,
      deliveryError: options.deliveryError
    };
    setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message]);
    appendConversationMessage({
      ...message,
      sessionId: sessionIdRef.current,
      voiceId: selectedVoice.id,
      voiceName: selectedVoice.displayName
    }).catch((historyError) => logger.warn('[VoiceCall] Failed to persist conversation message', historyError));
    return message;
  }, [selectedVoice.displayName, selectedVoice.id]);

  const consumeSuppressedEcho = useCallback((text) => {
    const now = Date.now();
    const pending = (suppressedUserEchoesRef.current.get(text) || []).filter((expiresAt) => expiresAt > now);
    if (!pending.length) {
      suppressedUserEchoesRef.current.delete(text);
      return false;
    }
    pending.shift();
    if (pending.length) suppressedUserEchoesRef.current.set(text, pending);
    else suppressedUserEchoesRef.current.delete(text);
    return true;
  }, []);

  const flushPendingMessages = useCallback(async () => {
    if (!isOnline || humeEVIService.getState() !== 'connected') return;
    if (queueRetryTimerRef.current) {
      clearTimeout(queueRetryTimerRef.current);
      queueRetryTimerRef.current = null;
    }
    const remaining = await flushOfflineMessageQueue({
      sessionId: sessionIdRef.current,
      sendMessage: async (queued) => {
        const pending = suppressedUserEchoesRef.current.get(queued.text) || [];
        suppressedUserEchoesRef.current.set(queued.text, [...pending, Date.now() + 30000]);
        const accepted = humeEVIService.sendText(queued.text);
        if (!accepted) {
          consumeSuppressedEcho(queued.text);
          return false;
        }
        return true;
      },
      onDelivered: async (queued) => {
        await updateConversationMessage(queued.sessionId, queued.id, { deliveryStatus: 'sent', deliveryError: null });
        if (mountedRef.current) {
          setMessages((items) => items.map((item) => item.id === queued.id
            ? { ...item, deliveryStatus: 'sent', deliveryError: null }
            : item));
        }
      },
      onFailed: async (queued, queueError) => {
        const deliveryError = userFacingVoiceError(queueError, { isOnline: true });
        await updateConversationMessage(queued.sessionId, queued.id, { deliveryStatus: 'failed', deliveryError });
        if (mountedRef.current) {
          setMessages((items) => items.map((item) => item.id === queued.id
            ? { ...item, deliveryStatus: 'failed', deliveryError }
            : item));
        }
      }
    });
    await refreshPendingCount();
    const nextAttemptAt = remaining
      .filter((item) => item.sessionId === sessionIdRef.current && item.nextAttemptAt > Date.now())
      .reduce((earliest, item) => Math.min(earliest, item.nextAttemptAt), Infinity);
    if (Number.isFinite(nextAttemptAt) && humeEVIService.getState() === 'connected') {
      queueRetryTimerRef.current = setTimeout(() => {
        queueRetryTimerRef.current = null;
        flushPendingMessagesRef.current?.().catch((queueError) => {
          logger.warn('[VoiceCall] Scheduled queue retry failed', queueError);
        });
      }, Math.max(0, nextAttemptAt - Date.now()));
    }
  }, [consumeSuppressedEcho, isOnline, refreshPendingCount]);

  useEffect(() => {
    flushPendingMessagesRef.current = flushPendingMessages;
  }, [flushPendingMessages]);

  const bindServiceHandlers = useCallback((service) => {
    service.setStateHandler({
      onStateChange: (next) => {
        if (!mountedRef.current) return;
        setStatus(next);
        if (next === 'connected') {
          setError(null);
          setNotice(null);
          service.startMicrophone?.().catch?.((microphoneError) => presentError(microphoneError));
          if (service === humeEVIService) flushPendingMessages().catch((queueError) => logger.warn('[VoiceCall] Queue flush failed', queueError));
        }
      }
    });
    service.setMessageHandler({
      onUserMessage: (text) => {
        if (service === humeEVIService && consumeSuppressedEcho(text)) return;
        appendMessage('user', text, { source: service === offlineEVIService ? 'offline' : 'hume' });
      },
      onAssistantMessage: (text) => appendMessage('assistant', text, { source: service === offlineEVIService ? 'offline' : 'hume' }),
      onChatMetadata: async (metadata) => {
        await updateConversationSessionMetadata(sessionIdRef.current, {
          ...metadata,
          customSessionId: sessionIdRef.current,
          voiceId: selectedVoice.id,
          voiceName: selectedVoice.displayName
        }).catch((historyError) => logger.warn('[VoiceCall] Failed to persist Hume session metadata', historyError));
        await configureHumeCustomSession({
          chatId: metadata.chatId,
          customSessionId: sessionIdRef.current,
          accessToken
        });
      },
      onToolCall: (toolCall, { signal }) => executeHumeTool(toolCall, { accessToken, signal }),
      onError: (nextError) => {
        if (!mountedRef.current) return;
        presentError(nextError);
        if (service !== offlineEVIService) setFallbackAvailable(true);
      }
    });
  }, [accessToken, appendMessage, consumeSuppressedEcho, flushPendingMessages, presentError, selectedVoice.displayName, selectedVoice.id]);

  useEffect(() => {
    bindServiceHandlers(serviceRef.current);
  }, [bindServiceHandlers]);

  useEffect(() => {
    if (!isOnline) {
      setNotice(voiceCallCopy.offline);
      return;
    }
    if (humeEVIService.getState() === 'connected') {
      flushPendingMessages().catch((queueError) => logger.warn('[VoiceCall] Network-restored queue flush failed', queueError));
    }
  }, [flushPendingMessages, isOnline]);

  useEffect(() => {
    loadConversationSession(sessionIdRef.current)
      .then((session) => {
        if (mountedRef.current && session?.messages) {
          setMessages((current) => {
            const currentIds = new Set(current.map((message) => message.id));
            return [...session.messages.filter((message) => !currentIds.has(message.id)), ...current];
          });
        }
      })
      .catch((historyError) => logger.warn('[VoiceCall] Failed to load conversation', historyError));
    refreshPendingCount().catch(() => {});
  }, [refreshPendingCount]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (queueRetryTimerRef.current) clearTimeout(queueRetryTimerRef.current);
      serviceRef.current.disconnect?.().catch?.(() => {});
    };
  }, []);

  const connectService = useCallback(async (service) => {
    serviceRef.current = service;
    bindServiceHandlers(service);
    setStatus(service.getState());
    if (service === offlineEVIService) {
      await service.connect();
      return;
    }
    const session = await loadConversationSession(sessionIdRef.current);
    await service.connect({
      accessToken,
      configId: config.humeConfigId,
      voiceId: voiceOverride(selectedVoice),
      customSessionId: sessionIdRef.current,
      resumedChatGroupId: session?.chatGroupId,
      systemPrompt: `You are ${selectedVoice.displayName}, a compassionate safety companion. Be concise, emotionally attuned, honest about actions, and practical.`
    });
  }, [accessToken, bindServiceHandlers, selectedVoice.displayName, selectedVoice.humeVoiceID]);

  const start = useCallback(async () => {
    if (startInFlightRef.current) return false;
    startInFlightRef.current = true;
    setIsStarting(true);
    setError(null);
    setNotice(null);
    setFallbackAvailable(false);
    try {
      await ensureConversationSession({
        sessionId: sessionIdRef.current,
        voiceId: selectedVoice.id,
        voiceName: selectedVoice.displayName
      });
      const useOfflineService = forcedOffline || !isOnline;
      if (useOfflineService && !isOnline) setNotice(voiceCallCopy.offline);
      await connectService(useOfflineService ? offlineEVIService : humeEVIService);
      return true;
    } catch (startError) {
      logger.warn('[VoiceCall] Start failed', startError);
      presentError(startError);
      if (!forcedOffline && isOnline) setFallbackAvailable(true);
      return false;
    } finally {
      startInFlightRef.current = false;
      if (mountedRef.current) setIsStarting(false);
    }
  }, [connectService, forcedOffline, isOnline, presentError, selectedVoice.displayName, selectedVoice.id]);

  const startOfflineFallback = useCallback(async () => {
    setIsStarting(true);
    await serviceRef.current.disconnect?.().catch(() => {});
    setError(null);
    setFallbackAvailable(false);
    try {
      await connectService(offlineEVIService);
    } catch (fallbackError) {
      logger.warn('[VoiceCall] Offline fallback failed', fallbackError);
      presentError(fallbackError);
    } finally {
      if (mountedRef.current) setIsStarting(false);
    }
  }, [connectService, presentError]);

  const retryOnline = useCallback(async () => {
    if (!isOnline || forcedOffline) return;
    if (startInFlightRef.current) return;
    startInFlightRef.current = true;
    setIsStarting(true);
    await serviceRef.current.disconnect?.().catch(() => {});
    setError(null);
    setNotice(null);
    setFallbackAvailable(false);
    try {
      await connectService(humeEVIService);
    } catch (retryError) {
      logger.warn('[VoiceCall] Reconnect failed', retryError);
      presentError(retryError);
      setFallbackAvailable(true);
    } finally {
      startInFlightRef.current = false;
      if (mountedRef.current) setIsStarting(false);
    }
  }, [connectService, forcedOffline, isOnline, presentError]);

  const stop = useCallback(() => serviceRef.current.disconnect(), []);

  const sendText = useCallback(async (rawText) => {
    const text = rawText?.trim();
    if (!text) return false;
    const service = serviceRef.current;
    if (service === humeEVIService && isOnline && service.getState() === 'connected' && service.sendText(text)) return true;

    if (service === offlineEVIService && forcedOffline && service.getState() === 'connected') {
      appendMessage('user', text, { source: 'offline', deliveryStatus: 'local' });
      service.sendText(text, { emitUser: false });
      setNotice(null);
      return true;
    }

    const queued = await queueOfflineMessage({ sessionId: sessionIdRef.current, text });
    appendMessage('user', text, { id: queued.id, source: 'offline', deliveryStatus: 'queued' });
    await refreshPendingCount();
    if (service === offlineEVIService && service.getState() === 'connected') service.sendText(text, { emitUser: false });
    else setFallbackAvailable(true);
    setNotice(isOnline ? voiceCallCopy.queued : voiceCallCopy.offline);
    return false;
  }, [appendMessage, forcedOffline, isOnline, refreshPendingCount]);

  const retryMessage = useCallback(async (messageId) => {
    if (!messageId) return false;
    await retryQueuedMessage(sessionIdRef.current, messageId);
    await updateConversationMessage(sessionIdRef.current, messageId, { deliveryStatus: 'queued', deliveryError: null });
    setMessages((items) => items.map((item) => item.id === messageId
      ? { ...item, deliveryStatus: 'queued', deliveryError: null }
      : item));
    setNotice(voiceCallCopy.retrying);
    if (!isOnline) {
      setNotice(voiceCallCopy.offline);
      return false;
    }
    if (humeEVIService.getState() === 'connected') {
      await flushPendingMessages();
      return true;
    }
    if (!forcedOffline) await retryOnline();
    else setNotice(voiceCallCopy.queued);
    return false;
  }, [flushPendingMessages, forcedOffline, isOnline, retryOnline]);

  return {
    status,
    messages,
    error,
    notice,
    selectedVoice,
    start,
    stop,
    sendText,
    fallbackAvailable,
    startOfflineFallback,
    isOnline,
    pendingMessageCount,
    isConnecting: isStarting || status === 'connecting' || status === 'reconnecting',
    isOfflineCompanion: serviceRef.current === offlineEVIService && status === 'connected',
    canRetryOnline: isOnline && !forcedOffline && serviceRef.current === offlineEVIService,
    retryOnline,
    retryMessage,
    sessionId: sessionIdRef.current
  };
}
