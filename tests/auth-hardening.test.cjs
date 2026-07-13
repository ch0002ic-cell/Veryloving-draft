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

test('choose-voice onboarding provides a real selector before completion', () => {
  const { readFileSync } = require('node:fs');
  const screen = readFileSync(
    path.resolve(process.cwd(), 'app/(auth)/tutorial/choose-voice.js'),
    'utf8'
  );
  assert.match(screen, /voiceProfiles\.map/);
  assert.match(screen, /await updateSettings\(\{ selectedVoiceId: voiceId \}\)/);
  assert.match(screen, /catch \(error\)/);
  assert.match(screen, /logger\.warn\('\[Onboarding\] Could not persist voice selection'/);
  assert.match(screen, /router\.push\('\/\(auth\)\/completion'\)/);
  assert.doesNotMatch(screen, /router\.(?:push|replace)\('\/voices'\)/);
});

test('dashboard safety-mode persistence failures are handled without claiming delivery', () => {
  const { readFileSync } = require('node:fs');
  const dashboard = readFileSync(
    path.resolve(process.cwd(), 'app/(tabs)/index.js'),
    'utf8'
  );
  assert.match(dashboard, /await updateSettings\(\{ mode \}\)/);
  assert.match(dashboard, /catch \(error\)/);
  assert.match(dashboard, /Alert\.alert\(t\('settings\.updateFailedTitle'\)/);
  assert.doesNotMatch(dashboard, /contacts? (?:were )?notified|guardians? (?:were )?notified/i);
});

test('country picker modal establishes a safe-area boundary', () => {
  const { readFileSync } = require('node:fs');
  const picker = readFileSync(
    path.resolve(process.cwd(), 'src/components/CountryPicker.js'),
    'utf8'
  );
  assert.match(picker, /SafeAreaProvider, SafeAreaView/);
  assert.match(picker, /<Modal[\s\S]*<SafeAreaProvider>[\s\S]*<SafeAreaView/);
});

test('language picker modal establishes its own safe-area boundary', () => {
  const { readFileSync } = require('node:fs');
  const picker = readFileSync(
    path.resolve(process.cwd(), 'src/components/LanguageSelector.js'),
    'utf8'
  );
  assert.match(picker, /SafeAreaProvider, SafeAreaView/);
  assert.match(picker, /<Modal[\s\S]*<SafeAreaProvider>[\s\S]*<SafeAreaView/);
});

test('Google Sign-In fails before invoking native code when its client ID is missing', () => {
  const { readFileSync } = require('node:fs');
  const auth = readFileSync(
    path.resolve(process.cwd(), 'src/context/AuthContext.js'),
    'utf8'
  );
  const guard = auth.indexOf('if (!config.googleWebClientId)');
  const nativeImport = auth.indexOf("require('@react-native-google-signin/google-signin')");
  assert.notEqual(guard, -1);
  assert.ok(guard < nativeImport, 'Google configuration must be checked before loading its native module');
  assert.match(auth, /GoogleSignin\.configure\(\{[\s\S]*webClientId: config\.googleWebClientId/);
  assert.match(auth, /iosClientId: config\.googleIOSClientId/);
  assert.match(auth, /exchangeProviderIdentity/);
  assert.doesNotMatch(auth, /await persist\(identity\.user, identity\.identityToken\)/);
});

test('Apple Sign-In binds a secure nonce and exchanges the provider credential', () => {
  const { readFileSync } = require('node:fs');
  const auth = readFileSync(path.resolve(process.cwd(), 'src/context/AuthContext.js'), 'utf8');
  assert.match(auth, /const nonce = createAuthenticationNonce\(\)/);
  assert.match(auth, /AppleAuthentication\.signInAsync\(\{[\s\S]*nonce/);
  assert.match(auth, /provider: 'apple'[\s\S]*idToken: credential\.identityToken[\s\S]*nonce/);
});

test('production UI cannot create an in-memory demo guardian', () => {
  const { readFileSync } = require('node:fs');
  const friends = readFileSync(path.resolve(process.cwd(), 'app/friends.js'), 'utf8');
  assert.match(friends, /__DEV__ && config\.enableMockPhoneAuth/);
  assert.match(friends, /friends\.addDemo/);
});

test('root navigation has a render error boundary', () => {
  const { readFileSync } = require('node:fs');
  const layout = readFileSync(path.resolve(process.cwd(), 'app/_layout.js'), 'utf8');
  assert.match(layout, /<LocalizedErrorBoundary>[\s\S]*<LocalizedNavigation \/>/);
  const boundary = readFileSync(path.resolve(process.cwd(), 'src/components/AppErrorBoundary.js'), 'utf8');
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /componentDidCatch/);
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
