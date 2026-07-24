import { config } from '../utils/config';
import {
  cancelResponseBody,
  readBoundedJSONResponse,
  runBoundedRequest
} from '../utils/bounded-http';
import { createAuthenticationNonce, sessionTokenClaims } from '../utils/session-token';
import { logger } from '../utils/logger';
import {
  getPendingScenarioIntent,
  persistScenarioExecution,
  recordScenarioFeedback,
  releasePendingScenarioIntent,
  reservePendingScenarioIntent
} from './scenario-activity-store';

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 750;
const DEFAULT_POLL_TIMEOUT_MS = 60_000;
const DEFAULT_INTENT_RESERVATION_TIMEOUT_MS = 1_500;
const LOCAL_WRITE_OBSERVATION_TIMEOUT_MS = 1_500;
const DEFAULT_EXECUTION_LIST_LIMIT = 50;
const MAX_EXECUTION_LIST_LIMIT = 100;
const MAX_RESPONSE_BYTES = 256 * 1024;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EXECUTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,79}$/;
const TERMINAL_STATES = new Set(['completed', 'fallback_completed', 'failed', 'cancelled']);
const EXECUTION_STATES = new Set([
  'queued', 'running', 'completed', 'fallback_completed', 'failed', 'cancelled'
]);
const PRIORITIES = new Set(['critical', 'standard', 'background']);
const MOOD_KEYS = new Set(['very_low', 'low', 'okay', 'good', 'great']);
const COGNITIVE_ACTIVITIES = new Set(['memory', 'trivia', 'conversation']);
const MAX_REFLECTION_SUMMARY_LENGTH = 280;
const RECONCILIATION_ORDER = Object.freeze([
  'ai_angel_auto_dial',
  'fall_detection',
  'medication_adherence',
  'emotional_check_in',
  'cognitive_engagement'
]);

export const AI_NATIVE_SCENARIO_INTENTS = Object.freeze({
  fall_detection: 'practice_drill',
  medication_adherence: 'review_reminder',
  emotional_check_in: 'self_check_in',
  cognitive_engagement: 'start_activity',
  ai_angel_auto_dial: null
});

export const AI_NATIVE_SCENARIO_IDS = Object.freeze(
  Object.keys(AI_NATIVE_SCENARIO_INTENTS)
);

export class ScenarioClientError extends Error {
  constructor(code, message, { statusCode, cause } = {}) {
    super(message);
    this.name = 'ScenarioClientError';
    this.code = code;
    if (statusCode !== undefined) this.statusCode = statusCode;
    if (cause !== undefined) this.cause = cause;
  }
}

function scenarioError(code, message, options) {
  return new ScenarioClientError(code, message, options);
}

function normalizedAccountId(value) {
  const accountId = typeof value === 'string' ? value.trim() : '';
  return ACCOUNT_ID_PATTERN.test(accountId) ? accountId : null;
}

function requireAuthenticatedAccount(accountId, accessToken) {
  const normalized = normalizedAccountId(accountId);
  if (!normalized || typeof accessToken !== 'string' || !accessToken) {
    throw scenarioError(
      'SCENARIO_AUTHENTICATION_REQUIRED',
      'Sign in again to use connected care scenarios.'
    );
  }
  const tokenSubject = sessionTokenClaims(accessToken)?.sub;
  if (tokenSubject && tokenSubject !== normalized) {
    throw scenarioError(
      'SCENARIO_ACCOUNT_MISMATCH',
      'The scenario session belongs to a different authenticated account.'
    );
  }
  return normalized;
}

function scenarioEndpoint(path, apiBaseUrl) {
  if (typeof apiBaseUrl !== 'string' || !apiBaseUrl.trim()) {
    throw scenarioError(
      'SCENARIO_CONFIGURATION_MISSING',
      'The connected care service is not configured.'
    );
  }
  try {
    const base = new globalThis.URL(apiBaseUrl);
    const developmentRuntime = typeof __DEV__ !== 'undefined' && __DEV__;
    if (!['http:', 'https:'].includes(base.protocol)
      || base.username || base.password || base.search || base.hash
      || (base.protocol !== 'https:' && !developmentRuntime)) throw new Error();
    const queryIndex = path.indexOf('?');
    const relativePath = queryIndex === -1 ? path : path.slice(0, queryIndex);
    const query = queryIndex === -1 ? '' : path.slice(queryIndex + 1);
    const basePath = base.pathname.replace(/\/$/, '');
    base.pathname = `${basePath}${relativePath}`;
    base.search = query ? `?${query}` : '';
    return base.toString();
  } catch {
    throw scenarioError(
      'SCENARIO_CONFIGURATION_INVALID',
      'The connected care service URL is invalid.'
    );
  }
}

function safeTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function normalizeScenarioContext(scenarioId, context) {
  if (context === undefined) {
    if (scenarioId === 'emotional_check_in' || scenarioId === 'cognitive_engagement') {
      throw scenarioError('SCENARIO_CONTEXT_REQUIRED', 'Choose the check-in details before starting this scenario.');
    }
    return undefined;
  }
  if (scenarioId === 'emotional_check_in') {
    const allowed = new Set(['mood_key', 'reflection_summary']);
    const keys = context && typeof context === 'object' && !Array.isArray(context)
      ? Object.keys(context)
      : [];
    if (!keys.includes('mood_key')
      || keys.some((key) => !allowed.has(key))
      || !MOOD_KEYS.has(context?.mood_key)
      || (context.reflection_summary !== undefined
        && (typeof context.reflection_summary !== 'string'
          || !context.reflection_summary.trim()
          || context.reflection_summary.length > MAX_REFLECTION_SUMMARY_LENGTH
          || /[\u0000-\u001f\u007f]/u.test(context.reflection_summary)))) {
      throw scenarioError('SCENARIO_CONTEXT_INVALID', 'The scenario context failed validation.');
    }
    return Object.freeze({
      mood_key: context.mood_key,
      ...(context.reflection_summary !== undefined
        ? { reflection_summary: context.reflection_summary }
        : {})
    });
  }
  if (scenarioId === 'cognitive_engagement') {
    if (!exactKeys(context, new Set(['activity']))
      || !COGNITIVE_ACTIVITIES.has(context.activity)) {
      throw scenarioError('SCENARIO_CONTEXT_INVALID', 'The scenario context failed validation.');
    }
    return Object.freeze({ activity: context.activity });
  }
  throw scenarioError('SCENARIO_CONTEXT_INVALID', 'The scenario context failed validation.');
}

function validateScenarioIntent(scenarioId, intent) {
  const expectedIntent = AI_NATIVE_SCENARIO_INTENTS[scenarioId];
  const expectedKeys = expectedIntent === null
    ? new Set(['scenarioId', 'requestId', 'occurredAt'])
    : new Set(['scenarioId', 'requestId', 'occurredAt', 'intent']);
  if (!Object.hasOwn(AI_NATIVE_SCENARIO_INTENTS, scenarioId)
    || !intent || intent.scenarioId !== scenarioId
    || !exactKeys(intent, expectedKeys)
    || !IDENTIFIER_PATTERN.test(intent.requestId ?? '')
    || !safeTimestamp(intent.occurredAt)
    || (expectedIntent === null
      ? Object.hasOwn(intent, 'intent')
      : intent.intent !== expectedIntent)) {
    throw scenarioError('SCENARIO_INTENT_INVALID', 'The scenario request identity is invalid.');
  }
  return intent;
}

export function normalizeScenarioExecution(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== 1
    || !EXECUTION_ID_PATTERN.test(value.executionId ?? '')
    || !Object.hasOwn(AI_NATIVE_SCENARIO_INTENTS, value.scenarioId)
    || !EXECUTION_STATES.has(value.state)
    || !PRIORITIES.has(value.priority)
    || !safeTimestamp(value.createdAt)
    || !safeTimestamp(value.updatedAt)
    || value.updatedAt < value.createdAt
    || !Number.isSafeInteger(value.version) || value.version < 1
    || (value.completedAt !== undefined
      && (!safeTimestamp(value.completedAt) || value.completedAt < value.createdAt))
    || (value.errorCode !== undefined
      && (typeof value.errorCode !== 'string' || !ERROR_CODE_PATTERN.test(value.errorCode)))) {
    throw scenarioError(
      'SCENARIO_RESPONSE_INVALID',
      'The connected care service returned an invalid scenario.'
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    executionId: value.executionId.toLowerCase(),
    scenarioId: value.scenarioId,
    priority: value.priority,
    state: value.state,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.completedAt !== undefined ? { completedAt: value.completedAt } : {}),
    version: value.version,
    ...(typeof value.errorCode === 'string' && ERROR_CODE_PATTERN.test(value.errorCode)
      ? { errorCode: value.errorCode }
      : {})
  });
}

function normalizeStartedResponse(payload, expectedScenarioId) {
  if (!exactKeys(payload, new Set(['started']))
    || !Array.isArray(payload.started) || payload.started.length !== 1) {
    throw scenarioError(
      'SCENARIO_RESPONSE_INVALID',
      'The connected care service returned an invalid scenario response.'
    );
  }
  return Object.freeze({
    started: Object.freeze(payload.started.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || item.accepted !== true || typeof item.duplicate !== 'boolean') {
        throw scenarioError(
          'SCENARIO_RESPONSE_INVALID',
          'The connected care service returned an invalid scenario response.'
        );
      }
      const execution = normalizeScenarioExecution(item.execution);
      if (expectedScenarioId && execution.scenarioId !== expectedScenarioId) {
        throw scenarioError(
          'SCENARIO_RESPONSE_INVALID',
          'The connected care service returned an invalid scenario response.'
        );
      }
      return Object.freeze({
        accepted: true,
        duplicate: item.duplicate,
        execution
      });
    }))
  });
}

function observeLocalWrite(operationFactory, message, fallbackCode) {
  let operation;
  try {
    operation = Promise.resolve().then(operationFactory);
  } catch (error) {
    logger.recoverable(message, { errorCode: error?.code || error?.name || fallbackCode });
    return;
  }
  let reported = false;
  const timeout = setTimeout(() => {
    reported = true;
    logger.recoverable(message, { errorCode: `${fallbackCode}_TIMEOUT` });
  }, LOCAL_WRITE_OBSERVATION_TIMEOUT_MS);
  timeout.unref?.();
  operation.then(
    () => clearTimeout(timeout),
    (error) => {
      clearTimeout(timeout);
      if (!reported) {
        logger.recoverable(message, { errorCode: error?.code || error?.name || fallbackCode });
      }
    }
  );
}

function persistExecutionWithoutMaskingServerResult(accountId, execution) {
  observeLocalWrite(
    () => persistScenarioExecution(accountId, execution),
    '[Scenarios] Could not persist encrypted scenario activity',
    'SCENARIO_ACTIVITY_PERSIST_FAILED'
  );
}

function releaseIntentWithoutMaskingServerResult(accountId, pendingIntent) {
  observeLocalWrite(
    () => releasePendingScenarioIntent(accountId, pendingIntent),
    '[Scenarios] Could not clear encrypted pending scenario intent',
    'SCENARIO_INTENT_RELEASE_FAILED'
  );
}

function feedbackWithoutMaskingServerResult(accountId, feedback) {
  observeLocalWrite(
    () => recordScenarioFeedback(accountId, feedback),
    '[Scenarios] Could not persist encrypted scenario feedback',
    'SCENARIO_FEEDBACK_PERSIST_FAILED'
  );
}

function mapRequestError(error) {
  if (error instanceof ScenarioClientError) return error;
  if (error?.code === 'HTTP_REQUEST_TIMEOUT') {
    return scenarioError('SCENARIO_TIMEOUT', 'The connected care service took too long to respond.');
  }
  if (error?.code === 'HTTP_REQUEST_ABORTED') {
    return scenarioError('SCENARIO_CANCELLED', 'The scenario request was cancelled.');
  }
  if (error?.code === 'HTTP_RESPONSE_TOO_LARGE') {
    return scenarioError('SCENARIO_RESPONSE_TOO_LARGE', 'The connected care response was too large.');
  }
  if (error?.code === 'HTTP_RESPONSE_INVALID') {
    return scenarioError('SCENARIO_RESPONSE_INVALID', 'The connected care service returned invalid data.');
  }
  if (error instanceof TypeError) {
    return scenarioError(
      'SCENARIO_NETWORK_ERROR',
      'The connected care service could not be reached.',
      { cause: error }
    );
  }
  return scenarioError(
    'SCENARIO_REQUEST_FAILED',
    'The connected care request could not be completed.',
    { cause: error }
  );
}

function semanticHttpError(statusCode) {
  const mapped = {
    401: ['SCENARIO_AUTHENTICATION_REQUIRED', 'Sign in again to use connected care scenarios.'],
    403: ['SCENARIO_ACCOUNT_UNAVAILABLE', 'This scenario is not available for the active account.'],
    404: ['SCENARIO_NOT_FOUND', 'The scenario execution could not be found.'],
    503: ['SCENARIO_NOT_CONFIGURED', 'Connected care is not configured in this environment.']
  }[statusCode] ?? [
    `SCENARIO_HTTP_${statusCode}`,
    'The connected care service could not complete the request.'
  ];
  return scenarioError(mapped[0], mapped[1], { statusCode });
}

function reserveIntentWithDeadline(accountId, pendingIntent, timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
    return Promise.reject(scenarioError(
      'SCENARIO_INTENT_RESERVATION_OPTIONS_INVALID',
      'The scenario request could not be reserved.'
    ));
  }
  const operation = reservePendingScenarioIntent(accountId, pendingIntent);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => finish(
      reject,
      scenarioError(
        'SCENARIO_INTENT_RESERVATION_TIMEOUT',
        'The scenario request could not be saved safely. Please try again.'
      )
    ), timeoutMs);
    operation.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, scenarioError(
        'SCENARIO_INTENT_PERSIST_FAILED',
        'The scenario request could not be saved safely. Please try again.',
        { cause: error }
      ))
    );
  });
}

function readPendingIntentWithDeadline(accountId, scenarioId, timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
    return Promise.reject(scenarioError(
      'SCENARIO_RECONCILIATION_OPTIONS_INVALID',
      'Scenario reconciliation options are invalid.'
    ));
  }
  const operation = getPendingScenarioIntent(accountId, scenarioId);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => finish(
      reject,
      scenarioError(
        'SCENARIO_RECONCILIATION_LOCAL_TIMEOUT',
        'Local scenario reconciliation timed out.'
      )
    ), timeoutMs);
    operation.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, scenarioError(
        'SCENARIO_RECONCILIATION_LOCAL_FAILED',
        'Local scenario reconciliation failed.',
        { cause: error }
      ))
    );
  });
}

function terminalIntentFailure(error) {
  return error?.code === 'SCENARIO_ACCOUNT_UNAVAILABLE'
    || error?.code === 'SCENARIO_NOT_FOUND'
    || ['SCENARIO_HTTP_400', 'SCENARIO_HTTP_405', 'SCENARIO_HTTP_409',
      'SCENARIO_HTTP_410', 'SCENARIO_HTTP_422'].includes(error?.code);
}

async function requestScenario(path, {
  accessToken,
  accountId,
  method = 'GET',
  body,
  signal,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = config.apiBaseUrl
}) {
  requireAuthenticatedAccount(accountId, accessToken);
  const endpoint = scenarioEndpoint(path, apiBaseUrl);
  try {
    const { response, payload } = await runBoundedRequest(async ({
      signal: requestSignal,
      captureResponse
    }) => {
      const nextResponse = await fetchImpl(endpoint, {
        method,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: requestSignal
      });
      captureResponse(nextResponse);
      const nextPayload = nextResponse.status === 204
        ? (await cancelResponseBody(nextResponse), null)
        : await readBoundedJSONResponse(nextResponse, {
          signal: requestSignal,
          maxBytes: MAX_RESPONSE_BYTES
        });
      return { response: nextResponse, payload: nextPayload };
    }, { timeoutMs, signal });
    if (!response.ok) {
      const statusCode = Number.isInteger(response.status) ? response.status : 500;
      throw semanticHttpError(statusCode);
    }
    return payload;
  } catch (error) {
    throw mapRequestError(error);
  }
}

/**
 * Creates the durable user-intent identity. Keep this object for retries after
 * a lost response so the server can deduplicate the exact same action.
 */
export function createScenarioIntent(scenarioId, {
  requestId = createAuthenticationNonce(),
  occurredAt = Date.now()
} = {}) {
  if (!Object.hasOwn(AI_NATIVE_SCENARIO_INTENTS, scenarioId)) {
    throw scenarioError('SCENARIO_ID_INVALID', 'The selected care scenario is unavailable.');
  }
  if (!IDENTIFIER_PATTERN.test(requestId ?? '') || !safeTimestamp(occurredAt)) {
    throw scenarioError('SCENARIO_INTENT_INVALID', 'The scenario request identity is invalid.');
  }
  const intent = AI_NATIVE_SCENARIO_INTENTS[scenarioId];
  return Object.freeze({
    scenarioId,
    requestId,
    occurredAt,
    ...(intent ? { intent } : {})
  });
}

export async function startScenario({
  accountId,
  accessToken,
  scenarioId,
  scenarioIntent,
  context
}, options = {}) {
  requireAuthenticatedAccount(accountId, accessToken);
  if (options.signal?.aborted) {
    throw scenarioError('SCENARIO_CANCELLED', 'The scenario request was cancelled.');
  }
  const intent = validateScenarioIntent(
    scenarioId,
    scenarioIntent ?? createScenarioIntent(scenarioId)
  );
  const normalizedContext = normalizeScenarioContext(scenarioId, context);
  const pendingCandidate = Object.freeze({
    ...intent,
    ...(normalizedContext ? { context: normalizedContext } : {})
  });
  const {
    reservationTimeoutMs = DEFAULT_INTENT_RESERVATION_TIMEOUT_MS,
    ...requestOptions
  } = options;
  const reserved = await reserveIntentWithDeadline(
    accountId,
    pendingCandidate,
    reservationTimeoutMs
  );
  if (options.signal?.aborted) {
    releaseIntentWithoutMaskingServerResult(accountId, reserved);
    throw scenarioError('SCENARIO_CANCELLED', 'The scenario request was cancelled.');
  }
  let payload;
  try {
    payload = await requestScenario('/v1/scenarios', {
      ...requestOptions,
      accessToken,
      accountId,
      method: 'POST',
      body: {
        scenario_id: scenarioId,
        request_id: reserved.requestId,
        occurred_at: reserved.occurredAt,
        ...(reserved.intent ? { intent: reserved.intent } : {}),
        ...(reserved.context ? { context: reserved.context } : {})
      }
    });
  } catch (error) {
    if (terminalIntentFailure(error)) {
      releaseIntentWithoutMaskingServerResult(accountId, reserved);
    }
    throw error;
  }
  const result = normalizeStartedResponse(payload, scenarioId);
  releaseIntentWithoutMaskingServerResult(accountId, reserved);
  if (options.signal?.aborted) {
    throw scenarioError('SCENARIO_CANCELLED', 'The scenario request was cancelled.');
  }
  result.started.forEach(({ execution }) => {
    persistExecutionWithoutMaskingServerResult(accountId, execution);
  });
  return result;
}

export async function getScenarioExecution({ accountId, accessToken, executionId }, options = {}) {
  if (!EXECUTION_ID_PATTERN.test(executionId ?? '')) {
    throw scenarioError('SCENARIO_EXECUTION_ID_INVALID', 'The scenario execution identity is invalid.');
  }
  const execution = normalizeScenarioExecution(await requestScenario(
    `/v1/scenarios/${encodeURIComponent(executionId.toLowerCase())}`,
    { ...options, accessToken, accountId }
  ));
  if (options.signal?.aborted) {
    throw scenarioError('SCENARIO_CANCELLED', 'The scenario request was cancelled.');
  }
  persistExecutionWithoutMaskingServerResult(accountId, execution);
  return execution;
}

export async function listScenarioExecutions({
  accountId,
  accessToken,
  limit = DEFAULT_EXECUTION_LIST_LIMIT
}, options = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EXECUTION_LIST_LIMIT) {
    throw scenarioError('SCENARIO_LIST_LIMIT_INVALID', 'The scenario history limit is invalid.');
  }
  const payload = await requestScenario(`/v1/scenarios/executions?limit=${limit}`, {
    ...options,
    accountId,
    accessToken
  });
  if (!exactKeys(payload, new Set(['executions']))
    || !Array.isArray(payload.executions)
    || payload.executions.length > limit) {
    throw scenarioError(
      'SCENARIO_RESPONSE_INVALID',
      'The connected care service returned invalid scenario history.'
    );
  }
  const executions = payload.executions.map(normalizeScenarioExecution);
  if (new Set(executions.map(({ executionId }) => executionId)).size !== executions.length) {
    throw scenarioError(
      'SCENARIO_RESPONSE_INVALID',
      'The connected care service returned invalid scenario history.'
    );
  }
  if (options.signal?.aborted) {
    throw scenarioError('SCENARIO_CANCELLED', 'The scenario request was cancelled.');
  }
  executions.forEach((execution) => {
    persistExecutionWithoutMaskingServerResult(accountId, execution);
  });
  return Object.freeze(executions);
}

/**
 * Refreshes authoritative execution snapshots, then explicitly replays each
 * crash-surviving pending intent with its original request identity. The
 * server's idempotency record provides the only safe correlation after a lost
 * response; scenario/time heuristics are intentionally forbidden.
 */
export async function reconcileScenarioExecutions({
  accountId,
  accessToken,
  limit = DEFAULT_EXECUTION_LIST_LIMIT
}, options = {}) {
  const {
    reservationTimeoutMs = DEFAULT_INTENT_RESERVATION_TIMEOUT_MS,
    ...requestOptions
  } = options;
  const executions = await listScenarioExecutions({ accountId, accessToken, limit }, requestOptions);
  const reconciled = [];
  for (const scenarioId of RECONCILIATION_ORDER) {
    if (requestOptions.signal?.aborted) {
      throw scenarioError('SCENARIO_CANCELLED', 'Scenario reconciliation was cancelled.');
    }
    let pending;
    try {
      pending = await readPendingIntentWithDeadline(accountId, scenarioId, reservationTimeoutMs);
    } catch (error) {
      logger.recoverable('[Scenarios] Could not read a pending intent for reconciliation', {
        errorCode: error?.code || error?.name || 'SCENARIO_RECONCILIATION_LOCAL_FAILED',
        scenarioId
      });
      continue;
    }
    if (!pending) continue;
    const { context, ...scenarioIntent } = pending;
    try {
      const result = await startScenario({
        accountId,
        accessToken,
        scenarioId: pending.scenarioId,
        scenarioIntent,
        ...(context ? { context } : {})
      }, { ...requestOptions, reservationTimeoutMs });
      reconciled.push(...result.started.map(({ execution }) => execution));
    } catch (error) {
      if (error?.code === 'SCENARIO_CANCELLED') throw error;
      logger.recoverable('[Scenarios] Pending intent reconciliation remains incomplete', {
        errorCode: error?.code || error?.name || 'SCENARIO_RECONCILIATION_FAILED',
        scenarioId: pending.scenarioId
      });
    }
  }
  return Object.freeze({ executions, reconciled: Object.freeze(reconciled) });
}

function waitForPollInterval(delayMs, signal) {
  if (signal?.aborted) {
    return Promise.reject(scenarioError('SCENARIO_CANCELLED', 'Scenario status polling was cancelled.'));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(finish, delayMs);
    function finish() {
      signal?.removeEventListener?.('abort', cancel);
      resolve();
    }
    function cancel() {
      clearTimeout(timeout);
      signal?.removeEventListener?.('abort', cancel);
      reject(scenarioError('SCENARIO_CANCELLED', 'Scenario status polling was cancelled.'));
    }
    signal?.addEventListener?.('abort', cancel, { once: true });
  });
}

export async function pollScenarioExecution({
  accountId,
  accessToken,
  executionId,
  onUpdate
}, {
  signal,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  now = Date.now,
  wait = waitForPollInterval,
  ...requestOptions
  } = {}) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 100 || intervalMs > 30_000
    || !Number.isSafeInteger(pollTimeoutMs) || pollTimeoutMs < 1 || pollTimeoutMs > 30 * 60_000
    || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 120_000) {
    throw scenarioError('SCENARIO_POLL_OPTIONS_INVALID', 'Scenario polling options are invalid.');
  }
  const startedAt = now();
  if (!safeTimestamp(startedAt)) {
    throw scenarioError('SCENARIO_POLL_OPTIONS_INVALID', 'Scenario polling options are invalid.');
  }
  while (true) {
    if (signal?.aborted) {
      throw scenarioError('SCENARIO_CANCELLED', 'Scenario status polling was cancelled.');
    }
    const elapsedBeforeRequest = now() - startedAt;
    if (!Number.isFinite(elapsedBeforeRequest)
      || elapsedBeforeRequest < 0
      || elapsedBeforeRequest >= pollTimeoutMs) {
      throw scenarioError('SCENARIO_POLL_TIMEOUT', 'The scenario is still running. Check again shortly.');
    }
    const execution = await getScenarioExecution({ accountId, accessToken, executionId }, {
      ...requestOptions,
      signal,
      timeoutMs: Math.max(1, Math.min(requestTimeoutMs, pollTimeoutMs - elapsedBeforeRequest))
    });
    await onUpdate?.(execution);
    if (TERMINAL_STATES.has(execution.state)) return execution;
    const elapsed = now() - startedAt;
    if (!Number.isFinite(elapsed) || elapsed >= pollTimeoutMs) {
      throw scenarioError('SCENARIO_POLL_TIMEOUT', 'The scenario is still running. Check again shortly.');
    }
    await wait(Math.min(intervalMs, pollTimeoutMs - elapsed), signal);
  }
}

export async function cancelScenarioExecution({
  accountId,
  accessToken,
  executionId,
  occurredAt = Date.now()
}, options = {}) {
  if (!EXECUTION_ID_PATTERN.test(executionId ?? '') || !safeTimestamp(occurredAt)) {
    throw scenarioError('SCENARIO_EXECUTION_ID_INVALID', 'The scenario execution identity is invalid.');
  }
  const execution = normalizeScenarioExecution(await requestScenario(
    `/v1/scenarios/${encodeURIComponent(executionId.toLowerCase())}/cancel`,
    {
      ...options,
      accessToken,
      accountId,
      method: 'POST',
      body: { confirmed: true, occurred_at: occurredAt }
    }
  ));
  if (options.signal?.aborted) {
    throw scenarioError('SCENARIO_CANCELLED', 'The scenario request was cancelled.');
  }
  persistExecutionWithoutMaskingServerResult(accountId, execution);
  return execution;
}

export async function submitScenarioFeedback({
  accountId,
  accessToken,
  executionId,
  rating,
  occurredAt = Date.now()
}, options = {}) {
  if (!EXECUTION_ID_PATTERN.test(executionId ?? '')
    || !['up', 'down'].includes(rating)
    || !safeTimestamp(occurredAt)) {
    throw scenarioError('SCENARIO_FEEDBACK_INVALID', 'Scenario feedback failed validation.');
  }
  const serverRating = rating === 'up' ? 'helpful' : 'not_helpful';
  const payload = await requestScenario(
    `/v1/scenarios/${encodeURIComponent(executionId.toLowerCase())}/feedback`,
    {
      ...options,
      accessToken,
      accountId,
      method: 'POST',
      body: { rating: serverRating, occurred_at: occurredAt }
    }
  );
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || payload.recorded !== true || payload.rating !== serverRating) {
    throw scenarioError(
      'SCENARIO_RESPONSE_INVALID',
      'The connected care service returned an invalid feedback response.'
    );
  }
  if (options.signal?.aborted) {
    throw scenarioError('SCENARIO_CANCELLED', 'The scenario request was cancelled.');
  }
  feedbackWithoutMaskingServerResult(accountId, {
    executionId,
    rating,
    recordedAt: occurredAt
  });
  return Object.freeze({ recorded: true, rating });
}

export async function submitInteractionFeedback({
  accountId,
  accessToken,
  interactionType,
  interactionId,
  rating,
  occurredAt = Date.now()
}, options = {}) {
  if (interactionType !== 'voice_call'
    || !IDENTIFIER_PATTERN.test(interactionId ?? '')
    || interactionId.length > 80
    || !['up', 'down'].includes(rating)
    || !safeTimestamp(occurredAt)) {
    throw scenarioError('INTERACTION_FEEDBACK_INVALID', 'Interaction feedback failed validation.');
  }
  const serverRating = rating === 'up' ? 'helpful' : 'not_helpful';
  const payload = await requestScenario('/v1/interaction-feedback', {
    ...options,
    accessToken,
    accountId,
    method: 'POST',
    body: {
      interaction_type: interactionType,
      interaction_id: interactionId,
      rating: serverRating,
      occurred_at: occurredAt
    }
  });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || payload.recorded !== true || payload.rating !== serverRating) {
    throw scenarioError(
      'SCENARIO_RESPONSE_INVALID',
      'The connected care service returned an invalid feedback response.'
    );
  }
  return Object.freeze({ recorded: true, rating });
}
