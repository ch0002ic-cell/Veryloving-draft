export const SAFE_NAVIGATION_DESTINATIONS = Object.freeze([
  '/(tabs)',
  '/(tabs)/map',
  '/settings',
  '/voices',
  '/device-management',
  '/emergency-contacts',
  '/friends',
  '/conversation-history',
  '/capybear-tap'
]);

const SAFE_DESTINATION_SET = new Set(SAFE_NAVIGATION_DESTINATIONS);
const SAFE_ROOT_ROUTES = new Set(
  SAFE_NAVIGATION_DESTINATIONS
    .filter((destination) => !destination.startsWith('/(tabs)'))
    .map((destination) => destination.slice(1))
);
const TRUSTED_WEB_HOSTS = new Set(['veryloving.ai', 'www.veryloving.ai']);
const MAX_SYSTEM_PATH_LENGTH = 8192;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const GOOGLE_CALLBACK_PROTOCOL_PATTERN = /^com\.googleusercontent\.apps\.[a-z0-9.-]+:$/i;

function safeDestinationForRoute(rawRoute) {
  if (typeof rawRoute !== 'string') return null;
  // Encoded separators are interpreted inconsistently across URL parsers and
  // native navigation stacks. Only canonical literal route separators pass.
  if (/%(?:2f|5c)/i.test(rawRoute)) return null;
  let decodedRoute;
  try {
    decodedRoute = decodeURIComponent(rawRoute);
  } catch {
    return null;
  }
  if (CONTROL_CHARACTER_PATTERN.test(decodedRoute) || decodedRoute.includes('\\')) return null;
  const route = decodedRoute.replace(/^\/+|\/+$/g, '');
  if (!route || route === 'home' || route === '(tabs)' || route === '(tabs)/index') {
    return '/(tabs)';
  }
  if (route === 'map' || route === '(tabs)/map') return '/(tabs)/map';
  const destination = `/${route}`;
  return SAFE_DESTINATION_SET.has(destination) ? destination : null;
}

function routeFromURL(url) {
  const expoRouteMarker = '/--/';
  const path = url.pathname || '';
  if (path.includes(expoRouteMarker)) {
    return path.slice(path.indexOf(expoRouteMarker) + expoRouteMarker.length);
  }
  if (url.protocol === 'veryloving:') return `${url.hostname || ''}/${path}`;
  return path;
}

function isEmptyNavigationURL(url) {
  if (url.protocol === 'veryloving:') return !url.hostname && !url.pathname.replace(/\//g, '');
  return !url.pathname.replace(/\//g, '');
}

export function safeNavigationDestinationForSegments(segments) {
  if (!Array.isArray(segments) || !segments.length) return null;
  const normalized = segments.map((segment) => String(segment || '').trim());

  if (normalized[0] === '(tabs)') {
    if (normalized.length === 1 || (normalized.length === 2 && normalized[1] === 'index')) {
      return '/(tabs)';
    }
    if (normalized.length === 2 && normalized[1] === 'map') return '/(tabs)/map';
    return null;
  }

  if (normalized.length === 1 && SAFE_ROOT_ROUTES.has(normalized[0])) {
    return `/${normalized[0]}`;
  }
  return null;
}

export function initialURLHasNavigationIntent(initialURL) {
  if (typeof initialURL !== 'string' || !initialURL.trim()) return false;
  try {
    const url = new globalThis.URL(initialURL);
    const path = decodeURIComponent(url.pathname || '');
    const expoRouteMarker = '/--/';
    if (path.includes(expoRouteMarker)) {
      return Boolean(path.slice(path.indexOf(expoRouteMarker) + expoRouteMarker.length).replace(/^\/+|\/+$/g, ''));
    }
    if (url.protocol === 'veryloving:') {
      return Boolean(`${url.hostname || ''}/${path}`.replace(/^\/+|\/+$/g, ''));
    }
    return Boolean(path.replace(/^\/+|\/+$/g, ''));
  } catch {
    // A non-empty malformed launch URL is still external navigation intent.
    // Conservatively avoid replacing it with stale local history.
    return true;
  }
}

export function safeNavigationDestinationFromURL(initialURL) {
  if (typeof initialURL !== 'string' || !initialURL.trim()) return null;
  try {
    const url = new globalThis.URL(initialURL.trim());
    const trustedWebURL = url.protocol === 'https:' && TRUSTED_WEB_HOSTS.has(url.hostname);
    const customSchemeURL = url.protocol === 'veryloving:';
    const expoDevelopmentURL = url.protocol === 'exp:' || url.protocol === 'exps:';
    if (!trustedWebURL && !customSchemeURL && !expoDevelopmentURL) return null;
    if ((trustedWebURL || customSchemeURL) && (url.username || url.password || url.port)) return null;
    return safeDestinationForRoute(routeFromURL(url));
  } catch {
    return null;
  }
}

/**
 * Expo Router invokes this boundary only for URLs delivered by the operating
 * system. Internal router pushes do not pass through it. Recognized app links
 * are reduced to a query-free allowlisted route; unknown and malformed links
 * fail closed instead of reaching a generated file route.
 */
export function sanitizeSystemNavigationPath(path, { initial = false } = {}) {
  const rejectedDestination = initial ? '/' : null;
  if (
    typeof path !== 'string'
    || !path.trim()
    || path.length > MAX_SYSTEM_PATH_LENGTH
    || CONTROL_CHARACTER_PATTERN.test(path)
  ) return rejectedDestination;

  const input = path.trim();
  let url;
  try {
    url = new globalThis.URL(input);
  } catch {
    // Expo Router may provide an already-extracted path. Keep that case behind
    // the same allowlist, while rejecting malformed absolute schemes.
    if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return rejectedDestination;
    const pathOnly = input.split(/[?#]/, 1)[0];
    if (!pathOnly.replace(/\//g, '')) return '/';
    return safeDestinationForRoute(pathOnly) || rejectedDestination;
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol === 'veryloving:') {
    if (url.username || url.password || url.port) return rejectedDestination;
    if (isEmptyNavigationURL(url)) return '/';
    return safeNavigationDestinationFromURL(input) || rejectedDestination;
  }

  if (protocol === 'https:') {
    if (
      !TRUSTED_WEB_HOSTS.has(url.hostname)
      || url.username
      || url.password
      || url.port
    ) return rejectedDestination;
    if (isEmptyNavigationURL(url)) return '/';
    return safeNavigationDestinationFromURL(input) || rejectedDestination;
  }
  if (protocol === 'http:') return rejectedDestination;

  // Development-client and Expo Go entry URLs are consumed by Expo itself.
  if (protocol === 'exp:' || protocol === 'exps:' || protocol.startsWith('exp+')) return input;

  // Native Google Sign-In consumes its callback before Router. Returning null
  // ensures a duplicated Linking event cannot become an application route.
  if (
    GOOGLE_CALLBACK_PROTOCOL_PATTERN.test(protocol)
    || protocol === 'com.veryloving.app:'
  ) return null;

  return rejectedDestination;
}
