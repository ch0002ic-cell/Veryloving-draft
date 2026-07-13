import { storage } from './storage';
import { runLocalUserDataMutation } from './local-mutation-coordinator';

export const PAIRED_DEVICE_KEY = 'veryloving.pairedDevice';
export const DEFAULT_DEVICE = Object.freeze({
  id: null,
  name: 'NorthStar VL01',
  battery: null,
  connected: false,
  connectionState: 'disconnected',
  autoReconnect: false,
  simulated: false,
  lastErrorCode: null
});

const CONNECTION_STATES = new Set(['connected', 'connecting', 'reconnecting', 'disconnected']);

const cleanString = (value, fallback = null) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 120) : fallback;
};

export function normalizePairedDevice(value, { forHydration = false } = {}) {
  const id = cleanString(value?.id);
  if (!id) return { ...DEFAULT_DEVICE };

  const simulated = value?.simulated === true;
  const autoReconnect = !simulated && value?.autoReconnect !== false;
  const requestedState = CONNECTION_STATES.has(value?.connectionState)
    ? value.connectionState
    : (value?.connected ? 'connected' : 'disconnected');
  const connectionState = forHydration
    ? (autoReconnect ? 'reconnecting' : 'disconnected')
    : requestedState;

  return {
    id,
    name: cleanString(value?.name, DEFAULT_DEVICE.name),
    // Battery remains unknown until a real VL01 battery characteristic is wired.
    battery: null,
    connected: forHydration ? false : connectionState === 'connected' && value?.connected === true,
    connectionState,
    autoReconnect,
    simulated,
    lastErrorCode: cleanString(value?.lastErrorCode)
  };
}

export async function loadPairedDevice() {
  const stored = await storage.getJSON(PAIRED_DEVICE_KEY, null);
  return normalizePairedDevice(stored, { forHydration: true });
}

export async function persistPairedDevice(device) {
  const normalized = normalizePairedDevice(device);
  if (!normalized.id) {
    await runLocalUserDataMutation(() => storage.remove(PAIRED_DEVICE_KEY));
    return normalized;
  }
  await runLocalUserDataMutation(() => storage.setJSON(PAIRED_DEVICE_KEY, normalized));
  return normalized;
}
