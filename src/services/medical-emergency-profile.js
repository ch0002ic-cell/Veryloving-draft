const BLOOD_TYPES = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown']);
const MAX_ITEMS = 20;
const MAX_ITEM_LENGTH = 160;
const MAX_PROFILE_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function validationError(code, message) {
  return Object.assign(new Error(message), { code });
}

function cleanString(value, label, { required = false, maxLength = MAX_ITEM_LENGTH } = {}) {
  if (value === undefined || value === null) {
    if (required) throw validationError('MEDICAL_PROFILE_INVALID', `${label} is required.`);
    return null;
  }
  if (typeof value !== 'string') throw validationError('MEDICAL_PROFILE_INVALID', `${label} is invalid.`);
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maxLength) {
    throw validationError('MEDICAL_PROFILE_INVALID', `${label} is invalid.`);
  }
  return normalized || null;
}

function cleanList(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    throw validationError('MEDICAL_PROFILE_INVALID', `${label} is invalid.`);
  }
  return [...new Set(value.map((item) => cleanString(item, label, { required: true })))];
}

function cleanMedications(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    throw validationError('MEDICAL_PROFILE_INVALID', 'Medications are invalid.');
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw validationError('MEDICAL_PROFILE_INVALID', 'Medication is invalid.');
    }
    return {
      name: cleanString(item.name, 'Medication name', { required: true }),
      dose: cleanString(item.dose, 'Medication dose'),
      instructions: cleanString(item.instructions, 'Medication instructions')
    };
  });
}

function validTimestamp(value, label) {
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw validationError('MEDICAL_PROFILE_TIME_INVALID', `${label} is invalid.`);
  }
  return timestamp;
}

function frozenList(values) {
  return Object.freeze([...values]);
}

function frozenMedications(values) {
  return Object.freeze(values.map((medication) => Object.freeze({ ...medication })));
}

export function normalizeMedicalEmergencyProfile(input = {}) {
  const bloodType = cleanString(input.bloodType, 'Blood type') || 'unknown';
  if (!BLOOD_TYPES.has(bloodType)) {
    throw validationError('MEDICAL_PROFILE_INVALID', 'Blood type is invalid.');
  }
  return Object.freeze({
    version: 1,
    profileVersion: Number.isSafeInteger(input.profileVersion) && input.profileVersion > 0
      ? input.profileVersion
      : 1,
    bloodType,
    conditions: frozenList(cleanList(input.conditions, 'Medical conditions')),
    allergies: frozenList(cleanList(input.allergies, 'Allergies')),
    medications: frozenMedications(cleanMedications(input.medications)),
    emergencyNotes: cleanString(input.emergencyNotes, 'Emergency notes', { maxLength: 500 }),
    shareInEmergency: input.shareInEmergency === true,
    consentRecordedAt: validTimestamp(input.consentRecordedAt, 'Consent time'),
    updatedAt: validTimestamp(input.updatedAt, 'Profile update time')
  });
}

export function buildEmergencyMedicalAttachment(input, {
  now = Date.now,
  maxProfileAgeMs = MAX_PROFILE_AGE_MS
} = {}) {
  const profile = normalizeMedicalEmergencyProfile(input);
  const generatedAt = now();
  if (!profile.shareInEmergency) {
    throw validationError('MEDICAL_PROFILE_CONSENT_REQUIRED', 'Emergency medical sharing is not enabled.');
  }
  if (!Number.isSafeInteger(generatedAt)
    || profile.consentRecordedAt > generatedAt
    || profile.updatedAt > generatedAt) {
    throw validationError('MEDICAL_PROFILE_TIME_INVALID', 'Medical profile time is invalid.');
  }
  if (profile.consentRecordedAt < profile.updatedAt) {
    throw validationError(
      'MEDICAL_PROFILE_CONSENT_REQUIRED',
      'Medical profile changes must be reviewed before emergency sharing.'
    );
  }
  if (generatedAt - profile.updatedAt > Math.max(1, maxProfileAgeMs)) {
    throw validationError('MEDICAL_PROFILE_STALE', 'Medical profile must be reviewed before sharing.');
  }
  const hasContent = profile.bloodType !== 'unknown'
    || profile.conditions.length
    || profile.allergies.length
    || profile.medications.length
    || profile.emergencyNotes;
  if (!hasContent) throw validationError('MEDICAL_PROFILE_EMPTY', 'Medical profile has no emergency information.');

  return Object.freeze({
    schemaVersion: 1,
    profileVersion: profile.profileVersion,
    consentRecordedAt: profile.consentRecordedAt,
    generatedAt,
    bloodType: profile.bloodType,
    conditions: frozenList(profile.conditions),
    allergies: frozenList(profile.allergies),
    medications: frozenMedications(profile.medications),
    emergencyNotes: profile.emergencyNotes
  });
}
