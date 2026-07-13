import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import { AUTH_STORAGE_KEYS } from '../context/AuthContext';
import { CONVERSATION_HISTORY_KEY, loadConversationHistory } from './conversation-history';
import {
  deleteLocalUserStores,
  hasLocalUserDataDeletionWarnings,
  LOCAL_USER_DATA_PREFIX
} from './local-user-data';
import { RATIONALE_PREFIX } from './permissions';
import { storage } from './storage';
import { translate } from '../i18n/core';
import { purgeVoiceAudioCache } from './voice-audio-cache';
import { purgeOfflineMapCache } from './mapbox';
import { logger } from '../utils/logger';

export const PRIVACY_POLICY_URL = 'https://veryloving.ai/privacy';
export { hasLocalUserDataDeletionWarnings };

async function readJSONSecureStore(key) {
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseStoredValue(raw) {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function collectLocalStorageSnapshot() {
  const keys = (await storage.keys()).filter(
    (key) => key.startsWith(LOCAL_USER_DATA_PREFIX) && key !== CONVERSATION_HISTORY_KEY
  );
  const entries = await Promise.all(keys.map(async (key) => [key, parseStoredValue(await storage.getRaw(key))]));
  return Object.fromEntries(entries);
}

export async function buildUserDataExport() {
  const localStorage = await collectLocalStorageSnapshot();
  const conversations = await loadConversationHistory();
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: {
      name: 'VeryLoving',
      privacyPolicy: PRIVACY_POLICY_URL
    },
    account: await readJSONSecureStore(AUTH_STORAGE_KEYS.user),
    settings: localStorage['veryloving.settings'] || null,
    emergencyContacts: localStorage['veryloving.emergencyContacts'] || [],
    conversations,
    localStorage,
    permissionRationales: Object.fromEntries(
      Object.entries(localStorage).filter(([key]) => key.startsWith(RATIONALE_PREFIX))
    ),
    localStorageKeys: Object.keys(localStorage).filter((key) => key !== CONVERSATION_HISTORY_KEY)
  };
}

export async function exportUserData() {
  const data = await buildUserDataExport();
  const filename = `veryloving-data-${Date.now()}.json`;
  const file = new File(Paths.cache, filename);
  file.write(JSON.stringify(data, null, 2));
  try {
    if (!await Sharing.isAvailableAsync()) {
      throw new Error('File sharing is unavailable on this device.');
    }
    await Sharing.shareAsync(file.uri, {
      dialogTitle: translate('privacy.exportTitle'),
      mimeType: 'application/json',
      UTI: 'public.json'
    });
    return file.uri;
  } finally {
    if (file.exists) file.delete();
  }
}

export async function deleteLocalUserData({ localMutationLockHeld = false } = {}) {
  const result = await deleteLocalUserStores({
    mutationLockHeld: localMutationLockHeld,
    purgeArtifacts: async () => {
      const results = await Promise.allSettled([
        purgeVoiceAudioCache(),
        purgeOfflineMapCache()
      ]);
      return {
        failures: results.filter((item) => item.status === 'rejected').length
      };
    }
  });
  const artifactFailures = Number(result?.artifactCleanup?.failures) || 0;
  if (hasLocalUserDataDeletionWarnings(result)) {
    logger.warn('[Privacy] Local deletion completed with residual artifact warnings', {
      drainFailures: result?.drainFailures || 0,
      artifactFailures
    });
  }
  return result;
}

export async function deleteAllUserData(options) {
  const result = await deleteLocalUserData(options);
  await Promise.all([
    SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.token),
    SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.user),
    SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.onboarding)
  ]);
  return result;
}
