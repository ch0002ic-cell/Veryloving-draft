import { withTimeout } from '../utils/async';

export const LOCALE_TRANSITION_GATE_TIMEOUT_MS = 15000;
const RELOAD_BLOCKING_STATUSES = new Set([
  'cancelled',
  'reminder-cleanup-incomplete',
  'reminder-superseded',
  'superseded',
  'timeout'
]);

export function localeTransitionAllowsDirectionReload(preparation) {
  if (!preparation) return true;
  if (preparation.matched && !preparation.current) return false;
  return !RELOAD_BLOCKING_STATUSES.has(preparation.status);
}

function normalizeLocale(locale) {
  if (typeof locale !== 'string') return null;
  const normalized = locale.trim();
  return normalized || null;
}

function createDeferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

export function createLocaleTransitionCoordinator({
  timeoutMs = LOCALE_TRANSITION_GATE_TIMEOUT_MS
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Locale transition timeout must be a positive number.');
  }

  let generation = 0;
  let current = null;

  const settle = (entry, outcome) => {
    if (!entry || entry.settled) return false;
    entry.settled = true;
    entry.resolve({
      status: 'ready',
      ...outcome,
      generation: entry.generation,
      locale: entry.locale
    });
    return true;
  };

  const begin = (locale) => {
    const normalizedLocale = normalizeLocale(locale);
    if (!normalizedLocale) throw new TypeError('A locale is required for a locale transition.');

    if (current && !current.settled) {
      settle(current, { status: 'superseded' });
    }

    const deferred = createDeferred();
    const entry = {
      generation: ++generation,
      locale: normalizedLocale,
      promise: deferred.promise,
      resolve: deferred.resolve,
      settled: false
    };
    current = entry;
    return Object.freeze({ generation: entry.generation, locale: entry.locale });
  };

  const isCurrent = (token) => Boolean(
    token
    && current
    && token.generation === current.generation
    && token.locale === current.locale
  );

  const complete = (token, outcome = {}) => {
    if (!isCurrent(token)) return false;
    return settle(current, outcome);
  };

  const waitFor = async (locale) => {
    const normalizedLocale = normalizeLocale(locale);
    const entry = current;
    if (!normalizedLocale || !entry || entry.locale !== normalizedLocale) {
      return {
        matched: false,
        current: false,
        status: 'uncoordinated',
        locale: normalizedLocale,
        pendingLocale: entry?.locale || null
      };
    }

    let outcome;
    try {
      outcome = await withTimeout(
        entry.promise,
        timeoutMs,
        `Preparing the ${entry.locale} interface direction timed out.`
      );
    } catch (error) {
      outcome = {
        status: 'timeout',
        error,
        generation: entry.generation,
        locale: entry.locale
      };
    }

    return {
      ...outcome,
      matched: true,
      current: current === entry
    };
  };

  const waitForCurrent = async (locale) => {
    while (true) {
      const outcome = await waitFor(locale);
      if (!outcome.matched || outcome.current) return outcome;
      // A newer generation for the same locale may have replaced the promise
      // that just settled. Follow the current generation rather than allowing
      // stale work to suppress or trigger a reload.
    }
  };

  return Object.freeze({ begin, complete, isCurrent, waitFor, waitForCurrent });
}
