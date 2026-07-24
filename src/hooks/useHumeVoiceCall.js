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
import {
  userFacingVoiceErrorKey,
  voiceCallCopyKeys
} from '../utils/user-facing-error';
import { humeVoiceOverride } from '../utils/hume-voice';
import { dispatchWearableAction } from '../services/device-actions';
import { useI18n } from '../context/I18nContext';
import { triggerSOS } from '../services/emergency';
import { loadLastKnownLocation } from '../services/location-cache';
import { loadEmergencyMedicalAttachment } from '../services/medical-profile-store';
import { normalizeVoiceText } from '../utils/voice-text';

const MAX_IN_MEMORY_MESSAGES = 200;
const MAX_SUPPRESSED_USER_ECHOES = 64;

function cancelledVoiceOperation() {
  const error = new Error('The voice connection request was cancelled.');
  error.code = 'VOICE_OPERATION_CANCELLED';
  return error;
}

function normalizeSessionId(value) {
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function voiceOverride(selectedVoice) {
  return humeVoiceOverride({
    brandedVoiceId: config.humeBrandedVoiceId,
    selectedVoiceId: selectedVoice.humeVoiceID
  });
}

export function useHumeVoiceCall({ initialSessionId } = {}) {
  const { accessToken, isDemoMode, user } = useAuth();
  const { contacts, selectedVoice, settings, wearableEntities, robotEntities } = useAppState();
  const { locale } = useI18n();
  const networkState = useNetworkState();
  const isOnline = networkState.isConnected !== false && networkState.isInternetReachable !== false;
  const forcedOffline = isDemoMode || config.enableOfflineMode || settings.offlineMode;
  const serviceRef = useRef(forcedOffline ? offlineEVIService : humeEVIService);
  const sessionIdRef = useRef(normalizeSessionId(initialSessionId) || createConversationSessionId());
  // A durable conversation may be resumed many times, while the authenticated
  // feedback proof is deliberately single-use. Keep those identities separate
  // so resuming history never replays a completed voice interaction.
  const interactionIdRef = useRef(createConversationSessionId());
  const suppressedUserEchoesRef = useRef(new Map());
  const mountedRef = useRef(true);
  const startInFlightRef = useRef(false);
  const connectionGenerationRef = useRef(0);
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
    setError({
      code: typeof nextError?.code === 'string' ? nextError.code : null,
      translationKey: userFacingVoiceErrorKey(nextError, { isOnline })
    });
  }, [isOnline]);

  const refreshPendingCount = useCallback(async () => {
    const count = await queuedMessageCount(sessionIdRef.current);
    if (mountedRef.current) setPendingMessageCount(count);
  }, []);

  const requestHelpDial = useCallback(async ({ signal } = {}) => {
    if (signal?.aborted) throw new Error('The help-dial request was cancelled.');
    const [location, medicalAttachment] = await Promise.all([
      loadLastKnownLocation().catch(() => null),
      loadEmergencyMedicalAttachment(user?.id).catch(() => null)
    ]);
    if (signal?.aborted) throw new Error('The help-dial request was cancelled.');
    return triggerSOS(contacts, {
      accessToken,
      accountId: user?.id,
      location,
      medicalAttachment
    });
  }, [accessToken, contacts, user?.id]);

  const appendMessage = useCallback((role, text, options = {}) => {
    const boundedText = normalizeVoiceText(text, { truncate: true });
    if (!boundedText) return null;
    const message = {
      id: options.id || `${Date.now()}-${role}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      text: boundedText,
      source: options.source,
      deliveryStatus: options.deliveryStatus,
      deliveryError: options.deliveryError
    };
    setMessages((items) => items.some((item) => item.id === message.id)
      ? items
      : [...items, message].slice(-MAX_IN_MEMORY_MESSAGES));
    appendConversationMessage({
      ...message,
      sessionId: sessionIdRef.current,
      voiceId: selectedVoice.id,
      voiceName: selectedVoice.displayName
    }).catch((historyError) => logger.recoverable('[VoiceCall] Failed to persist conversation message', historyError));
    return message;
  }, [selectedVoice.displayName, selectedVoice.id]);

  const pruneSuppressedEchoes = useCallback((now = Date.now()) => {
    let total = 0;
    for (const [text, expiries] of suppressedUserEchoesRef.current) {
      const live = expiries.filter((expiresAt) => expiresAt > now);
      if (live.length) {
        suppressedUserEchoesRef.current.set(text, live);
        total += live.length;
      } else suppressedUserEchoesRef.current.delete(text);
    }
    while (total > MAX_SUPPRESSED_USER_ECHOES) {
      const first = suppressedUserEchoesRef.current.entries().next().value;
      if (!first) break;
      const [text, expiries] = first;
      expiries.shift();
      total -= 1;
      if (expiries.length) suppressedUserEchoesRef.current.set(text, expiries);
      else suppressedUserEchoesRef.current.delete(text);
    }
  }, []);

  const rememberSuppressedEcho = useCallback((text) => {
    pruneSuppressedEchoes();
    const pending = suppressedUserEchoesRef.current.get(text) || [];
    suppressedUserEchoesRef.current.set(text, [...pending, Date.now() + 30000]);
    pruneSuppressedEchoes();
  }, [pruneSuppressedEchoes]);

  const consumeSuppressedEcho = useCallback((text) => {
    pruneSuppressedEchoes();
    const pending = suppressedUserEchoesRef.current.get(text) || [];
    if (!pending.length) {
      suppressedUserEchoesRef.current.delete(text);
      return false;
    }
    pending.shift();
    if (pending.length) suppressedUserEchoesRef.current.set(text, pending);
    else suppressedUserEchoesRef.current.delete(text);
    return true;
  }, [pruneSuppressedEchoes]);

  const flushPendingMessages = useCallback(async () => {
    if (!isOnline || humeEVIService.getState() !== 'connected') return;
    if (queueRetryTimerRef.current) {
      clearTimeout(queueRetryTimerRef.current);
      queueRetryTimerRef.current = null;
    }
    const remaining = await flushOfflineMessageQueue({
      sessionId: sessionIdRef.current,
      sendMessage: async (queued) => {
        rememberSuppressedEcho(queued.text);
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
        const deliveryError = userFacingVoiceErrorKey(queueError, { isOnline: true });
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
          logger.recoverable('[VoiceCall] Scheduled queue retry failed', queueError);
        });
      }, Math.max(0, nextAttemptAt - Date.now()));
    }
  }, [consumeSuppressedEcho, isOnline, refreshPendingCount, rememberSuppressedEcho]);

  useEffect(() => {
    flushPendingMessagesRef.current = flushPendingMessages;
  }, [flushPendingMessages]);

  const bindServiceHandlers = useCallback((service, generation = connectionGenerationRef.current) => {
    const isCurrent = () => (
      mountedRef.current
      && connectionGenerationRef.current === generation
      && serviceRef.current === service
    );
    service.setStateHandler({
      onStateChange: (next) => {
        if (!isCurrent()) return;
        setStatus(next);
        if (next === 'connected') {
          setError(null);
          setNotice(null);
          service.startMicrophone?.().catch?.((microphoneError) => {
            if (isCurrent()) presentError(microphoneError);
          });
          if (service === humeEVIService) flushPendingMessages().catch((queueError) => {
            if (isCurrent()) logger.recoverable('[VoiceCall] Queue flush failed', queueError);
          });
        }
      }
    });
    service.setMessageHandler({
      onUserMessage: (text) => {
        if (!isCurrent()) return;
        if (service === humeEVIService && consumeSuppressedEcho(text)) return;
        appendMessage('user', text, { source: service === offlineEVIService ? 'offline' : 'hume' });
      },
      onAssistantMessage: (text) => {
        if (!isCurrent()) return;
        return appendMessage('assistant', text, { source: service === offlineEVIService ? 'offline' : 'hume' });
      },
      onChatMetadata: async (metadata) => {
        if (!isCurrent()) throw cancelledVoiceOperation();
        await updateConversationSessionMetadata(sessionIdRef.current, {
          ...metadata,
          customSessionId: sessionIdRef.current,
          voiceId: selectedVoice.id,
          voiceName: selectedVoice.displayName
        }).catch((historyError) => logger.recoverable('[VoiceCall] Failed to persist Hume session metadata', historyError));
        if (!isCurrent()) throw cancelledVoiceOperation();
        await configureHumeCustomSession({
          chatId: metadata.chatId,
          customSessionId: sessionIdRef.current,
          accessToken
        });
        if (!isCurrent()) throw cancelledVoiceOperation();
      },
      onToolCall: async (toolCall, { signal }) => {
        if (!isCurrent()) throw cancelledVoiceOperation();
        const result = await executeHumeTool(toolCall, {
          accessToken,
          signal,
          requestHelpDial,
          requestDeviceAction: service === humeEVIService && config.humeWSProxyURL
            ? (request, options) => humeEVIService.requestDeviceAction(request, options)
            : undefined
        });
        if (!isCurrent()) throw cancelledVoiceOperation();
        return result;
      },
      onDeviceAction: (message) => {
        if (!isCurrent()) throw cancelledVoiceOperation();
        return dispatchWearableAction(message, { publicKey: config.actionSigningPublicKey });
      },
      onError: (nextError) => {
        if (!isCurrent()) return;
        presentError(nextError);
        if (service !== offlineEVIService) setFallbackAvailable(true);
      }
    });
  }, [accessToken, appendMessage, consumeSuppressedEcho, flushPendingMessages, presentError, requestHelpDial, selectedVoice.displayName, selectedVoice.id]);

  useEffect(() => {
    bindServiceHandlers(serviceRef.current);
  }, [bindServiceHandlers]);

  useEffect(() => {
    humeEVIService.updateDevices([...wearableEntities, ...robotEntities]);
  }, [robotEntities, wearableEntities]);

  useEffect(() => {
    if (!isOnline) {
      setNotice(voiceCallCopyKeys.offline);
      return;
    }
    if (humeEVIService.getState() === 'connected') {
      flushPendingMessages().catch((queueError) => logger.recoverable('[VoiceCall] Network-restored queue flush failed', queueError));
    }
  }, [flushPendingMessages, isOnline]);

  useEffect(() => {
    loadConversationSession(sessionIdRef.current)
      .then((session) => {
        if (mountedRef.current && session?.messages) {
          setMessages((current) => {
            const currentIds = new Set(current.map((message) => message.id));
            return [...session.messages.filter((message) => !currentIds.has(message.id)), ...current]
              .slice(-MAX_IN_MEMORY_MESSAGES);
          });
        }
      })
      .catch((historyError) => logger.recoverable('[VoiceCall] Failed to load conversation', historyError));
    refreshPendingCount().catch(() => {});
  }, [refreshPendingCount]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      connectionGenerationRef.current += 1;
      if (queueRetryTimerRef.current) clearTimeout(queueRetryTimerRef.current);
      serviceRef.current.disconnect?.().catch?.(() => {});
    };
  }, []);

  const connectService = useCallback(async (service, generation) => {
    const assertCurrent = async () => {
      if (
        mountedRef.current
        && connectionGenerationRef.current === generation
        && serviceRef.current === service
      ) return;
      await service.disconnect?.().catch?.(() => {});
      throw cancelledVoiceOperation();
    };
    serviceRef.current = service;
    bindServiceHandlers(service, generation);
    setStatus(service.getState());
    if (service === offlineEVIService) {
      await service.connect({ locale, personaId: selectedVoice.id });
      await assertCurrent();
      return;
    }
    const session = await loadConversationSession(sessionIdRef.current);
    await assertCurrent();
    await service.connect({
      accessToken,
      configId: config.humeConfigId,
      // Provider voice UUIDs stay server-side when the authenticated gateway
      // is in use. Direct development connections may still use the single
      // explicitly configured branded UUID.
      voiceId: config.humeWSProxyURL ? undefined : voiceOverride(selectedVoice),
      personaId: selectedVoice.id,
      locale,
      customSessionId: config.humeWSProxyURL
        ? interactionIdRef.current
        : sessionIdRef.current,
      resumedChatGroupId: session?.chatGroupId,
      systemPrompt: `You are ${selectedVoice.displayName}, a compassionate safety companion. Be concise, emotionally attuned, honest about actions, and practical.`,
      devices: [...wearableEntities, ...robotEntities]
    });
    await assertCurrent();
  }, [accessToken, bindServiceHandlers, locale, robotEntities, selectedVoice.displayName, selectedVoice.id, wearableEntities]);

  const start = useCallback(async () => {
    if (startInFlightRef.current) return false;
    startInFlightRef.current = true;
    const generation = ++connectionGenerationRef.current;
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
      if (!mountedRef.current || connectionGenerationRef.current !== generation) throw cancelledVoiceOperation();
      const useOfflineService = forcedOffline || !isOnline;
      if (useOfflineService && !isOnline) setNotice(voiceCallCopyKeys.offline);
      await connectService(useOfflineService ? offlineEVIService : humeEVIService, generation);
      return true;
    } catch (startError) {
      if (startError?.code === 'VOICE_OPERATION_CANCELLED') return false;
      logger.recoverable('[VoiceCall] Start failed', startError);
      presentError(startError);
      if (!forcedOffline && isOnline) setFallbackAvailable(true);
      return false;
    } finally {
      startInFlightRef.current = false;
      if (mountedRef.current) setIsStarting(false);
    }
  }, [connectService, forcedOffline, isOnline, presentError, selectedVoice.displayName, selectedVoice.id]);

  const startOfflineFallback = useCallback(async () => {
    if (startInFlightRef.current) return false;
    startInFlightRef.current = true;
    const generation = ++connectionGenerationRef.current;
    setIsStarting(true);
    await serviceRef.current.disconnect?.().catch(() => {});
    setError(null);
    setFallbackAvailable(false);
    try {
      if (!mountedRef.current || connectionGenerationRef.current !== generation) throw cancelledVoiceOperation();
      await connectService(offlineEVIService, generation);
      return true;
    } catch (fallbackError) {
      if (fallbackError?.code === 'VOICE_OPERATION_CANCELLED') return false;
      logger.recoverable('[VoiceCall] Offline fallback failed', fallbackError);
      presentError(fallbackError);
    } finally {
      startInFlightRef.current = false;
      if (mountedRef.current) setIsStarting(false);
    }
  }, [connectService, presentError]);

  const retryOnline = useCallback(async () => {
    if (!isOnline || forcedOffline) return;
    if (startInFlightRef.current) return;
    startInFlightRef.current = true;
    const generation = ++connectionGenerationRef.current;
    setIsStarting(true);
    await serviceRef.current.disconnect?.().catch(() => {});
    setError(null);
    setNotice(null);
    setFallbackAvailable(false);
    try {
      if (!mountedRef.current || connectionGenerationRef.current !== generation) throw cancelledVoiceOperation();
      await connectService(humeEVIService, generation);
    } catch (retryError) {
      if (retryError?.code === 'VOICE_OPERATION_CANCELLED') return;
      logger.recoverable('[VoiceCall] Reconnect failed', retryError);
      presentError(retryError);
      setFallbackAvailable(true);
    } finally {
      startInFlightRef.current = false;
      if (mountedRef.current) setIsStarting(false);
    }
  }, [connectService, forcedOffline, isOnline, presentError]);

  const stop = useCallback(async () => {
    const service = serviceRef.current;
    let interactionFeedbackEligible = false;
    const completedInteractionId = service === humeEVIService && config.humeWSProxyURL
      ? interactionIdRef.current
      : null;
    if (service === humeEVIService && config.humeWSProxyURL && service.getState() === 'connected') {
      const microphoneStop = service.stopMicrophone().catch(() => {});
      try {
        interactionFeedbackEligible = await service.completeInteraction(completedInteractionId) === true;
      } catch (completionError) {
        logger.recoverable('[VoiceCall] Secure interaction completion was not acknowledged', {
          errorCode: completionError?.code || completionError?.name || 'VOICE_INTERACTION_COMPLETION_FAILED'
        });
      }
      await microphoneStop;
    }
    connectionGenerationRef.current += 1;
    if (queueRetryTimerRef.current) {
      clearTimeout(queueRetryTimerRef.current);
      queueRetryTimerRef.current = null;
    }
    await service.disconnect();
    if (completedInteractionId) interactionIdRef.current = createConversationSessionId();
    return Object.freeze({
      interactionFeedbackEligible,
      interactionId: interactionFeedbackEligible ? completedInteractionId : null
    });
  }, []);

  const sendText = useCallback(async (rawText) => {
    let text;
    try {
      text = normalizeVoiceText(rawText);
    } catch (textError) {
      presentError(textError);
      throw textError;
    }
    if (!text) return false;
    const service = serviceRef.current;
    if (service === humeEVIService && isOnline && service.getState() === 'connected' && service.sendText(text)) return true;

    if (service === offlineEVIService && forcedOffline && service.getState() === 'connected') {
      appendMessage('user', text, { source: 'offline', deliveryStatus: 'local' });
      service.sendText(text, { emitUser: false });
      setNotice(null);
      return true;
    }

    try {
      const queued = await queueOfflineMessage({ sessionId: sessionIdRef.current, text });
      appendMessage('user', text, { id: queued.id, source: 'offline', deliveryStatus: 'queued' });
      await refreshPendingCount();
      if (service === offlineEVIService && service.getState() === 'connected') service.sendText(text, { emitUser: false });
      else setFallbackAvailable(true);
      setNotice(isOnline ? voiceCallCopyKeys.queued : voiceCallCopyKeys.offline);
      return false;
    } catch (queueError) {
      logger.recoverable('[VoiceCall] Could not persist the offline message', {
        name: queueError?.name || 'OfflineQueueError'
      });
      presentError(queueError);
      throw queueError;
    }
  }, [appendMessage, forcedOffline, isOnline, presentError, refreshPendingCount]);

  const retryMessage = useCallback(async (messageId) => {
    if (!messageId) return false;
    await retryQueuedMessage(sessionIdRef.current, messageId);
    await updateConversationMessage(sessionIdRef.current, messageId, { deliveryStatus: 'queued', deliveryError: null });
    setMessages((items) => items.map((item) => item.id === messageId
      ? { ...item, deliveryStatus: 'queued', deliveryError: null }
      : item));
    setNotice(voiceCallCopyKeys.retrying);
    if (!isOnline) {
      setNotice(voiceCallCopyKeys.offline);
      return false;
    }
    if (humeEVIService.getState() === 'connected') {
      await flushPendingMessages();
      return true;
    }
    if (!forcedOffline) await retryOnline();
    else setNotice(voiceCallCopyKeys.queued);
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
