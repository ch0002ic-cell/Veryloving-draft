import { storage } from './storage';
import { runLocalUserDataMutation } from './local-mutation-coordinator';

export const PAIRED_DEVICE_KEY = 'veryloving.pairedDevice';
export const DEFAULT_DEVICE = Object.freeze({
  accountId: null,
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

  const battery = Number(value?.battery);

  return {
    accountId: cleanString(value?.accountId),
    id,
    name: cleanString(value?.name, DEFAULT_DEVICE.name),
    battery: !forHydration && Number.isFinite(battery) && battery >= 0 && battery <= 100
      ? Math.round(battery)
      : null,
    connected: forHydration ? false : connectionState === 'connected' && value?.connected === true,
    connectionState,
    autoReconnect,
    simulated,
    lastErrorCode: cleanString(value?.lastErrorCode)
  };
}

export async function loadPairedDevice(accountId) {
  if (!accountId) return { ...DEFAULT_DEVICE };
  const stored = await storage.getJSON(PAIRED_DEVICE_KEY, null);
  const normalized = normalizePairedDevice(stored, { forHydration: true });
  if (!normalized.id) return normalized;
  if (normalized.accountId && normalized.accountId !== accountId) return { ...DEFAULT_DEVICE };
  if (!normalized.accountId) {
    // Bind legacy device metadata to the first authenticated account that
    // restores it. Subsequent accounts cannot hydrate or reconnect it.
    const migrated = { ...normalized, accountId };
    await persistPairedDevice(migrated);
    return normalizePairedDevice(migrated, { forHydration: true });
  }
  return normalized;
}

export async function persistPairedDevice(device) {
  const normalized = normalizePairedDevice(device);
  if (!normalized.id) {
    await runLocalUserDataMutation(() => storage.remove(PAIRED_DEVICE_KEY));
    return normalized;
  }
  if (!normalized.accountId) throw new Error('An authenticated account is required to remember a paired device.');
  await runLocalUserDataMutation(() => storage.setJSON(PAIRED_DEVICE_KEY, {
    ...normalized,
    // A battery percentage is ephemeral and stale immediately after process
    // death. Re-read it from the verified GATT characteristic on reconnect.
    battery: null
  }));
  return normalized;
}
