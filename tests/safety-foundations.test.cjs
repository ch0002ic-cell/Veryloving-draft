'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createSafetyEventRouter,
  normalizeSafetyEvent
} = require('../src/services/safety-events');
const {
  distanceBetweenLocations,
  evaluateGeofence
} = require('../src/services/geofence-evaluator');
const {
  createMedicationReminder,
  MEDICATION_REMINDER_STATUS,
  nextMedicationActions,
  transitionMedicationReminder
} = require('../src/services/medication-reminder-state');
const {
  buildEmergencyMedicalAttachment,
  normalizeMedicalEmergencyProfile
} = require('../src/services/medical-emergency-profile');
const { secureStorage } = require('../src/services/secure-storage');
const {
  clearMedicalEmergencyProfile,
  loadEmergencyMedicalAttachment,
  loadMedicalEmergencyProfile,
  MEDICAL_PROFILE_KEY,
  saveMedicalEmergencyProfile
} = require('../src/services/medical-profile-store');
const { decodeVL01SafetyEvent } = require('../src/services/vl01-protocol');

test('Pat-Pat routes exactly once into the injected SOS path with a durable event identity', async () => {
  const calls = [];
  const router = createSafetyEventRouter({
    now: () => 1_000_000,
    decodeWearableEvent: async (raw) => JSON.parse(raw),
    activateSOS: async (request) => {
      calls.push(request);
      return { status: 'dialer_opened', backendStatus: 'accepted' };
    }
  });
  const raw = JSON.stringify({
    event_type: 'pat_pat',
    event_id: 'vl01-event-0001',
    occurred_at: 999_900
  });

  const first = await router.routeWearableEvent(raw, { deviceId: 'wearable-0001' });
  const replay = await router.routeWearableEvent(raw, { deviceId: 'wearable-0001' });
  assert.equal(first.status, 'sos_dispatched');
  assert.equal(replay.status, 'duplicate');
  assert.deepEqual(calls, [{
    trigger: 'pat_pat',
    source: 'vl01',
    deviceId: 'wearable-0001',
    occurredAt: 999_900,
    idempotencyKey: 'vl01-event-0001'
  }]);
});

test('VL01 safety event decoder requires a bounded versioned firmware envelope', () => {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    event_type: 'pat_pat',
    event_id: 'vl01-event-0001',
    occurred_at: 999_900
  })).toString('base64');
  assert.equal(decodeVL01SafetyEvent(payload).event_id, 'vl01-event-0001');
  assert.throws(() => decodeVL01SafetyEvent(Buffer.from('{"version":2}').toString('base64')), /unsupported/);
  assert.throws(() => decodeVL01SafetyEvent('not base64!'), /versioned envelope|invalid length/);
});

test('Pat-Pat fails closed without a manufacturer decoder or stable replay identifier', async () => {
  const noDecoder = createSafetyEventRouter({ activateSOS: async () => {} });
  await assert.rejects(
    noDecoder.routeWearableEvent('opaque', { deviceId: 'wearable-0001' }),
    (error) => error.code === 'WEARABLE_EVENT_DECODER_UNAVAILABLE'
  );

  const router = createSafetyEventRouter({
    now: () => 1_000_000,
    decodeWearableEvent: async () => ({ event: 'pat_pat', occurredAt: 1_000_000 }),
    activateSOS: async () => { throw new Error('must not activate'); }
  });
  await assert.rejects(
    router.routeWearableEvent('opaque', { deviceId: 'wearable-0001' }),
    (error) => error.code === 'SAFETY_EVENT_ID_INVALID'
  );
});

test('concurrent Pat-Pat duplicates cannot start a second SOS operation and failures remain retryable', async () => {
  let attempts = 0;
  let releaseFirst;
  const firstActivation = new Promise((resolve) => { releaseFirst = resolve; });
  const event = { type: 'pat_pat', eventId: 'concurrent-event-01', occurredAt: 3_000_000 };
  const router = createSafetyEventRouter({
    now: () => 3_000_000,
    decodeWearableEvent: async (value) => value,
    activateSOS: async () => {
      attempts += 1;
      await firstActivation;
      return { status: 'accepted' };
    }
  });
  const first = router.routeWearableEvent(event, { deviceId: 'w1' });
  while (attempts === 0) await Promise.resolve();
  const concurrent = await router.routeWearableEvent(event, { deviceId: 'w1' });
  assert.equal(concurrent.status, 'duplicate_in_flight');
  assert.equal(attempts, 1);
  releaseFirst();
  assert.equal((await first).status, 'sos_dispatched');

  let shouldFail = true;
  const retryRouter = createSafetyEventRouter({
    now: () => 3_000_000,
    decodeWearableEvent: async (value) => value,
    activateSOS: async () => {
      if (shouldFail) throw new Error('temporary failure');
      return { status: 'accepted' };
    }
  });
  await assert.rejects(
    retryRouter.routeWearableEvent(event, { deviceId: 'w1' }),
    /temporary failure/
  );
  shouldFail = false;
  assert.equal((await retryRouter.routeWearableEvent(event, { deviceId: 'w1' })).status, 'sos_dispatched');
});

test('fall events normalize consistently across wearable and home robot sources', async () => {
  const falls = [];
  const router = createSafetyEventRouter({
    now: () => 2_000_000,
    decodeWearableEvent: async (value) => value,
    reportFall: async (event) => { falls.push(event); return { accepted: true }; }
  });
  const wearable = await router.routeWearableEvent({
    type: 'fall_detected', eventId: 'wearable-fall-01', occurredAt: 1_999_000, confidence: 0.94
  }, { deviceId: 'wearable-0001' });
  const robot = await router.routeRobotEvent({
    event: 'fall', event_id: 'robot-fall-0001', occurred_at: 1_999_500, confidence: 0.87
  }, { deviceId: 'robot-home-0001' });

  assert.equal(wearable.event.source, 'vl01');
  assert.equal(robot.event.source, 'home_robot');
  assert.equal(wearable.event.type, robot.event.type);
  assert.equal(falls.length, 2);
  assert.throws(() => normalizeSafetyEvent({
    type: 'pat_pat', eventId: 'robot-patpat-01', occurredAt: 2_000_000
  }, { deviceType: 'home_robot', deviceId: 'robot-home-0001', now: () => 2_000_000 }),
  (error) => error.code === 'SAFETY_EVENT_SOURCE_INVALID');
});

test('stale and future safety events cannot activate handlers', async () => {
  let activations = 0;
  const router = createSafetyEventRouter({
    now: () => 10_000_000,
    maxEventAgeMs: 1000,
    futureToleranceMs: 100,
    decodeWearableEvent: async (value) => value,
    activateSOS: async () => { activations += 1; }
  });
  await assert.rejects(router.routeWearableEvent({
    type: 'pat_pat', eventId: 'stale-event-01', occurredAt: 9_998_999
  }, { deviceId: 'wearable-0001' }), (error) => error.code === 'SAFETY_EVENT_STALE');
  await assert.rejects(router.routeWearableEvent({
    type: 'pat_pat', eventId: 'future-event-01', occurredAt: 10_000_101
  }, { deviceId: 'wearable-0001' }), (error) => error.code === 'SAFETY_EVENT_FUTURE');
  assert.equal(activations, 0);
});

test('geofence evaluation is deterministic, freshness-bounded, and hysteresis-safe', () => {
  const now = 1_000_000;
  const fence = { id: 'home', latitude: 1.3000, longitude: 103.8000, radiusMeters: 100 };
  assert.ok(distanceBetweenLocations(fence, { latitude: 1.3005, longitude: 103.8000 }) > 50);

  const inside = evaluateGeofence({
    geofence: fence,
    location: { latitude: 1.3005, longitude: 103.8000, capturedAt: now },
    previousState: 'unknown',
    now: () => now
  });
  assert.equal(inside.state, 'inside');

  const boundaryNoise = evaluateGeofence({
    geofence: fence,
    location: { latitude: 1.30095, longitude: 103.8000, capturedAt: now },
    previousState: 'inside',
    now: () => now
  });
  assert.equal(boundaryNoise.state, 'inside');
  assert.equal(boundaryNoise.transition, 'none');

  const exit = evaluateGeofence({
    geofence: fence,
    location: { latitude: 1.3012, longitude: 103.8000, capturedAt: now },
    previousState: 'inside',
    now: () => now
  });
  assert.equal(exit.state, 'outside');
  assert.equal(exit.transition, 'exit');

  const stale = evaluateGeofence({
    geofence: fence,
    location: { latitude: 1.3000, longitude: 103.8000, capturedAt: now - 301_000 },
    previousState: 'outside',
    now: () => now
  });
  assert.deepEqual(stale, {
    state: 'unknown', transition: 'none', reason: 'location_stale', distanceMeters: null
  });
});

test('medication state distinguishes accepted from delivered and escalates deterministically', () => {
  let currentTime = 1_000_000;
  const now = () => currentTime;
  let reminder = createMedicationReminder({
    id: 'med-reminder-001',
    medicationId: 'morning-dose',
    robotDeviceId: 'robot-home-0001',
    dueAt: 1_060_000,
    escalationDelayMs: 60_000
  }, { now });

  currentTime = 1_060_000;
  reminder = transitionMedicationReminder(reminder, { type: 'tick' }, { now });
  assert.equal(reminder.status, MEDICATION_REMINDER_STATUS.reminderDue);
  assert.deepEqual(nextMedicationActions(reminder), [{
    type: 'send_robot_reminder',
    idempotencyKey: 'med-reminder-001_reminder_v1',
    deviceId: 'robot-home-0001',
    command: {
      action: 'medication_reminder',
      parameters: {
        reminder_id: 'med-reminder-001',
        medication_id: 'morning-dose',
        scheduled_at: 1_060_000
      }
    }
  }]);

  currentTime = 1_061_000;
  reminder = transitionMedicationReminder(reminder, {
    type: 'reminder_accepted', receiptId: 'manufacturer-accepted-01'
  }, { now });
  assert.equal(reminder.status, MEDICATION_REMINDER_STATUS.reminderAccepted);
  assert.equal(reminder.reminderDeliveredAt, undefined);

  currentTime = 1_120_000;
  reminder = transitionMedicationReminder(reminder, { type: 'tick' }, { now });
  assert.equal(reminder.status, MEDICATION_REMINDER_STATUS.escalationDue);
  assert.deepEqual(nextMedicationActions(reminder), [{
    type: 'notify_caregiver',
    idempotencyKey: 'med-reminder-001_escalation_v1',
    medicationId: 'morning-dose',
    occurredAt: 1_120_000
  }]);

  currentTime = 1_121_000;
  reminder = transitionMedicationReminder(reminder, {
    type: 'escalation_accepted', receiptId: 'push-accepted-0001'
  }, { now });
  assert.equal(reminder.status, MEDICATION_REMINDER_STATUS.escalationAccepted);
  assert.equal(reminder.escalationDeliveredAt, undefined);
});

test('medication acknowledgement prevents later escalation', () => {
  let currentTime = 1_000_000;
  const now = () => currentTime;
  let reminder = createMedicationReminder({
    id: 'med-reminder-002', medicationId: 'evening-dose', robotDeviceId: 'robot-home-0001',
    dueAt: 1_060_000, escalationDelayMs: 60_000
  }, { now });
  currentTime = 1_060_000;
  reminder = transitionMedicationReminder(reminder, { type: 'tick' }, { now });
  currentTime = 1_061_000;
  reminder = transitionMedicationReminder(reminder, { type: 'reminder_delivered', receiptId: 'delivered-0001' }, { now });
  currentTime = 1_062_000;
  reminder = transitionMedicationReminder(reminder, { type: 'acknowledge' }, { now });
  currentTime = 2_000_000;
  assert.equal(transitionMedicationReminder(reminder, { type: 'tick' }, { now }).status,
    MEDICATION_REMINDER_STATUS.acknowledged);
});

test('medical emergency attachments require explicit consent and current reviewed data', () => {
  const input = {
    profileVersion: 3,
    bloodType: 'O+',
    conditions: ['Asthma'],
    allergies: ['Penicillin'],
    medications: [{ name: 'Inhaler', dose: 'As prescribed', instructions: 'Use during an asthma attack' }],
    emergencyNotes: 'Emergency contact has care instructions.',
    shareInEmergency: true,
    consentRecordedAt: 975_000,
    updatedAt: 950_000
  };
  const attachment = buildEmergencyMedicalAttachment(input, { now: () => 1_000_000 });
  assert.equal(attachment.schemaVersion, 1);
  assert.equal(attachment.profileVersion, 3);
  assert.equal(Object.hasOwn(attachment, 'shareInEmergency'), false);

  assert.throws(() => buildEmergencyMedicalAttachment({ ...input, shareInEmergency: false }, {
    now: () => 1_000_000
  }), (error) => error.code === 'MEDICAL_PROFILE_CONSENT_REQUIRED');
  assert.throws(() => buildEmergencyMedicalAttachment({
    ...input, consentRecordedAt: input.updatedAt - 1
  }, {
    now: () => 1_000_000
  }), (error) => error.code === 'MEDICAL_PROFILE_CONSENT_REQUIRED');
  assert.throws(() => buildEmergencyMedicalAttachment({ ...input, updatedAt: 1 }, {
    now: () => 1_000_000,
    maxProfileAgeMs: 1000
  }), (error) => error.code === 'MEDICAL_PROFILE_STALE');
  assert.throws(() => normalizeMedicalEmergencyProfile({
    ...input,
    emergencyNotes: 'x'.repeat(501)
  }), (error) => error.code === 'MEDICAL_PROFILE_INVALID');
});

test('medical profiles are account-bound in SecureStore and load only consent-valid attachments', async () => {
  let stored = null;
  const originalGet = secureStorage.getItemAsync;
  const originalSet = secureStorage.setItemAsync;
  const originalDelete = secureStorage.deleteItemAsync;
  secureStorage.getItemAsync = async (key) => { assert.equal(key, MEDICAL_PROFILE_KEY); return stored; };
  secureStorage.setItemAsync = async (key, value) => { assert.equal(key, MEDICAL_PROFILE_KEY); stored = value; };
  secureStorage.deleteItemAsync = async (key) => { assert.equal(key, MEDICAL_PROFILE_KEY); stored = null; };
  try {
    await saveMedicalEmergencyProfile('account-a', {
      bloodType: 'O+', conditions: ['Asthma'], allergies: [], medications: [],
      shareInEmergency: true
    }, { now: () => 1_000_000 });
    assert.equal((await loadMedicalEmergencyProfile('account-a')).bloodType, 'O+');
    assert.equal(await loadMedicalEmergencyProfile('account-b'), null);
    assert.equal((await loadEmergencyMedicalAttachment('account-a', { now: () => 1_000_001 })).bloodType, 'O+');
    await clearMedicalEmergencyProfile();
    assert.equal(stored, null);
  } finally {
    secureStorage.getItemAsync = originalGet;
    secureStorage.setItemAsync = originalSet;
    secureStorage.deleteItemAsync = originalDelete;
  }
});

test('in-session medical profile clearing cannot erase another account snapshot', async () => {
  const originalGet = secureStorage.getItemAsync;
  const originalDelete = secureStorage.deleteItemAsync;
  let deleted = false;
  secureStorage.getItemAsync = async () => JSON.stringify({
    version: 1,
    accountId: 'account-a',
    profile: {}
  });
  secureStorage.deleteItemAsync = async () => { deleted = true; };
  try {
    assert.equal(await clearMedicalEmergencyProfile('account-b'), false);
    assert.equal(deleted, false);
    assert.equal(await clearMedicalEmergencyProfile('account-a'), true);
    assert.equal(deleted, true);
  } finally {
    secureStorage.getItemAsync = originalGet;
    secureStorage.deleteItemAsync = originalDelete;
  }
});
