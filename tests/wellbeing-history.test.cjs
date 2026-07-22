'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const {
  clearMoodCheckIns,
  deleteMoodCheckIn,
  listMoodCheckIns,
  MAX_MOOD_CHECKINS,
  MAX_REFLECTION_SUMMARY_LENGTH,
  MOOD_CHECKIN_HISTORY_KEY,
  saveMoodCheckIn
} = require('../src/services/mood-checkin-store');
const {
  clearScenarioActivity,
  deleteScenarioFeedback,
  drainScenarioActivityMutations,
  listPendingScenarioIntents,
  loadScenarioActivity,
  MAX_PENDING_SCENARIO_INTENTS,
  MAX_SCENARIO_EXECUTIONS,
  persistScenarioExecution,
  recordScenarioFeedback,
  releasePendingScenarioIntent,
  reservePendingScenarioIntent,
  SCENARIO_ACTIVITY_KEY,
  SCENARIO_PENDING_INTENT_KEY_PREFIX
} = require('../src/services/scenario-activity-store');
const { storage } = require('../src/services/storage');

const memory = new Map();
storage.getJSON = async (key, fallback) => memory.has(key) ? structuredClone(memory.get(key)) : fallback;
storage.setJSON = async (key, value) => { memory.set(key, structuredClone(value)); };
storage.remove = async (key) => memory.delete(key);
storage.removeMany = async (keys) => keys.forEach((key) => memory.delete(key));

function uuid(index) {
  return `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`;
}

function historyExecution(index, overrides = {}) {
  return {
    executionId: uuid(index),
    scenarioId: 'cognitive_engagement',
    priority: 'background',
    state: 'queued',
    createdAt: 1_000 + index,
    updatedAt: 1_000 + index,
    ...overrides
  };
}

test('scenario history is account-bound, bounded, monotonic, and accepts feedback after successful completion', async () => {
  memory.clear();
  for (let index = 0; index < MAX_SCENARIO_EXECUTIONS + 3; index += 1) {
    await persistScenarioExecution('account-a', historyExecution(index));
  }
  let activity = await loadScenarioActivity('account-a');
  assert.equal(activity.executions.length, MAX_SCENARIO_EXECUTIONS);
  assert.equal(activity.executions[0].executionId, uuid(MAX_SCENARIO_EXECUTIONS + 2));
  assert.deepEqual(await loadScenarioActivity('account-b'), {
    executions: [], feedback: [], pendingIntents: []
  });
  await assert.rejects(persistScenarioExecution('account-b', historyExecution(999)),
    (error) => error.code === 'SCENARIO_ACTIVITY_ACCOUNT_MISMATCH');

  const target = activity.executions[0];
  await assert.rejects(recordScenarioFeedback('account-a', {
    executionId: target.executionId,
    rating: 'up',
    recordedAt: 5_000
  }), (error) => error.code === 'SCENARIO_FEEDBACK_EXECUTION_INCOMPLETE');

  await persistScenarioExecution('account-a', {
    ...target,
    state: 'completed',
    updatedAt: 6_000,
    completedAt: 6_000
  });
  await persistScenarioExecution('account-a', {
    ...target,
    state: 'running',
    updatedAt: 5_999
  });
  await recordScenarioFeedback('account-a', {
    executionId: target.executionId,
    rating: 'up',
    recordedAt: 6_100
  });
  activity = await loadScenarioActivity('account-a');
  assert.equal(activity.executions.find(({ executionId }) => executionId === target.executionId).state, 'completed');
  assert.deepEqual(activity.feedback[0], {
    executionId: target.executionId,
    scenarioId: 'cognitive_engagement',
    rating: 'up',
    recordedAt: 6_100
  });
  await deleteScenarioFeedback('account-a', target.executionId);
  assert.equal((await loadScenarioActivity('account-a')).feedback.length, 0);
  assert.equal(await clearScenarioActivity('account-b'), false);
  assert.equal(await clearScenarioActivity('account-a'), true);
  assert.equal(memory.has(SCENARIO_ACTIVITY_KEY), false);
});

test('local scenario feedback accepts only successful terminal executions', async () => {
  memory.clear();
  const completed = historyExecution(700, {
    state: 'completed', updatedAt: 10_000, completedAt: 10_000
  });
  const fallbackCompleted = historyExecution(701, {
    state: 'fallback_completed', updatedAt: 10_001, completedAt: 10_001
  });
  const failed = historyExecution(702, {
    state: 'failed', updatedAt: 10_002, completedAt: 10_002
  });
  const cancelled = historyExecution(703, {
    state: 'cancelled', updatedAt: 10_003, completedAt: 10_003
  });
  for (const execution of [completed, fallbackCompleted, failed, cancelled]) {
    await persistScenarioExecution('account-a', execution);
  }

  await recordScenarioFeedback('account-a', {
    executionId: completed.executionId,
    rating: 'up',
    recordedAt: 10_100
  });
  await recordScenarioFeedback('account-a', {
    executionId: fallbackCompleted.executionId,
    rating: 'down',
    recordedAt: 10_101
  });
  for (const execution of [failed, cancelled]) {
    await assert.rejects(recordScenarioFeedback('account-a', {
      executionId: execution.executionId,
      rating: 'up',
      recordedAt: 10_102
    }), (error) => error.code === 'SCENARIO_FEEDBACK_EXECUTION_INCOMPLETE');
  }

  assert.deepEqual(
    new Set((await loadScenarioActivity('account-a')).feedback.map(({ executionId }) => executionId)),
    new Set([completed.executionId, fallbackCompleted.executionId])
  );

  await persistScenarioExecution('account-a', {
    ...completed,
    state: 'failed',
    updatedAt: 10_200,
    completedAt: 10_200,
    version: 2
  });
  assert.equal(
    (await loadScenarioActivity('account-a')).feedback.some(
      ({ executionId }) => executionId === completed.executionId
    ),
    false
  );
  assert.equal(
    memory.get(SCENARIO_ACTIVITY_KEY).feedback.some(
      ({ executionId }) => executionId === completed.executionId
    ),
    false
  );
  assert.equal(await clearScenarioActivity('account-a'), true);
});

test('pending scenario intents are exact, bounded, account-bound, and isolated by scenario lane', async () => {
  memory.clear();
  const intents = [
    { scenarioId: 'fall_detection', requestId: 'pending-fall', occurredAt: 1, intent: 'practice_drill' },
    { scenarioId: 'medication_adherence', requestId: 'pending-medication', occurredAt: 2, intent: 'review_reminder' },
    {
      scenarioId: 'emotional_check_in',
      requestId: 'pending-emotional',
      occurredAt: 3,
      intent: 'self_check_in',
      context: { mood_key: 'good', reflection_summary: 'A bounded summary.' }
    },
    {
      scenarioId: 'cognitive_engagement',
      requestId: 'pending-cognitive',
      occurredAt: 4,
      intent: 'start_activity',
      context: { activity: 'conversation' }
    },
    { scenarioId: 'ai_angel_auto_dial', requestId: 'pending-emergency', occurredAt: 5 }
  ];
  for (const intent of intents) await reservePendingScenarioIntent('account-a', intent);
  const pending = await listPendingScenarioIntents('account-a');
  assert.equal(pending.length, MAX_PENDING_SCENARIO_INTENTS);
  assert.deepEqual(new Set(pending.map(({ scenarioId }) => scenarioId)),
    new Set(intents.map(({ scenarioId }) => scenarioId)));
  assert.deepEqual((await loadScenarioActivity('account-a')).pendingIntents, pending);
  assert.deepEqual(await listPendingScenarioIntents('account-b'), []);
  await assert.rejects(reservePendingScenarioIntent('account-b', intents[0]),
    (error) => error.code === 'SCENARIO_ACTIVITY_ACCOUNT_MISMATCH');

  const reused = await reservePendingScenarioIntent('account-a', {
    ...intents[0], requestId: 'replacement-must-not-win', occurredAt: 99
  });
  assert.equal(reused.requestId, 'pending-fall');
  assert.equal(await releasePendingScenarioIntent('account-a', {
    scenarioId: 'fall_detection', requestId: 'wrong-id'
  }), false);
  assert.equal((await listPendingScenarioIntents('account-a')).length, 5);
  await assert.rejects(reservePendingScenarioIntent('account-a', {
    ...intents[2], raw_transcript: 'must never persist'
  }), (error) => error.code === 'SCENARIO_PENDING_INTENT_INVALID');
  await assert.rejects(reservePendingScenarioIntent('account-a', {
    ...intents[3], context: { activity: 'memory', score: 100 }
  }), (error) => error.code === 'SCENARIO_PENDING_INTENT_INVALID');

  const storedKeys = [...memory.keys()].filter((key) => (
    key.startsWith(SCENARIO_PENDING_INTENT_KEY_PREFIX)
  ));
  assert.equal(storedKeys.length, 5);
  assert.deepEqual(Object.keys(memory.get(storedKeys[0])).sort(),
    ['accountId', 'pendingIntent', 'version']);
  assert.equal(await clearScenarioActivity('account-b'), false);
  assert.equal(await clearScenarioActivity('account-a'), true);
  await drainScenarioActivityMutations();
  assert.equal([...memory.keys()].some((key) => (
    key.startsWith(SCENARIO_PENDING_INTENT_KEY_PREFIX)
  )), false);
});

test('mood history stores only bounded self reports and derived summaries, never raw Hume transcripts', async () => {
  memory.clear();
  for (let index = 0; index < MAX_MOOD_CHECKINS + 2; index += 1) {
    await saveMoodCheckIn('account-a', {
      id: String(index).padStart(64, 'a'),
      moodKey: 'good',
      score: 4,
      occurredAt: 10_000 + index,
      reflectionSummary: `  Felt supported after check-in ${index}.  `
    });
  }
  let history = await listMoodCheckIns('account-a');
  assert.equal(history.length, MAX_MOOD_CHECKINS);
  assert.equal(history[0].occurredAt, 10_000 + MAX_MOOD_CHECKINS + 1);
  assert.match(history[0].reflectionSummary, /^Felt supported/);
  assert.deepEqual(await listMoodCheckIns('account-b'), []);
  await assert.rejects(saveMoodCheckIn('account-b', {
    id: 'b'.repeat(64), moodKey: 'okay', score: 3, occurredAt: 20_000
  }), (error) => error.code === 'MOOD_ACCOUNT_MISMATCH');
  await assert.rejects(saveMoodCheckIn('account-a', {
    id: 'c'.repeat(64), moodKey: 'great', score: 5, occurredAt: 20_000,
    rawTranscript: 'private raw conversation'
  }), (error) => error.code === 'MOOD_CHECKIN_INVALID');
  await assert.rejects(saveMoodCheckIn('account-a', {
    id: 'd'.repeat(64), moodKey: 'great', score: 5, occurredAt: 20_000,
    reflectionSummary: 'x'.repeat(MAX_REFLECTION_SUMMARY_LENGTH + 1)
  }), (error) => error.code === 'MOOD_CHECKIN_INVALID');

  const removedId = history[0].id;
  await deleteMoodCheckIn('account-a', removedId);
  history = await listMoodCheckIns('account-a');
  assert.equal(history.some(({ id }) => id === removedId), false);
  assert.equal(await clearMoodCheckIns('account-b'), false);
  assert.equal(await clearMoodCheckIns('account-a'), true);
  assert.equal(memory.has(MOOD_CHECKIN_HISTORY_KEY), false);
});

test('wellbeing and scenario activity participate in encrypted export and deletion lifecycle', () => {
  const storageSource = readFileSync('src/services/storage.js', 'utf8');
  const privacySource = readFileSync('src/services/privacy.js', 'utf8');
  const deletionSource = readFileSync('src/services/local-user-data.js', 'utf8');
  assert.match(storageSource, /createEncryptedStorage/);
  assert.match(privacySource, /scenarioActivity,/);
  assert.match(privacySource, /moodCheckIns,/);
  assert.match(privacySource, /!key\.startsWith\(SCENARIO_PENDING_INTENT_KEY_PREFIX\)/);
  assert.match(deletionSource, /drainScenarioActivityMutations/);
  assert.match(deletionSource, /drainMoodCheckInMutations/);
});
