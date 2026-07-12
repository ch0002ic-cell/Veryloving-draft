import { storage } from './storage';

export const SETTINGS_KEY = 'veryloving.settings';
export const DEFAULT_SETTINGS = {
  mode: 'home',
  selectedVoiceId: 'capybara',
  language: 'system',
  showCompanion: true,
  offlineMode: false,
  reminderEnabled: true
};

let settingsWriteQueue = Promise.resolve();

export function mergeSettings(current, patch) {
  return { ...DEFAULT_SETTINGS, ...(current || {}), ...(patch || {}) };
}

export async function loadSettings() {
  return mergeSettings(await storage.getJSON(SETTINGS_KEY, DEFAULT_SETTINGS));
}

export function persistSettings(settings) {
  const snapshot = mergeSettings(settings);
  const operation = settingsWriteQueue
    .catch(() => {})
    .then(() => storage.setJSON(SETTINGS_KEY, snapshot))
    .then(() => snapshot);
  settingsWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
