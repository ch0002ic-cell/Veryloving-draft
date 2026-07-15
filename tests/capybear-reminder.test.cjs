'use strict';

const assert = require('node:assert/strict');
const { setImmediate: waitForImmediate } = require('node:timers/promises');
const { test } = require('node:test');
const {
  CAPYBEAR_REMINDER_HOUR,
  CAPYBEAR_REMINDER_KEY,
  createCapybearReminderScheduler
} = require('../src/services/capybear-reminder-core');

function createHarness({ permission = true, available = true, writeFails = false, schedule } = {}) {
  let record = null;
  const scheduled = [];
  const cancelled = [];
  const Notifications = available ? {
    SchedulableTriggerInputTypes: { DAILY: 'daily' },
    async scheduleNotificationAsync(request) {
      scheduled.push(request);
      if (schedule) return schedule(request, scheduled.length);
      return `reminder-${scheduled.length}`;
    },
    async cancelScheduledNotificationAsync(identifier) {
      cancelled.push(identifier);
    }
  } : null;
  const storageAdapter = {
    async getJSON(key) {
      assert.equal(key, CAPYBEAR_REMINDER_KEY);
      return record;
    },
    async setJSON(key, value) {
      assert.equal(key, CAPYBEAR_REMINDER_KEY);
      if (writeFails) throw new Error('write failed');
      record = value;
    },
    async remove(key) {
      assert.equal(key, CAPYBEAR_REMINDER_KEY);
      record = null;
    }
  };
  const setEnabled = createCapybearReminderScheduler({
    getNotifications: async () => Notifications,
    requestPermission: async () => permission,
    storageAdapter,
    translateText: (key, options) => options?.locale
      ? `${options.locale}:${key}`
      : `translated:${key}`
  });
  return { cancelled, getRecord: () => record, scheduled, setEnabled };
}

test('Capybear reminder is opt-in, localized, daily, and durably cancellable', async () => {
  const harness = createHarness();
  const enabled = await harness.setEnabled(true);
  assert.equal(enabled.enabled, true);
  assert.deepEqual(harness.getRecord(), { version: 1, identifier: 'reminder-1' });
  assert.equal(harness.scheduled[0].content.title, 'translated:common.veryLoving');
  assert.equal(harness.scheduled[0].content.body, 'translated:auth.remindersReady');
  assert.deepEqual(harness.scheduled[0].trigger, {
    type: 'daily',
    hour: CAPYBEAR_REMINDER_HOUR,
    minute: 0
  });

  const disabled = await harness.setEnabled(false);
  assert.equal(disabled.enabled, false);
  assert.deepEqual(harness.cancelled, ['reminder-1']);
  assert.equal(harness.getRecord(), null);
});

test('Capybear reminder never claims activation when permission or runtime is unavailable', async () => {
  const denied = createHarness({ permission: false });
  assert.deepEqual(await denied.setEnabled(true), { enabled: false, reason: 'permission-denied' });
  assert.equal(denied.scheduled.length, 0);

  const unavailable = createHarness({ available: false });
  assert.deepEqual(await unavailable.setEnabled(true), { enabled: false, reason: 'unavailable' });
  assert.equal(unavailable.scheduled.length, 0);
});

test('a reminder is cancelled if its durable identifier cannot be saved', async () => {
  const harness = createHarness({ writeFails: true });
  await assert.rejects(harness.setEnabled(true), /write failed/);
  assert.deepEqual(harness.cancelled, ['reminder-1']);
});

test('localized rescheduling is generation-safe and the newest request owns persistence', async () => {
  let releaseFirst;
  const firstIdentifier = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const harness = createHarness({
    schedule: async (_request, index) => index === 1 ? firstIdentifier : `reminder-${index}`
  });

  const arabic = harness.setEnabled(true, { locale: 'ar' });
  while (harness.scheduled.length < 1) await waitForImmediate();

  const hebrew = await harness.setEnabled(true, { locale: 'he' });
  assert.equal(hebrew.enabled, true);
  assert.deepEqual(harness.getRecord(), { version: 1, identifier: 'reminder-2' });

  releaseFirst('reminder-1');
  const stale = await arabic;
  assert.deepEqual(stale, { enabled: false, reason: 'superseded' });
  assert.deepEqual(harness.getRecord(), { version: 1, identifier: 'reminder-2' });
  assert.ok(harness.cancelled.includes('reminder-1'));
  assert.equal(harness.scheduled[0].content.body, 'ar:auth.remindersReady');
  assert.equal(harness.scheduled[1].content.body, 'he:auth.remindersReady');
});

test('a bounded cleanup request prevents a late reminder schedule from becoming active', async () => {
  let releaseSchedule;
  const delayedIdentifier = new Promise((resolve) => {
    releaseSchedule = resolve;
  });
  const harness = createHarness({ schedule: async () => delayedIdentifier });

  const scheduling = harness.setEnabled(true, { locale: 'ar' });
  while (harness.scheduled.length < 1) await waitForImmediate();
  assert.deepEqual(await harness.setEnabled(false), { enabled: false, reason: null });

  releaseSchedule('late-reminder');
  assert.deepEqual(await scheduling, { enabled: false, reason: 'superseded' });
  assert.equal(harness.getRecord(), null);
  assert.ok(harness.cancelled.includes('late-reminder'));
});
