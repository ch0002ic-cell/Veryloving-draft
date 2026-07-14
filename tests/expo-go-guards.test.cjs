'use strict';

const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createNotificationsRuntime } = require('../src/services/notifications-runtime');
const { createSecureStorage } = require('../src/services/secure-storage');
const { isExpoGoRuntime } = require('../src/utils/runtime-environment');

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    return /\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(entry.name) ? [absolutePath] : [];
  });
}

test('Expo Go detection does not misclassify an SDK 57 development client', () => {
  assert.equal(isExpoGoRuntime({ appOwnership: 'expo', executionEnvironment: 'storeClient' }), true);
  assert.equal(isExpoGoRuntime({
    appOwnership: null,
    executionEnvironment: 'storeClient',
    expoVersion: '57.0.4'
  }), true);
  assert.equal(isExpoGoRuntime({ appOwnership: null, executionEnvironment: 'storeClient' }), false);
  assert.equal(isExpoGoRuntime({ appOwnership: null, executionEnvironment: 'standalone' }), false);
  assert.equal(isExpoGoRuntime(null), false);
});

test('notification runtime never evaluates expo-notifications in Expo Go', async () => {
  let loads = 0;
  let skips = 0;
  const runtime = createNotificationsRuntime({
    isExpoGo: () => true,
    loadNotifications: async () => {
      loads += 1;
      throw new Error('The native notification package must not load.');
    },
    onExpoGoSkip: () => { skips += 1; }
  });

  assert.equal(await runtime.getModule(), null);
  assert.equal(await runtime.getModule(), null);
  assert.equal(loads, 0);
  assert.equal(skips, 1);
});

test('supported notification runtime loads once, configures once, and can retry a failed import', async () => {
  let loads = 0;
  let handlers = 0;
  const notifications = {
    setNotificationHandler(handler) {
      handlers += 1;
      assert.equal(typeof handler.handleNotification, 'function');
    }
  };
  const runtime = createNotificationsRuntime({
    isExpoGo: () => false,
    loadNotifications: async () => {
      loads += 1;
      if (loads === 1) throw new Error('stale development client');
      return notifications;
    }
  });

  await assert.rejects(runtime.getModule(), /stale development client/);
  assert.equal(await runtime.getModule(), notifications);
  assert.equal(await runtime.getModule(), notifications);
  assert.equal(loads, 2);
  assert.equal(handlers, 1);
});

test('Expo Go uses process memory without evaluating native SecureStore', async () => {
  let nativeLoads = 0;
  let memoryModeLogs = 0;
  const storage = createSecureStorage({
    isExpoGo: () => true,
    loadSecureStore: () => {
      nativeLoads += 1;
      throw new Error('The native SecureStore loader must not run in Expo Go.');
    },
    onMemoryMode: () => { memoryModeLogs += 1; }
  });

  assert.equal(storage.isVolatile, true);
  assert.deepEqual(await Promise.all([
    storage.getItemAsync('veryloving.auth.token'),
    storage.getItemAsync('veryloving.auth.refreshToken'),
    storage.getItemAsync('veryloving.auth.user'),
    storage.getItemAsync('veryloving.auth.onboarding')
  ]), [null, null, null, null]);
  await Promise.all([
    storage.setItemAsync('token', 'value'),
    storage.setItemAsync('profile', 'tester')
  ]);
  assert.equal(await storage.getItemAsync('token'), 'value');
  await storage.deleteItemAsync('token');
  assert.equal(await storage.getItemAsync('token'), null);
  assert.equal(nativeLoads, 0);
  assert.equal(memoryModeLogs, 1);
});

test('Expo Go memory storage does not persist across JavaScript runtimes', async () => {
  let nativeLoads = 0;
  const options = {
    isExpoGo: () => true,
    loadSecureStore: () => {
      nativeLoads += 1;
      throw new Error('The native SecureStore loader must not run in Expo Go.');
    }
  };
  const first = createSecureStorage(options);
  await first.setItemAsync('session', 'volatile');

  const restarted = createSecureStorage(options);
  assert.equal(await restarted.getItemAsync('session'), null);
  assert.equal(restarted.isVolatile, true);
  assert.equal(nativeLoads, 0);
});

test('development and production storage delegate to native SecureStore without fallback', async () => {
  const values = new Map();
  let loads = 0;
  let memoryModeActivations = 0;
  const storage = createSecureStorage({
    isExpoGo: () => false,
    loadSecureStore: async () => {
      loads += 1;
      return {
        getItemAsync: async (key) => values.get(key) ?? null,
        setItemAsync: async (key, value) => values.set(key, value),
        deleteItemAsync: async (key) => values.delete(key)
      };
    },
    onMemoryMode: () => { memoryModeActivations += 1; }
  });

  assert.deepEqual(await Promise.all([
    storage.getItemAsync('token'),
    storage.getItemAsync('refreshToken'),
    storage.getItemAsync('user'),
    storage.getItemAsync('onboarding')
  ]), [null, null, null, null]);
  await storage.setItemAsync('token', 'native');
  assert.equal(await storage.getItemAsync('token'), 'native');
  assert.equal(loads, 1);
  assert.equal(memoryModeActivations, 0);

  let failedLoads = 0;
  const failingStorage = createSecureStorage({
    isExpoGo: () => false,
    loadSecureStore: () => {
      failedLoads += 1;
      throw new Error('ExpoSecureStore is missing');
    }
  });
  await assert.rejects(failingStorage.getItemAsync('token'), /ExpoSecureStore is missing/);
  await assert.rejects(failingStorage.getItemAsync('token'), /ExpoSecureStore is missing/);
  assert.equal(failedLoads, 2);

  let rejectingLoads = 0;
  const rejectingStorage = createSecureStorage({
    isExpoGo: () => false,
    loadSecureStore: () => {
      rejectingLoads += 1;
      return {
        getItemAsync: async () => { throw new Error('Keychain read failed'); },
        setItemAsync: async () => {},
        deleteItemAsync: async () => {}
      };
    }
  });
  await assert.rejects(rejectingStorage.getItemAsync('token'), /Keychain read failed/);
  await assert.rejects(rejectingStorage.getItemAsync('token'), /Keychain read failed/);
  assert.equal(rejectingLoads, 1);
  assert.equal(rejectingStorage.isVolatile, false);
});

test('dynamic SecureStore import normalizes default exports and retries invalid modules', async () => {
  const values = new Map();
  const backend = {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => values.set(key, value),
    deleteItemAsync: async (key) => values.delete(key)
  };
  let loads = 0;
  const storage = createSecureStorage({
    isExpoGo: () => false,
    loadSecureStore: async () => {
      loads += 1;
      return loads === 1 ? { default: {} } : { default: backend };
    }
  });

  await assert.rejects(storage.getItemAsync('token'), (error) => {
    assert.equal(error.code, 'SECURE_STORAGE_MODULE_INVALID');
    return true;
  });
  await storage.setItemAsync('token', 'native');
  assert.equal(await storage.getItemAsync('token'), 'native');
  assert.equal(loads, 2);
});

test('native Keychain package roots have exactly one guarded runtime loader each', () => {
  const roots = ['app', 'src', 'server', 'scripts', 'plugins']
    .map((directory) => path.resolve(process.cwd(), directory));
  const references = roots.flatMap(sourceFiles).flatMap((absolutePath) => {
    const source = readFileSync(absolutePath, 'utf8');
    if (!/expo-(?:secure-store|notifications)/.test(source)) return [];
    return [path.relative(process.cwd(), absolutePath)];
  }).sort();

  assert.deepEqual(references, [
    'src/services/notifications.js',
    'src/services/secure-storage.js'
  ]);
});

test('entitlement-sensitive native paths remain guarded without disabling supported Apple auth', () => {
  const notifications = readFileSync(path.resolve(process.cwd(), 'src/services/notifications.js'), 'utf8');
  const mapbox = readFileSync(path.resolve(process.cwd(), 'src/services/mapbox.native.js'), 'utf8');
  const auth = readFileSync(path.resolve(process.cwd(), 'src/context/AuthContext.js'), 'utf8');
  const layout = readFileSync(path.resolve(process.cwd(), 'app/_layout.js'), 'utf8');
  const i18n = readFileSync(path.resolve(process.cwd(), 'src/context/I18nContext.js'), 'utf8');
  const audio = readFileSync(path.resolve(process.cwd(), 'src/services/audio.js'), 'utf8');
  const ble = readFileSync(path.resolve(process.cwd(), 'src/services/ble.js'), 'utf8');
  const secureStorage = readFileSync(path.resolve(process.cwd(), 'src/services/secure-storage.js'), 'utf8');

  assert.doesNotMatch(notifications, /import .* from ['"]expo-notifications['"]/);
  assert.match(notifications, /isExpoGo: isExpoGoRuntime[\s\S]*loadNotifications: \(\) => import\('expo-notifications'\)/);
  assert.doesNotMatch(mapbox, /import Mapbox from ['"]@rnmapbox\/maps['"]/);
  assert.match(mapbox, /getModule\(\) \{[\s\S]*if \(isExpoGo\(\)\) return null;/);
  assert.doesNotMatch(auth, /import .*expo-secure-store/);
  assert.match(auth, /if \(!secureStorage\.isVolatile\) \{[\s\S]*Could not restore the secure session/);
  assert.doesNotMatch(secureStorage, /import .*expo-secure-store/);
  assert.doesNotMatch(secureStorage, /require\(['"]expo-secure-store['"]\)/);
  assert.match(secureStorage, /loadSecureStore = \(\) => import\('expo-secure-store'\)/);
  const secureStorageInvoke = secureStorage.slice(
    secureStorage.indexOf('const invoke = async'),
    secureStorage.indexOf('return {', secureStorage.indexOf('const invoke = async'))
  );
  assert.ok(
    secureStorageInvoke.indexOf('if (volatile) return memoryBackend')
      < secureStorageInvoke.indexOf('await getNativeBackend()'),
    'Every operation must select Expo Go memory before requesting the dynamic SecureStore module'
  );
  assert.doesNotMatch(auth, /import .*expo-apple-authentication/);
  assert.match(auth, /const signInWithApple[\s\S]*require\('expo-apple-authentication'\)/);
  assert.match(auth, /const signInWithGoogle[\s\S]*if \(isExpoGoRuntime\(\)\)[\s\S]*require\('@react-native-google-signin\/google-signin'\)/);
  assert.match(layout, /initializeNotifications\(\)\.catch/);
  assert.match(
    readFileSync(path.resolve(process.cwd(), 'app/(auth)/create-account.js'), 'utf8'),
    /googleSignInAvailable[\s\S]*common\.google/
  );
  assert.match(
    readFileSync(path.resolve(process.cwd(), 'app/(auth)/notification-permission.js'), 'utf8'),
    /notificationsAvailable \? t\('permissions\.enableNotifications'\) : t\('common\.continue'\)/
  );
  assert.doesNotMatch(i18n, /executionEnvironment === ['"]storeClient['"]/);
  assert.match(audio, /backgroundAudioEnabled = !isExpoGoRuntime\(\)[\s\S]*allowsBackgroundRecording: backgroundAudioEnabled/);
  assert.match(ble, /if \(this\.expoGo\)[\s\S]*this\.manager = false/);
});
