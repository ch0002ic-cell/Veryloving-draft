import { clearConversationHistory } from './conversation-history';
import { clearOfflineMessageQueue } from './offline-message-queue';
import { storage } from './storage';

export const LOCAL_USER_DATA_PREFIX = 'veryloving.';

export async function deleteLocalUserStores({ purgeArtifacts } = {}) {
  // Drain durable mutation queues before sweeping keys. Otherwise an in-flight
  // history/queue write can recreate another account's data after logout.
  await Promise.all([
    clearConversationHistory(),
    clearOfflineMessageQueue()
  ]);
  const localKeys = (await storage.keys()).filter((key) => key.startsWith(LOCAL_USER_DATA_PREFIX));
  await storage.removeMany(localKeys);
  await purgeArtifacts?.();
}
