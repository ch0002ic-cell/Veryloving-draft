import { secureStorage } from './secure-storage';
import {
  buildEmergencyMedicalAttachment,
  normalizeMedicalEmergencyProfile
} from './medical-emergency-profile';

export const MEDICAL_PROFILE_KEY = 'veryloving.medicalProfile.secure.v1';

function normalizeAccountId(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 512 ? normalized : null;
}

function parseSnapshot(raw, accountId) {
  if (!raw || !accountId) return null;
  try {
    const snapshot = JSON.parse(raw);
    if (snapshot?.version !== 1 || snapshot.accountId !== accountId) return null;
    return normalizeMedicalEmergencyProfile(snapshot.profile);
  } catch {
    return null;
  }
}

export async function loadMedicalEmergencyProfile(accountId) {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) return null;
  return parseSnapshot(await secureStorage.getItemAsync(MEDICAL_PROFILE_KEY), normalized);
}

export async function saveMedicalEmergencyProfile(accountId, input, { now = Date.now } = {}) {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) throw new Error('An authenticated account is required to save medical information.');
  const timestamp = now();
  const profile = normalizeMedicalEmergencyProfile({
    ...input,
    updatedAt: Number(input?.updatedAt) || timestamp,
    consentRecordedAt: Number(input?.consentRecordedAt) || timestamp
  });
  await secureStorage.setItemAsync(MEDICAL_PROFILE_KEY, JSON.stringify({
    version: 1,
    accountId: normalized,
    profile
  }));
  return profile;
}

export async function loadEmergencyMedicalAttachment(accountId, options) {
  const profile = await loadMedicalEmergencyProfile(accountId);
  if (!profile) return null;
  try {
    return buildEmergencyMedicalAttachment(profile, options);
  } catch {
    // Consent, freshness, and post-edit review failures omit the optional
    // attachment without blocking the emergency call or SOS acceptance path.
    return null;
  }
}

export async function clearMedicalEmergencyProfile(accountId) {
  const normalized = normalizeAccountId(accountId);
  // Privacy/account-boundary cleanup intentionally omits an account so it can
  // erase any orphaned snapshot. An in-session user action is scoped to the
  // authenticated owner and can never clear another account's record.
  if (accountId !== undefined && !normalized) {
    throw new Error('An authenticated account is required to clear medical information.');
  }
  if (normalized) {
    const raw = await secureStorage.getItemAsync(MEDICAL_PROFILE_KEY);
    if (!raw) return false;
    try {
      const snapshot = JSON.parse(raw);
      if (snapshot?.version !== 1 || snapshot.accountId !== normalized) return false;
    } catch {
      return false;
    }
  }
  await secureStorage.deleteItemAsync(MEDICAL_PROFILE_KEY);
  return true;
}
