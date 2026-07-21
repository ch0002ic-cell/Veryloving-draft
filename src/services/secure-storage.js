import { logger } from '../utils/logger';
import { isExpoGoRuntime, runtimePlatformOS } from '../utils/runtime-environment';

export const SECURE_STORAGE_MEMORY_REASON = Object.freeze({
  EXPO_GO: 'expo-go',
  IOS_SIMULATOR: 'ios-simulator',
  IOS_PREFLIGHT_FAILED: 'ios-preflight-failed'
});

export function isExpectedEphemeralStorageReason(reason) {
  return reason === SECURE_STORAGE_MEMORY_REASON.EXPO_GO
    || reason === SECURE_STORAGE_MEMORY_REASON.IOS_SIMULATOR;
}

function createMemoryBackend(memory) {
  return {
    getItemAsync: async (key) => memory.get(key) ?? null,
    setItemAsync: async (key, value) => {
      memory.set(key, value);
    },
    deleteItemAsync: async (key) => {
      memory.delete(key);
    }
  };
}

function normalizeSecureStoreModule(secureStoreModule) {
  const candidates = [secureStoreModule, secureStoreModule?.default];
  const backend = candidates.find((candidate) => candidate
    && typeof candidate.getItemAsync === 'function'
    && typeof candidate.setItemAsync === 'function'
    && typeof candidate.deleteItemAsync === 'function');
  if (backend) return backend;

  const error = new Error('The native secure-storage module is unavailable in this build.');
  error.code = 'SECURE_STORAGE_MODULE_INVALID';
  throw error;
}

function normalizeApplicationModule(applicationModule) {
  const candidates = [applicationModule, applicationModule?.default];
  const Application = candidates.find((candidate) => candidate
    && typeof candidate.getIosApplicationReleaseTypeAsync === 'function'
    && Number.isFinite(candidate.ApplicationReleaseType?.SIMULATOR));
  if (Application) return Application;

  const error = new Error('The native application metadata module is unavailable in this build.');
  error.code = 'APPLICATION_METADATA_MODULE_INVALID';
  throw error;
}

/**
 * Classify unsupported hosts before expo-secure-store is evaluated. Unsigned
 * simulator artifacts do not carry the application identifier entitlement
 * required by Keychain; importing SecureStore and catching its later rejection
 * is too late to prevent the native warning.
 */
export async function detectSecureStorageMemoryReason({
  isExpoGo,
  platformOS,
  loadApplication
}) {
  if (isExpoGo()) return SECURE_STORAGE_MEMORY_REASON.EXPO_GO;
  if (platformOS !== 'ios') return null;

  try {
    const Application = normalizeApplicationModule(await loadApplication());
    const releaseType = await Application.getIosApplicationReleaseTypeAsync();
    return releaseType === Application.ApplicationReleaseType?.SIMULATOR
      ? SECURE_STORAGE_MEMORY_REASON.IOS_SIMULATOR
      : null;
  } catch {
    // Fail closed on an iOS artifact whose entitlement preflight cannot run.
    // This prevents a missing/stale native metadata module from exposing the
    // same Keychain error the preflight is intended to avoid.
    return SECURE_STORAGE_MEMORY_REASON.IOS_PREFLIGHT_FAILED;
  }
}

export function createSecureStorage({
  isExpoGo = isExpoGoRuntime,
  platformOS = runtimePlatformOS,
  loadApplication = () => import('expo-application'),
  loadSecureStore = () => import('expo-secure-store'),
  onMemoryMode = () => {}
} = {}) {
  const memory = new Map();
  const memoryBackend = createMemoryBackend(memory);
  let memoryReason = isExpoGo()
    ? SECURE_STORAGE_MEMORY_REASON.EXPO_GO
    : null;
  let preflightPromise = null;
  let nativeBackendPromise = null;
  let memoryModeLogged = false;

  const enterMemoryMode = (reason) => {
    memoryReason = reason;
    if (!memoryModeLogged) {
      memoryModeLogged = true;
      onMemoryMode(reason);
    }
  };

  // Expo Go's host binary does not carry VeryLoving's Keychain access group.
  // Select memory before the first operation so expo-secure-store is never
  // evaluated and cannot emit an entitlement warning during module loading.
  if (memoryReason) enterMemoryMode(memoryReason);

  const ensureStorageMode = () => {
    if (memoryReason) return Promise.resolve(memoryReason);
    if (!preflightPromise) {
      const attempt = detectSecureStorageMemoryReason({
        isExpoGo,
        platformOS: typeof platformOS === 'function' ? platformOS() : platformOS,
        loadApplication
      }).then((reason) => {
        if (reason) enterMemoryMode(reason);
        return reason;
      });
      preflightPromise = attempt;
      attempt.catch(() => {
        // The detector currently fails closed, but retain retry behavior if a
        // future platform preflight needs to surface a transient rejection.
        if (preflightPromise === attempt) preflightPromise = null;
      });
    }
    return preflightPromise;
  };

  const getNativeBackend = () => {
    if (!nativeBackendPromise) {
      const attempt = Promise.resolve()
        .then(loadSecureStore)
        .then(normalizeSecureStoreModule);
      nativeBackendPromise = attempt;
      attempt.catch(() => {
        // A rebuilt development client can retry a stale or missing native
        // module without retaining a permanently rejected import promise.
        if (nativeBackendPromise === attempt) nativeBackendPromise = null;
      });
    }
    return nativeBackendPromise;
  };

  const invoke = async (method, args) => {
    if (memoryReason) return memoryBackend[method](...args);
    await ensureStorageMode();
    if (memoryReason) return memoryBackend[method](...args);
    const nativeBackend = await getNativeBackend();
    return nativeBackend[method](...args);
  };

  return {
    get isVolatile() {
      return Boolean(memoryReason);
    },
    get volatileReason() {
      return memoryReason;
    },
    async getItemAsync(key, options) {
      return invoke('getItemAsync', [key, options]);
    },
    async setItemAsync(key, value, options) {
      return invoke('setItemAsync', [key, value, options]);
    },
    async deleteItemAsync(key, options) {
      return invoke('deleteItemAsync', [key, options]);
    }
  };
}

export const secureStorage = createSecureStorage({
  onMemoryMode: (reason) => {
    logger.info(
      reason === SECURE_STORAGE_MEMORY_REASON.EXPO_GO
        ? '[SecureStorage] Expo Go detected; secure storage is using process memory and resets on reload'
        : reason === SECURE_STORAGE_MEMORY_REASON.IOS_SIMULATOR
          ? '[SecureStorage] iOS Simulator detected; secure storage is using process memory and resets on reload'
          : '[SecureStorage] iOS entitlement preflight unavailable; secure storage is using process memory and resets on reload'
    );
  }
});
