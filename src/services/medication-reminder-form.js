import { MEDICATION_REMINDER_STATUS } from './medication-reminder-state';
import { createAuthenticationNonce } from '../utils/session-token';

const MEDICATION_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const DEVICE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REMINDER_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const MAX_REMINDER_DELAY_MINUTES = 365 * 24 * 60;
const MAX_ESCALATION_DELAY_MINUTES = 24 * 60;

function formError(code, message) {
  return Object.assign(new Error(message), { code });
}

function boundedMinutes(value, label, maximum) {
  const normalized = typeof value === 'string' ? value.trim() : value;
  const minutes = Number(normalized);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > maximum) {
    throw formError('MEDICATION_MINUTES_INVALID', `${label} is invalid.`);
  }
  return minutes;
}

/**
 * Converts the accessible management form into the scheduler's strict input.
 * The medication value is a non-PII schedule reference, not free-form medical
 * notes; the full reminder snapshot remains account-bound and encrypted.
 */
export function createMedicationReminderInput({
  medicationReference,
  robotDeviceId,
  reminderDelayMinutes,
  escalationDelayMinutes
} = {}, {
  now = Date.now,
  createId = createAuthenticationNonce
} = {}) {
  const reference = typeof medicationReference === 'string' ? medicationReference.trim() : '';
  if (!MEDICATION_REFERENCE_PATTERN.test(reference)) {
    throw formError('MEDICATION_REFERENCE_INVALID', 'Medication reference is invalid.');
  }
  const deviceId = typeof robotDeviceId === 'string' ? robotDeviceId.trim() : '';
  if (!DEVICE_IDENTIFIER_PATTERN.test(deviceId)) {
    throw formError('MEDICATION_ROBOT_INVALID', 'A paired home robot is required.');
  }
  const reminderMinutes = boundedMinutes(
    reminderDelayMinutes,
    'Reminder delay',
    MAX_REMINDER_DELAY_MINUTES
  );
  const escalationMinutes = boundedMinutes(
    escalationDelayMinutes,
    'Escalation delay',
    MAX_ESCALATION_DELAY_MINUTES
  );
  const currentTime = now();
  if (!Number.isSafeInteger(currentTime) || currentTime <= 0) {
    throw formError('MEDICATION_TIME_INVALID', 'Current time is invalid.');
  }
  const dueAt = currentTime + reminderMinutes * 60 * 1000;
  const escalationDelayMs = escalationMinutes * 60 * 1000;
  if (!Number.isSafeInteger(dueAt) || !Number.isSafeInteger(escalationDelayMs)) {
    throw formError('MEDICATION_TIME_INVALID', 'Medication reminder time is invalid.');
  }
  const id = createId();
  if (typeof id !== 'string' || !REMINDER_ID_PATTERN.test(id)) {
    throw formError('MEDICATION_ID_INVALID', 'A secure reminder identifier could not be created.');
  }
  return {
    id,
    medicationId: reference,
    robotDeviceId: deviceId,
    dueAt,
    escalationDelayMs
  };
}

export function canAcknowledgeMedicationReminder(reminder) {
  return [
    MEDICATION_REMINDER_STATUS.reminderAccepted,
    MEDICATION_REMINDER_STATUS.awaitingAcknowledgement,
    MEDICATION_REMINDER_STATUS.escalationDue,
    MEDICATION_REMINDER_STATUS.escalationAccepted
  ].includes(reminder?.status);
}
