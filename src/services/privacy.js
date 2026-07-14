import { File, Paths } from 'expo-file-system';
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
import { purgePrivacyArtifacts } from './privacy-artifact-cleanup';
import {
  clearEmergencyContactCache,
  loadEmergencyContactCache
} from './emergency-contact-store';
import { config } from '../utils/config';
import { deleteRemoteUserData, fetchRemoteUserData } from './safety-api';
import { secureStorage } from './secure-storage';
import { parseSessionEnvelope } from '../utils/session-envelope';

export const PRIVACY_POLICY_URL = 'https://veryloving.ai/privacy';
export { hasLocalUserDataDeletionWarnings };

async function readJSONSecureStore(key) {
  const raw = await secureStorage.getItemAsync(key);
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

export async function buildUserDataExport({ accessToken } = {}) {
  const localStorage = await collectLocalStorageSnapshot();
  const conversations = await loadConversationHistory();
  const session = parseSessionEnvelope(
    await secureStorage.getItemAsync(AUTH_STORAGE_KEYS.session),
    { allowExpiredAccess: true, skewSeconds: 0 }
  );
  // Legacy profile support exists only for exports made before AuthContext has
  // completed its one-time atomic-envelope migration.
  const account = session?.user || await readJSONSecureStore(AUTH_STORAGE_KEYS.user);
  const emergencyContacts = account?.id
    ? await loadEmergencyContactCache(account.id).catch(() => [])
    : [];
  const remoteData = config.safetyBackendEnabled && accessToken
    ? await fetchRemoteUserData(accessToken)
    : null;
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: {
      name: 'VeryLoving',
      privacyPolicy: PRIVACY_POLICY_URL
    },
    account,
    settings: localStorage['veryloving.settings'] || null,
    emergencyContacts,
    conversations,
    remoteData,
    localStorage,
    permissionRationales: Object.fromEntries(
      Object.entries(localStorage).filter(([key]) => key.startsWith(RATIONALE_PREFIX))
    ),
    localStorageKeys: Object.keys(localStorage).filter((key) => key !== CONVERSATION_HISTORY_KEY)
  };
}

export async function exportUserData(options) {
  const data = await buildUserDataExport(options);
  const filename = `veryloving-data-${Date.now()}.json`;
  const file = new File(Paths.cache, filename);
  try {
    // Keep creation, sharing, and cleanup in one guarded scope. Native writes
    // can fail after creating a partial file, which must not be left in cache.
    file.write(JSON.stringify(data, null, 2));
    if (!await Sharing.isAvailableAsync()) {
      throw new Error('File sharing is unavailable on this device.');
    }
    await Sharing.shareAsync(file.uri, {
      dialogTitle: translate('privacy.exportTitle'),
      mimeType: 'application/json',
      UTI: 'public.json'
    });
    return true;
  } finally {
    try {
      if (file.exists) file.delete();
    } catch (cleanupError) {
      // A cleanup failure must not turn a completed native share into a false
      // failure. Record only non-sensitive context for a subsequent audit.
      logger.warn('[Privacy] Could not remove the temporary export file', {
        name: cleanupError?.name || 'FileCleanupError'
      });
    }
  }
}

export async function deleteLocalUserData({ localMutationLockHeld = false } = {}) {
  const [localResult, secureContactResult] = await Promise.allSettled([
    deleteLocalUserStores({
      mutationLockHeld: localMutationLockHeld,
      purgeArtifacts: () => purgePrivacyArtifacts([
        purgeVoiceAudioCache,
        purgeOfflineMapCache
      ])
    }),
    clearEmergencyContactCache()
  ]);
  if (localResult.status === 'rejected') throw localResult.reason;
  const result = {
    ...localResult.value,
    secureStoreFailures: secureContactResult.status === 'rejected' ? 1 : 0
  };
  const artifactFailures = Number(result?.artifactCleanup?.failures) || 0;
  if (hasLocalUserDataDeletionWarnings(result)) {
    logger.warn('[Privacy] Local deletion completed with residual artifact warnings', {
      drainFailures: result?.drainFailures || 0,
      artifactFailures
    });
  }
  return result;
}

export async function deleteAllUserData({ accessToken, ...options } = {}) {
  if (config.safetyBackendEnabled && accessToken) await deleteRemoteUserData(accessToken);
  const result = await deleteLocalUserData(options);
  await storage.setJSON(AUTH_STORAGE_KEYS.signedOut, {
    version: 1,
    signedOutAt: Date.now()
  });
  const secureResults = await Promise.allSettled([
    secureStorage.deleteItemAsync(AUTH_STORAGE_KEYS.session),
    secureStorage.deleteItemAsync(AUTH_STORAGE_KEYS.token),
    secureStorage.deleteItemAsync(AUTH_STORAGE_KEYS.refreshToken),
    secureStorage.deleteItemAsync(AUTH_STORAGE_KEYS.user),
    secureStorage.deleteItemAsync(AUTH_STORAGE_KEYS.onboarding)
  ]);
  const secureStoreFailures = secureResults.filter(({ status }) => status === 'rejected').length;
  if (secureStoreFailures) {
    // The non-sensitive AsyncStorage tombstone above prevents any residual
    // Keychain value from restoring the account. Report cleanup failures as a
    // warning so Settings can still finish AuthContext sign-out and clear the
    // in-memory access token instead of leaving a deleted account active.
    logger.warn('[Privacy] Account deletion left protected secure-storage artifacts', {
      secureStoreFailures
    });
  }
  return {
    ...result,
    secureStoreFailures: (Number(result.secureStoreFailures) || 0) + secureStoreFailures
  };
}
