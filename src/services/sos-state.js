import { storage } from './storage';
import { logger } from '../utils/logger';
import { runLocalUserDataMutation } from './local-mutation-coordinator';
import { createAuthenticationNonce } from '../utils/session-token';

export const LAST_SOS_STATUS_KEY = 'veryloving.lastSOSStatus';
export const PENDING_SOS_ATTEMPT_KEY = 'veryloving.pendingSOSAttempt';
const PENDING_SOS_MAX_AGE_MS = 15 * 60 * 1000;
const SOS_ATTEMPT_VERSION = 2;
let pendingSOSMutationQueue = Promise.resolve();
const acceptedSOSAttemptKeys = new Set();

export const SOS_ATTEMPT_STATUS = Object.freeze({
  pending: 'pending',
  accepted: 'accepted'
});

export const SOS_STATUS_TRANSLATION_KEYS = Object.freeze({
  dialer_opened: 'releaseCritical.sosDialerOpened',
  cancelled: 'releaseCritical.sosCancelled',
  contact_required: 'releaseCritical.sosContactRequired',
  dialer_failed: 'releaseCritical.sosDialerFailed',
  unknown: 'releaseCritical.sosUnknown'
});

export function createSOSStatus(result, { now = Date.now, failed = false } = {}) {
  return {
    version: 2,
    status: failed ? 'dialer_failed' : result?.status || 'unknown',
    backendStatus: result?.backendStatus || 'disabled',
    backendReceiptId: typeof result?.backendReceipt?.id === 'string'
      ? result.backendReceipt.id
      : null,
    recordedAt: now()
  };
}

export function sosStatusTranslationKey(status) {
  return SOS_STATUS_TRANSLATION_KEYS[status] || SOS_STATUS_TRANSLATION_KEYS.unknown;
}

export async function saveSOSStatus(
  result,
  { storageImpl = storage, now = Date.now, failed = false } = {}
) {
  const snapshot = createSOSStatus(result, { now, failed });
  await runLocalUserDataMutation(() => storageImpl.setJSON(LAST_SOS_STATUS_KEY, snapshot));
  return snapshot;
}

export async function loadSOSStatus({ storageImpl = storage } = {}) {
  const snapshot = await storageImpl.getJSON(LAST_SOS_STATUS_KEY, null);
  if (!snapshot || ![1, 2].includes(snapshot.version) || !snapshot.status || !Number.isFinite(snapshot.recordedAt)) {
    return null;
  }
  return snapshot;
}

function contactFingerprint(contactIds) {
  return [...new Set((contactIds || []).filter(Boolean))].sort().join('|');
}

function attemptStatus(attempt) {
  // Version 1 records predate explicit delivery state and always represented
  // an indeterminate/pending backend attempt.
  if (attempt?.version === 1) return SOS_ATTEMPT_STATUS.pending;
  return attempt?.status;
}

export function loadOrCreatePendingSOSAttempt({
  accountId,
  contactIds,
  storageImpl = storage,
  now = Date.now,
  createId = createAuthenticationNonce
}) {
  if (!accountId) throw new Error('An authenticated account is required for connected SOS delivery.');
  const fingerprint = contactFingerprint(contactIds);
  if (!fingerprint) throw new Error('At least one synchronized emergency contact is required.');
  const operation = pendingSOSMutationQueue.catch(() => {}).then(async () => {
    const current = await storageImpl.getJSON(PENDING_SOS_ATTEMPT_KEY, null);
    const timestamp = now();
    if (
      [1, SOS_ATTEMPT_VERSION].includes(current?.version)
      && attemptStatus(current) === SOS_ATTEMPT_STATUS.pending
      && !acceptedSOSAttemptKeys.has(current.idempotencyKey)
      && current.accountId === accountId
      && current.contactFingerprint === fingerprint
      && typeof current.idempotencyKey === 'string'
      && Number.isFinite(current.createdAt)
      && timestamp - current.createdAt >= 0
      && timestamp - current.createdAt <= PENDING_SOS_MAX_AGE_MS
    ) return current;
    const next = {
      version: SOS_ATTEMPT_VERSION,
      status: SOS_ATTEMPT_STATUS.pending,
      accountId,
      contactFingerprint: fingerprint,
      idempotencyKey: createId(),
      createdAt: timestamp
    };
    await runLocalUserDataMutation(() => storageImpl.setJSON(PENDING_SOS_ATTEMPT_KEY, next));
    // There is only one durable SOS attempt slot. Once its replacement is
    // safely persisted, no older process-local acceptance guard is needed.
    acceptedSOSAttemptKeys.clear();
    return next;
  });
  pendingSOSMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function markSOSAttemptAccepted(
  idempotencyKey,
  { storageImpl = storage, now = Date.now } = {}
) {
  if (!idempotencyKey) return Promise.resolve(false);
  const operation = pendingSOSMutationQueue.catch(() => {}).then(async () => {
    // The server receipt is authoritative even if local storage becomes
    // unreadable at this exact moment. Guard the accepted key before any
    // storage access so a transient read failure cannot make it reusable in
    // this process once storage recovers.
    acceptedSOSAttemptKeys.add(idempotencyKey);
    const current = await storageImpl.getJSON(PENDING_SOS_ATTEMPT_KEY, null);
    if (!current || current.idempotencyKey !== idempotencyKey) return false;

    const accepted = {
      ...current,
      version: SOS_ATTEMPT_VERSION,
      status: SOS_ATTEMPT_STATUS.accepted,
      acceptedAt: now()
    };
    try {
      await runLocalUserDataMutation(() => storageImpl.setJSON(PENDING_SOS_ATTEMPT_KEY, accepted));
    } catch (error) {
      // Removing the pending record is a safe fallback: the next activation
      // will create a new key. Preserve the original persistence error so the
      // caller can log degraded bookkeeping without masking SOS acceptance.
      await runLocalUserDataMutation(() => storageImpl.remove(PENDING_SOS_ATTEMPT_KEY)).catch(() => {});
      throw error;
    }
    return true;
  });
  pendingSOSMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function clearPendingSOSAttempt(idempotencyKey, { storageImpl = storage } = {}) {
  const operation = pendingSOSMutationQueue.catch(() => {}).then(async () => {
    const current = await storageImpl.getJSON(PENDING_SOS_ATTEMPT_KEY, null);
    if (!current || current.idempotencyKey !== idempotencyKey) return false;
    await runLocalUserDataMutation(() => storageImpl.remove(PENDING_SOS_ATTEMPT_KEY));
    acceptedSOSAttemptKeys.delete(idempotencyKey);
    return true;
  });
  pendingSOSMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function runAndPersistSOS(operation, options = {}) {
  try {
    const result = await operation();
    await saveSOSStatus(result, options).catch((error) => {
      (options.loggerImpl || logger).warn('[SOS] Could not persist the latest local SOS status', {
        name: error?.name
      });
    });
    return result;
  } catch (error) {
    await saveSOSStatus({
      backendStatus: error?.backendStatus,
      backendReceipt: error?.backendReceipt
    }, { ...options, failed: true }).catch(() => {});
    throw error;
  }
}
