const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REMINDER_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const MEDICATION_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const MIN_ESCALATION_DELAY_MS = 60 * 1000;
const MAX_ESCALATION_DELAY_MS = 24 * 60 * 60 * 1000;

export const MEDICATION_REMINDER_STATUS = Object.freeze({
  scheduled: 'scheduled',
  reminderDue: 'reminder_due',
  reminderAccepted: 'reminder_accepted',
  awaitingAcknowledgement: 'awaiting_acknowledgement',
  escalationDue: 'escalation_due',
  escalationAccepted: 'escalation_accepted',
  escalated: 'escalated',
  acknowledged: 'acknowledged',
  cancelled: 'cancelled'
});

function invalid(code, message) {
  return Object.assign(new Error(message), { code });
}

function identifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value.trim())) {
    throw invalid('MEDICATION_IDENTIFIER_INVALID', `${label} is invalid.`);
  }
  return value.trim();
}

function reminderIdentifier(value) {
  if (typeof value !== 'string' || !REMINDER_ID_PATTERN.test(value.trim())) {
    throw invalid('MEDICATION_IDENTIFIER_INVALID', 'Reminder identifier is invalid.');
  }
  return value.trim();
}

function medicationIdentifier(value) {
  if (typeof value !== 'string' || !MEDICATION_IDENTIFIER_PATTERN.test(value.trim())) {
    throw invalid('MEDICATION_IDENTIFIER_INVALID', 'Medication identifier is invalid.');
  }
  return value.trim();
}

function timestamp(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw invalid('MEDICATION_TIME_INVALID', `${label} is invalid.`);
  }
  return parsed;
}

function receiptId(value) {
  return identifier(value, 'Delivery receipt');
}

export function createMedicationReminder({
  id,
  medicationId,
  robotDeviceId,
  dueAt,
  escalationDelayMs = 15 * 60 * 1000
} = {}, { now = Date.now } = {}) {
  const delay = Number(escalationDelayMs);
  if (!Number.isSafeInteger(delay) || delay < MIN_ESCALATION_DELAY_MS || delay > MAX_ESCALATION_DELAY_MS) {
    throw invalid('MEDICATION_ESCALATION_DELAY_INVALID', 'Medication escalation delay is invalid.');
  }
  const createdAt = now();
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0) throw invalid('MEDICATION_TIME_INVALID', 'Current time is invalid.');
  const normalizedId = reminderIdentifier(id);
  const normalizedDueAt = timestamp(dueAt, 'Reminder due time');
  const escalationAt = normalizedDueAt + delay;
  if (!Number.isSafeInteger(escalationAt)) {
    throw invalid('MEDICATION_TIME_INVALID', 'Medication escalation time is invalid.');
  }
  return Object.freeze({
    version: 1,
    id: normalizedId,
    medicationId: medicationIdentifier(medicationId),
    robotDeviceId: identifier(robotDeviceId, 'Robot device identifier'),
    dueAt: normalizedDueAt,
    escalationAt,
    status: MEDICATION_REMINDER_STATUS.scheduled,
    createdAt,
    updatedAt: createdAt,
    reminderReceiptId: null,
    escalationReceiptId: null,
    acknowledgedAt: null
  });
}

function withUpdate(state, status, updatedAt, fields = {}) {
  if (!Number.isSafeInteger(updatedAt) || updatedAt < state.updatedAt) {
    throw invalid('MEDICATION_TIME_INVALID', 'Medication event time is invalid.');
  }
  return Object.freeze({ ...state, ...fields, status, updatedAt });
}

export function transitionMedicationReminder(state, event, { now = Date.now } = {}) {
  if (state?.version !== 1 || !Object.values(MEDICATION_REMINDER_STATUS).includes(state.status)) {
    throw invalid('MEDICATION_STATE_INVALID', 'Medication reminder state is invalid.');
  }
  const type = event?.type;
  if (type === 'cancel') {
    if ([MEDICATION_REMINDER_STATUS.acknowledged, MEDICATION_REMINDER_STATUS.escalated].includes(state.status)) {
      throw invalid('MEDICATION_TRANSITION_INVALID', 'A completed reminder cannot be cancelled.');
    }
    return withUpdate(state, MEDICATION_REMINDER_STATUS.cancelled, now());
  }
  if ([MEDICATION_REMINDER_STATUS.cancelled, MEDICATION_REMINDER_STATUS.acknowledged].includes(state.status)) {
    return state;
  }

  if (type === 'tick') {
    const currentTime = now();
    if (!Number.isSafeInteger(currentTime) || currentTime < state.updatedAt) {
      throw invalid('MEDICATION_TIME_INVALID', 'Medication event time is invalid.');
    }
    if (state.status === MEDICATION_REMINDER_STATUS.scheduled && currentTime >= state.escalationAt) {
      return Object.freeze({ ...state, status: MEDICATION_REMINDER_STATUS.escalationDue, updatedAt: currentTime });
    }
    if (state.status === MEDICATION_REMINDER_STATUS.scheduled && currentTime >= state.dueAt) {
      return Object.freeze({ ...state, status: MEDICATION_REMINDER_STATUS.reminderDue, updatedAt: currentTime });
    }
    if ([
      MEDICATION_REMINDER_STATUS.reminderDue,
      MEDICATION_REMINDER_STATUS.reminderAccepted,
      MEDICATION_REMINDER_STATUS.awaitingAcknowledgement
    ].includes(state.status) && currentTime >= state.escalationAt) {
      return Object.freeze({ ...state, status: MEDICATION_REMINDER_STATUS.escalationDue, updatedAt: currentTime });
    }
    return state;
  }

  if (type === 'reminder_accepted' && state.status === MEDICATION_REMINDER_STATUS.reminderDue) {
    const acceptedAt = now();
    return withUpdate(state, MEDICATION_REMINDER_STATUS.reminderAccepted, acceptedAt, {
      reminderReceiptId: receiptId(event.receiptId),
      reminderAcceptedAt: acceptedAt
    });
  }
  if (type === 'reminder_delivered' && [
    MEDICATION_REMINDER_STATUS.reminderDue,
    MEDICATION_REMINDER_STATUS.reminderAccepted
  ].includes(state.status)) {
    const deliveredAt = now();
    return withUpdate(state, MEDICATION_REMINDER_STATUS.awaitingAcknowledgement, deliveredAt, {
      reminderReceiptId: receiptId(event.receiptId),
      reminderDeliveredAt: deliveredAt
    });
  }
  if (type === 'acknowledge' && [
    MEDICATION_REMINDER_STATUS.reminderAccepted,
    MEDICATION_REMINDER_STATUS.awaitingAcknowledgement,
    MEDICATION_REMINDER_STATUS.escalationDue,
    MEDICATION_REMINDER_STATUS.escalationAccepted
  ].includes(state.status)) {
    const acknowledgedAt = now();
    return withUpdate(state, MEDICATION_REMINDER_STATUS.acknowledged, acknowledgedAt, { acknowledgedAt });
  }
  if (type === 'escalation_accepted' && state.status === MEDICATION_REMINDER_STATUS.escalationDue) {
    const acceptedAt = now();
    return withUpdate(state, MEDICATION_REMINDER_STATUS.escalationAccepted, acceptedAt, {
      escalationReceiptId: receiptId(event.receiptId),
      escalationAcceptedAt: acceptedAt
    });
  }
  if (type === 'escalation_delivered' && [
    MEDICATION_REMINDER_STATUS.escalationDue,
    MEDICATION_REMINDER_STATUS.escalationAccepted
  ].includes(state.status)) {
    const deliveredAt = now();
    return withUpdate(state, MEDICATION_REMINDER_STATUS.escalated, deliveredAt, {
      escalationReceiptId: receiptId(event.receiptId),
      escalationDeliveredAt: deliveredAt
    });
  }
  throw invalid('MEDICATION_TRANSITION_INVALID', 'Medication reminder transition is invalid.');
}

export function nextMedicationActions(state) {
  if (state?.status === MEDICATION_REMINDER_STATUS.reminderDue) {
    return [{
      type: 'send_robot_reminder',
      idempotencyKey: `${state.id}_reminder_v1`,
      deviceId: state.robotDeviceId,
      command: {
        action: 'medication_reminder',
        parameters: {
          reminder_id: state.id,
          medication_id: state.medicationId,
          scheduled_at: state.dueAt
        }
      }
    }];
  }
  if (state?.status === MEDICATION_REMINDER_STATUS.escalationDue) {
    return [{
      type: 'notify_caregiver',
      idempotencyKey: `${state.id}_escalation_v1`,
      medicationId: state.medicationId,
      occurredAt: state.escalationAt
    }];
  }
  return [];
}
