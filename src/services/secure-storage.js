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
  onVolatileFallback = () => {}
} = {}) {
  const memory = new Map();
  const memoryBackend = createMemoryBackend(memory);
  let nativeBackend = null;
  let volatile = false;
  let fallbackLogged = false;

  const switchToMemory = (error) => {
    if (!isExpoGo()) throw error;
    volatile = true;
    if (!fallbackLogged) {
      fallbackLogged = true;
      onVolatileFallback(error);
    }
    return memoryBackend;
  };

  const invoke = async (method, args) => {
    if (volatile) return memoryBackend[method](...args);
    try {
      if (!nativeBackend) nativeBackend = loadSecureStore();
      return await nativeBackend[method](...args);
    } catch (error) {
      const fallback = switchToMemory(error);
      return fallback[method](...args);
    }
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
  onVolatileFallback: (error) => {
    logger.info('[SecureStorage] Native storage is unavailable in Expo Go; using process memory', {
      errorCode: error?.code || error?.name || 'SECURE_STORAGE_UNAVAILABLE'
    });
  }
});
