'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createMedicationReminderScheduler,
  MEDICATION_REMINDER_STORE_KEY,
  medicationReminderRetryDelay
} = require('../src/services/medication-reminder-scheduler');
const { MEDICATION_REMINDER_STATUS } = require('../src/services/medication-reminder-state');
const {
  canAcknowledgeMedicationReminder,
  createMedicationReminderInput
} = require('../src/services/medication-reminder-form');
const { recordMedicationDeliveryTelemetry } = require('../src/services/medication-telemetry');

function memoryStorage(initialValue = null) {
  let value = initialValue;
  return {
    async getJSON(key, fallback) {
      assert.equal(key, MEDICATION_REMINDER_STORE_KEY);
      return value === null ? fallback : structuredClone(value);
    },
    async setJSON(key, next) {
      assert.equal(key, MEDICATION_REMINDER_STORE_KEY);
      value = structuredClone(next);
    },
    snapshot() { return value === null ? null : structuredClone(value); }
  };
}

function timerHarness() {
  let sequence = 0;
  let active = null;
  const cleared = [];
  return {
    setTimeoutImpl(callback, delay) {
      active = { id: ++sequence, callback, delay, unref() {} };
      return active;
    },
    clearTimeoutImpl(timer) {
      cleared.push(timer?.id);
      if (active === timer) active = null;
    },
    active: () => active,
    cleared
  };
}

const reminderInput = (id = 'med-reminder-001') => ({
  id,
  medicationId: 'morning-dose',
  robotDeviceId: 'robot-home-0001',
  dueAt: 1_060_000,
  escalationDelayMs: 60_000
});

test('durable scheduler preserves accepted versus delivered and acknowledgement prevents escalation', async () => {
  let currentTime = 1_000_000;
  const store = memoryStorage();
  const timers = timerHarness();
  const robotCalls = [];
  const caregiverCalls = [];
  const scheduler = createMedicationReminderScheduler({
    accountId: 'user-a',
    storageImpl: store,
    now: () => currentTime,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
    sendRobotReminder: async (request) => {
      robotCalls.push(request);
      return { status: 'accepted', action_id: 'manufacturer-action-001' };
    },
    notifyCaregiver: async (request) => {
      caregiverCalls.push(request);
      return { status: 'accepted', receiptId: 'caregiver-push-001' };
    }
  });

  await scheduler.start();
  await scheduler.schedule(reminderInput());
  assert.equal(timers.active().delay, 60_000);
  assert.equal(store.snapshot().accountId, 'user-a');
  assert.equal(store.snapshot().reminders.length, 1);

  currentTime = 1_060_000;
  assert.deepEqual(await scheduler.runDue(), { attempted: 1, accepted: 1, total: 1 });
  assert.equal(robotCalls.length, 1);
  assert.equal(robotCalls[0].idempotencyKey, 'med-reminder-001_reminder_v1');
  assert.equal(robotCalls[0].command.action, 'medication_reminder');
  assert.deepEqual(robotCalls[0].command.parameters, {
    reminder_id: 'med-reminder-001',
    medication_id: 'morning-dose',
    scheduled_at: 1_060_000
  });
  let state = (await scheduler.list())[0];
  assert.equal(state.status, MEDICATION_REMINDER_STATUS.reminderAccepted);
  assert.equal(state.reminderAcceptedAt, 1_060_000);
  assert.equal(state.reminderDeliveredAt, undefined);

  currentTime = 1_061_000;
  state = await scheduler.recordRobotDelivery('med-reminder-001', 'manufacturer-delivery-001');
  assert.equal(state.status, MEDICATION_REMINDER_STATUS.awaitingAcknowledgement);
  assert.equal(state.reminderDeliveredAt, 1_061_000);

  currentTime = 1_062_000;
  state = await scheduler.acknowledge('med-reminder-001');
  assert.equal(state.status, MEDICATION_REMINDER_STATUS.acknowledged);
  assert.equal((await scheduler.acknowledge('med-reminder-001')).status, MEDICATION_REMINDER_STATUS.acknowledged);

  currentTime = 2_000_000;
  await scheduler.runDue();
  assert.equal(caregiverCalls.length, 0);
  scheduler.stop();
});

test('process restart rehydrates account-bound work and never repeats an accepted reminder', async () => {
  let currentTime = 1_000_000;
  const store = memoryStorage();
  const first = createMedicationReminderScheduler({
    accountId: 'user-a',
    storageImpl: store,
    now: () => currentTime,
    sendRobotReminder: async () => { throw new Error('not due'); },
    notifyCaregiver: async () => { throw new Error('not due'); }
  });
  await first.schedule(reminderInput('restart-reminder-001'));
  first.stop();

  currentTime = 1_060_000;
  const calls = [];
  const restored = createMedicationReminderScheduler({
    accountId: 'user-a',
    storageImpl: store,
    now: () => currentTime,
    sendRobotReminder: async (request) => {
      calls.push(request);
      return { accepted: true, receiptId: 'restart-acceptance-001' };
    },
    notifyCaregiver: async () => ({ accepted: true, receiptId: 'restart-caregiver-001' })
  });
  await restored.start();
  await restored.start();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].idempotencyKey, 'restart-reminder-001_reminder_v1');
  assert.equal((await restored.list())[0].status, MEDICATION_REMINDER_STATUS.reminderAccepted);

  const otherAccount = createMedicationReminderScheduler({
    accountId: 'user-b',
    storageImpl: store,
    now: () => currentTime,
    sendRobotReminder: async () => { throw new Error('cross-account dispatch'); },
    notifyCaregiver: async () => { throw new Error('cross-account dispatch'); }
  });
  assert.deepEqual((await otherAccount.start()).reminders, []);
  restored.stop();
  otherAccount.stop();
});

test('robot delivery retries exponentially, survives restart, and escalates after its bounded budget', async () => {
  let currentTime = 1_000_000;
  const store = memoryStorage();
  const idempotencyKeys = [];
  const failures = [];
  const createScheduler = () => createMedicationReminderScheduler({
    accountId: 'user-a',
    storageImpl: store,
    now: () => currentTime,
    retryBaseMs: 1000,
    retryMaximumMs: 10_000,
    maxDeliveryAttempts: 2,
    sendRobotReminder: async ({ idempotencyKey }) => {
      idempotencyKeys.push(idempotencyKey);
      throw Object.assign(new Error('private network detail'), { code: 'ROBOT_NETWORK_UNAVAILABLE' });
    },
    notifyCaregiver: async ({ idempotencyKey }) => ({
      status: 'accepted', receiptId: `${idempotencyKey}:accepted`
    }),
    onDeliveryFailure: (failure) => failures.push(failure)
  });

  const firstProcess = createScheduler();
  await firstProcess.schedule(reminderInput('retry-reminder-001'));
  currentTime = 1_060_000;
  await firstProcess.runDue();
  assert.equal(idempotencyKeys.length, 1);
  assert.equal((await firstProcess.list())[0].delivery.reminder.nextAttemptAt, 1_061_000);
  firstProcess.stop();

  const afterRestart = createScheduler();
  currentTime = 1_060_999;
  await afterRestart.runDue();
  assert.equal(idempotencyKeys.length, 1);
  currentTime = 1_061_000;
  await afterRestart.runDue();
  let state = (await afterRestart.list())[0];
  assert.equal(idempotencyKeys.length, 2);
  assert.deepEqual(new Set(idempotencyKeys), new Set(['retry-reminder-001_reminder_v1']));
  assert.equal(state.delivery.reminder.exhausted, true);
  assert.equal(state.delivery.reminder.attempts, 2);
  assert.equal(JSON.stringify(store.snapshot()).includes('private network detail'), false);
  assert.equal(failures.at(-1).exhausted, true);

  currentTime = 1_120_000;
  await afterRestart.runDue();
  state = (await afterRestart.list())[0];
  assert.equal(state.status, MEDICATION_REMINDER_STATUS.escalationAccepted);
  assert.equal(state.escalationDeliveredAt, undefined);
  currentTime = 1_121_000;
  state = await afterRestart.recordCaregiverDelivery(
    'retry-reminder-001',
    'caregiver-delivery-001'
  );
  assert.equal(state.status, MEDICATION_REMINDER_STATUS.escalated);
});

test('delivery work is capacity and cycle bounded while duplicate schedule calls are idempotent', async () => {
  let currentTime = 1_060_000;
  const store = memoryStorage();
  const delivered = [];
  const scheduler = createMedicationReminderScheduler({
    accountId: 'user-a',
    storageImpl: store,
    now: () => currentTime,
    maxReminders: 3,
    maxActionsPerCycle: 2,
    sendRobotReminder: async ({ reminderId }) => {
      delivered.push(reminderId);
      return { accepted: true, receiptId: `receipt-${reminderId}` };
    },
    notifyCaregiver: async () => ({ accepted: true, receiptId: 'caregiver-receipt' })
  });
  currentTime = 1_000_000;
  const duplicateInput = reminderInput('bounded-reminder-001');
  const [first, duplicate] = await Promise.all([
    scheduler.schedule(duplicateInput),
    scheduler.schedule(duplicateInput)
  ]);
  assert.equal(first.id, duplicate.id);
  await scheduler.schedule(reminderInput('bounded-reminder-002'));
  await scheduler.schedule(reminderInput('bounded-reminder-003'));
  await assert.rejects(
    scheduler.schedule(reminderInput('bounded-reminder-004')),
    (error) => error.code === 'MEDICATION_REMINDER_CAPACITY'
  );

  currentTime = 1_060_000;
  const firstCycle = await scheduler.runDue();
  assert.equal(firstCycle.attempted, 2);
  assert.equal(delivered.length, 2);
  const secondCycle = await scheduler.runDue();
  assert.equal(secondCycle.attempted, 1);
  assert.equal(delivered.length, 3);
  assert.equal((await scheduler.list()).length, 3);
});

test('retry delay and persisted input validation fail closed', async () => {
  assert.equal(medicationReminderRetryDelay(1, { baseDelayMs: 1000, maximumDelayMs: 5000 }), 1000);
  assert.equal(medicationReminderRetryDelay(4, { baseDelayMs: 1000, maximumDelayMs: 5000 }), 5000);

  const store = memoryStorage({
    version: 1,
    accountId: 'user-a',
    reminders: [{ version: 1, id: '../unsafe', status: 'scheduled' }]
  });
  const scheduler = createMedicationReminderScheduler({
    accountId: 'user-a',
    storageImpl: store,
    now: () => 1_000_000,
    sendRobotReminder: async () => { throw new Error('invalid persisted item dispatched'); },
    notifyCaregiver: async () => { throw new Error('invalid persisted item dispatched'); }
  });
  assert.deepEqual((await scheduler.start()).reminders, []);
  scheduler.stop();
});

test('management form creates a durable reminder that can be listed and acknowledged', async () => {
  let currentTime = 5_000_000;
  const scheduler = createMedicationReminderScheduler({
    accountId: 'user-a',
    storageImpl: memoryStorage(),
    now: () => currentTime,
    sendRobotReminder: async () => ({
      accepted: true,
      receiptId: 'manufacturer-action-1001'
    }),
    notifyCaregiver: async () => ({
      accepted: true,
      receiptId: 'caregiver-action-1001'
    })
  });
  const input = createMedicationReminderInput({
    medicationReference: 'morning_dose',
    robotDeviceId: 'robot-home-0001',
    reminderDelayMinutes: '5',
    escalationDelayMinutes: '15'
  }, {
    now: () => currentTime,
    createId: () => 'management-reminder-0001'
  });

  assert.deepEqual(input, {
    id: 'management-reminder-0001',
    medicationId: 'morning_dose',
    robotDeviceId: 'robot-home-0001',
    dueAt: 5_300_000,
    escalationDelayMs: 900_000
  });
  await scheduler.start();
  await scheduler.schedule(input);
  assert.equal((await scheduler.list())[0].status, MEDICATION_REMINDER_STATUS.scheduled);

  currentTime = input.dueAt;
  await scheduler.runDue();
  let reminder = (await scheduler.list())[0];
  assert.equal(reminder.status, MEDICATION_REMINDER_STATUS.reminderAccepted);
  assert.equal(canAcknowledgeMedicationReminder(reminder), true);
  reminder = await scheduler.acknowledge(reminder.id);
  assert.equal(reminder.status, MEDICATION_REMINDER_STATUS.acknowledged);
  assert.equal(canAcknowledgeMedicationReminder(reminder), false);
  scheduler.stop();
});

test('authenticated manufacturer telemetry records delivery only for the reminder robot', async () => {
  let currentTime = 8_000_000;
  const scheduler = createMedicationReminderScheduler({
    accountId: 'user-a',
    storageImpl: memoryStorage(),
    now: () => currentTime,
    sendRobotReminder: async () => ({
      accepted: true,
      receiptId: 'manufacturer-action-2001'
    }),
    notifyCaregiver: async () => ({
      accepted: true,
      receiptId: 'caregiver-action-2001'
    })
  });
  await scheduler.start();
  await scheduler.schedule({
    ...reminderInput('telemetry-reminder-0001'),
    dueAt: currentTime + 60_000
  });
  currentTime += 60_000;
  await scheduler.runDue();

  await assert.rejects(recordMedicationDeliveryTelemetry({
    deviceId: 'robot-home-attacker',
    telemetry: {
      medication_acknowledgements: [{
        reminder_id: 'telemetry-reminder-0001',
        receipt_id: 'manufacturer-delivery-2001',
        delivered_at: currentTime
      }]
    },
    recordRobotDelivery: (...args) => scheduler.recordRobotDelivery(...args)
  }), (error) => error.code === 'MEDICATION_ACK_SOURCE_MISMATCH');
  assert.equal((await scheduler.list())[0].status, MEDICATION_REMINDER_STATUS.reminderAccepted);

  const recorded = await recordMedicationDeliveryTelemetry({
    deviceId: 'robot-home-0001',
    telemetry: {
      medication_acknowledgements: [
        {
          reminder_id: 'telemetry-reminder-0001',
          receipt_id: 'manufacturer-delivery-2001',
          delivered_at: currentTime
        },
        {
          reminder_id: 'telemetry-reminder-0001',
          receipt_id: 'manufacturer-delivery-2001',
          delivered_at: currentTime
        }
      ]
    },
    recordRobotDelivery: (...args) => scheduler.recordRobotDelivery(...args)
  });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].status, MEDICATION_REMINDER_STATUS.awaitingAcknowledgement);
  assert.equal((await scheduler.list())[0].reminderReceiptId, 'manufacturer-delivery-2001');
  scheduler.stop();
});

test('caregiver backend receipts preserve delivered and failed delivery semantics', async () => {
  let currentTime = 10_000_000;
  const scheduler = createMedicationReminderScheduler({
    accountId: 'user-a',
    storageImpl: memoryStorage(),
    now: () => currentTime,
    sendRobotReminder: async ({ reminderId }) => ({
      status: 'accepted',
      action_id: `robot-${reminderId}`
    }),
    notifyCaregiver: async ({ reminderId }) => reminderId === 'delivered-reminder-0001'
      ? {
          id: 'medication-escalation-delivered-0001',
          status: 'accepted',
          deliveryStatus: 'delivered'
        }
      : {
          id: 'medication-escalation-failed-0001',
          status: 'accepted',
          deliveryStatus: 'failed'
        }
  });
  await scheduler.start();
  await scheduler.schedule({
    ...reminderInput('delivered-reminder-0001'),
    dueAt: currentTime + 60_000,
    escalationDelayMs: 60_000
  });
  await scheduler.schedule({
    ...reminderInput('failed-reminder-0001'),
    dueAt: currentTime + 60_000,
    escalationDelayMs: 60_000
  });

  currentTime += 60_000;
  await scheduler.runDue();
  currentTime += 60_000;
  await scheduler.runDue();
  const byId = new Map((await scheduler.list()).map((reminder) => [reminder.id, reminder]));
  assert.equal(byId.get('delivered-reminder-0001').status, MEDICATION_REMINDER_STATUS.escalated);
  assert.equal(byId.get('delivered-reminder-0001').delivery.escalation.deliveryStatus, 'delivered');
  assert.equal(byId.get('failed-reminder-0001').status, MEDICATION_REMINDER_STATUS.escalationAccepted);
  assert.equal(byId.get('failed-reminder-0001').escalationDeliveredAt, undefined);
  assert.equal(byId.get('failed-reminder-0001').delivery.escalation.deliveryStatus, 'failed');
  scheduler.stop();
});
