import * as SecureStore from 'expo-secure-store';
import { storage } from './storage';

export const EMERGENCY_CONTACT_CACHE_KEY = 'veryloving.emergencyContacts.secure';
export const LEGACY_EMERGENCY_CONTACTS_KEY = 'veryloving.emergencyContacts';

function normalizedContacts(value) {
  return Array.isArray(value) ? value.filter((contact) => contact && typeof contact === 'object') : [];
}

export async function loadEmergencyContactCache(accountId) {
  if (!accountId) return [];
  const raw = await SecureStore.getItemAsync(EMERGENCY_CONTACT_CACHE_KEY);
  if (raw) {
    try {
      const snapshot = JSON.parse(raw);
      if (snapshot?.version === 1 && snapshot.accountId === accountId) {
        return normalizedContacts(snapshot.contacts);
      }
    } catch {
      // Replace malformed secure state below instead of exposing it.
    }
  }

  // One-time migration from releases that cached contact PII in AsyncStorage.
  // The snapshot is bound to the currently authenticated account before the
  // plaintext legacy key is removed.
  const legacy = normalizedContacts(await storage.getJSON(LEGACY_EMERGENCY_CONTACTS_KEY, []));
  await persistEmergencyContactCache(accountId, legacy);
  await storage.remove(LEGACY_EMERGENCY_CONTACTS_KEY);
  return legacy;
}

export async function persistEmergencyContactCache(accountId, contacts) {
  if (!accountId) throw new Error('An authenticated account is required to cache emergency contacts.');
  await SecureStore.setItemAsync(EMERGENCY_CONTACT_CACHE_KEY, JSON.stringify({
    version: 1,
    accountId,
    contacts: normalizedContacts(contacts)
  }));
}

export function clearEmergencyContactCache() {
  return SecureStore.deleteItemAsync(EMERGENCY_CONTACT_CACHE_KEY);
}
