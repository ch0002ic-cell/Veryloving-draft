import { logger } from '../utils/logger';
import { isExpoGoRuntime } from '../utils/runtime-environment';

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

export function createSecureStorage({
  isExpoGo = isExpoGoRuntime,
  loadSecureStore = () => import('expo-secure-store'),
  onMemoryMode = () => {}
} = {}) {
  const memory = new Map();
  const memoryBackend = createMemoryBackend(memory);
  let nativeBackendPromise = null;
  const volatile = Boolean(isExpoGo());

  // Expo Go's host binary does not carry VeryLoving's Keychain access group.
  // Select memory before the first operation so expo-secure-store is never
  // evaluated and cannot emit an entitlement warning during module loading.
  if (volatile) onMemoryMode();

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
    if (volatile) return memoryBackend[method](...args);
    const nativeBackend = await getNativeBackend();
    return nativeBackend[method](...args);
  };

  return {
    get isVolatile() {
      return volatile;
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
  onMemoryMode: () => {
    logger.info('[SecureStorage] Expo Go detected; secure storage is using process memory and resets on reload');
  }
});
