'use strict';

const crypto = require('node:crypto');

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const INTERACTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const DEFAULT_MAX_RECORDS = 10000;
const DEFAULT_ACTIVE_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_COMPLETED_TTL_MS = 15 * 60 * 1000;
const DEFAULT_RECONNECT_GRACE_MS = 30 * 1000;

function boundedInteger(value, fallback, minimum, maximum, name) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new TypeError(`${name} is invalid`);
  }
  return candidate;
}

function validIdentity(accountId, interactionId) {
  return ACCOUNT_ID_PATTERN.test(accountId ?? '') && INTERACTION_ID_PATTERN.test(interactionId ?? '');
}

function recordKey(accountId, interactionId) {
  return crypto.createHash('sha256').update(accountId).update('\0').update(interactionId).digest('base64url');
}

/**
 * Bounded, process-local proof that an account established a voice interaction,
 * Hume emitted a real user/assistant turn, and the client explicitly ended it.
 * The HTTP server and voice gateway share this object. The production server
 * already requires AI_NATIVE_SINGLE_REPLICA=true; a restart intentionally loses
 * these short-lived proofs and therefore fails closed.
 */
function createVoiceInteractionCompletionRegistry({
  clock = Date.now,
  maxRecords,
  activeTTLms,
  completedTTLms,
  reconnectGraceMs
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock is invalid');
  const capacity = boundedInteger(maxRecords, DEFAULT_MAX_RECORDS, 1, 100000, 'maxRecords');
  const activeTTL = boundedInteger(activeTTLms, DEFAULT_ACTIVE_TTL_MS, 1000, 24 * 60 * 60 * 1000, 'activeTTLms');
  const completedTTL = boundedInteger(completedTTLms, DEFAULT_COMPLETED_TTL_MS, 1000, 24 * 60 * 60 * 1000, 'completedTTLms');
  const reconnectGrace = boundedInteger(
    reconnectGraceMs,
    DEFAULT_RECONNECT_GRACE_MS,
    1000,
    5 * 60 * 1000,
    'reconnectGraceMs'
  );
  const records = new Map();

  function prune(now) {
    for (const [key, record] of records) {
      if (record.expiresAt <= now) records.delete(key);
    }
    while (records.size > capacity) records.delete(records.keys().next().value);
  }

  function begin(accountId, interactionId) {
    if (!validIdentity(accountId, interactionId)) return false;
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) return false;
    prune(now);
    const key = recordKey(accountId, interactionId);
    const current = records.get(key);
    if (current?.state === 'completed') return false;
    if (current?.state === 'active') {
      // A reconnect may overlap the old socket briefly. Count both transports
      // without extending the hard interaction lifetime.
      current.activeConnections += 1;
      return true;
    }
    if (current?.state === 'reconnectable') {
      if (current.reconnectUntil < now || current.activeExpiresAt <= now) return false;
      records.set(key, {
        ...current,
        state: 'active',
        completedAt: null,
        activeConnections: 1,
        reconnectUntil: null,
        expiresAt: current.activeExpiresAt
      });
      return true;
    }
    records.set(key, {
      startedAt: now,
      state: 'active',
      completedAt: null,
      activityObservedAt: null,
      activeConnections: 1,
      activeExpiresAt: now + activeTTL,
      reconnectUntil: null,
      expiresAt: now + activeTTL
    });
    prune(now);
    return true;
  }

  function observeActivity(accountId, interactionId) {
    if (!validIdentity(accountId, interactionId)) return false;
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) return false;
    prune(now);
    const key = recordKey(accountId, interactionId);
    const current = records.get(key);
    if (!current || current.state !== 'active' || current.activeConnections < 1) return false;
    // Keep only a timestamp proof. Never retain transcripts, audio, provider
    // payloads, message types, or counters derived from the conversation.
    if (!Number.isSafeInteger(current.activityObservedAt)) {
      records.set(key, { ...current, activityObservedAt: now });
    }
    return true;
  }

  function hasActivity(accountId, interactionId) {
    if (!validIdentity(accountId, interactionId)) return false;
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) return false;
    prune(now);
    const current = records.get(recordKey(accountId, interactionId));
    return Boolean(current && Number.isSafeInteger(current.activityObservedAt));
  }

  function complete(accountId, interactionId) {
    if (!validIdentity(accountId, interactionId)) return false;
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) return false;
    prune(now);
    const key = recordKey(accountId, interactionId);
    const current = records.get(key);
    if (!current) return false;
    if (current.state === 'completed') return true;
    if (current.state !== 'active'
      || current.activeConnections < 1
      || !Number.isSafeInteger(current.activityObservedAt)) return false;
    records.delete(key);
    records.set(key, {
      ...current,
      state: 'completed',
      completedAt: now,
      activeConnections: 0,
      reconnectUntil: null,
      expiresAt: now + completedTTL
    });
    prune(now);
    return true;
  }

  function disconnect(accountId, interactionId) {
    if (!validIdentity(accountId, interactionId)) return false;
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) return false;
    prune(now);
    const key = recordKey(accountId, interactionId);
    const current = records.get(key);
    if (!current) return false;
    if (current.state !== 'active') return true;
    const activeConnections = Math.max(0, current.activeConnections - 1);
    if (activeConnections > 0) {
      records.set(key, { ...current, activeConnections });
      return true;
    }
    records.delete(key);
    records.set(key, {
      ...current,
      state: 'reconnectable',
      completedAt: null,
      activeConnections: 0,
      reconnectUntil: Math.min(now + reconnectGrace, now + completedTTL),
      expiresAt: now + completedTTL
    });
    prune(now);
    return true;
  }

  function verifyCompleted(accountId, interactionId, { occurredAt } = {}) {
    if (!validIdentity(accountId, interactionId)
      || !Number.isSafeInteger(occurredAt) || occurredAt < 0) return false;
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) return false;
    prune(now);
    const record = records.get(recordKey(accountId, interactionId));
    return Boolean(record
      && record.state === 'completed'
      && Number.isSafeInteger(record.completedAt)
      && occurredAt >= record.completedAt
      && occurredAt <= now + 30_000);
  }

  return Object.freeze({ begin, observeActivity, hasActivity, complete, disconnect, verifyCompleted });
}

module.exports = {
  createVoiceInteractionCompletionRegistry
};
