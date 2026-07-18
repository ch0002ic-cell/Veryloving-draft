'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

const originalLoad = Module._load;
Module._load = function loadSafetyConfig(request, parent, isMain) {
  if (request === '../utils/config' && parent?.filename.endsWith('/src/services/safety-api.js')) {
    return { config: { safetyBackendEnabled: true, apiBaseUrl: 'https://api.example.test' } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const {
  dispatchMedicationEscalation,
  dispatchSOS,
  normalizeSOSLocation,
  safetyRequest,
  SOS_LOCATION_MAX_AGE_MS
} = require('../src/services/safety-api');
const { createMedicationReminderScheduler } = require('../src/services/medication-reminder-scheduler');
const { MEDICATION_REMINDER_STATUS } = require('../src/services/medication-reminder-state');
Module._load = originalLoad;

const runtimeConfig = { safetyBackendEnabled: true, apiBaseUrl: 'https://api.example.test/' };

test('safety client sends first-party bearer auth and validates HTTP failures', async () => {
  let request;
  const payload = await safetyRequest('/v1/test', {
    accessToken: 'first-party-session',
    method: 'POST',
    body: { mode: 'guardian' },
    runtimeConfig,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
    }
  });
  assert.deepEqual(payload, { status: 'ok' });
  assert.equal(request.url, 'https://api.example.test/v1/test');
  assert.equal(request.options.headers.Authorization, 'Bearer first-party-session');
  assert.deepEqual(JSON.parse(request.options.body), { mode: 'guardian' });

  await assert.rejects(safetyRequest('/v1/test', {
    accessToken: 'expired-session',
    runtimeConfig,
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' })
    })
  }), (error) => error.code === 'SAFETY_HTTP_401');
});

test('safety client fails closed without auth and aborts stalled requests', async () => {
  await assert.rejects(safetyRequest('/v1/test', {
    runtimeConfig,
    fetchImpl: async () => { throw new Error('must not run'); }
  }), (error) => error.code === 'SAFETY_AUTHENTICATION_REQUIRED');

  await assert.rejects(safetyRequest('/v1/test', {
    accessToken: 'first-party-session',
    runtimeConfig,
    timeoutMs: 5,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })
  }), (error) => error.code === 'SAFETY_TIMEOUT');
});

test('SOS location normalization omits stale optional cache without blocking the event', () => {
  const now = 1_000_000;
  assert.deepEqual(normalizeSOSLocation({
    timestamp: now - SOS_LOCATION_MAX_AGE_MS,
    coords: { latitude: 1.3521, longitude: 103.8198 }
  }, { now: () => now }), {
    latitude: 1.3521,
    longitude: 103.8198,
    capturedAt: now - SOS_LOCATION_MAX_AGE_MS
  });

  assert.equal(normalizeSOSLocation({
    isCached: true,
    cachedAt: now - SOS_LOCATION_MAX_AGE_MS - 1,
    coords: { latitude: 1.3521, longitude: 103.8198 }
  }, { now: () => now }), null);

  assert.equal(normalizeSOSLocation({
    timestamp: now,
    coords: { latitude: 91, longitude: 103.8198 }
  }, { now: () => now }), null);
});

test('SOS dispatch omits stale location and includes only the consent-built medical attachment', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const requests = [];
  try {
    Date.now = () => 2_000_000;
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, status: 202, json: async () => ({ id: 'sos-receipt', status: 'accepted' }) };
    };

    await dispatchSOS({
      accessToken: 'first-party-session',
      idempotencyKey: 'durable-idempotency-key',
      contactIds: ['contact_abcdefghijklmnopqrstuvwx'],
      location: {
        isCached: true,
        cachedAt: 2_000_000 - SOS_LOCATION_MAX_AGE_MS - 1,
        coords: { latitude: 1.3521, longitude: 103.8198 }
      },
      medicalAttachment: {
        schemaVersion: 1,
        profileVersion: 1,
        consentRecordedAt: 1_999_000,
        generatedAt: 2_000_000,
        bloodType: 'O+',
        conditions: [],
        allergies: [],
        medications: [],
        emergencyNotes: null
      }
    });
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 1);
  assert.equal(Object.hasOwn(requests[0], 'location'), false);
  assert.equal(requests[0].medicalAttachment.bloodType, 'O+');
  assert.equal(requests[0].occurredAt, 2_000_000);
});

test('medication escalation client matches the protected durable backend contract', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 202,
        json: async () => ({ id: 'medication_escalation_receipt', status: 'accepted' })
      };
    };
    const response = await dispatchMedicationEscalation({
      reminderId: 'medication-reminder-0001',
      medicationId: 'schedule_item_01',
      idempotencyKey: 'medication_1234567890abcdef',
      accessToken: 'first-party-session',
      occurredAt: 3_000_000
    });
    assert.deepEqual(response, { id: 'medication_escalation_receipt', status: 'accepted' });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests[0].url, 'https://api.example.test/v1/medication-escalations');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer first-party-session');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    idempotencyKey: 'medication_1234567890abcdef',
    medicationReference: 'schedule_item_01',
    reason: 'reminder_unacknowledged',
    occurredAt: 3_000_000,
    source: 'home_robot'
  });
});

test('medication scheduler consumes the real caregiver API response shape end to end', async () => {
  const originalFetch = globalThis.fetch;
  let currentTime = 4_000_000;
  let snapshot = null;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 202,
      json: async () => ({
        id: 'medication_escalation_backend_0001',
        status: 'accepted',
        deliveryStatus: 'delivered'
      })
    });
    const scheduler = createMedicationReminderScheduler({
      accountId: 'user-a',
      now: () => currentTime,
      storageImpl: {
        async getJSON(_key, fallback) { return snapshot || fallback; },
        async setJSON(_key, value) { snapshot = structuredClone(value); }
      },
      sendRobotReminder: async () => ({
        status: 'accepted',
        action_id: 'manufacturer_action_backend_0001'
      }),
      notifyCaregiver: ({ reminderId, medicationId, idempotencyKey }) => (
        dispatchMedicationEscalation({
          reminderId,
          medicationId,
          idempotencyKey,
          accessToken: 'first-party-session',
          occurredAt: currentTime
        })
      )
    });
    await scheduler.start();
    await scheduler.schedule({
      id: 'client-backend-reminder-0001',
      medicationId: 'schedule_item_01',
      robotDeviceId: 'robot-home-0001',
      dueAt: currentTime + 60_000,
      escalationDelayMs: 60_000
    });
    currentTime += 60_000;
    await scheduler.runDue();
    currentTime += 60_000;
    await scheduler.runDue();
    const reminder = (await scheduler.list())[0];
    assert.equal(reminder.status, MEDICATION_REMINDER_STATUS.escalated);
    assert.equal(reminder.escalationReceiptId, 'medication_escalation_backend_0001');
    assert.equal(reminder.delivery.escalation.deliveryStatus, 'delivered');
    scheduler.stop();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('lost caregiver response retries with identical idempotency fingerprint inputs', async () => {
  const originalFetch = globalThis.fetch;
  let currentTime = 6_000_000;
  let snapshot = null;
  const bodies = [];
  try {
    globalThis.fetch = async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      if (bodies.length === 1) throw Object.assign(new Error('response lost'), { code: 'ECONNRESET' });
      return {
        ok: true,
        status: 202,
        json: async () => ({
          id: 'medication_escalation_retry_0001',
          status: 'accepted',
          deliveryStatus: 'failed'
        })
      };
    };
    const scheduler = createMedicationReminderScheduler({
      accountId: 'user-a',
      now: () => currentTime,
      retryBaseMs: 1000,
      retryMaximumMs: 1000,
      storageImpl: {
        async getJSON(_key, fallback) { return snapshot || fallback; },
        async setJSON(_key, value) { snapshot = structuredClone(value); }
      },
      sendRobotReminder: async () => ({
        status: 'accepted',
        action_id: 'manufacturer_action_retry_0001'
      }),
      notifyCaregiver: ({ reminderId, medicationId, idempotencyKey, occurredAt }) => (
        dispatchMedicationEscalation({
          reminderId,
          medicationId,
          idempotencyKey,
          occurredAt,
          accessToken: 'first-party-session'
        })
      )
    });
    await scheduler.start();
    await scheduler.schedule({
      id: 'lost-response-reminder-0001',
      medicationId: 'schedule_item_02',
      robotDeviceId: 'robot-home-0001',
      dueAt: currentTime + 60_000,
      escalationDelayMs: 60_000
    });
    currentTime += 60_000;
    await scheduler.runDue();
    currentTime += 60_000;
    await scheduler.runDue();
    assert.equal(bodies.length, 1);
    currentTime += 1000;
    await scheduler.runDue();
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[1], bodies[0]);
    assert.equal(bodies[0].idempotencyKey, 'lost-response-reminder-0001_escalation_v1');
    assert.equal(bodies[0].occurredAt, 6_120_000);
    const reminder = (await scheduler.list())[0];
    assert.equal(reminder.status, MEDICATION_REMINDER_STATUS.escalationAccepted);
    assert.equal(reminder.delivery.escalation.deliveryStatus, 'failed');
    scheduler.stop();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
