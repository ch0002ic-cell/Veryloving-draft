import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform, Share } from 'react-native';
import { AUTH_STORAGE_KEYS } from '../context/AuthContext';
import { CONVERSATION_HISTORY_KEY, loadConversationHistory } from './conversation-history';
import { RATIONALE_PREFIX } from './permissions';
import { storage } from './storage';

export const PRIVACY_POLICY_URL = 'https://veryloving.ai/privacy';
const LOCAL_KEY_PREFIX = 'veryloving.';

async function readJSONSecureStore(key) {
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseStoredValue(raw) {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function collectLocalStorageSnapshot() {
  const keys = (await storage.keys()).filter((key) => key.startsWith(LOCAL_KEY_PREFIX));
  const entries = await Promise.all(keys.map(async (key) => [key, parseStoredValue(await storage.getRaw(key))]));
  return Object.fromEntries(entries);
}

export async function buildUserDataExport() {
  const localStorage = await collectLocalStorageSnapshot();
  const conversations = await loadConversationHistory();
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: {
      name: 'VeryLoving',
      privacyPolicy: PRIVACY_POLICY_URL
    },
    account: await readJSONSecureStore(AUTH_STORAGE_KEYS.user),
    settings: localStorage['veryloving.settings'] || null,
    emergencyContacts: localStorage['veryloving.emergencyContacts'] || [],
    conversations,
    localStorage,
    permissionRationales: Object.fromEntries(
      Object.entries(localStorage).filter(([key]) => key.startsWith(RATIONALE_PREFIX))
    ),
    localStorageKeys: Object.keys(localStorage).filter((key) => key !== CONVERSATION_HISTORY_KEY)
  };
}

export async function exportUserData() {
  const data = await buildUserDataExport();
  const filename = `veryloving-data-${Date.now()}.json`;
  const uri = `${FileSystem.documentDirectory}${filename}`;
  const json = JSON.stringify(data, null, 2);
  await FileSystem.writeAsStringAsync(uri, json);
  await Share.share({
    title: 'VeryLoving data export',
    url: uri,
    message: Platform.OS === 'ios' ? 'VeryLoving data export' : json
  });
  return uri;
}

export async function deleteAllUserData() {
  const localKeys = (await storage.keys()).filter((key) => key.startsWith(LOCAL_KEY_PREFIX));
  await storage.removeMany(localKeys);
  await SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.token);
  await SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.user);
}
