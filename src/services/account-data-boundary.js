import { clearEmergencyContactCache } from './emergency-contact-store';
import { clearSavedPlaces } from './saved-place-store';
import { clearMedicalEmergencyProfile } from './medical-profile-store';
import { clearRobotPairingCredentials } from './robot-pairing-credential-store';
import { deleteLocalUserStores } from './local-user-data';
import { runLocalUserDataMutation } from './local-mutation-coordinator';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  persistSettings
} from './settings-store';
import { storage } from './storage';

export const ACCOUNT_DATA_OWNER_KEY = 'veryloving.accountDataOwner.v1';
export const ACCOUNT_DATA_OWNER_VERSION = 1;

let boundaryQueue = Promise.resolve();

async function purgeAccountArtifacts() {
  const [artifactCleanup, mapbox, voiceAudio] = await Promise.all([
    import('./privacy-artifact-cleanup'),
    import('./mapbox'),
    import('./voice-audio-cache')
  ]);
  return artifactCleanup.purgePrivacyArtifacts([
    voiceAudio.purgeVoiceAudioCache,
    mapbox.purgeOfflineMapCache
  ]);
}

async function disableCapybearReminder() {
  const reminder = await import('./capybear-reminder');
  return reminder.setCapybearReminderEnabled(false);
}

function normalizedAccountId(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 512 ? normalized : null;
}

export function parseAccountDataOwner(value) {
  if (
    value?.version !== ACCOUNT_DATA_OWNER_VERSION
    || !normalizedAccountId(value.accountId)
  ) return null;
  return {
    version: ACCOUNT_DATA_OWNER_VERSION,
    accountId: normalizedAccountId(value.accountId),
    boundAt: Number.isFinite(value.boundAt) ? value.boundAt : null
  };
}

/**
 * Establishes the only account allowed to hydrate device-local user data.
 *
 * A rejected refresh deliberately leaves offline data in place so the same
 * account can recover it after reauthentication. Before a different account is
 * published, this boundary removes every VeryLoving user-data key and the
 * secure emergency-contact cache. A missing/malformed owner is treated as
 * untrusted legacy state and is also cleared rather than assigned implicitly.
 * The UI language is a device preference, so it is the sole setting carried
 * across the boundary; account-specific voice, mode, and safety preferences
 * return to defaults.
 */
export function ensureAccountDataOwner(accountId, {
  clearEmergencyContactsImpl = clearEmergencyContactCache,
  clearSavedPlacesImpl = clearSavedPlaces,
  clearMedicalProfileImpl = clearMedicalEmergencyProfile,
  clearRobotCredentialsImpl = clearRobotPairingCredentials,
  disableReminderImpl = disableCapybearReminder,
  deleteLocalUserStoresImpl = deleteLocalUserStores,
  loadSettingsImpl = loadSettings,
  now = Date.now,
  persistSettingsImpl = persistSettings,
  purgeArtifactsImpl = purgeAccountArtifacts,
  storageImpl = storage
} = {}) {
  const nextAccountId = normalizedAccountId(accountId);
  if (!nextAccountId) {
    const error = new Error('A valid authenticated account is required to bind local user data.');
    error.code = 'LOCAL_ACCOUNT_REQUIRED';
    return Promise.reject(error);
  }

  const operation = boundaryQueue.catch(() => {}).then(async () => {
    const currentOwner = parseAccountDataOwner(
      await storageImpl.getJSON(ACCOUNT_DATA_OWNER_KEY, null)
    );
    if (currentOwner?.accountId === nextAccountId) {
      return { changed: false, accountId: nextAccountId, warnings: 0 };
    }

    // Read and normalize before deletion. Persist only the language afterward;
    // no other previous-account preference may cross this boundary.
    const currentSettings = await loadSettingsImpl();
    const language = currentSettings.language;
    let reminderWarning = 0;
    try {
      await disableReminderImpl();
    } catch {
      reminderWarning = 1;
    }
    let localDeletion;
    try {
      // Keep the non-sensitive auth tombstone in place until AuthContext has
      // durably installed a replacement real session. This prevents a
      // residual Keychain item from resurrecting an old account if the process
      // dies during an account switch or while entering volatile demo mode.
      localDeletion = await deleteLocalUserStoresImpl({
        preserveSignedOutTombstone: true,
        purgeArtifacts: purgeArtifactsImpl
      });
    } catch (cause) {
      const error = new Error('Local account data could not be isolated for sign-in.');
      error.code = 'LOCAL_ACCOUNT_BOUNDARY_FAILED';
      error.cause = cause;
      throw error;
    }
    // The secure cache is independently account-bound, so a Keychain cleanup
    // warning cannot expose it to the next account. Perform it only after the
    // required local sweep succeeds to avoid needless data loss on retry.
    let secureContactWarning = 0;
    try {
      await clearEmergencyContactsImpl({ nextAccountId });
    } catch {
      secureContactWarning = 1;
    }
    let savedPlacesWarning = 0;
    try {
      await clearSavedPlacesImpl();
    } catch {
      savedPlacesWarning = 1;
    }
    let medicalProfileWarning = 0;
    try {
      await clearMedicalProfileImpl();
    } catch {
      medicalProfileWarning = 1;
    }
    let robotCredentialsWarning = 0;
    try {
      await clearRobotCredentialsImpl();
    } catch {
      robotCredentialsWarning = 1;
    }

    await persistSettingsImpl({ ...DEFAULT_SETTINGS, language });
    const owner = {
      version: ACCOUNT_DATA_OWNER_VERSION,
      accountId: nextAccountId,
      boundAt: now()
    };
    await runLocalUserDataMutation(() => storageImpl.setJSON(ACCOUNT_DATA_OWNER_KEY, owner));

    return {
      changed: true,
      accountId: nextAccountId,
      warnings: secureContactWarning
        + savedPlacesWarning
        + medicalProfileWarning
        + robotCredentialsWarning
        + reminderWarning
        + Number(localDeletion?.drainFailures || 0)
        + Number(localDeletion?.artifactCleanup?.failures || 0)
    };
  });
  boundaryQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
