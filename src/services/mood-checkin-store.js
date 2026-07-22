import { createAuthenticationNonce } from '../utils/session-token';
import { runLocalUserDataMutation } from './local-mutation-coordinator';
import { storage } from './storage';

export const MOOD_CHECKIN_HISTORY_KEY = 'veryloving.moodCheckins.v1';
export const MOOD_CHECKIN_HISTORY_VERSION = 1;
export const MAX_MOOD_CHECKINS = 90;
export const MAX_REFLECTION_SUMMARY_LENGTH = 280;

export const MOOD_OPTIONS = Object.freeze([
  Object.freeze({ key: 'very_low', score: 1 }),
  Object.freeze({ key: 'low', score: 2 }),
  Object.freeze({ key: 'okay', score: 3 }),
  Object.freeze({ key: 'good', score: 4 }),
  Object.freeze({ key: 'great', score: 5 })
]);

const MOOD_SCORES = new Map(MOOD_OPTIONS.map(({ key, score }) => [key, score]));
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const CHECKIN_ID_PATTERN = /^[a-f0-9]{64}$/;
let mutationQueue = Promise.resolve();

function moodError(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizeAccountId(value) {
  const accountId = typeof value === 'string' ? value.trim() : '';
  return ACCOUNT_ID_PATTERN.test(accountId) ? accountId : null;
}

function normalizedSummary(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return null;
  const summary = value.replace(/\s+/g, ' ').trim();
  if (!summary || summary.length > MAX_REFLECTION_SUMMARY_LENGTH) return null;
  return summary;
}

function normalizeCheckIn(value) {
  const expectedScore = MOOD_SCORES.get(value?.moodKey);
  const reflectionSummary = normalizedSummary(value?.reflectionSummary);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !CHECKIN_ID_PATTERN.test(value.id ?? '')
    || expectedScore !== value.score
    || !Number.isSafeInteger(value.occurredAt) || value.occurredAt < 0
    || (value.reflectionSummary !== undefined && value.reflectionSummary !== null
      && reflectionSummary === null)) return null;
  return Object.freeze({
    id: value.id,
    moodKey: value.moodKey,
    score: expectedScore,
    occurredAt: value.occurredAt,
    ...(reflectionSummary ? { reflectionSummary } : {})
  });
}

function normalizedHistory(value, accountId) {
  if (value?.version !== MOOD_CHECKIN_HISTORY_VERSION || value.accountId !== accountId) return [];
  return Array.isArray(value.checkIns)
    ? value.checkIns.flatMap((item) => normalizeCheckIn(item) ?? [])
      .sort((left, right) => right.occurredAt - left.occurredAt)
      .slice(0, MAX_MOOD_CHECKINS)
    : [];
}

function runMutation(accountId, mutator) {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) {
    return Promise.reject(moodError(
      'MOOD_ACCOUNT_REQUIRED',
      'An authenticated account is required for mood check-ins.'
    ));
  }
  const previous = mutationQueue;
  const operation = runLocalUserDataMutation(async () => {
    await previous.catch(() => {});
    const stored = await storage.getJSON(MOOD_CHECKIN_HISTORY_KEY, null);
    if (stored?.accountId && stored.accountId !== normalized) {
      throw moodError('MOOD_ACCOUNT_MISMATCH', 'Mood history belongs to a different authenticated account.');
    }
    const next = (await mutator(normalizedHistory(stored, normalized)))
      .flatMap((item) => normalizeCheckIn(item) ?? [])
      .sort((left, right) => right.occurredAt - left.occurredAt)
      .slice(0, MAX_MOOD_CHECKINS);
    await storage.setJSON(MOOD_CHECKIN_HISTORY_KEY, {
      version: MOOD_CHECKIN_HISTORY_VERSION,
      accountId: normalized,
      checkIns: next
    });
    return Object.freeze(next);
  });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function drainMoodCheckInMutations() {
  await mutationQueue.catch(() => {});
}

export async function listMoodCheckIns(accountId) {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) return Object.freeze([]);
  await drainMoodCheckInMutations();
  return Object.freeze(normalizedHistory(
    await storage.getJSON(MOOD_CHECKIN_HISTORY_KEY, null),
    normalized
  ));
}

/**
 * Saves a privacy-minimized self report. reflectionSummary must be a short
 * derived summary; raw Hume audio/transcripts are intentionally unsupported.
 */
export function saveMoodCheckIn(accountId, input = {}) {
  const allowedKeys = new Set(['id', 'moodKey', 'score', 'occurredAt', 'reflectionSummary']);
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !allowedKeys.has(key))) {
    return Promise.reject(moodError('MOOD_CHECKIN_INVALID', 'Mood check-in failed validation.'));
  }
  const {
    id = createAuthenticationNonce(),
    moodKey,
    score,
    occurredAt = Date.now(),
    reflectionSummary
  } = input;
  const expectedScore = MOOD_SCORES.get(moodKey);
  const summary = normalizedSummary(reflectionSummary);
  if (!CHECKIN_ID_PATTERN.test(id ?? '')
    || expectedScore !== score
    || !Number.isSafeInteger(occurredAt) || occurredAt < 0
    || (reflectionSummary !== undefined && reflectionSummary !== null && reflectionSummary !== ''
      && summary === null)) {
    return Promise.reject(moodError('MOOD_CHECKIN_INVALID', 'Mood check-in failed validation.'));
  }
  const checkIn = {
    id,
    moodKey,
    score,
    occurredAt,
    ...(summary ? { reflectionSummary: summary } : {})
  };
  return runMutation(accountId, (current) => [
    checkIn,
    ...current.filter((item) => item.id !== id)
  ]);
}

export function deleteMoodCheckIn(accountId, checkInId) {
  if (!CHECKIN_ID_PATTERN.test(checkInId ?? '')) {
    return Promise.reject(moodError('MOOD_CHECKIN_INVALID', 'Mood check-in failed validation.'));
  }
  return runMutation(accountId, (current) => current.filter(({ id }) => id !== checkInId));
}

export async function clearMoodCheckIns(accountId) {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) return false;
  const previous = mutationQueue;
  const operation = runLocalUserDataMutation(async () => {
    await previous.catch(() => {});
    const stored = await storage.getJSON(MOOD_CHECKIN_HISTORY_KEY, null);
    if (stored?.accountId && stored.accountId !== normalized) return false;
    await storage.remove(MOOD_CHECKIN_HISTORY_KEY);
    return true;
  });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
