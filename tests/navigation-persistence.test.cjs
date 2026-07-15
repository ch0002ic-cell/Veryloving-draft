'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { storage } = require('../src/services/storage');
const {
  AUTHENTICATED_ONBOARDING_ROUTES,
  PROTECTED_ROOT_ROUTES,
  PUBLIC_AUTH_ROUTES
} = require('../src/utils/auth-routing');
const {
  NAVIGATION_DESTINATION_KEY,
  NAVIGATION_DESTINATION_VERSION,
  SAFE_NAVIGATION_DESTINATIONS,
  initialURLHasNavigationIntent,
  loadSafeNavigationDestination,
  persistSafeNavigationDestination,
  restoreSafeNavigationDestination,
  safeNavigationDestinationFromURL,
  safeNavigationDestinationForSegments
} = require('../src/services/navigation-persistence');
const { sanitizeSystemNavigationPath } = require('../src/utils/navigation-intent');
const { redirectSystemPath } = require('../app/+native-intent');

let storedSnapshot = null;
storage.setJSON = async (key, value) => {
  assert.equal(key, NAVIGATION_DESTINATION_KEY);
  storedSnapshot = structuredClone(value);
};
storage.getJSON = async (key, fallback) => {
  assert.equal(key, NAVIGATION_DESTINATION_KEY);
  return storedSnapshot === null ? fallback : structuredClone(storedSnapshot);
};

test('only stable protected destinations and current tabs are restorable', () => {
  assert.equal(safeNavigationDestinationForSegments(['(tabs)']), '/(tabs)');
  assert.equal(safeNavigationDestinationForSegments(['(tabs)', 'index']), '/(tabs)');
  assert.equal(safeNavigationDestinationForSegments(['(tabs)', 'map']), '/(tabs)/map');
  for (const route of [
    'settings',
    'voices',
    'device-management',
    'emergency-contacts',
    'friends',
    'conversation-history',
    'capybear-tap'
  ]) {
    assert.equal(safeNavigationDestinationForSegments([route]), `/${route}`);
  }
  for (const segments of [
    [],
    ['index'],
    ['emergency-sos'],
    ['safety-call'],
    ['ai-companion'],
    ['quick-share-location'],
    ['jewelry-setup'],
    ['debug'],
    ['(auth)', 'onboarding'],
    ['+not-found']
  ]) {
    assert.equal(safeNavigationDestinationForSegments(segments), null, segments.join('/'));
  }
  assert.equal(SAFE_NAVIGATION_DESTINATIONS.includes('/emergency-sos'), false);
  assert.equal(SAFE_NAVIGATION_DESTINATIONS.includes('/safety-call'), false);
});

test('persisted destinations are versioned, account-bound, and fail closed', async () => {
  storedSnapshot = null;
  assert.equal(await persistSafeNavigationDestination('account-a', '/settings'), true);
  assert.deepEqual(storedSnapshot, {
    version: NAVIGATION_DESTINATION_VERSION,
    accountId: 'account-a',
    destination: '/settings'
  });
  assert.equal(await loadSafeNavigationDestination('account-a'), '/settings');
  assert.equal(await loadSafeNavigationDestination('account-b'), null);
  assert.equal(await persistSafeNavigationDestination('account-a', '/emergency-sos'), false);

  storedSnapshot = { ...storedSnapshot, destination: '/safety-call' };
  assert.equal(await loadSafeNavigationDestination('account-a'), null);
  storedSnapshot = { ...storedSnapshot, destination: '/settings', version: 999 };
  assert.equal(await loadSafeNavigationDestination('account-a'), null);
});

test('cold-start restoration honors allowlisted deep links and never substitutes stale history', async () => {
  storedSnapshot = {
    version: NAVIGATION_DESTINATION_VERSION,
    accountId: 'account-a',
    destination: '/(tabs)/map'
  };
  assert.equal(initialURLHasNavigationIntent(null), false);
  assert.equal(initialURLHasNavigationIntent('veryloving://'), false);
  assert.equal(initialURLHasNavigationIntent('veryloving://settings'), true);
  assert.equal(initialURLHasNavigationIntent('veryloving:///emergency-sos'), true);
  assert.equal(initialURLHasNavigationIntent('https://veryloving.ai/friends'), true);
  assert.equal(initialURLHasNavigationIntent('exp://127.0.0.1:8081/--/voices'), true);
  assert.equal(safeNavigationDestinationFromURL('veryloving://settings'), '/settings');
  assert.equal(safeNavigationDestinationFromURL('veryloving:///map'), '/(tabs)/map');
  assert.equal(safeNavigationDestinationFromURL('https://veryloving.ai/friends'), '/friends');
  assert.equal(safeNavigationDestinationFromURL('https://example.invalid/settings'), null);
  assert.equal(safeNavigationDestinationFromURL('exp://127.0.0.1:8081/--/voices'), '/voices');
  assert.equal(safeNavigationDestinationFromURL('veryloving:///emergency-sos'), null);
  assert.equal(safeNavigationDestinationFromURL('not a URL'), null);
  assert.equal(await restoreSafeNavigationDestination('account-a', null), '/(tabs)/map');
  assert.equal(await restoreSafeNavigationDestination('account-a', 'veryloving://settings'), '/settings');
  assert.equal(await restoreSafeNavigationDestination('account-a', 'veryloving:///emergency-sos'), null);
});

test('native system links reduce recognized URLs to query-free allowlisted routes', () => {
  for (const [url, destination] of [
    ['veryloving://settings', '/settings'],
    ['veryloving:///voices?next=/emergency-sos', '/voices'],
    ['veryloving://map#unsafe-fragment', '/(tabs)/map'],
    ['https://veryloving.ai/friends?mode=debug', '/friends'],
    ['/conversation-history?next=/safety-call', '/conversation-history']
  ]) {
    assert.equal(sanitizeSystemNavigationPath(url, { initial: true }), destination, url);
    assert.equal(redirectSystemPath({ path: url, initial: false }), destination, url);
  }
  assert.equal(sanitizeSystemNavigationPath('veryloving://', { initial: true }), '/');
  assert.equal(sanitizeSystemNavigationPath('/', { initial: false }), '/');
});

test('native system links fail closed for protected high-risk and malformed routes', () => {
  const rejected = [
    'veryloving:///emergency-sos',
    'veryloving:///safety-call',
    'veryloving:///quick-share-location',
    'veryloving:///ai-companion',
    'veryloving:///jewelry-setup?mode=standalone',
    'veryloving:///debug',
    'veryloving://user@settings',
    'veryloving://settings:42',
    'veryloving://settings/%2e%2e/emergency-sos',
    'veryloving:///%2Fsettings',
    'veryloving:///%E0%A4%A',
    'http://veryloving.ai/settings',
    'https://user@veryloving.ai/',
    'https://veryloving.ai:444/',
    'https://example.invalid/settings',
    '/(auth)/tutorial/home-mode',
    '/emergency-sos'
  ];
  for (const url of rejected) {
    assert.equal(sanitizeSystemNavigationPath(url, { initial: true }), '/', `${url} cold launch`);
    assert.equal(sanitizeSystemNavigationPath(url, { initial: false }), null, `${url} warm link`);
  }
});

test('every non-allowlisted file route is unreachable through the custom scheme', () => {
  for (const route of PROTECTED_ROOT_ROUTES.filter((candidate) => candidate !== '(tabs)')) {
    const url = `veryloving:///${route}`;
    const allowlisted = safeNavigationDestinationFromURL(url);
    assert.equal(
      sanitizeSystemNavigationPath(url, { initial: false }),
      allowlisted,
      route
    );
  }
  for (const route of [...PUBLIC_AUTH_ROUTES, ...AUTHENTICATED_ONBOARDING_ROUTES]) {
    assert.equal(
      sanitizeSystemNavigationPath(`veryloving:///${route}`, { initial: false }),
      null,
      route
    );
  }
});

test('native system link boundary preserves Expo development entry and ignores provider callbacks', () => {
  const expoURL = 'exp://127.0.0.1:8081/--/settings';
  assert.equal(sanitizeSystemNavigationPath(expoURL, { initial: true }), expoURL);
  assert.equal(
    sanitizeSystemNavigationPath('com.googleusercontent.apps.123-example:/oauth', { initial: false }),
    null
  );
  assert.equal(sanitizeSystemNavigationPath('com.veryloving.app:/oauth', { initial: false }), null);
  assert.equal(sanitizeSystemNavigationPath('unknown-scheme://settings', { initial: true }), '/');
  assert.equal(sanitizeSystemNavigationPath('unknown-scheme://settings', { initial: false }), null);
});
