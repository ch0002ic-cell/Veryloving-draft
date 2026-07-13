import { drainConversationHistoryMutations } from './conversation-history';
import { drainOfflineMessageQueueMutations } from './offline-message-queue';
import { lockAndDrainLocalUserDataMutations } from './local-mutation-coordinator';
import { storage } from './storage';

export const LOCAL_USER_DATA_PREFIX = 'veryloving.';

export function hasLocalUserDataDeletionWarnings(result) {
  return Boolean(
    Number(result?.drainFailures)
    || Number(result?.artifactCleanup?.failures)
    || Number(result?.secureStoreFailures)
  );
}

export async function deleteLocalUserStores({ purgeArtifacts, mutationLockHeld = false } = {}) {
  let releaseMutations;
  if (!mutationLockHeld) releaseMutations = await lockAndDrainLocalUserDataMutations();

  try {
    // The shared lock blocks new durable writers. These helpers only drain the
    // services' private serialization queues; enqueueing a clear write here
    // would be rejected while the deletion lock is held.
    const drainResults = await Promise.allSettled([
      drainConversationHistoryMutations(),
      drainOfflineMessageQueueMutations()
    ]);
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
    const localKeys = (await storage.keys()).filter((key) => key.startsWith(LOCAL_USER_DATA_PREFIX));
    await storage.removeMany(localKeys);
    return {
      drainFailures: drainResults.filter((result) => result.status === 'rejected').length,
      artifactCleanup
    };
  } finally {
    releaseMutations?.();
  }
}
