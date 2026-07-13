'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createNotificationsRuntime } = require('../src/services/notifications-runtime');
const { createSecureStorage } = require('../src/services/secure-storage');
const { isExpoGoRuntime } = require('../src/utils/runtime-environment');

test('Expo Go detection does not misclassify an SDK 57 development client', () => {
  assert.equal(isExpoGoRuntime({ appOwnership: 'expo', executionEnvironment: 'storeClient' }), true);
  assert.equal(isExpoGoRuntime({ appOwnership: null, executionEnvironment: 'storeClient' }), false);
  assert.equal(isExpoGoRuntime({ appOwnership: null, executionEnvironment: 'standalone' }), false);
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

test('Expo Go falls back to process memory only after native SecureStore fails', async () => {
  let nativeLoads = 0;
  const storage = createSecureStorage({
    isExpoGo: () => true,
    loadSecureStore: () => {
      nativeLoads += 1;
      throw new Error('Keychain entitlement is unavailable.');
    }
  });

  await storage.setItemAsync('token', 'value');
  assert.equal(storage.isVolatile, true);
  assert.equal(await storage.getItemAsync('token'), 'value');
  await storage.deleteItemAsync('token');
  assert.equal(await storage.getItemAsync('token'), null);
  assert.equal(nativeLoads, 1);
  await storage.setItemAsync('session', 'volatile');

  const restartedStorage = createSecureStorage({
    isExpoGo: () => true,
    loadSecureStore: () => { throw new Error('Keychain entitlement is unavailable.'); }
  });
  assert.equal(await restartedStorage.getItemAsync('session'), null);
});

test('Expo Go keeps supported native SecureStore persistence instead of forcing volatility', async () => {
  const values = new Map();
  const loadSecureStore = () => ({
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => values.set(key, value),
    deleteItemAsync: async (key) => values.delete(key)
  });
  const first = createSecureStorage({ isExpoGo: () => true, loadSecureStore });
  await first.setItemAsync('session', 'native');
  assert.equal(first.isVolatile, false);

  const restarted = createSecureStorage({ isExpoGo: () => true, loadSecureStore });
  assert.equal(await restarted.getItemAsync('session'), 'native');
  assert.equal(restarted.isVolatile, false);
});

test('development and production storage delegate to native SecureStore without fallback', async () => {
  const values = new Map();
  let loads = 0;
  const storage = createSecureStorage({
    isExpoGo: () => false,
    loadSecureStore: () => {
      loads += 1;
      return {
        getItemAsync: async (key) => values.get(key) ?? null,
        setItemAsync: async (key, value) => values.set(key, value),
        deleteItemAsync: async (key) => values.delete(key)
      };
    }
  });

  await storage.setItemAsync('token', 'native');
  assert.equal(await storage.getItemAsync('token'), 'native');
  assert.equal(loads, 1);

  const failingStorage = createSecureStorage({
    isExpoGo: () => false,
    loadSecureStore: () => { throw new Error('ExpoSecureStore is missing'); }
  });
  await assert.rejects(failingStorage.getItemAsync('token'), /ExpoSecureStore is missing/);
});

test('entitlement-sensitive native paths remain guarded without disabling supported Apple auth', () => {
  const notifications = readFileSync(path.resolve(process.cwd(), 'src/services/notifications.js'), 'utf8');
  const mapbox = readFileSync(path.resolve(process.cwd(), 'src/services/mapbox.native.js'), 'utf8');
  const auth = readFileSync(path.resolve(process.cwd(), 'src/context/AuthContext.js'), 'utf8');
  const layout = readFileSync(path.resolve(process.cwd(), 'app/_layout.js'), 'utf8');
  const i18n = readFileSync(path.resolve(process.cwd(), 'src/context/I18nContext.js'), 'utf8');
  const audio = readFileSync(path.resolve(process.cwd(), 'src/services/audio.js'), 'utf8');
  const ble = readFileSync(path.resolve(process.cwd(), 'src/services/ble.js'), 'utf8');

  assert.doesNotMatch(notifications, /import .* from ['"]expo-notifications['"]/);
  assert.match(notifications, /isExpoGo: isExpoGoRuntime[\s\S]*loadNotifications: \(\) => import\('expo-notifications'\)/);
  assert.doesNotMatch(mapbox, /import Mapbox from ['"]@rnmapbox\/maps['"]/);
  assert.match(mapbox, /getModule\(\) \{[\s\S]*if \(isExpoGo\(\)\) return null;/);
  assert.doesNotMatch(auth, /import .*expo-secure-store/);
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
