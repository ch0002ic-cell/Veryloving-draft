import { drainConversationHistoryMutations } from './conversation-history';
import { drainOfflineMessageQueueMutations } from './offline-message-queue';
import { lockAndDrainLocalUserDataMutations } from './local-mutation-coordinator';
import {
  DEFAULT_SETTINGS,
  drainSettingsMutations,
  loadSettings,
  SETTINGS_KEY
} from './settings-store';
import { storage } from './storage';

export const LOCAL_USER_DATA_PREFIX = 'veryloving.';
export const SIGNED_OUT_TOMBSTONE_KEY = 'veryloving.auth.signedOut';

export function hasLocalUserDataDeletionWarnings(result) {
  return Boolean(
    Number(result?.drainFailures)
    || Number(result?.artifactCleanup?.failures)
    || Number(result?.secureStoreFailures)
    || Number(result?.localStoreFailures)
    || Number(result?.remoteDeletionFailures)
    || Number(result?.tombstoneFailures)
    || Number(result?.languagePreservationFailures)
    || Number(result?.notificationFailures)
    || Number(result?.encryptionKeyFailures)
  );
}

export async function deleteLocalUserStores({
  preserveSignedOutTombstone = false,
  preserveLanguage = false,
  purgeArtifacts,
  mutationLockHeld = false
} = {}) {
  let releaseMutations;
  if (!mutationLockHeld) releaseMutations = await lockAndDrainLocalUserDataMutations();

  try {
    // The shared lock blocks new durable writers. These helpers only drain the
    // services' private serialization queues; enqueueing a clear write here
    // would be rejected while the deletion lock is held.
    const drainResults = await Promise.allSettled([
      drainConversationHistoryMutations(),
      drainOfflineMessageQueueMutations(),
      drainSettingsMutations()
    ]);
    let retainedLanguage = DEFAULT_SETTINGS.language;
    let languagePreservationFailures = 0;
    if (preserveLanguage) {
      try {
        retainedLanguage = (await loadSettings()).language;
      } catch {
        languagePreservationFailures += 1;
      }
    }
    // Artifact cleanup may need metadata stored under the VeryLoving prefix
    // (for example, the native Mapbox offline-pack name), so run it before the
    // final key sweep. Native artifact failures are reported separately but must
    // not prevent app storage or credentials from being deleted.
    let artifactCleanup = null;
    try {
      artifactCleanup = await purgeArtifacts?.();
    } catch (error) {
      artifactCleanup = { failures: 1, errorName: error?.name || 'Error' };
    }
    const localKeys = (await storage.keys()).filter((key) => (
      key.startsWith(LOCAL_USER_DATA_PREFIX)
      && (!preserveSignedOutTombstone || key !== SIGNED_OUT_TOMBSTONE_KEY)
    ));
    await storage.removeMany(localKeys);
    if (preserveLanguage) {
      try {
        // The cleanup lock is intentionally still held. Write this normalized,
        // device-wide preference directly so no account-specific settings can
        // race back into storage during sign-out.
        await storage.setJSON(SETTINGS_KEY, { ...DEFAULT_SETTINGS, language: retainedLanguage });
      } catch {
        languagePreservationFailures += 1;
      }
    }
    return {
      drainFailures: drainResults.filter((result) => result.status === 'rejected').length,
      artifactCleanup,
      languagePreservationFailures
    };
  } finally {
    releaseMutations?.();
  }
}
