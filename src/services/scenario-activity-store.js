import { runLocalUserDataMutation } from './local-mutation-coordinator';
import { storage } from './storage';

export const SCENARIO_ACTIVITY_KEY = 'veryloving.aiNativeScenarioActivity.v1';
export const SCENARIO_ACTIVITY_VERSION = 1;
export const MAX_SCENARIO_EXECUTIONS = 100;
export const MAX_SCENARIO_FEEDBACK = 100;
export const MAX_PENDING_SCENARIO_INTENTS = 5;
export const SCENARIO_PENDING_INTENT_KEY_PREFIX = 'veryloving.aiNativeScenarioPending.v1.';

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const EXECUTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCENARIO_INTENTS = Object.freeze({
  fall_detection: 'practice_drill',
  medication_adherence: 'review_reminder',
  emotional_check_in: 'self_check_in',
  cognitive_engagement: 'start_activity',
  ai_angel_auto_dial: null
});
const SCENARIO_ID_LIST = Object.freeze(Object.keys(SCENARIO_INTENTS));
const SCENARIO_IDS = new Set(SCENARIO_ID_LIST);
const MOOD_KEYS = new Set(['very_low', 'low', 'okay', 'good', 'great']);
const COGNITIVE_ACTIVITIES = new Set(['memory', 'trivia', 'conversation']);
const MAX_REFLECTION_SUMMARY_LENGTH = 280;
const EXECUTION_STATES = new Set([
  'queued',
  'running',
  'completed',
  'fallback_completed',
  'failed',
  'cancelled'
]);
const FEEDBACK_ELIGIBLE_STATES = new Set(['completed', 'fallback_completed']);
const TERMINAL_STATES = new Set([
  'completed', 'fallback_completed', 'failed', 'cancelled'
]);
const PRIORITIES = new Set(['critical', 'standard', 'background']);

let mutationQueue = Promise.resolve();
const pendingMutationQueues = new Map();

function scenarioStoreError(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizeAccountId(value) {
  const accountId = typeof value === 'string' ? value.trim() : '';
  return ACCOUNT_ID_PATTERN.test(accountId) ? accountId : null;
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function normalizePendingContext(scenarioId, value) {
  if (value === undefined) return undefined;
  if (scenarioId === 'emotional_check_in') {
    const allowed = new Set(['mood_key', 'reflection_summary']);
    const keys = Object.keys(value || {});
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !keys.includes('mood_key')
      || keys.some((key) => !allowed.has(key))
      || !MOOD_KEYS.has(value.mood_key)
      || (value.reflection_summary !== undefined
        && (typeof value.reflection_summary !== 'string'
          || !value.reflection_summary.trim()
          || value.reflection_summary.length > MAX_REFLECTION_SUMMARY_LENGTH
          || /[\u0000-\u001f\u007f]/u.test(value.reflection_summary)))) return null;
    return Object.freeze({
      mood_key: value.mood_key,
      ...(value.reflection_summary !== undefined
        ? { reflection_summary: value.reflection_summary }
        : {})
    });
  }
  if (scenarioId === 'cognitive_engagement') {
    if (!exactKeys(value, new Set(['activity']))
      || !COGNITIVE_ACTIVITIES.has(value.activity)) return null;
    return Object.freeze({ activity: value.activity });
  }
  return null;
}

function normalizePendingIntent(value, expectedScenarioId) {
  const scenarioId = value?.scenarioId;
  const expectedIntent = SCENARIO_INTENTS[scenarioId];
  const context = normalizePendingContext(scenarioId, value?.context);
  const expectedKeys = new Set([
    'scenarioId',
    'requestId',
    'occurredAt',
    ...(expectedIntent === null ? [] : ['intent']),
    ...(value && Object.hasOwn(value, 'context') ? ['context'] : [])
  ]);
  if (!SCENARIO_IDS.has(scenarioId)
    || (expectedScenarioId && scenarioId !== expectedScenarioId)
    || !exactKeys(value, expectedKeys)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.requestId ?? '')
    || !validTime(value.occurredAt)
    || (expectedIntent === null
      ? Object.hasOwn(value, 'intent')
      : value.intent !== expectedIntent)
    || (Object.hasOwn(value, 'context') && context === null)) return null;
  return Object.freeze({
    scenarioId,
    requestId: value.requestId,
    occurredAt: value.occurredAt,
    ...(expectedIntent === null ? {} : { intent: expectedIntent }),
    ...(context ? { context } : {})
  });
}

function pendingIntentKey(scenarioId) {
  return `${SCENARIO_PENDING_INTENT_KEY_PREFIX}${scenarioId}`;
}

function normalizePendingEnvelope(value, accountId, scenarioId) {
  if (!exactKeys(value, new Set(['version', 'accountId', 'pendingIntent']))
    || value.version !== SCENARIO_ACTIVITY_VERSION
    || value.accountId !== accountId) return null;
  return normalizePendingIntent(value.pendingIntent, scenarioId);
}

function normalizeExecution(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !EXECUTION_ID_PATTERN.test(value.executionId ?? '')
    || !SCENARIO_IDS.has(value.scenarioId)
    || !EXECUTION_STATES.has(value.state)
    || !PRIORITIES.has(value.priority)
    || !validTime(value.createdAt)
    || !validTime(value.updatedAt)
    || value.updatedAt < value.createdAt
    || (value.version !== undefined
      && (!Number.isSafeInteger(value.version) || value.version < 1))
    || (value.completedAt !== undefined
      && (!validTime(value.completedAt) || value.completedAt < value.createdAt))) return null;
  return Object.freeze({
    executionId: value.executionId.toLowerCase(),
    scenarioId: value.scenarioId,
    priority: value.priority,
    state: value.state,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    version: value.version ?? 1,
    ...(value.completedAt !== undefined ? { completedAt: value.completedAt } : {}),
    ...(typeof value.errorCode === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(value.errorCode)
      ? { errorCode: value.errorCode }
      : {})
  });
}

function normalizeFeedback(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !EXECUTION_ID_PATTERN.test(value.executionId ?? '')
    || !SCENARIO_IDS.has(value.scenarioId)
    || !['up', 'down'].includes(value.rating)
    || !validTime(value.recordedAt)) return null;
  return Object.freeze({
    executionId: value.executionId.toLowerCase(),
    scenarioId: value.scenarioId,
    rating: value.rating,
    recordedAt: value.recordedAt
  });
}

function newestFirst(left, right) {
  return right.updatedAt - left.updatedAt || right.createdAt - left.createdAt;
}

function normalizedActivity(value, accountId) {
  if (value?.version !== SCENARIO_ACTIVITY_VERSION || value.accountId !== accountId) {
    return Object.freeze({
      executions: Object.freeze([]),
      feedback: Object.freeze([]),
      pendingIntents: Object.freeze([])
    });
  }
  const executions = Array.isArray(value.executions)
    ? value.executions.flatMap((item) => normalizeExecution(item) ?? []).sort(newestFirst)
      .slice(0, MAX_SCENARIO_EXECUTIONS)
    : [];
  const feedbackEligibleExecutionIds = new Set(executions
    .filter(({ state }) => FEEDBACK_ELIGIBLE_STATES.has(state))
    .map(({ executionId }) => executionId));
  const feedback = Array.isArray(value.feedback)
    ? value.feedback.flatMap((item) => normalizeFeedback(item) ?? [])
      .filter(({ executionId }) => feedbackEligibleExecutionIds.has(executionId))
      .sort((left, right) => right.recordedAt - left.recordedAt)
      .slice(0, MAX_SCENARIO_FEEDBACK)
    : [];
  return Object.freeze({
    executions: Object.freeze(executions),
    feedback: Object.freeze(feedback),
    pendingIntents: Object.freeze([])
  });
}

async function readActivity(accountId) {
  return normalizedActivity(await storage.getJSON(SCENARIO_ACTIVITY_KEY, null), accountId);
}

function serialize(accountId, activity) {
  return {
    version: SCENARIO_ACTIVITY_VERSION,
    accountId,
    executions: activity.executions,
    feedback: activity.feedback
  };
}

async function readPendingIntents(accountId) {
  const records = await Promise.all(SCENARIO_ID_LIST.map((scenarioId) => (
    readPendingIntent(accountId, scenarioId)
  )));
  return Object.freeze(records.filter(Boolean).slice(0, MAX_PENDING_SCENARIO_INTENTS));
}

async function readPendingIntent(accountId, scenarioId) {
  const value = await storage.getJSON(pendingIntentKey(scenarioId), null);
  if (value?.accountId && value.accountId !== accountId) return null;
  return normalizePendingEnvelope(value, accountId, scenarioId);
}

function runPendingMutation(accountId, scenarioId, mutator) {
  const normalizedAccount = normalizeAccountId(accountId);
  if (!normalizedAccount || !SCENARIO_IDS.has(scenarioId)) {
    return Promise.reject(scenarioStoreError(
      'SCENARIO_PENDING_INTENT_INVALID',
      'The pending scenario intent failed validation.'
    ));
  }
  const previous = pendingMutationQueues.get(scenarioId) ?? Promise.resolve();
  const operation = runLocalUserDataMutation(async () => {
    await previous.catch(() => {});
    const key = pendingIntentKey(scenarioId);
    const stored = await storage.getJSON(key, null);
    if (stored?.accountId && stored.accountId !== normalizedAccount) {
      throw scenarioStoreError(
        'SCENARIO_ACTIVITY_ACCOUNT_MISMATCH',
        'Pending scenario intent belongs to a different authenticated account.'
      );
    }
    const current = normalizePendingEnvelope(stored, normalizedAccount, scenarioId);
    const { next, result } = await mutator(current);
    if (next) {
      await storage.setJSON(key, {
        version: SCENARIO_ACTIVITY_VERSION,
        accountId: normalizedAccount,
        pendingIntent: next
      });
    } else if (stored) {
      await storage.remove(key);
    }
    return result;
  });
  const tail = operation.then(() => undefined, () => undefined);
  pendingMutationQueues.set(scenarioId, tail);
  tail.finally(() => {
    if (pendingMutationQueues.get(scenarioId) === tail) pendingMutationQueues.delete(scenarioId);
  });
  return operation;
}

function runMutation(accountId, mutator) {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) {
    return Promise.reject(scenarioStoreError(
      'SCENARIO_ACTIVITY_ACCOUNT_REQUIRED',
      'An authenticated account is required for scenario activity.'
    ));
  }
  const previous = mutationQueue;
  const operation = runLocalUserDataMutation(async () => {
    await previous.catch(() => {});
    const stored = await storage.getJSON(SCENARIO_ACTIVITY_KEY, null);
    if (stored?.accountId && stored.accountId !== normalized) {
      throw scenarioStoreError(
        'SCENARIO_ACTIVITY_ACCOUNT_MISMATCH',
        'Scenario activity belongs to a different authenticated account.'
      );
    }
    const current = normalizedActivity(stored, normalized);
    const next = await mutator(current);
    await storage.setJSON(SCENARIO_ACTIVITY_KEY, serialize(normalized, next));
    return normalizedActivity(serialize(normalized, next), normalized);
  });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function drainScenarioActivityMutations() {
  await Promise.allSettled([mutationQueue, ...pendingMutationQueues.values()]);
}

export async function loadScenarioActivity(accountId) {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) return Object.freeze({
    executions: Object.freeze([]),
    feedback: Object.freeze([]),
    pendingIntents: Object.freeze([])
  });
  await drainScenarioActivityMutations();
  const [activity, pendingIntents] = await Promise.all([
    readActivity(normalized),
    readPendingIntents(normalized)
  ]);
  return Object.freeze({ ...activity, pendingIntents });
}

export async function listPendingScenarioIntents(accountId) {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) return Object.freeze([]);
  return readPendingIntents(normalized);
}

export async function getPendingScenarioIntent(accountId, scenarioId) {
  const normalized = normalizeAccountId(accountId);
  if (!normalized || !SCENARIO_IDS.has(scenarioId)) return null;
  return readPendingIntent(normalized, scenarioId);
}

/**
 * Atomically reserves one stable request identity per scenario. Separate
 * encrypted keys and serialization lanes prevent a stalled wellness write
 * from starving the critical AI Angel reservation lane.
 */
export function reservePendingScenarioIntent(accountId, pendingIntent) {
  const normalizedIntent = normalizePendingIntent(pendingIntent);
  if (!normalizedIntent) {
    return Promise.reject(scenarioStoreError(
      'SCENARIO_PENDING_INTENT_INVALID',
      'The pending scenario intent failed validation.'
    ));
  }
  return runPendingMutation(accountId, normalizedIntent.scenarioId, (current) => {
    const reserved = current ?? normalizedIntent;
    return { next: reserved, result: reserved };
  });
}

export function releasePendingScenarioIntent(accountId, { scenarioId, requestId } = {}) {
  if (!SCENARIO_IDS.has(scenarioId)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId ?? '')) {
    return Promise.reject(scenarioStoreError(
      'SCENARIO_PENDING_INTENT_INVALID',
      'The pending scenario intent failed validation.'
    ));
  }
  return runPendingMutation(accountId, scenarioId, (current) => {
    if (!current || current.requestId !== requestId) {
      return { next: current, result: false };
    }
    return { next: null, result: true };
  });
}

export function persistScenarioExecution(accountId, execution) {
  const normalizedExecution = normalizeExecution(execution);
  if (!normalizedExecution) {
    return Promise.reject(scenarioStoreError(
      'SCENARIO_ACTIVITY_EXECUTION_INVALID',
      'Scenario execution history failed validation.'
    ));
  }
  return runMutation(accountId, (current) => {
    const existing = current.executions.find(
      ({ executionId }) => executionId === normalizedExecution.executionId
    );
    if (existing && (
      normalizedExecution.updatedAt < existing.updatedAt
      || (normalizedExecution.updatedAt === existing.updatedAt
        && normalizedExecution.version < existing.version)
      || (TERMINAL_STATES.has(existing.state) && !TERMINAL_STATES.has(normalizedExecution.state))
    )) return current;
    const executions = [
      normalizedExecution,
      ...current.executions.filter(
        ({ executionId }) => executionId !== normalizedExecution.executionId
      )
    ].sort(newestFirst).slice(0, MAX_SCENARIO_EXECUTIONS);
    const feedbackEligibleExecutionIds = new Set(executions
      .filter(({ state }) => FEEDBACK_ELIGIBLE_STATES.has(state))
      .map(({ executionId }) => executionId));
    return {
      executions,
      feedback: current.feedback.filter(
        ({ executionId }) => feedbackEligibleExecutionIds.has(executionId)
      )
        .slice(0, MAX_SCENARIO_FEEDBACK)
    };
  });
}

export function recordScenarioFeedback(accountId, {
  executionId,
  rating,
  recordedAt = Date.now()
} = {}) {
  const normalizedExecutionId = typeof executionId === 'string' ? executionId.toLowerCase() : '';
  if (!EXECUTION_ID_PATTERN.test(normalizedExecutionId) || !['up', 'down'].includes(rating)
    || !validTime(recordedAt)) {
    return Promise.reject(scenarioStoreError(
      'SCENARIO_FEEDBACK_INVALID',
      'Scenario feedback failed validation.'
    ));
  }
  return runMutation(accountId, (current) => {
    const execution = current.executions.find((item) => item.executionId === normalizedExecutionId);
    if (!execution || !FEEDBACK_ELIGIBLE_STATES.has(execution.state)) {
      throw scenarioStoreError(
        'SCENARIO_FEEDBACK_EXECUTION_INCOMPLETE',
        'Feedback is available after the scenario completes successfully.'
      );
    }
    const feedback = [{
      executionId: execution.executionId,
      scenarioId: execution.scenarioId,
      rating,
      recordedAt
    }, ...current.feedback.filter((item) => item.executionId !== execution.executionId)]
      .sort((left, right) => right.recordedAt - left.recordedAt)
      .slice(0, MAX_SCENARIO_FEEDBACK);
    return { executions: current.executions, feedback };
  });
}

export function deleteScenarioFeedback(accountId, executionId) {
  const normalizedExecutionId = typeof executionId === 'string' ? executionId.toLowerCase() : '';
  if (!EXECUTION_ID_PATTERN.test(normalizedExecutionId)) {
    return Promise.reject(scenarioStoreError(
      'SCENARIO_FEEDBACK_INVALID',
      'Scenario feedback failed validation.'
    ));
  }
  return runMutation(accountId, (current) => ({
    executions: current.executions,
    feedback: current.feedback.filter((item) => item.executionId !== normalizedExecutionId)
  }));
}

export async function clearScenarioActivity(accountId) {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) return false;
  const previous = mutationQueue;
  const previousPending = [...pendingMutationQueues.values()];
  const operation = runLocalUserDataMutation(async () => {
    await Promise.allSettled([previous, ...previousPending]);
    const [stored, ...pending] = await Promise.all([
      storage.getJSON(SCENARIO_ACTIVITY_KEY, null),
      ...SCENARIO_ID_LIST.map((scenarioId) => storage.getJSON(pendingIntentKey(scenarioId), null))
    ]);
    if (stored?.accountId && stored.accountId !== normalized) return false;
    if (pending.some((value) => value?.accountId && value.accountId !== normalized)) return false;
    const keys = [
      ...(stored ? [SCENARIO_ACTIVITY_KEY] : []),
      ...pending.flatMap((value, index) => value ? [pendingIntentKey(SCENARIO_ID_LIST[index])] : [])
    ];
    if (!keys.length) return true;
    if (typeof storage.removeMany === 'function') await storage.removeMany(keys);
    else await Promise.all(keys.map((key) => storage.remove(key)));
    return true;
  });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
