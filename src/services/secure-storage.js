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

export function createSecureStorage({
  isExpoGo = isExpoGoRuntime,
  loadSecureStore = () => require('expo-secure-store'),
  onMemoryMode = () => {}
} = {}) {
  const memory = new Map();
  const memoryBackend = createMemoryBackend(memory);
  let nativeBackend = null;
  const volatile = Boolean(isExpoGo());

  // Expo Go's host binary does not carry VeryLoving's Keychain access group.
  // Select memory before the first operation so expo-secure-store is never
  // evaluated and cannot emit an entitlement warning during module loading.
  if (volatile) onMemoryMode();

  const invoke = async (method, args) => {
    if (volatile) return memoryBackend[method](...args);
    if (!nativeBackend) nativeBackend = loadSecureStore();
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
