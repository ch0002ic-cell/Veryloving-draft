import { storage } from './storage';
import { logger } from '../utils/logger';
import { runLocalUserDataMutation } from './local-mutation-coordinator';
import { createAuthenticationNonce } from '../utils/session-token';

export const LAST_SOS_STATUS_KEY = 'veryloving.lastSOSStatus';
export const PENDING_SOS_ATTEMPT_KEY = 'veryloving.pendingSOSAttempt';
export const LAST_SOS_ATTEMPT_TITLE = 'Last SOS attempt';
const PENDING_SOS_MAX_AGE_MS = 15 * 60 * 1000;
let pendingSOSMutationQueue = Promise.resolve();

export const SOS_STATUS_MESSAGES = Object.freeze({
  dialer_opened: 'Phone dialer opened; call not confirmed.',
  cancelled: 'Cancelled; no call was placed.',
  contact_required: 'No emergency contact was available; no call was placed.',
  dialer_failed: 'The phone dialer could not open; no call was placed.',
  unknown: 'The last SOS attempt could not be confirmed.'
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

export function sosStatusMessage(status) {
  return SOS_STATUS_MESSAGES[status] || SOS_STATUS_MESSAGES.unknown;
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
      current?.version === 1
      && current.accountId === accountId
      && current.contactFingerprint === fingerprint
      && typeof current.idempotencyKey === 'string'
      && Number.isFinite(current.createdAt)
      && timestamp - current.createdAt >= 0
      && timestamp - current.createdAt <= PENDING_SOS_MAX_AGE_MS
    ) return current;
    const next = {
      version: 1,
      accountId,
      contactFingerprint: fingerprint,
      idempotencyKey: createId(),
      createdAt: timestamp
    };
    await runLocalUserDataMutation(() => storageImpl.setJSON(PENDING_SOS_ATTEMPT_KEY, next));
    return next;
  });
  pendingSOSMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function clearPendingSOSAttempt(idempotencyKey, { storageImpl = storage } = {}) {
  const operation = pendingSOSMutationQueue.catch(() => {}).then(async () => {
    const current = await storageImpl.getJSON(PENDING_SOS_ATTEMPT_KEY, null);
    if (!current || current.idempotencyKey !== idempotencyKey) return false;
    await runLocalUserDataMutation(() => storageImpl.remove(PENDING_SOS_ATTEMPT_KEY));
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
