import { storage } from './storage';
import { createOpaqueSessionId } from '../utils/session-id';
import { runLocalUserDataMutation } from './local-mutation-coordinator';

export const CONVERSATION_HISTORY_KEY = 'veryloving.conversationHistory';
const MAX_SESSIONS = 50;
const MAX_MESSAGES_PER_SESSION = 200;
let mutationQueue = Promise.resolve();

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

export function createConversationSessionId() {
  return createOpaqueSessionId();
}

function runMutation(mutator) {
  const previousMutation = mutationQueue;
  const operation = runLocalUserDataMutation(async () => {
    await previousMutation.catch(() => {});
    const sessions = await storage.getJSON(CONVERSATION_HISTORY_KEY, []);
    const next = await mutator(Array.isArray(sessions) ? sessions : []);
    await storage.setJSON(CONVERSATION_HISTORY_KEY, next);
    return next;
  });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function drainConversationHistoryMutations() {
  await mutationQueue.catch(() => {});
}

export async function loadConversationHistory() {
  await drainConversationHistoryMutations();
  const sessions = await storage.getJSON(CONVERSATION_HISTORY_KEY, []);
  return Array.isArray(sessions) ? sessions : [];
}

export async function loadConversationSession(sessionId) {
  if (!sessionId) return null;
  const sessions = await loadConversationHistory();
  return sessions.find((session) => session.id === sessionId) || null;
}

export function clearConversationHistory() {
  return runMutation(() => []);
}

export function ensureConversationSession({ sessionId, voiceId, voiceName }) {
  if (!sessionId) throw new Error('A conversation session ID is required.');
  return runMutation((sessions) => {
    if (sessions.some((session) => session.id === sessionId)) return sessions;
    const now = new Date().toISOString();
    return [{ id: sessionId, voiceId, voiceName, startedAt: now, updatedAt: now, messages: [] }, ...sessions].slice(0, MAX_SESSIONS);
  });
}

export function appendConversationMessage(message) {
  if (!message?.text?.trim()) return Promise.resolve([]);
  return runMutation((sessions) => {
    const sessionId = message.sessionId || createConversationSessionId();
    const now = new Date().toISOString();
    const nextMessage = {
      id: message.id || `${sessionId}-${Date.now()}-${randomSuffix()}`,
      role: message.role,
      text: message.text.trim(),
      voiceId: message.voiceId,
      source: message.source,
      deliveryStatus: message.deliveryStatus,
      createdAt: message.createdAt || now
    };

    const existingIndex = sessions.findIndex((session) => session.id === sessionId);
    const existing = existingIndex >= 0 ? sessions[existingIndex] : null;
    if (existing?.messages?.some((item) => item.id === nextMessage.id)) return sessions;
    const nextSession = {
      id: sessionId,
      voiceId: message.voiceId || existing?.voiceId,
      voiceName: message.voiceName || existing?.voiceName,
      chatId: existing?.chatId,
      chatGroupId: existing?.chatGroupId,
      customSessionId: existing?.customSessionId || sessionId,
      startedAt: existing?.startedAt || message.startedAt || now,
      updatedAt: now,
      messages: [...(existing?.messages || []), nextMessage].slice(-MAX_MESSAGES_PER_SESSION)
    };

    const nextSessions = [nextSession, ...sessions.filter((session) => session.id !== sessionId)];
    return nextSessions.slice(0, MAX_SESSIONS);
  });
}

export function updateConversationSessionMetadata(sessionId, metadata = {}) {
  if (!sessionId) return Promise.resolve([]);
  return runMutation((sessions) => {
    const now = new Date().toISOString();
    const existing = sessions.find((session) => session.id === sessionId);
    const nextSession = {
      id: sessionId,
      voiceId: metadata.voiceId || existing?.voiceId,
      voiceName: metadata.voiceName || existing?.voiceName,
      chatId: metadata.chatId || existing?.chatId,
      chatGroupId: metadata.chatGroupId || existing?.chatGroupId,
      customSessionId: metadata.customSessionId || existing?.customSessionId || sessionId,
      startedAt: existing?.startedAt || now,
      updatedAt: now,
      messages: existing?.messages || []
    };
    return [nextSession, ...sessions.filter((session) => session.id !== sessionId)].slice(0, MAX_SESSIONS);
  });
}

export function updateConversationMessage(sessionId, messageId, patch) {
  if (!sessionId || !messageId) return Promise.resolve([]);
  return runMutation((sessions) => sessions.map((session) => {
    if (session.id !== sessionId) return session;
    return {
      ...session,
      updatedAt: new Date().toISOString(),
      messages: (session.messages || []).map((message) => message.id === messageId ? { ...message, ...patch } : message)
    };
  }));
}

export function deleteConversationSession(sessionId) {
  return runMutation((sessions) => sessions.filter((session) => session.id !== sessionId));
}
