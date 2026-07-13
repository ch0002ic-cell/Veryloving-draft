export const ONBOARDING_STATE_VERSION = 1;

function normalizedUserId(userId) {
  if (userId === null || userId === undefined) return null;
  const value = String(userId).trim();
  return value || null;
}

export function createOnboardingMarker(userId) {
  const normalized = normalizedUserId(userId);
  if (!normalized) throw new Error('A signed-in user is required to complete onboarding.');
  return { userId: normalized, version: ONBOARDING_STATE_VERSION };
}

export function isOnboardingMarkerValid(rawMarker, userId) {
  const normalized = normalizedUserId(userId);
  if (!rawMarker || !normalized) return false;

  try {
    const marker = typeof rawMarker === 'string' ? JSON.parse(rawMarker) : rawMarker;
    return marker?.version === ONBOARDING_STATE_VERSION
      && marker?.userId === normalized;
  } catch {
    return false;
  }
}
