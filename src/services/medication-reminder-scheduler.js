import { runLocalUserDataMutation } from './local-mutation-coordinator';
import {
  createMedicationReminder,
  MEDICATION_REMINDER_STATUS,
  nextMedicationActions,
  transitionMedicationReminder
} from './medication-reminder-state';
import { storage } from './storage';

export const MEDICATION_REMINDER_STORE_KEY = 'veryloving.medicationReminders.v1';

const STORE_VERSION = 1;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REMINDER_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const MEDICATION_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
// Receipt IDs must also pass medication-reminder-state's identifier gate.
const RECEIPT_PATTERN = IDENTIFIER_PATTERN;
const DELIVERY_STATUSES = new Set([
  'pending',
  'delivered',
  'partially_delivered',
  'failed',
  'no_eligible_recipients',
  'not_configured'
]);
const TERMINAL_STATUSES = new Set([
  MEDICATION_REMINDER_STATUS.acknowledged,
  MEDICATION_REMINDER_STATUS.cancelled,
  MEDICATION_REMINDER_STATUS.escalated
]);
const DEFAULT_MAX_REMINDERS = 100;
const DEFAULT_MAX_ACTIONS_PER_CYCLE = 25;
const DEFAULT_MAX_DELIVERY_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_MS = 5 * 1000;
const DEFAULT_RETRY_MAX_MS = 5 * 60 * 1000;
const DEFAULT_COMPLETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;

function schedulerError(code, message) {
  return Object.assign(new Error(message), { code });
}

function positiveSafeInteger(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function accountIdentifier(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 512 ? normalized : null;
}

function identifier(value, pattern = IDENTIFIER_PATTERN) {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

function safeTime(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalTime(value) {
  if (value === null || value === undefined) return null;
  return safeTime(value);
}

function checkedNow(now) {
  const current = now();
  if (!Number.isSafeInteger(current) || current <= 0) {
    throw schedulerError('MEDICATION_TIME_INVALID', 'Current medication scheduler time is invalid.');
  }
  return current;
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function normalizedDeliveryPhase(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const attempts = Number(value.attempts);
  const nextAttemptAt = value.nextAttemptAt === null ? null : safeTime(value.nextAttemptAt);
  const receiptId = identifier(value.receiptId, RECEIPT_PATTERN);
  const lastErrorCode = identifier(value.lastErrorCode, /^[A-Z][A-Z0-9_]{0,79}$/);
  const deliveryStatus = DELIVERY_STATUSES.has(value.deliveryStatus)
    ? value.deliveryStatus
    : undefined;
  return {
    attempts: Number.isSafeInteger(attempts) && attempts >= 0 ? Math.min(attempts, 100) : 0,
    nextAttemptAt,
    exhausted: value.exhausted === true,
    ...(receiptId ? { receiptId } : {}),
    ...(lastErrorCode ? { lastErrorCode } : {}),
    ...(deliveryStatus ? { deliveryStatus } : {}),
    ...(safeTime(value.acceptedAt) ? { acceptedAt: safeTime(value.acceptedAt) } : {}),
    ...(safeTime(value.deliveredAt) ? { deliveredAt: safeTime(value.deliveredAt) } : {})
  };
}

function normalizeStoredReminder(value) {
  if (
    value?.version !== 1
    || !identifier(value.id, REMINDER_ID_PATTERN)
    || !identifier(value.medicationId, MEDICATION_IDENTIFIER_PATTERN)
    || !identifier(value.robotDeviceId)
    || !Object.values(MEDICATION_REMINDER_STATUS).includes(value.status)
  ) return null;
  const dueAt = safeTime(value.dueAt);
  const escalationAt = safeTime(value.escalationAt);
  const createdAt = safeTime(value.createdAt);
  const updatedAt = safeTime(value.updatedAt);
  if (!dueAt || !escalationAt || escalationAt < dueAt || !createdAt || !updatedAt || updatedAt < createdAt) {
    return null;
  }
  const reminderReceiptId = value.reminderReceiptId === null
    ? null : identifier(value.reminderReceiptId, RECEIPT_PATTERN);
  const escalationReceiptId = value.escalationReceiptId === null
    ? null : identifier(value.escalationReceiptId, RECEIPT_PATTERN);
  if (reminderReceiptId === null && value.reminderReceiptId !== null) return null;
  if (escalationReceiptId === null && value.escalationReceiptId !== null) return null;
  const acknowledgedAt = optionalTime(value.acknowledgedAt);
  const reminderAcceptedAt = optionalTime(value.reminderAcceptedAt);
  const reminderDeliveredAt = optionalTime(value.reminderDeliveredAt);
  const escalationAcceptedAt = optionalTime(value.escalationAcceptedAt);
  const escalationDeliveredAt = optionalTime(value.escalationDeliveredAt);
  if (
    (value.acknowledgedAt != null && !acknowledgedAt)
    || (value.reminderAcceptedAt != null && !reminderAcceptedAt)
    || (value.reminderDeliveredAt != null && !reminderDeliveredAt)
    || (value.escalationAcceptedAt != null && !escalationAcceptedAt)
    || (value.escalationDeliveredAt != null && !escalationDeliveredAt)
  ) return null;
  const delivery = value.delivery && typeof value.delivery === 'object' && !Array.isArray(value.delivery)
    ? {
        ...(normalizedDeliveryPhase(value.delivery.reminder)
          ? { reminder: normalizedDeliveryPhase(value.delivery.reminder) } : {}),
        ...(normalizedDeliveryPhase(value.delivery.escalation)
          ? { escalation: normalizedDeliveryPhase(value.delivery.escalation) } : {})
      }
    : {};
  return {
    version: 1,
    id: value.id,
    medicationId: value.medicationId,
    robotDeviceId: value.robotDeviceId,
    dueAt,
    escalationAt,
    status: value.status,
    createdAt,
    updatedAt,
    reminderReceiptId,
    escalationReceiptId,
    acknowledgedAt,
    ...(reminderAcceptedAt ? { reminderAcceptedAt } : {}),
    ...(reminderDeliveredAt ? { reminderDeliveredAt } : {}),
    ...(escalationAcceptedAt ? { escalationAcceptedAt } : {}),
    ...(escalationDeliveredAt ? { escalationDeliveredAt } : {}),
    delivery
  };
}

function deliveryErrorCode(error) {
  const candidate = error?.code || error?.name;
  return typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(candidate)
    ? candidate
    : 'MEDICATION_DELIVERY_FAILED';
}

function normalizeDispatchResult(result) {
  const status = typeof result?.status === 'string' ? result.status.toLowerCase() : '';
  const deliveryStatusCandidate = result?.deliveryStatus ?? result?.delivery_status;
  const deliveryStatus = typeof deliveryStatusCandidate === 'string'
    && DELIVERY_STATUSES.has(deliveryStatusCandidate.toLowerCase())
    ? deliveryStatusCandidate.toLowerCase()
    : undefined;
  const delivered = result?.delivered === true
    || status === 'delivered'
    || deliveryStatus === 'delivered';
  const accepted = delivered
    || result?.accepted === true
    || ['accepted', 'queued', 'pending_ack'].includes(status);
  const receiptId = identifier(
    result?.receiptId
      ?? result?.receipt_id
      ?? result?.actionId
      ?? result?.action_id
      ?? result?.id,
    RECEIPT_PATTERN
  );
  if (!accepted || !receiptId) {
    throw schedulerError(
      'MEDICATION_DELIVERY_RESPONSE_INVALID',
      'Medication delivery did not return a valid acceptance receipt.'
    );
  }
  return { accepted: true, delivered, receiptId, ...(deliveryStatus ? { deliveryStatus } : {}) };
}

export function medicationReminderRetryDelay(attempt, {
  baseDelayMs = DEFAULT_RETRY_BASE_MS,
  maximumDelayMs = DEFAULT_RETRY_MAX_MS
} = {}) {
  const normalizedAttempt = Math.max(1, Number(attempt) || 1);
  return Math.min(maximumDelayMs, baseDelayMs * (2 ** Math.min(normalizedAttempt - 1, 20)));
}

/**
 * Durable, account-bound reminder orchestration.
 *
 * Only one timer and one serialized mutation pipeline are used regardless of
 * reminder count. External dispatchers receive a stable idempotency key and
 * must preserve it through the robot/manufacturer or caregiver delivery path.
 */
export function createMedicationReminderScheduler({
  accountId,
  sendRobotReminder,
  notifyCaregiver,
  storageImpl = storage,
  now = Date.now,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  onDeliveryFailure = () => {},
  onStateChange = () => {},
  maxReminders = DEFAULT_MAX_REMINDERS,
  maxActionsPerCycle = DEFAULT_MAX_ACTIONS_PER_CYCLE,
  maxDeliveryAttempts = DEFAULT_MAX_DELIVERY_ATTEMPTS,
  retryBaseMs = DEFAULT_RETRY_BASE_MS,
  retryMaximumMs = DEFAULT_RETRY_MAX_MS,
  completedRetentionMs = DEFAULT_COMPLETED_RETENTION_MS,
  maxTimerDelayMs = MAX_TIMER_DELAY_MS
} = {}) {
  const owner = accountIdentifier(accountId);
  if (!owner) throw schedulerError('MEDICATION_ACCOUNT_REQUIRED', 'An authenticated account is required.');
  if (typeof sendRobotReminder !== 'function' || typeof notifyCaregiver !== 'function') {
    throw schedulerError('MEDICATION_DELIVERY_NOT_CONFIGURED', 'Medication delivery handlers are required.');
  }
  const capacity = positiveSafeInteger(maxReminders, DEFAULT_MAX_REMINDERS, 500);
  const cycleLimit = positiveSafeInteger(maxActionsPerCycle, DEFAULT_MAX_ACTIONS_PER_CYCLE, 50);
  const attemptLimit = positiveSafeInteger(maxDeliveryAttempts, DEFAULT_MAX_DELIVERY_ATTEMPTS, 10);
  const retryBase = positiveSafeInteger(retryBaseMs, DEFAULT_RETRY_BASE_MS, 60 * 60 * 1000);
  const retryMaximum = positiveSafeInteger(retryMaximumMs, DEFAULT_RETRY_MAX_MS, 24 * 60 * 60 * 1000);
  const retention = positiveSafeInteger(completedRetentionMs, DEFAULT_COMPLETED_RETENTION_MS, 365 * 24 * 60 * 60 * 1000);
  const maximumTimerDelay = positiveSafeInteger(maxTimerDelayMs, MAX_TIMER_DELAY_MS, MAX_TIMER_DELAY_MS);

  let reminders = new Map();
  let loaded = false;
  let running = false;
  let timer = null;
  let timerGeneration = 0;
  let lifecycleGeneration = 0;
  let mutationQueue = Promise.resolve();

  const serialize = (operation) => {
    const next = mutationQueue.catch(() => {}).then(operation);
    mutationQueue = next.then(() => undefined, () => undefined);
    return next;
  };

  const listUnsafe = () => [...reminders.values()]
    .sort((left, right) => left.dueAt - right.dueAt || left.id.localeCompare(right.id));

  const persistUnsafe = async () => {
    const snapshot = {
      version: STORE_VERSION,
      accountId: owner,
      reminders: listUnsafe().slice(0, capacity)
    };
    await runLocalUserDataMutation(() => storageImpl.setJSON(MEDICATION_REMINDER_STORE_KEY, snapshot));
    await Promise.resolve(onStateChange(snapshot.reminders.map(cloneState))).catch(() => {});
  };

  const loadUnsafe = async () => {
    if (loaded) return;
    const snapshot = await storageImpl.getJSON(MEDICATION_REMINDER_STORE_KEY, null);
    reminders = new Map();
    if (snapshot?.version === STORE_VERSION && snapshot.accountId === owner && Array.isArray(snapshot.reminders)) {
      for (const candidate of snapshot.reminders.slice(0, capacity)) {
        const normalized = normalizeStoredReminder(candidate);
        if (normalized && !reminders.has(normalized.id)) reminders.set(normalized.id, normalized);
      }
    }
    loaded = true;
  };

  const phaseMetadata = (state, phase) => state.delivery?.[phase] || {
    attempts: 0,
    nextAttemptAt: null,
    exhausted: false
  };

  const withPhaseMetadata = (state, phase, metadata, currentTime) => ({
    ...state,
    updatedAt: Math.max(state.updatedAt, currentTime),
    delivery: {
      ...(state.delivery || {}),
      [phase]: metadata
    }
  });

  const nextActionAt = (state, currentTime) => {
    if (state.status === MEDICATION_REMINDER_STATUS.scheduled) return state.dueAt;
    if ([
      MEDICATION_REMINDER_STATUS.reminderAccepted,
      MEDICATION_REMINDER_STATUS.awaitingAcknowledgement
    ].includes(state.status)) return state.escalationAt;
    if (state.status === MEDICATION_REMINDER_STATUS.reminderDue) {
      const metadata = phaseMetadata(state, 'reminder');
      if (metadata.exhausted) return state.escalationAt;
      return metadata.nextAttemptAt || currentTime;
    }
    if (state.status === MEDICATION_REMINDER_STATUS.escalationDue) {
      const metadata = phaseMetadata(state, 'escalation');
      if (metadata.exhausted) return null;
      return metadata.nextAttemptAt || currentTime;
    }
    return null;
  };

  const clearTimerUnsafe = () => {
    timerGeneration += 1;
    if (timer !== null) clearTimeoutImpl(timer);
    timer = null;
  };

  const armUnsafe = (expectedGeneration = lifecycleGeneration) => {
    clearTimerUnsafe();
    if (!running || expectedGeneration !== lifecycleGeneration) return;
    const currentTime = checkedNow(now);
    const nextAt = listUnsafe().reduce((earliest, state) => {
      const candidate = nextActionAt(state, currentTime);
      return candidate === null ? earliest : Math.min(earliest, candidate);
    }, Infinity);
    if (!Number.isFinite(nextAt)) return;
    const generation = timerGeneration;
    const delay = Math.min(maximumTimerDelay, Math.max(0, nextAt - currentTime));
    timer = setTimeoutImpl(() => {
      if (
        !running
        || generation !== timerGeneration
        || expectedGeneration !== lifecycleGeneration
      ) return;
      timer = null;
      runDue().catch((error) => {
        Promise.resolve(onDeliveryFailure({
          phase: 'scheduler',
          errorCode: deliveryErrorCode(error)
        })).catch(() => {});
      });
    }, delay);
    timer?.unref?.();
  };

  const recordFailureUnsafe = async (state, phase, currentTime, error, expectedGeneration) => {
    if (expectedGeneration !== lifecycleGeneration) return false;
    const previous = phaseMetadata(state, phase);
    const attempts = previous.attempts + 1;
    const exhausted = attempts >= attemptLimit;
    const nextAttemptAt = exhausted
      ? null
      : currentTime + medicationReminderRetryDelay(attempts, {
          baseDelayMs: retryBase,
          maximumDelayMs: retryMaximum
        });
    const next = withPhaseMetadata(state, phase, {
      attempts,
      nextAttemptAt,
      exhausted,
      lastErrorCode: deliveryErrorCode(error)
    }, currentTime);
    if (expectedGeneration !== lifecycleGeneration) return false;
    reminders.set(next.id, next);
    await persistUnsafe();
    if (expectedGeneration !== lifecycleGeneration) return false;
    await Promise.resolve(onDeliveryFailure({
      reminderId: next.id,
      phase,
      attempts,
      exhausted,
      errorCode: deliveryErrorCode(error)
    })).catch(() => {});
    return true;
  };

  const dispatchActionUnsafe = async (state, action, currentTime, expectedGeneration) => {
    if (expectedGeneration !== lifecycleGeneration) return false;
    const phase = action.type === 'send_robot_reminder' ? 'reminder' : 'escalation';
    const previous = phaseMetadata(state, phase);
    try {
      const rawResult = phase === 'reminder'
        ? await sendRobotReminder({
            accountId: owner,
            reminderId: state.id,
            deviceId: action.deviceId,
            command: action.command,
            idempotencyKey: action.idempotencyKey
          })
        : await notifyCaregiver({
            accountId: owner,
            reminderId: state.id,
            medicationId: state.medicationId,
            idempotencyKey: action.idempotencyKey,
            occurredAt: action.occurredAt
          });
      if (expectedGeneration !== lifecycleGeneration) return false;
      const result = normalizeDispatchResult(rawResult);
      const event = phase === 'reminder'
        ? {
            type: result.delivered ? 'reminder_delivered' : 'reminder_accepted',
            receiptId: result.receiptId
          }
        : {
            type: result.delivered ? 'escalation_delivered' : 'escalation_accepted',
            receiptId: result.receiptId
          };
      const transitioned = transitionMedicationReminder(state, event, { now: () => currentTime });
      const next = withPhaseMetadata(transitioned, phase, {
        attempts: previous.attempts + 1,
        nextAttemptAt: null,
        exhausted: false,
        receiptId: result.receiptId,
        ...(result.deliveryStatus ? { deliveryStatus: result.deliveryStatus } : {}),
        ...(result.delivered ? { deliveredAt: currentTime } : { acceptedAt: currentTime })
      }, currentTime);
      if (expectedGeneration !== lifecycleGeneration) return false;
      reminders.set(next.id, next);
      await persistUnsafe();
      return expectedGeneration === lifecycleGeneration;
    } catch (error) {
      if (expectedGeneration !== lifecycleGeneration) return false;
      await recordFailureUnsafe(state, phase, currentTime, error, expectedGeneration);
      return false;
    }
  };

  const processDueUnsafe = async (expectedGeneration) => {
    await loadUnsafe();
    if (expectedGeneration !== lifecycleGeneration) {
      return { attempted: 0, accepted: 0, total: reminders.size };
    }
    const currentTime = checkedNow(now);
    let changed = false;
    for (const state of listUnsafe()) {
      const next = transitionMedicationReminder(state, { type: 'tick' }, { now: () => currentTime });
      if (next !== state) {
        reminders.set(next.id, next);
        changed = true;
      }
    }
    // Persist due/escalation transitions before any external side effect. A
    // process death can then safely retry using the same idempotency key.
    if (changed) await persistUnsafe();
    if (expectedGeneration !== lifecycleGeneration) {
      return { attempted: 0, accepted: 0, total: reminders.size };
    }

    let attempted = 0;
    let accepted = 0;
    for (const state of listUnsafe()) {
      if (expectedGeneration !== lifecycleGeneration) break;
      if (attempted >= cycleLimit) break;
      const action = nextMedicationActions(state)[0];
      if (!action) continue;
      const phase = action.type === 'send_robot_reminder' ? 'reminder' : 'escalation';
      const metadata = phaseMetadata(state, phase);
      if (metadata.exhausted || (metadata.nextAttemptAt && metadata.nextAttemptAt > currentTime)) continue;
      attempted += 1;
      if (await dispatchActionUnsafe(state, action, currentTime, expectedGeneration)) accepted += 1;
    }
    return { attempted, accepted, total: reminders.size };
  };

  const runDue = () => {
    const generation = lifecycleGeneration;
    return serialize(async () => {
      const result = await processDueUnsafe(generation);
      armUnsafe(generation);
      return result;
    });
  };

  const start = () => {
    const generation = ++lifecycleGeneration;
    return serialize(async () => {
      await loadUnsafe();
      if (generation !== lifecycleGeneration) {
        return {
          attempted: 0,
          accepted: 0,
          total: reminders.size,
          reminders: listUnsafe().map(cloneState)
        };
      }
      running = true;
      const result = await processDueUnsafe(generation);
      armUnsafe(generation);
      return { ...result, reminders: listUnsafe().map(cloneState) };
    });
  };

  const stop = () => {
    lifecycleGeneration += 1;
    running = false;
    clearTimerUnsafe();
  };

  const schedule = (input) => serialize(async () => {
    await loadUnsafe();
    const existingId = identifier(input?.id);
    const existing = existingId ? reminders.get(existingId) : null;
    if (existing) {
      if (
        existing.medicationId === input.medicationId
        && existing.robotDeviceId === input.robotDeviceId
        && existing.dueAt === Number(input.dueAt)
      ) return cloneState(existing);
      throw schedulerError('MEDICATION_REMINDER_CONFLICT', 'A different reminder already uses this identifier.');
    }
    const currentTime = checkedNow(now);
    for (const [id, state] of reminders) {
      if (TERMINAL_STATUSES.has(state.status) && state.updatedAt < currentTime - retention) reminders.delete(id);
    }
    if (reminders.size >= capacity) {
      throw schedulerError('MEDICATION_REMINDER_CAPACITY', 'Medication reminder capacity is full.');
    }
    const reminder = createMedicationReminder(input, { now: () => currentTime });
    reminders.set(reminder.id, { ...reminder, delivery: {} });
    await persistUnsafe();
    if (running) {
      const generation = lifecycleGeneration;
      await processDueUnsafe(generation);
      armUnsafe(generation);
    }
    return cloneState(reminders.get(reminder.id));
  });

  const applyEvent = (reminderId, event) => serialize(async () => {
    await loadUnsafe();
    const state = reminders.get(reminderId);
    if (!state) throw schedulerError('MEDICATION_REMINDER_NOT_FOUND', 'Medication reminder was not found.');
    if (event.type === 'acknowledge' && state.status === MEDICATION_REMINDER_STATUS.acknowledged) {
      return cloneState(state);
    }
    if (event.type === 'cancel' && state.status === MEDICATION_REMINDER_STATUS.cancelled) {
      return cloneState(state);
    }
    const currentTime = checkedNow(now);
    const next = transitionMedicationReminder(state, event, { now: () => currentTime });
    reminders.set(next.id, next);
    await persistUnsafe();
    armUnsafe();
    return cloneState(next);
  });

  const acknowledge = (reminderId) => applyEvent(reminderId, { type: 'acknowledge' });
  const cancel = (reminderId) => applyEvent(reminderId, { type: 'cancel' });

  const recordRobotDelivery = (reminderId, receiptId, { robotDeviceId } = {}) => serialize(async () => {
    await loadUnsafe();
    const state = reminders.get(reminderId);
    if (!state) throw schedulerError('MEDICATION_REMINDER_NOT_FOUND', 'Medication reminder was not found.');
    if (robotDeviceId !== undefined && state.robotDeviceId !== robotDeviceId) {
      throw schedulerError(
        'MEDICATION_ACK_SOURCE_MISMATCH',
        'Medication delivery was reported by a different robot.'
      );
    }
    if ([
      MEDICATION_REMINDER_STATUS.awaitingAcknowledgement,
      MEDICATION_REMINDER_STATUS.acknowledged,
      MEDICATION_REMINDER_STATUS.escalationDue,
      MEDICATION_REMINDER_STATUS.escalationAccepted,
      MEDICATION_REMINDER_STATUS.escalated
    ].includes(state.status)) return cloneState(state);
    const currentTime = checkedNow(now);
    const next = transitionMedicationReminder(state, {
      type: 'reminder_delivered', receiptId
    }, { now: () => currentTime });
    reminders.set(next.id, withPhaseMetadata(next, 'reminder', {
      ...phaseMetadata(next, 'reminder'),
      receiptId,
      nextAttemptAt: null,
      exhausted: false,
      deliveredAt: currentTime
    }, currentTime));
    await persistUnsafe();
    armUnsafe();
    return cloneState(reminders.get(next.id));
  });

  const recordCaregiverDelivery = (reminderId, receiptId) => serialize(async () => {
    await loadUnsafe();
    const state = reminders.get(reminderId);
    if (!state) throw schedulerError('MEDICATION_REMINDER_NOT_FOUND', 'Medication reminder was not found.');
    if (state.status === MEDICATION_REMINDER_STATUS.escalated) return cloneState(state);
    const currentTime = checkedNow(now);
    const next = transitionMedicationReminder(state, {
      type: 'escalation_delivered', receiptId
    }, { now: () => currentTime });
    reminders.set(next.id, withPhaseMetadata(next, 'escalation', {
      ...phaseMetadata(next, 'escalation'),
      receiptId,
      nextAttemptAt: null,
      exhausted: false,
      deliveredAt: currentTime
    }, currentTime));
    await persistUnsafe();
    armUnsafe();
    return cloneState(reminders.get(next.id));
  });

  const list = () => serialize(async () => {
    await loadUnsafe();
    return listUnsafe().map(cloneState);
  });

  const drain = () => mutationQueue.catch(() => {});

  return Object.freeze({
    acknowledge,
    cancel,
    drain,
    list,
    recordCaregiverDelivery,
    recordRobotDelivery,
    runDue,
    schedule,
    start,
    stop
  });
}
