'use strict';

const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  AUTHENTICATED_ONBOARDING_ROUTES,
  PROTECTED_ROOT_ROUTES,
  PUBLIC_AUTH_ROUTES
} = require('../src/utils/auth-routing');
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

test('phone authentication uses the backend and keeps PII out of route parameters', () => {
  const auth = readFileSync(path.resolve(process.cwd(), 'src/context/AuthContext.js'), 'utf8');
  const client = readFileSync(path.resolve(process.cwd(), 'src/services/auth-session.js'), 'utf8');
  const createAccount = readFileSync(path.resolve(process.cwd(), 'app/(auth)/create-account.js'), 'utf8');
  const verifyCode = readFileSync(path.resolve(process.cwd(), 'app/(auth)/verify-code.js'), 'utf8');

  assert.match(client, /'\/v1\/auth\/phone\/start'/);
  assert.match(client, /'\/v1\/auth\/phone\/verify'/);
  assert.match(auth, /requestPhoneVerification/);
  assert.match(auth, /confirmPhoneVerification/);
  assert.doesNotMatch(auth, /dev-access-token|123456|mock-phone-auth/i);
  assert.match(createAccount, /router\.push\('\/\(auth\)\/verify-code'\)/);
  assert.doesNotMatch(createAccount, /params:\s*\{[^}]*phone/);
  assert.doesNotMatch(verifyCode, /useLocalSearchParams|verificationId\s*=\s*routeValue/);
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

test('Google Sign-In checks runtime capabilities before loading native code', () => {
  const auth = readFileSync(
    path.resolve(process.cwd(), 'src/context/AuthContext.js'),
    'utf8'
  );
  const google = auth.slice(auth.indexOf('const signInWithGoogle'), auth.indexOf('const signInWithPhone'));
  const guard = google.indexOf("requireCapability('google')");
  const simulatorPreflight = google.indexOf("requireProviderRuntime('google')");
  const nativeImport = google.indexOf("import('@react-native-google-signin/google-signin')");
  assert.notEqual(guard, -1);
  assert.notEqual(simulatorPreflight, -1);
  assert.ok(guard < nativeImport, 'Google configuration must be checked before loading its native module');
  assert.ok(simulatorPreflight < nativeImport, 'Google simulator detection must run before loading its native module');
  assert.match(google, /GoogleSignin\.configure\(\{[\s\S]*webClientId: config\.googleWebClientId/);
  assert.match(google, /iosClientId: config\.googleIOSClientId/);
  assert.match(google, /exchangeProviderIdentity/);
  assert.doesNotMatch(google, /await persist\(identity\.user, identity\.identityToken\)/);
});

test('Apple Sign-In binds a secure nonce and exchanges the provider credential', () => {
  const { readFileSync } = require('node:fs');
  const auth = readFileSync(path.resolve(process.cwd(), 'src/context/AuthContext.js'), 'utf8');
  const appleButton = readFileSync(path.resolve(process.cwd(), 'src/components/AppleSignInButton.js'), 'utf8');
  const createAccount = readFileSync(path.resolve(process.cwd(), 'app/(auth)/create-account.js'), 'utf8');
  assert.doesNotMatch(auth, /import .*expo-apple-authentication/);
  assert.match(auth, /const signInWithApple[\s\S]*import\('expo-apple-authentication'\)/);
  const apple = auth.slice(auth.indexOf('const signInWithApple'), auth.indexOf('const signInWithGoogle'));
  assert.ok(
    apple.indexOf("requireProviderRuntime('apple')") < apple.indexOf("import('expo-apple-authentication')"),
    'Apple simulator detection must run before loading its native module'
  );
  assert.match(auth, /const nonce = createAuthenticationNonce\(\)/);
  assert.match(auth, /AppleAuthentication\.signInAsync\(\{[\s\S]*nonce/);
  assert.match(auth, /provider: 'apple'[\s\S]*idToken: credential\.identityToken[\s\S]*nonce/);
  const nativeButtonEffect = appleButton.slice(
    appleButton.indexOf('useEffect(() =>'),
    appleButton.indexOf('}, [nativeModuleAllowed])')
  );
  assert.ok(
    nativeButtonEffect.indexOf('nativeModuleAllowed !== true')
      < nativeButtonEffect.indexOf("import('expo-apple-authentication')"),
    'The Apple button must resolve simulator eligibility before evaluating the native package'
  );
  assert.match(createAccount, /nativeModuleAllowed=\{isIOSSimulator === null \? null : !isIOSSimulator\}/);
});

test('development demo auth is volatile, internally guarded, and never creates a bearer token', () => {
  const auth = readFileSync(path.resolve(process.cwd(), 'src/context/AuthContext.js'), 'utf8');
  const authLayout = readFileSync(
    path.resolve(process.cwd(), 'app/(auth)/_layout.js'),
    'utf8'
  );
  const createAccount = readFileSync(
    path.resolve(process.cwd(), 'app/(auth)/create-account.js'),
    'utf8'
  );
  const demoStart = auth.indexOf('const continueAsDemo = useCallback');
  const demoEnd = auth.indexOf('\n\n  const signInWithPhone', demoStart);
  assert.notEqual(demoStart, -1);
  assert.notEqual(demoEnd, -1);
  const demo = auth.slice(demoStart, demoEnd);

  assert.match(demo, /authenticationRuntime\.isDemoModeAvailable\(\)/);
  assert.match(demo, /setAccessToken\(null\)/);
  assert.match(demo, /setUser\(DEVELOPMENT_DEMO_USER\)/);
  assert.match(demo, /setOnboardingComplete\(true\)/);
  assert.match(demo, /setSessionStatus\('demo'\)/);
  assert.doesNotMatch(demo, /persist\(|secureStorage|exchangeProviderIdentity|createSessionEnvelope|JWT|token\s*=/i);
  assert.match(auth, /signedInProvider === 'demo'[\s\S]*setSessionStatus\('signed-out'\)[\s\S]*return/);

  assert.match(createAccount, /demoModeAvailable \? \(/);
  assert.match(createAccount, /Continue as demo \(development only\)/);
  assert.match(createAccount, /Demo mode uses local fake data only/);
  const demoHandler = createAccount.slice(
    createAccount.indexOf('const startDemo'),
    createAccount.indexOf('\n\n  return (')
  );
  assert.match(demoHandler, /await continueAsDemo\(\)/);
  assert.doesNotMatch(demoHandler, /router\.(?:push|replace)/);
  assert.match(authLayout, /if \(user && onboardingComplete\) return <Redirect href="\/\(tabs\)" \/>/);
  assert.doesNotMatch(createAccount, /demo-access-token|fake-jwt|Bearer demo/i);
});

test('demo and tokenless sessions keep connected safety and voice services offline', () => {
  const appContext = readFileSync(path.resolve(process.cwd(), 'src/context/AppContext.js'), 'utf8');
  const home = readFileSync(path.resolve(process.cwd(), 'app/(tabs)/index.js'), 'utf8');
  const emergency = readFileSync(path.resolve(process.cwd(), 'src/services/emergency.js'), 'utf8');
  const privacy = readFileSync(path.resolve(process.cwd(), 'src/services/privacy.js'), 'utf8');
  const voice = readFileSync(path.resolve(process.cwd(), 'src/hooks/useHumeVoiceCall.js'), 'utf8');

  assert.match(appContext, /syncRemote = config\.safetyBackendEnabled && Boolean\(accessToken\)/);
  assert.match(home, /config\.safetyBackendEnabled && accessToken/);
  assert.match(emergency, /backendEnabled = config\.safetyBackendEnabled && Boolean\(accessToken\)/);
  assert.match(privacy, /config\.safetyBackendEnabled && accessToken/);
  assert.match(voice, /forcedOffline = isDemoMode \|\| config\.enableOfflineMode/);
});

test('auth persistence writes one account-bound secure envelope', () => {
  const { readFileSync } = require('node:fs');
  const auth = readFileSync(path.resolve(process.cwd(), 'src/context/AuthContext.js'), 'utf8');
  const persist = auth.slice(auth.indexOf('const persist = useCallback'), auth.indexOf('const completeOnboarding'));
  assert.match(persist, /createSessionEnvelope\(\{[\s\S]*accessToken:[\s\S]*refreshToken:[\s\S]*user: nextUser/);
  assert.match(persist, /setItemAsync\(SESSION_KEY, serializedEnvelope\)/);
  assert.match(persist, /storage\.remove\(SIGNED_OUT_KEY\)/);
  assert.doesNotMatch(persist, /setItemAsync\((?:LEGACY_)?(?:TOKEN|REFRESH_TOKEN|USER)_KEY/);
  assert.match(persist, /setUser\(null\)[\s\S]*setAccessToken\(null\)[\s\S]*setSessionStatus\('signed-out'\)/);
});

test('auth restore migrates only validated legacy sessions and refresh stays atomic', () => {
  const { readFileSync } = require('node:fs');
  const auth = readFileSync(path.resolve(process.cwd(), 'src/context/AuthContext.js'), 'utf8');
  const start = auth.indexOf('const refreshSession');
  const refresh = auth.slice(start, auth.indexOf('refreshSessionRef.current = refreshSession', start));
  assert.match(auth, /migrateLegacySession\(\{[\s\S]*accessToken: legacyToken[\s\S]*refreshToken: legacyRefresh[\s\S]*user: legacyUser/);
  assert.match(refresh, /createSessionEnvelope\(\{[\s\S]*user: persistedEnvelope\.user/);
  assert.match(refresh, /setItemAsync\(SESSION_KEY, JSON\.stringify\(nextEnvelope\)\)/);
  assert.doesNotMatch(refresh, /setItemAsync\((?:LEGACY_)?(?:TOKEN|REFRESH_TOKEN|USER)_KEY/);
  assert.match(auth, /storage\.setJSON\(SIGNED_OUT_KEY[\s\S]*invalidatePersistedSession/);
});

test('privacy deletion keeps sign-out progressing after protected Keychain cleanup failures', () => {
  const privacy = readFileSync(path.resolve(process.cwd(), 'src/services/privacy.js'), 'utf8');
  const deletion = privacy.slice(privacy.indexOf('export async function deleteAllUserData'));
  const tombstone = deletion.indexOf('storage.setJSON(AUTH_STORAGE_KEYS.signedOut');
  const cleanup = deletion.indexOf('Promise.allSettled');
  assert.notEqual(tombstone, -1);
  assert.ok(tombstone < cleanup, 'The signed-out tombstone must precede best-effort Keychain cleanup');
  assert.match(deletion, /secureStoreFailures: \(Number\(result\.secureStoreFailures\) \|\| 0\) \+ secureStoreFailures/);
  assert.doesNotMatch(deletion, /await Promise\.all\(\[/);
});

test('production UI contains no in-memory demo guardian action', () => {
  const friends = readFileSync(path.resolve(process.cwd(), 'app/friends.js'), 'utf8');
  assert.doesNotMatch(friends, /addDemo|enableMockPhoneAuth|__DEV__/);
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
  const requestPermissionStart = screen.indexOf('const requestPermission = useCallback');
  const requestPermissionEnd = screen.indexOf('\n\n  const openNotificationSettings', requestPermissionStart);
  assert.notEqual(requestPermissionStart, -1);
  assert.notEqual(requestPermissionEnd, -1);
  const requestPermission = screen.slice(requestPermissionStart, requestPermissionEnd);
  assert.match(requestPermission, /requestNotificationPermission/);
  assert.match(requestPermission, /catch(?: \([^)]*\))? \{/);
  assert.match(requestPermission, /setPermissionDenied\(true\)/);
  assert.match(screen, /setAvailabilityCheckFailed\(true\)/);
  assert.match(screen, /availabilityCheckFailed \? retryAvailabilityCheck : undefined/);
  assert.match(screen, /setPermissionDenied\(true\)/);
  assert.match(screen, /Linking\.openSettings\(\)/);
  assert.match(screen, /permissionDenied \? openNotificationSettings : requestPermission/);
  assert.match(screen, /<FeedbackBanner[\s\S]*?message=\{error\}/);
  assert.match(screen, /disabled=\{busy \|\| notificationsAvailable === null\}/);
});
