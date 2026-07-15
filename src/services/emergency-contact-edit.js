import { config } from '../utils/config';
import {
  fetchEmergencyContacts,
  updateEmergencyContact
} from './safety-api';
import { persistEmergencyContactCache } from './emergency-contact-store';

export const REMOTE_EMERGENCY_CONTACT_PATTERN = /^contact_[A-Za-z0-9_-]{24}$/;

function editError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeEdit(value) {
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  const phone = typeof value?.phone === 'string' ? value.phone.trim() : '';
  const countryCode = typeof value?.countryCode === 'string'
    ? value.countryCode.trim().toUpperCase()
    : '';
  if (!name || name.length > 100) throw editError('CONTACT_NAME_INVALID', 'The contact name is invalid.');
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw editError('CONTACT_PHONE_INVALID', 'The contact phone is invalid.');
  if (!/^[A-Z]{2}$/.test(countryCode)) throw editError('CONTACT_COUNTRY_INVALID', 'The contact country is invalid.');
  return { name, phone, countryCode };
}

function assertActive(isAccountActive) {
  if (isAccountActive?.() === false) {
    throw editError('CONTACT_ACCOUNT_CHANGED', 'The authenticated account changed during the contact update.');
  }
}

/**
 * Produces and persists a complete account-bound contact snapshot.
 *
 * Remote records are updated first. If the subsequent SecureStore write fails,
 * the returned server state remains authoritative and can still be rendered;
 * the next remote reconciliation repairs the cache. Purely local edits remain
 * transactional and reject without changing the caller's state when the secure
 * cache cannot be updated.
 */
export async function editEmergencyContact({
  accessToken,
  accountId,
  backendEnabled = config.safetyBackendEnabled,
  contactId,
  contacts,
  edit,
  fetchRemoteContactsImpl = fetchEmergencyContacts,
  isAccountActive,
  persistCacheImpl = persistEmergencyContactCache,
  updateRemoteImpl = updateEmergencyContact
}) {
  if (!accountId) throw editError('CONTACT_ACCOUNT_REQUIRED', 'An authenticated account is required.');
  const previousContacts = Array.isArray(contacts) ? contacts : [];
  const existing = previousContacts.find((contact) => contact?.id === contactId);
  if (!existing) throw editError('CONTACT_NOT_FOUND', 'The emergency contact is unavailable.');
  const normalizedEdit = normalizeEdit(edit);
  const syncRemote = backendEnabled
    && Boolean(accessToken)
    && REMOTE_EMERGENCY_CONTACT_PATTERN.test(contactId);
  assertActive(isAccountActive);

  let updatedContact;
  if (syncRemote) {
    try {
      updatedContact = await updateRemoteImpl(contactId, {
        ...normalizedEdit,
        version: existing.version
      }, accessToken);
    } catch (error) {
      if (error?.code === 'SAFETY_HTTP_409') {
        try {
          const latestContacts = await fetchRemoteContactsImpl(accessToken);
          assertActive(isAccountActive);
          error.latestContacts = latestContacts;
          await persistCacheImpl(accountId, latestContacts);
        } catch (refreshError) {
          if (refreshError?.code === 'CONTACT_ACCOUNT_CHANGED') throw refreshError;
        }
      }
      throw error;
    }
    if (
      !updatedContact
      || updatedContact.id !== contactId
      || !Number.isInteger(updatedContact.version)
    ) throw editError('CONTACT_RESPONSE_INVALID', 'The safety service returned an invalid contact.');
  } else {
    updatedContact = { ...existing, ...normalizedEdit };
  }

  assertActive(isAccountActive);
  const nextContacts = previousContacts.map((contact) => (
    contact.id === contactId ? updatedContact : contact
  ));
  try {
    await persistCacheImpl(accountId, nextContacts);
  } catch (error) {
    if (!syncRemote) throw error;
    return { cacheWarning: true, contact: updatedContact, contacts: nextContacts };
  }
  assertActive(isAccountActive);
  return { cacheWarning: false, contact: updatedContact, contacts: nextContacts };
}
