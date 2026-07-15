import { runLocalUserDataMutation } from './local-mutation-coordinator';
import { storage } from './storage';
import {
  initialURLHasNavigationIntent,
  SAFE_NAVIGATION_DESTINATIONS,
  safeNavigationDestinationFromURL,
  safeNavigationDestinationForSegments
} from '../utils/navigation-intent';

export {
  initialURLHasNavigationIntent,
  SAFE_NAVIGATION_DESTINATIONS,
  safeNavigationDestinationFromURL,
  safeNavigationDestinationForSegments
} from '../utils/navigation-intent';

export const NAVIGATION_DESTINATION_KEY = 'veryloving.navigation.destination';
export const NAVIGATION_DESTINATION_VERSION = 1;

const SAFE_DESTINATION_SET = new Set(SAFE_NAVIGATION_DESTINATIONS);

let mutationQueue = Promise.resolve();

function normalizeAccountId(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 512 ? normalized : null;
}

export function persistSafeNavigationDestination(accountId, destination) {
  const normalizedAccountId = normalizeAccountId(accountId);
  if (!normalizedAccountId || !SAFE_DESTINATION_SET.has(destination)) return Promise.resolve(false);

  const snapshot = {
    version: NAVIGATION_DESTINATION_VERSION,
    accountId: normalizedAccountId,
    destination
  };
  const previousMutation = mutationQueue;
  const operation = runLocalUserDataMutation(async () => {
    await previousMutation.catch(() => {});
    await storage.setJSON(NAVIGATION_DESTINATION_KEY, snapshot);
    return true;
  });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function loadSafeNavigationDestination(accountId) {
  const normalizedAccountId = normalizeAccountId(accountId);
  if (!normalizedAccountId) return null;
  await mutationQueue.catch(() => {});
  const snapshot = await storage.getJSON(NAVIGATION_DESTINATION_KEY, null);
  if (
    snapshot?.version !== NAVIGATION_DESTINATION_VERSION
    || snapshot.accountId !== normalizedAccountId
    || !SAFE_DESTINATION_SET.has(snapshot.destination)
  ) return null;
  return snapshot.destination;
}

export async function restoreSafeNavigationDestination(accountId, initialURL) {
  if (initialURLHasNavigationIntent(initialURL)) {
    // Expo Router normally opens a deep link directly. If route protection
    // temporarily redirected a signed-out user through auth/onboarding, the
    // root index is mounted instead; resolving the original allowlisted URL
    // here preserves that intent without ever restoring a high-risk modal.
    return safeNavigationDestinationFromURL(initialURL);
  }
  return loadSafeNavigationDestination(accountId);
}
