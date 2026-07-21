import AsyncStorage from '@react-native-async-storage/async-storage';
import nacl from 'tweetnacl';
import { createEncryptedStorage } from './encrypted-storage';
import {
  isExpectedEphemeralStorageReason,
  secureStorage
} from './secure-storage';

const isNodeRuntime = typeof process !== 'undefined' && process?.release?.name === 'node';
const nodeKeyMemory = new Map();
const nodeKeyStore = {
  getItemAsync: async (key) => nodeKeyMemory.get(key) ?? null,
  setItemAsync: async (key, value) => { nodeKeyMemory.set(key, value); },
  deleteItemAsync: async (key) => { nodeKeyMemory.delete(key); }
};

async function secureRandomBytes(length) {
  if (isNodeRuntime) return nacl.randomBytes(length);
  const Crypto = await import('expo-crypto');
  return Crypto.getRandomBytesAsync(length);
}

const encryptedBackend = createEncryptedStorage({
  backend: AsyncStorage,
  keyStore: isNodeRuntime ? nodeKeyStore : secureStorage,
  randomBytes: secureRandomBytes,
  recoverAuthenticationFailure: ({ storageKey }) => !isNodeRuntime
    && storageKey.startsWith('veryloving.')
    && isExpectedEphemeralStorageReason(secureStorage.volatileReason)
});

export const storage = {
  async keys() {
    return encryptedBackend.getAllKeys();
  },
  async getJSON(key, fallback) {
    const raw = await encryptedBackend.getItem(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  },
  async getRaw(key) {
    return encryptedBackend.getItem(key);
  },
  async setRaw(key, value) {
    await encryptedBackend.setItem(key, value);
  },
  async setJSON(key, value) {
    await encryptedBackend.setItem(key, JSON.stringify(value));
  },
  async remove(key) {
    await encryptedBackend.removeItem(key);
  },
  async removeMany(keys) {
    if (!keys.length) return;
    await encryptedBackend.multiRemove(keys);
  },
  async rotateEncryptionKeyAfterPurge() {
    await encryptedBackend.rotateKeyAfterPurge();
  }
};
