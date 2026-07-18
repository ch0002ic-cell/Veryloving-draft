'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_EXPO_BATCH_SIZE,
  createEmergencyContactPushNotifier,
  createExpoPushNotifier
} = require('./push-notifications.cjs');
const { handleSafetyAPI } = require('./safety-api.cjs');

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

test('emergency-contact notifier awaits verified account resolution and deduplicates recipients', async () => {
  const notification = { title: 'Safety alert', body: 'Open the app.' };
  const calls = [];
  const notify = createEmergencyContactPushNotifier({
    safetyRepository: {
      async listContacts() {
        return [
          { id: 'selected-1', phone: '+6591111111' },
          { id: 'selected-2', phone: '+6592222222' },
          { id: 'selected-3', phone: '+6593333333' },
          { id: 'not-selected', phone: '+6594444444' }
        ];
      }
    },
    async resolvePhoneAccountId(phone) {
      await Promise.resolve();
      if (phone === '+6591111111' || phone === '+6592222222') return 'contact-account';
      if (phone === '+6593333333') return 'sos-owner';
      return 'unselected-account';
    },
    async notifyUser(recipientId, payload) {
      calls.push({ recipientId, payload });
      return { sent: 2, failed: 0 };
    }
  });

  const result = await notify(
    'sos-owner',
    ['selected-1', 'selected-2', 'selected-3'],
    notification
  );

  assert.deepEqual(result, {
    eligible: 1,
    delivered: 1,
    failedRecipients: 0,
    sentNotifications: 2
  });
  assert.deepEqual(calls, [{ recipientId: 'contact-account', payload: notification }]);
});

test('emergency-contact notifier records linked accounts with no successful push as failed recipients', async () => {
  const notify = createEmergencyContactPushNotifier({
    safetyRepository: {
      async listContacts() {
        return [
          { id: 'contact-1', phone: '+6591111111' },
          { id: 'contact-2', phone: '+6592222222' },
          { id: 'contact-3', phone: '+6593333333' }
        ];
      }
    },
    async resolvePhoneAccountId(phone) { return `account:${phone}`; },
    async notifyUser(recipientId) {
      if (recipientId.endsWith('1111111')) return { sent: 3, failed: 1 };
      if (recipientId.endsWith('2222222')) return { sent: 0 };
      throw new Error('provider unavailable');
    }
  });

  assert.deepEqual(await notify('sos-owner', ['contact-1', 'contact-2', 'contact-3'], { body: 'Alert' }), {
    eligible: 3,
    delivered: 1,
    failedRecipients: 2,
    sentNotifications: 3
  });
});

test('SOS acceptance remains accepted when emergency-contact push delivery fails', async () => {
  const now = Date.now();
  const contactId = 'contact_abcdefghijklmnopqrstuvwx';
  const recordedDeliveries = [];
  let response;
  const repository = {
    async listContacts() { return [{ id: contactId, phone: '+6591111111' }]; },
    async acceptSOS(_userId, event) { return event; },
    async claimSOSDelivery(_userId, _idempotencyKey) { return { claimed: true }; },
    async recordSOSDelivery(userId, idempotencyKey, delivery) {
      recordedDeliveries.push({ userId, idempotencyKey, delivery });
    }
  };

  await handleSafetyAPI({
    req: { method: 'POST' },
    res: {},
    url: new URL('https://api.example.test/v1/sos-events'),
    body: {
      idempotencyKey: 'sos_1234567890abcdefg',
      occurredAt: now,
      source: 'app',
      contactIds: [contactId]
    },
    principal: { sub: 'sos-owner', scope: 'safety:write' },
    repository,
    async notifyEmergencyContacts() {
      return { eligible: 2, delivered: 0, failedRecipients: 2 };
    },
    json(_res, statusCode, body) { response = { statusCode, body }; }
  });

  assert.equal(response.statusCode, 202);
  assert.equal(response.body.status, 'accepted');
  assert.equal(response.body.deliveryStatus, 'failed');
  assert.deepEqual(recordedDeliveries, [{
    userId: 'sos-owner',
    idempotencyKey: 'sos_1234567890abcdefg',
    delivery: {
      deliveryStatus: 'failed',
      eligibleCount: 2,
      deliveredCount: 0,
      failedCount: 2
    }
  }]);
});
