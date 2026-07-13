'use strict';

const assert = require('node:assert/strict');
const { readdirSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  AUTHENTICATED_ONBOARDING_ROUTES,
  PROTECTED_ROOT_ROUTES,
  PUBLIC_AUTH_ROUTES
} = require('../src/utils/auth-routing');
const {
  MOCK_PHONE_VERIFICATION_CODE,
  MOCK_PHONE_VERIFICATION_TTL_MS,
  createMockPhoneVerification,
  isDevelopmentMockEnabled,
  isValidMockPhoneVerification
} = require('../src/utils/mock-phone-auth');
const {
  ONBOARDING_STATE_VERSION,
  createOnboardingMarker,
  isOnboardingMarkerValid
} = require('../src/utils/onboarding-state');

function routeNames(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('_')) return [];
    if (entry.isDirectory()) return [entry.name];
    return entry.name.endsWith('.js') ? [entry.name.slice(0, -3)] : [];
  }).sort();
}

test('every root route is explicitly public or protected', () => {
  const appDirectory = path.resolve(process.cwd(), 'app');
  const classified = ['index', '(auth)', ...PROTECTED_ROOT_ROUTES].sort();
  assert.deepEqual(routeNames(appDirectory), classified);
});

test('every authentication route is assigned to exactly one access state', () => {
  const authDirectory = path.resolve(process.cwd(), 'app', '(auth)');
  const classified = [...PUBLIC_AUTH_ROUTES, ...AUTHENTICATED_ONBOARDING_ROUTES];
  assert.equal(new Set(classified).size, classified.length);
  assert.deepEqual(routeNames(authDirectory), classified.slice().sort());
  assert.equal(AUTHENTICATED_ONBOARDING_ROUTES[0], 'location-permission');
});

test('phone mock must be explicitly requested in development or test only', () => {
  assert.equal(isDevelopmentMockEnabled({ requested: true, isDev: true }), true);
  assert.equal(isDevelopmentMockEnabled({ requested: true, nodeEnv: 'test' }), true);
  assert.equal(isDevelopmentMockEnabled({ requested: false, isDev: true }), false);
  assert.equal(isDevelopmentMockEnabled({ requested: true, isDev: false, nodeEnv: 'production' }), false);
});

test('phone mock binds an unexpired verification ID to the exact six-digit code', () => {
  const issuedAt = 1000;
  const challenge = createMockPhoneVerification(
    { phone: '+14155552671', countryCode: 'US' },
    { now: () => issuedAt, random: () => 0.25 }
  );

  assert.equal(isValidMockPhoneVerification(challenge, {
    verificationId: challenge.verificationId,
    code: MOCK_PHONE_VERIFICATION_CODE
  }, () => issuedAt + 1), true);
  assert.equal(isValidMockPhoneVerification(challenge, {
    verificationId: 'fabricated-id',
    code: MOCK_PHONE_VERIFICATION_CODE
  }, () => issuedAt + 1), false);
  assert.equal(isValidMockPhoneVerification(challenge, {
    verificationId: challenge.verificationId,
    code: '000000'
  }, () => issuedAt + 1), false);
  assert.equal(isValidMockPhoneVerification(challenge, {
    verificationId: challenge.verificationId,
    code: '1234'
  }, () => issuedAt + 1), false);
  assert.equal(isValidMockPhoneVerification(challenge, {
    verificationId: challenge.verificationId,
    code: MOCK_PHONE_VERIFICATION_CODE
  }, () => issuedAt + MOCK_PHONE_VERIFICATION_TTL_MS), false);
});

test('onboarding completion is versioned and bound to the authenticated account', () => {
  const marker = createOnboardingMarker('apple-user-a');
  assert.deepEqual(marker, {
    userId: 'apple-user-a',
    version: ONBOARDING_STATE_VERSION
  });
  assert.equal(isOnboardingMarkerValid(JSON.stringify(marker), 'apple-user-a'), true);
  assert.equal(isOnboardingMarkerValid(JSON.stringify(marker), 'apple-user-b'), false);
  assert.equal(isOnboardingMarkerValid({ ...marker, version: ONBOARDING_STATE_VERSION + 1 }, 'apple-user-a'), false);
  assert.equal(isOnboardingMarkerValid('not-json', 'apple-user-a'), false);
  assert.equal(isOnboardingMarkerValid(null, 'apple-user-a'), false);
});

test('all onboarding exits pass through the completion gate', () => {
  const projectRoot = process.cwd();
  const onboardingFiles = [
    'app/(auth)/capybear-setup.js',
    'app/(auth)/capybear-reminder.js',
    'app/(auth)/tutorial/choose-voice.js',
    'app/(auth)/tutorial/onsen-scene.js',
    'app/(auth)/tutorial/safety-call.js',
    'src/components/TutorialPage.js'
  ];
  const { readFileSync } = require('node:fs');
  for (const relativePath of onboardingFiles) {
    const contents = readFileSync(path.resolve(projectRoot, relativePath), 'utf8');
    assert.equal(contents.includes('/(tabs)'), false, `${relativePath} bypasses completion`);
    assert.equal(contents.includes('/(auth)/completion'), true, `${relativePath} must use completion`);
  }

  const completion = readFileSync(path.resolve(projectRoot, 'app/(auth)/completion.js'), 'utf8');
  assert.match(completion, /await completeOnboarding\(\)/);
  assert.match(completion, /router\.replace\('\/\(tabs\)'\)/);
});

test('cold-start resume sends incomplete accounts to the first permission step', () => {
  const { readFileSync } = require('node:fs');
  const index = readFileSync(path.resolve(process.cwd(), 'app/index.js'), 'utf8');
  assert.match(index, /onboardingComplete \? '\/\(tabs\)' : '\/\(auth\)\/location-permission'/);
  assert.doesNotMatch(index, /onboardingComplete \? '\/\(tabs\)' : '\/\(auth\)\/device-check'/);
});

test('notification permission screen catches native errors and prevents duplicate navigation', () => {
  const { readFileSync } = require('node:fs');
  const screen = readFileSync(
    path.resolve(process.cwd(), 'app/(auth)/notification-permission.js'),
    'utf8'
  );
  assert.match(screen, /requestingRef\.current \|\| navigatingRef\.current/);
  assert.match(screen, /catch \(permissionError\)/);
  assert.match(screen, /<FeedbackBanner message=\{error\}/);
  assert.match(screen, /disabled=\{busy\}/);
});
