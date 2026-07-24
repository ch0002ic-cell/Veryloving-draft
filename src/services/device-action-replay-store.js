import { storage as encryptedStorage } from './storage';
import { runLocalUserDataMutation } from './local-mutation-coordinator';

const STORAGE_KEY = 'veryloving.deviceActionReplay.v1';
const MAX_IDS = 200;

async function loadEntries(storage, now) {
  const parsed = JSON.parse(await storage.getItem(STORAGE_KEY) || '[]');
  return Array.isArray(parsed)
    ? parsed.filter((entry) => typeof entry?.id === 'string' && Number(entry.expiresAt) > now)
    : [];
}

const defaultStorage = {
  getItem: (key) => encryptedStorage.getRaw(key),
  setItem: (key, value) => encryptedStorage.setRaw(key, value)
};

export function createDeviceActionReplayStore({ storage = defaultStorage, now = Date.now } = {}) {
  let mutation = Promise.resolve();
  return {
    async has(id) {
      if (typeof id !== 'string' || !id) return true;
      await mutation.catch(() => {});
      return (await loadEntries(storage, now())).some((entry) => entry.id === id);
    },
    async reserve(id, expiresAt) {
      if (typeof id !== 'string' || !id || !Number.isFinite(expiresAt) || expiresAt <= now()) return false;
      let reserved = false;
      const previous = mutation;
      const execute = () => previous.catch(() => {}).then(async () => {
        const entries = await loadEntries(storage, now());
        if (entries.some((entry) => entry.id === id)) return;
        await storage.setItem(STORAGE_KEY, JSON.stringify([...entries, { id, expiresAt }].slice(-MAX_IDS)));
        reserved = true;
      });
      const operation = runLocalUserDataMutation(execute);
      mutation = operation.then(() => undefined, () => undefined);
      await operation;
      return reserved;
    },
    async release(id) {
      const previous = mutation;
      const execute = () => previous.catch(() => {}).then(async () => {
        const entries = await loadEntries(storage, now());
        await storage.setItem(STORAGE_KEY, JSON.stringify(entries.filter((entry) => entry.id !== id)));
      });
      const operation = runLocalUserDataMutation(execute);
      mutation = operation.then(() => undefined, () => undefined);
      return operation;
    },
    async remember(id, expiresAt) {
      const previous = mutation;
      const execute = () => previous.catch(() => {}).then(async () => {
        const entries = await loadEntries(storage, now());
        const next = [...entries.filter((entry) => entry.id !== id), { id, expiresAt }].slice(-MAX_IDS);
        await storage.setItem(STORAGE_KEY, JSON.stringify(next));
      });
      const operation = runLocalUserDataMutation(execute);
      mutation = operation.then(() => undefined, () => undefined);
      return operation;
    }
  };
}

export const deviceActionReplayStore = createDeviceActionReplayStore();
