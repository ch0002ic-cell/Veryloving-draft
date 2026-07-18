import { config } from '../utils/config';
import { createAuthenticationNonce } from '../utils/session-token';

const REQUEST_TIMEOUT_MS = 10000;
const MAX_SAFETY_RESPONSE_BYTES = 1024 * 1024;
export const SOS_LOCATION_MAX_AGE_MS = 5 * 60 * 1000;

function safetyResponseError(code, message) {
  return Object.assign(new Error(message), { code });
}

async function cancelSafetyResponse(response) {
  try { await response?.body?.cancel?.(); } catch {}
}

function encodedLength(value) {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

async function readBoundedSafetyPayload(response, signal) {
  const rawContentLength = response.headers?.get?.('content-length');
  if (rawContentLength !== undefined && rawContentLength !== null) {
    if (!/^\d{1,12}$/.test(rawContentLength)
      || Number(rawContentLength) > MAX_SAFETY_RESPONSE_BYTES) {
      await cancelSafetyResponse(response);
      throw safetyResponseError('SAFETY_RESPONSE_TOO_LARGE', 'The safety service response was too large.');
    }
  }

  let text;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const cancelOnAbort = () => { void Promise.resolve(reader.cancel?.()).catch(() => {}); };
    if (signal?.aborted) cancelOnAbort();
    else signal?.addEventListener('abort', cancelOnAbort, { once: true });
    const chunks = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) {
          throw safetyResponseError('SAFETY_RESPONSE_INVALID', 'The safety service response was invalid.');
        }
        received += value.byteLength;
        if (received > MAX_SAFETY_RESPONSE_BYTES) {
          await Promise.resolve(reader.cancel?.()).catch(() => {});
          throw safetyResponseError('SAFETY_RESPONSE_TOO_LARGE', 'The safety service response was too large.');
        }
        chunks.push(value);
      }
    } finally {
      signal?.removeEventListener('abort', cancelOnAbort);
      reader.releaseLock?.();
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
      throw safetyResponseError('SAFETY_RESPONSE_INVALID', 'The safety service response was invalid.');
    }
  } else if (typeof response.text === 'function') {
    text = await response.text();
  } else if (typeof response.json === 'function') {
    // Compatibility fallback for older React Native fetch implementations.
    // Production responses advertise Content-Length; streaming is used where
    // the runtime exposes a byte reader.
    const payload = await response.json();
    let serialized;
    try { serialized = JSON.stringify(payload); } catch {
      throw safetyResponseError('SAFETY_RESPONSE_INVALID', 'The safety service response was invalid.');
    }
    if (typeof serialized !== 'string') {
      throw safetyResponseError('SAFETY_RESPONSE_INVALID', 'The safety service response was invalid.');
    }
    if (encodedLength(serialized) > MAX_SAFETY_RESPONSE_BYTES) {
      throw safetyResponseError('SAFETY_RESPONSE_TOO_LARGE', 'The safety service response was too large.');
    }
    return payload;
  } else {
    throw safetyResponseError('SAFETY_RESPONSE_INVALID', 'The safety service response was invalid.');
  }

  if (typeof text !== 'string' || encodedLength(text) > MAX_SAFETY_RESPONSE_BYTES) {
    throw safetyResponseError('SAFETY_RESPONSE_TOO_LARGE', 'The safety service response was too large.');
  }
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

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
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw safetyResponseError('SAFETY_TIMEOUT_INVALID', 'The safety service timeout is invalid.');
  }
  const controller = new AbortController();
  let response;
  let timedOut = false;
  let timeoutHandle;
  const operation = (async () => {
    response = await fetchImpl(`${runtimeConfig.apiBaseUrl.replace(/\/$/, '')}${path}`, {
      method,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(headers || {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal
    });
    if (timedOut) {
      await cancelSafetyResponse(response);
      const error = new Error('The safety service request timed out.');
      error.name = 'AbortError';
      throw error;
    }
    if (response.status === 204) return null;
    const payload = await readBoundedSafetyPayload(response, controller.signal);
    if (timedOut) {
      await cancelSafetyResponse(response);
      const error = new Error('The safety service request timed out.');
      error.name = 'AbortError';
      throw error;
    }
    if (!response.ok) {
      const error = new Error(payload?.error || 'The safety service could not complete the request.');
      error.code = `SAFETY_HTTP_${response.status}`;
      throw error;
    }
    return payload;
  })();
  void operation.catch(() => {});
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      void cancelSafetyResponse(response);
      const error = new Error('The safety service request timed out.');
      error.name = 'AbortError';
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('The safety service took too long to respond.');
      timeoutError.code = 'SAFETY_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
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
