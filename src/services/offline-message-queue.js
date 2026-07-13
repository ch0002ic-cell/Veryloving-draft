import { storage } from './storage';
import { runLocalUserDataMutation } from './local-mutation-coordinator';

export const OFFLINE_MESSAGE_QUEUE_KEY = 'veryloving.offlineMessageQueue';
const MAX_QUEUED_MESSAGES = 100;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
let mutationQueue = Promise.resolve();

export function offlineRetryDelay(attempts) {
  const normalizedAttempts = Math.max(1, Number(attempts) || 1);
  return Math.min(1000 * Math.pow(2, normalizedAttempts - 1), MAX_BACKOFF_MS);
}

function mutate(mutator) {
  const previousMutation = mutationQueue;
  const operation = runLocalUserDataMutation(async () => {
    await previousMutation.catch(() => {});
    const current = await storage.getJSON(OFFLINE_MESSAGE_QUEUE_KEY, []);
    const next = await mutator(Array.isArray(current) ? current : []);
    await storage.setJSON(OFFLINE_MESSAGE_QUEUE_KEY, next);
    return next;
  });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function drainOfflineMessageQueueMutations() {
  await mutationQueue.catch(() => {});
}

export async function loadOfflineMessageQueue() {
  await drainOfflineMessageQueueMutations();
  const queue = await storage.getJSON(OFFLINE_MESSAGE_QUEUE_KEY, []);
  return Array.isArray(queue) ? queue : [];
}

export function queueOfflineMessage(message) {
  if (!message?.sessionId || !message?.text?.trim()) throw new Error('A session and message text are required.');
  const now = new Date().toISOString();
  const queued = {
    id: message.id || `queued-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    sessionId: message.sessionId,
    text: message.text.trim(),
    createdAt: message.createdAt || now,
    attempts: 0,
    nextAttemptAt: 0
  };
  return mutate((items) => {
    if (items.some((item) => item.id === queued.id)) return items;
    return [...items, queued].slice(-MAX_QUEUED_MESSAGES);
  }).then(() => queued);
}

export async function queuedMessageCount(sessionId) {
  const queue = await loadOfflineMessageQueue();
  return queue.filter((item) => !sessionId || item.sessionId === sessionId).length;
}

export function clearOfflineMessageQueue() {
  return mutate(() => []);
}

export function deleteQueuedMessagesForSession(sessionId) {
  if (!sessionId) return Promise.resolve([]);
  return mutate((items) => items.filter((item) => item.sessionId !== sessionId));
}

export function retryQueuedMessage(sessionId, messageId) {
  if (!sessionId || !messageId) return Promise.resolve([]);
  return mutate((items) => items.map((item) => item.sessionId === sessionId && item.id === messageId
    ? { ...item, attempts: 0, nextAttemptAt: 0 }
    : item));
}

export function flushOfflineMessageQueue({ sessionId, sendMessage, onDelivered, onFailed, force = false, now = Date.now }) {
  if (!sessionId || typeof sendMessage !== 'function') return Promise.resolve([]);
  return mutate(async (items) => {
    const remaining = [];
    let blocked = false;
    for (const item of items) {
      if (item.sessionId !== sessionId || blocked) {
        remaining.push(item);
        continue;
      }
      if (!force && item.nextAttemptAt > now()) {
        remaining.push(item);
        continue;
      }
      try {
        const accepted = await sendMessage(item);
        if (accepted === false) throw new Error('Message was not accepted by the voice service.');
        try {
          await onDelivered?.(item);
        } catch {
          // Delivery succeeded; local bookkeeping must not cause a duplicate replay.
        }
      } catch (error) {
        const attempts = item.attempts + 1;
        const failedItem = {
          ...item,
          attempts,
          nextAttemptAt: now() + offlineRetryDelay(attempts)
        };
        remaining.push(failedItem);
        try {
          await onFailed?.(failedItem, error);
        } catch {
          // Keep delivery retryable even when UI bookkeeping fails.
        }
        blocked = true;
      }
    }
    return remaining;
  });
}
