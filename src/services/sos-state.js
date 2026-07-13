import { storage } from './storage';
import { logger } from '../utils/logger';
import { runLocalUserDataMutation } from './local-mutation-coordinator';

export const LAST_SOS_STATUS_KEY = 'veryloving.lastSOSStatus';
export const LAST_SOS_ATTEMPT_TITLE = 'Last SOS attempt';

export const SOS_STATUS_MESSAGES = Object.freeze({
  dialer_opened: 'Phone dialer opened; call not confirmed.',
  cancelled: 'Cancelled; no call was placed.',
  contact_required: 'No emergency contact was available; no call was placed.',
  dialer_failed: 'The phone dialer could not open; no call was placed.',
  unknown: 'The last SOS attempt could not be confirmed.'
});

export function createSOSStatus(result, { now = Date.now, failed = false } = {}) {
  return {
    version: 1,
    status: failed ? 'dialer_failed' : result?.status || 'unknown',
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
  if (!snapshot || snapshot.version !== 1 || !snapshot.status || !Number.isFinite(snapshot.recordedAt)) {
    return null;
  }
  return snapshot;
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
    await saveSOSStatus(null, { ...options, failed: true }).catch(() => {});
    throw error;
  }
}
