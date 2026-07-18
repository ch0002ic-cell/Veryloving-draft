import { config } from '../utils/config';
import { createAuthenticationNonce } from '../utils/session-token';

const REQUEST_TIMEOUT_MS = 10000;
export const SOS_LOCATION_MAX_AGE_MS = 5 * 60 * 1000;

function finiteCoordinate(value, limit) {
  if (value === null || value === undefined || value === '') return null;
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || Math.abs(coordinate) > limit) return null;
  return coordinate;
}

/**
 * The server treats SOS location as optional, but rejects the whole request if
 * a supplied snapshot is stale. Normalize only a recent, valid snapshot so an
 * old offline cache can never prevent the emergency event itself from being
 * accepted.
 */
export function normalizeSOSLocation(
  location,
  { now = Date.now, maxAgeMs = SOS_LOCATION_MAX_AGE_MS } = {}
) {
  const latitude = finiteCoordinate(location?.latitude ?? location?.coords?.latitude, 90);
  const longitude = finiteCoordinate(location?.longitude ?? location?.coords?.longitude, 180);
  const capturedAt = Number(location?.capturedAt ?? location?.timestamp ?? location?.cachedAt);
  const timestamp = now();
  if (
    latitude === null
    || longitude === null
    || !Number.isFinite(capturedAt)
    || !Number.isFinite(timestamp)
    || Math.abs(timestamp - capturedAt) > maxAgeMs
  ) return null;
  return { latitude, longitude, capturedAt };
}

export async function safetyRequest(path, {
  accessToken,
  method = 'GET',
  body,
  headers,
  fetchImpl = globalThis.fetch,
  runtimeConfig = config,
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  if (!runtimeConfig.safetyBackendEnabled || !runtimeConfig.apiBaseUrl) {
    const error = new Error('The production safety service is not configured.');
    error.code = 'SAFETY_BACKEND_NOT_CONFIGURED';
    throw error;
  }
  if (!accessToken) {
    const error = new Error('Sign in again to use connected safety features.');
    error.code = 'SAFETY_AUTHENTICATION_REQUIRED';
    throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${runtimeConfig.apiBaseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(headers || {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal
    });
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error || 'The safety service could not complete the request.');
      error.code = `SAFETY_HTTP_${response.status}`;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('The safety service took too long to respond.');
      timeoutError.code = 'SAFETY_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchEmergencyContacts(accessToken) {
  const payload = await safetyRequest('/v1/emergency-contacts', { accessToken });
  return Array.isArray(payload?.contacts) ? payload.contacts : [];
}

export function createEmergencyContact(contact, accessToken) {
  return safetyRequest('/v1/emergency-contacts', { accessToken, method: 'POST', body: contact });
}

export function updateEmergencyContact(contactId, contact, accessToken, options = {}) {
  return safetyRequest(`/v1/emergency-contacts/${encodeURIComponent(contactId)}`, {
    ...options,
    accessToken,
    method: 'PATCH',
    body: contact
  });
}

export function deleteEmergencyContact(contactId, accessToken) {
  return safetyRequest(`/v1/emergency-contacts/${encodeURIComponent(contactId)}`, {
    accessToken,
    method: 'DELETE'
  });
}

export function activateSafetyMode(mode, accessToken, location) {
  return safetyRequest('/v1/safety-sessions', {
    accessToken,
    method: 'POST',
    body: {
      idempotencyKey: createAuthenticationNonce(),
      mode,
      ...(location ? { location } : {})
    }
  });
}

export async function fetchCurrentSafetyMode(accessToken) {
  const payload = await safetyRequest('/v1/safety-sessions/current', { accessToken });
  return payload?.session || null;
}

export function dispatchSOS({
  contactIds,
  accessToken,
  location,
  medicalAttachment,
  source = 'app',
  idempotencyKey = createAuthenticationNonce()
}) {
  const occurredAt = Date.now();
  const recentLocation = normalizeSOSLocation(location, { now: () => occurredAt });
  return safetyRequest('/v1/sos-events', {
    accessToken,
    method: 'POST',
    body: {
      idempotencyKey,
      source,
      occurredAt,
      contactIds,
      ...(recentLocation ? { location: recentLocation } : {}),
      ...(medicalAttachment ? { medicalAttachment } : {})
    }
  });
}

export function dispatchMedicationEscalation({
  reminderId,
  medicationId,
  idempotencyKey,
  accessToken,
  occurredAt = Date.now()
}) {
  if (typeof reminderId !== 'string' || !reminderId) {
    const error = new Error('Medication reminder identifier is required.');
    error.code = 'MEDICATION_REMINDER_ID_REQUIRED';
    throw error;
  }
  return safetyRequest('/v1/medication-escalations', {
    accessToken,
    method: 'POST',
    body: {
      idempotencyKey,
      medicationReference: medicationId,
      reason: 'reminder_unacknowledged',
      occurredAt,
      source: 'home_robot'
    }
  });
}

export async function fetchRemoteUserData(accessToken) {
  const payload = await safetyRequest('/v1/privacy/export', { accessToken });
  return payload?.data || null;
}

export function deleteRemoteUserData(accessToken) {
  return safetyRequest('/v1/privacy/data', { accessToken, method: 'DELETE' });
}
