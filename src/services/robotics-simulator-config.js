import { storage } from './storage';

export const ROBOTICS_SIMULATOR_URL_KEY = '@veryloving/simulator_url';
export const DEFAULT_ROBOTICS_SIMULATOR_URL = 'ws://127.0.0.1:9090';

function insecureWebSocketHostAllowed(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  if (/^(?:127\.|10\.|192\.168\.)/.test(host)) return true;
  const private172 = /^172\.(\d{1,3})\./.exec(host);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  return /^(?:fc|fd)[0-9a-f]*:/i.test(host);
}

function loadExpoConstants() {
  try {
    const constantsModule = require('expo-constants');
    return constantsModule.default || constantsModule;
  } catch {
    return null;
  }
}

export function normalizeRoboticsSimulatorURL(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new globalThis.URL(value.trim());
    if (!['ws:', 'wss:'].includes(url.protocol)) return null;
    if (!url.hostname || url.username || url.password || url.hash) return null;
    if (url.search) return null;
    if (url.protocol === 'ws:' && !insecureWebSocketHostAllowed(url.hostname)) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function expoDevelopmentHost(constants = loadExpoConstants()) {
  const hostUri = constants?.expoConfig?.hostUri
    || constants?.manifest2?.extra?.expoClient?.hostUri
    || constants?.manifest?.debuggerHost;
  if (typeof hostUri !== 'string' || !hostUri.trim()) return null;
  try {
    return new globalThis.URL(hostUri.includes('://') ? hostUri : `http://${hostUri}`).hostname;
  } catch {
    return null;
  }
}

export async function loadRoboticsSimulatorURL(storageImpl = storage) {
  return normalizeRoboticsSimulatorURL(await storageImpl.getJSON(ROBOTICS_SIMULATOR_URL_KEY, null));
}

export async function saveRoboticsSimulatorURL(value, storageImpl = storage) {
  if (typeof value !== 'string' || !value.trim()) {
    await storageImpl.remove(ROBOTICS_SIMULATOR_URL_KEY);
    return null;
  }
  const normalized = normalizeRoboticsSimulatorURL(value);
  if (!normalized) throw new Error('Use a valid ws:// or wss:// simulator URL without credentials.');
  await storageImpl.setJSON(ROBOTICS_SIMULATOR_URL_KEY, normalized);
  return normalized;
}

export async function resolveRoboticsSimulatorURLs({
  configuredURL = process.env.EXPO_PUBLIC_ROBOTICS_SIMULATOR_URL || DEFAULT_ROBOTICS_SIMULATOR_URL,
  constants = loadExpoConstants(),
  storageImpl = storage
} = {}) {
  const runtimeURL = await loadRoboticsSimulatorURL(storageImpl).catch(() => null);
  const developmentHost = expoDevelopmentHost(constants);
  const candidates = [
    runtimeURL,
    normalizeRoboticsSimulatorURL(configuredURL),
    developmentHost ? normalizeRoboticsSimulatorURL(`ws://${developmentHost}:9090`) : null,
    constants?.platform?.android ? 'ws://10.0.2.2:9090' : null,
    DEFAULT_ROBOTICS_SIMULATOR_URL
  ].filter(Boolean);
  return [...new Set(candidates)];
}
