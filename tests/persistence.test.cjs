'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { storage } = require('../src/services/storage');
const {
  appendConversationMessage,
  clearConversationHistory,
  loadConversationSession,
  updateConversationSessionMetadata
} = require('../src/services/conversation-history');
const {
  clearOfflineMessageQueue,
  flushOfflineMessageQueue,
  loadOfflineMessageQueue,
  offlineRetryDelay,
  queueOfflineMessage,
  retryQueuedMessage
} = require('../src/services/offline-message-queue');

const memory = new Map();
storage.getJSON = async (key, fallback) => memory.has(key) ? structuredClone(memory.get(key)) : fallback;
storage.setJSON = async (key, value) => {
  await Promise.resolve();
  memory.set(key, structuredClone(value));
};

test('conversation mutations serialize concurrent message writes without loss', async () => {
  memory.clear();
  await clearConversationHistory();
  const sessionId = 'call-concurrency-test';
  await Promise.all(Array.from({ length: 25 }, (_, index) => appendConversationMessage({
    id: `message-${index}`,
    sessionId,
    role: index % 2 ? 'assistant' : 'user',
    text: `Message ${index}`,
    voiceId: 'guardian',
    voiceName: 'Guardian'
  })));
  await updateConversationSessionMetadata(sessionId, {
    chatId: 'chat-id',
    chatGroupId: 'chat-group-id',
    customSessionId: sessionId
  });
  const session = await loadConversationSession(sessionId);
  assert.equal(session.messages.length, 25);
  assert.equal(new Set(session.messages.map((message) => message.id)).size, 25);
  assert.equal(session.chatGroupId, 'chat-group-id');
});

test('offline queue retries in order and removes only accepted messages', async () => {
  memory.clear();
  await clearOfflineMessageQueue();
  await queueOfflineMessage({ id: 'queued-1', sessionId: 'session-1', text: 'First' });
  await queueOfflineMessage({ id: 'queued-2', sessionId: 'session-1', text: 'Second' });
  const attempted = [];
  await flushOfflineMessageQueue({
    sessionId: 'session-1',
    force: true,
    sendMessage: (message) => {
      attempted.push(message.id);
      return message.id === 'queued-1';
    }
  });
  assert.deepEqual(attempted, ['queued-1', 'queued-2']);
  let queue = await loadOfflineMessageQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, 'queued-2');
  assert.equal(queue[0].attempts, 1);

  await flushOfflineMessageQueue({ sessionId: 'session-1', force: true, sendMessage: () => true });
  queue = await loadOfflineMessageQueue();
  assert.deepEqual(queue, []);
});

test('offline queue applies exponential backoff and manual retry resets the schedule', async () => {
  memory.clear();
  await clearOfflineMessageQueue();
  await queueOfflineMessage({ id: 'backoff-message', sessionId: 'backoff-session', text: 'Please send this' });
  let now = 10000;
  const failures = [];

  await flushOfflineMessageQueue({
    sessionId: 'backoff-session',
    sendMessage: () => false,
    onFailed: (item) => failures.push(item.attempts),
    now: () => now
  });
  let queue = await loadOfflineMessageQueue();
  assert.equal(queue[0].attempts, 1);
  assert.equal(queue[0].nextAttemptAt, 10000 + offlineRetryDelay(1));

  now = queue[0].nextAttemptAt;
  await flushOfflineMessageQueue({
    sessionId: 'backoff-session',
    sendMessage: () => false,
    onFailed: (item) => failures.push(item.attempts),
    now: () => now
  });
  queue = await loadOfflineMessageQueue();
  assert.equal(queue[0].attempts, 2);
  assert.equal(queue[0].nextAttemptAt, now + offlineRetryDelay(2));
  assert.deepEqual(failures, [1, 2]);

  await retryQueuedMessage('backoff-session', 'backoff-message');
  queue = await loadOfflineMessageQueue();
  assert.equal(queue[0].attempts, 0);
  assert.equal(queue[0].nextAttemptAt, 0);

  await flushOfflineMessageQueue({ sessionId: 'backoff-session', sendMessage: () => true, now: () => now });
  assert.deepEqual(await loadOfflineMessageQueue(), []);
});

test('offline queue does not overtake a head message that is still in backoff', async () => {
  memory.clear();
  await clearOfflineMessageQueue();
  await queueOfflineMessage({ id: 'ordered-1', sessionId: 'ordered-session', text: 'First' });
  await queueOfflineMessage({ id: 'ordered-2', sessionId: 'ordered-session', text: 'Second' });

  await flushOfflineMessageQueue({
    sessionId: 'ordered-session',
    sendMessage: (item) => item.id !== 'ordered-1',
    now: () => 1_000
  });

  const attempted = [];
  await flushOfflineMessageQueue({
    sessionId: 'ordered-session',
    sendMessage: (item) => {
      attempted.push(item.id);
      return true;
    },
    now: () => 1_500
  });

  assert.deepEqual(attempted, []);
  assert.deepEqual((await loadOfflineMessageQueue()).map((item) => item.id), ['ordered-1', 'ordered-2']);
});

test('voice persistence rejects oversized new text and bounds legacy snapshots', async () => {
  memory.clear();
  const oversized = 'x'.repeat(4097);
  assert.throws(
    () => queueOfflineMessage({ id: 'too-large', sessionId: 'session', text: oversized }),
    (error) => error.code === 'VOICE_TEXT_TOO_LONG'
  );
  assert.throws(
    () => appendConversationMessage({ id: 'too-large', sessionId: 'session', role: 'user', text: oversized }),
    (error) => error.code === 'VOICE_TEXT_TOO_LONG'
  );

  memory.set('veryloving.offlineMessageQueue', [{ id: 'legacy', sessionId: 'session', text: oversized }]);
  memory.set('veryloving.conversationHistory', [{
    id: 'session',
    messages: [{ id: 'legacy', role: 'assistant', text: oversized }]
  }]);
  assert.equal((await loadOfflineMessageQueue())[0].text.length, 4096);
  assert.equal((await loadConversationSession('session')).messages[0].text.length, 4096);
});
