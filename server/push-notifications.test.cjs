'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_EXPO_BATCH_SIZE, createExpoPushNotifier } = require('./push-notifications.cjs');

function token(index) {
  return `ExpoPushToken[token_${String(index).padStart(8, '0')}]`;
}

test('Expo notifier sends at most 100 messages per request and inspects tickets', async () => {
  const tokens = Array.from({ length: 205 }, (_, index) => token(index));
  const batches = [];
  const notify = createExpoPushNotifier({
    repository: { async list() { return tokens; } },
    fetchImpl: async (_url, options) => {
      const messages = JSON.parse(options.body);
      batches.push(messages);
      return { ok: true, status: 200, async json() { return { data: messages.map(() => ({ status: 'ok', id: 'ticket' })) }; } };
    }
  });
  const result = await notify('user-1', { title: 'Alert', body: 'Network failure' });
  assert.deepEqual(batches.map((batch) => batch.length), [MAX_EXPO_BATCH_SIZE, MAX_EXPO_BATCH_SIZE, 5]);
  assert.ok(batches.flat().every((message, index) => message.to === tokens[index]));
  assert.deepEqual(result, { sent: 205, failed: 0 });
});

test('Expo notifier reports per-ticket rejection and preserves partial delivery', async () => {
  const notify = createExpoPushNotifier({
    repository: { async list() { return [token(1), token(2)]; } },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { data: [{ status: 'ok', id: 'ticket' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] };
      }
    })
  });
  assert.deepEqual(await notify('user-1', { body: 'Warning' }), { sent: 1, failed: 1 });

  const rejected = createExpoPushNotifier({
    repository: { async list() { return [token(3)]; } },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() { return { data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }; }
    })
  });
  await assert.rejects(rejected('user-1', { body: 'Warning' }), (error) => (
    error.name === 'PushDeliveryError'
    && error.failures[0].code === 'DeviceNotRegistered'
    && !JSON.stringify(error).includes(token(3))
  ));
});

test('Expo notifier bounds a hung provider request', async () => {
  const notify = createExpoPushNotifier({
    repository: { async list() { return [token(1)]; } },
    timeoutMs: 5,
    fetchImpl: async () => new Promise(() => {})
  });
  await assert.rejects(notify('user-1', { body: 'Warning' }), (error) => error.name === 'TimeoutError');
});
