export const ONBOARDING_STATE_VERSION = 1;
export const ONBOARDING_PROGRESS_VERSION = 1;

export const ONBOARDING_ROUTES = Object.freeze([
  '/(auth)/location-permission',
  '/(auth)/notification-permission',
  '/(auth)/device-check',
  '/(auth)/jewelry-setup',
  '/(auth)/capybear-setup',
  '/(auth)/tutorial/choose-voice',
  '/(auth)/tutorial/home-mode',
  '/(auth)/tutorial/guardian-mode',
  '/(auth)/tutorial/emergency-mode',
  '/(auth)/tutorial/excuse-call',
  '/(auth)/tutorial/safety-call',
  '/(auth)/tutorial/onsen-scene',
  '/(auth)/capybear-reminder',
  '/(auth)/completion'
]);

export const INITIAL_ONBOARDING_ROUTE = ONBOARDING_ROUTES[0];
export const COMPLETION_ONBOARDING_ROUTE = ONBOARDING_ROUTES[ONBOARDING_ROUTES.length - 1];

const ROUTE_ALIASES = Object.freeze({
  '/(auth)/emergency-mode': '/(auth)/tutorial/emergency-mode'
});

const FORWARD_TRANSITIONS = Object.freeze({
  '/(auth)/location-permission': ['/(auth)/notification-permission'],
  '/(auth)/notification-permission': ['/(auth)/device-check'],
  '/(auth)/device-check': ['/(auth)/jewelry-setup', '/(auth)/capybear-setup'],
  '/(auth)/jewelry-setup': ['/(auth)/capybear-setup'],
  '/(auth)/capybear-setup': ['/(auth)/tutorial/choose-voice', COMPLETION_ONBOARDING_ROUTE],
  '/(auth)/tutorial/choose-voice': ['/(auth)/tutorial/home-mode', COMPLETION_ONBOARDING_ROUTE],
  '/(auth)/tutorial/home-mode': ['/(auth)/tutorial/guardian-mode', COMPLETION_ONBOARDING_ROUTE],
  '/(auth)/tutorial/guardian-mode': ['/(auth)/tutorial/emergency-mode', COMPLETION_ONBOARDING_ROUTE],
  '/(auth)/tutorial/emergency-mode': ['/(auth)/tutorial/excuse-call', COMPLETION_ONBOARDING_ROUTE],
  '/(auth)/tutorial/excuse-call': ['/(auth)/tutorial/safety-call', COMPLETION_ONBOARDING_ROUTE],
  '/(auth)/tutorial/safety-call': ['/(auth)/tutorial/onsen-scene', COMPLETION_ONBOARDING_ROUTE],
  '/(auth)/tutorial/onsen-scene': ['/(auth)/capybear-reminder', COMPLETION_ONBOARDING_ROUTE],
  '/(auth)/capybear-reminder': [COMPLETION_ONBOARDING_ROUTE],
  [COMPLETION_ONBOARDING_ROUTE]: []
});

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

export function normalizeOnboardingRoute(route) {
  if (typeof route !== 'string') return null;
  const withoutQuery = route.trim().split(/[?#]/)[0].replace(/\/$/, '');
  const canonical = ROUTE_ALIASES[withoutQuery] || withoutQuery;
  return ONBOARDING_ROUTES.includes(canonical) ? canonical : null;
}

export function createOnboardingProgress(userId, route = INITIAL_ONBOARDING_ROUTE) {
  const normalizedId = normalizedUserId(userId);
  const normalizedRoute = normalizeOnboardingRoute(route);
  if (!normalizedId) throw new Error('A signed-in user is required to save onboarding progress.');
  if (!normalizedRoute) throw new Error('The onboarding route is not recognized.');
  return {
    userId: normalizedId,
    route: normalizedRoute,
    version: ONBOARDING_PROGRESS_VERSION
  };
}

export function parseOnboardingProgress(rawProgress, userId) {
  const normalizedId = normalizedUserId(userId);
  if (!normalizedId) return null;
  try {
    const progress = typeof rawProgress === 'string' ? JSON.parse(rawProgress) : rawProgress;
    if (
      progress?.version !== ONBOARDING_PROGRESS_VERSION
      || progress?.userId !== normalizedId
    ) return null;
    const route = normalizeOnboardingRoute(progress.route);
    return route ? createOnboardingProgress(normalizedId, route) : null;
  } catch {
    return null;
  }
}

export function canAdvanceOnboarding(currentRoute, nextRoute) {
  const current = normalizeOnboardingRoute(currentRoute);
  const next = normalizeOnboardingRoute(nextRoute);
  if (!current || !next) return false;
  const currentIndex = ONBOARDING_ROUTES.indexOf(current);
  const nextIndex = ONBOARDING_ROUTES.indexOf(next);
  if (nextIndex <= currentIndex) return true;
  return Boolean(FORWARD_TRANSITIONS[current]?.includes(next));
}

export function nextOnboardingProgress(currentProgress, userId, nextRoute) {
  const current = parseOnboardingProgress(currentProgress, userId)
    || createOnboardingProgress(userId);
  const next = normalizeOnboardingRoute(nextRoute);
  if (!next || !canAdvanceOnboarding(current.route, next)) {
    const error = new Error('This onboarding step is not available yet.');
    error.code = 'ONBOARDING_ROUTE_BLOCKED';
    throw error;
  }
  const currentIndex = ONBOARDING_ROUTES.indexOf(current.route);
  const nextIndex = ONBOARDING_ROUTES.indexOf(next);
  return nextIndex > currentIndex ? createOnboardingProgress(userId, next) : current;
}

export function isOnboardingRouteAllowed(requestedRoute, progressRoute) {
  const requested = normalizeOnboardingRoute(requestedRoute);
  const progress = normalizeOnboardingRoute(progressRoute) || INITIAL_ONBOARDING_ROUTE;
  if (!requested) return false;
  return ONBOARDING_ROUTES.indexOf(requested) <= ONBOARDING_ROUTES.indexOf(progress);
}
