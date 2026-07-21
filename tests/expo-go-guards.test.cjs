'use strict';

const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  createNotificationsRuntime,
  detectNotificationsUnavailableReason,
  NOTIFICATIONS_UNAVAILABLE
} = require('../src/services/notifications-runtime');
const {
  createSecureStorage,
  detectSecureStorageMemoryReason,
  isExpectedEphemeralStorageReason,
  SECURE_STORAGE_MEMORY_REASON
} = require('../src/services/secure-storage');
const {
  createAuthenticationRuntime,
  detectIOSSimulatorRuntime,
  isExpoGoRuntime,
  runtimePlatformOS
} = require('../src/utils/runtime-environment');

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
  assert.equal(runtimePlatformOS({ platform: { ios: {} } }, undefined), 'ios');
  assert.equal(runtimePlatformOS({ platform: { android: {} } }, undefined), 'android');
  assert.equal(runtimePlatformOS(null, 'web'), 'web');
});

test('auth runtime detects iOS Simulator without loading provider SDKs', async () => {
  let applicationLoads = 0;
  const simulator = await detectIOSSimulatorRuntime({
    platformOS: 'ios',
    constants: null,
    loadApplication: async () => {
      applicationLoads += 1;
      return {
        ApplicationReleaseType: { SIMULATOR: 1, DEVELOPMENT: 3 },
        getIosApplicationReleaseTypeAsync: async () => 1
      };
    }
  });
  assert.equal(simulator, true);
  assert.equal(applicationLoads, 1);

  assert.equal(await detectIOSSimulatorRuntime({
    platformOS: 'ios',
    constants: { platform: { ios: { model: 'iPhone Simulator' } } },
    loadApplication: async () => { throw new Error('legacy fallback should win'); }
  }), true);
  assert.equal(await detectIOSSimulatorRuntime({
    platformOS: 'android',
    loadApplication: async () => { throw new Error('Android must not load iOS metadata'); }
  }), false);
  assert.equal(await detectIOSSimulatorRuntime({
    platformOS: 'ios',
    constants: null,
    loadApplication: async () => { throw new Error('stale metadata module'); }
  }), false);
});

test('demo authentication is limited to non-Expo-Go development simulators', async () => {
  const runtime = ({ development = true, expoGo = false, releaseType = 1 } = {}) => createAuthenticationRuntime({
    isDevelopment: () => development,
    isExpoGo: () => expoGo,
    platformOS: () => 'ios',
    constants: null,
    loadApplication: async () => ({
      ApplicationReleaseType: { SIMULATOR: 1, DEVELOPMENT: 3 },
      getIosApplicationReleaseTypeAsync: async () => releaseType
    })
  });

  assert.equal(await runtime().isDemoModeAvailable(), true);
  assert.equal(await runtime({ development: false }).isDemoModeAvailable(), false);
  assert.equal(await runtime({ expoGo: true }).isDemoModeAvailable(), false);
  assert.equal(await runtime({ releaseType: 3 }).isDemoModeAvailable(), false);
});

test('notification runtime never evaluates expo-notifications in Expo Go', async () => {
  let loads = 0;
  let skips = 0;
  const runtime = createNotificationsRuntime({
    getUnavailableReason: async () => NOTIFICATIONS_UNAVAILABLE.EXPO_GO,
    loadNotifications: async () => {
      loads += 1;
      throw new Error('The native notification package must not load.');
    },
    onUnavailable: () => { skips += 1; }
  });

  assert.equal(await runtime.isAvailable(), false);
  assert.equal(await runtime.getModule(), null);
  assert.equal(await runtime.getModule(), null);
  assert.equal(loads, 0);
  assert.equal(skips, 1);
});

test('notification preflight skips Expo Go and iOS Simulator before native notification import', async () => {
  let applicationLoads = 0;
  const expoGoReason = await detectNotificationsUnavailableReason({
    isExpoGo: () => true,
    platformOS: 'ios',
    loadApplication: async () => {
      applicationLoads += 1;
      throw new Error('Expo Go must not evaluate application metadata either.');
    }
  });
  assert.equal(expoGoReason, NOTIFICATIONS_UNAVAILABLE.EXPO_GO);
  assert.equal(applicationLoads, 0);

  let pushEnvironmentReads = 0;
  const simulatorReason = await detectNotificationsUnavailableReason({
    isExpoGo: () => false,
    platformOS: 'ios',
    loadApplication: async () => {
      applicationLoads += 1;
      return {
        ApplicationReleaseType: { SIMULATOR: 1 },
        getIosApplicationReleaseTypeAsync: async () => 1,
        getIosPushNotificationServiceEnvironmentAsync: async () => {
          pushEnvironmentReads += 1;
          return null;
        }
      };
    }
  });
  assert.equal(simulatorReason, NOTIFICATIONS_UNAVAILABLE.IOS_SIMULATOR);
  assert.equal(applicationLoads, 1);
  assert.equal(pushEnvironmentReads, 0);
});

test('notification preflight gates provisioned iOS builds without disabling App Store installs', async () => {
  let applicationLoads = 0;
  const loadApplication = (releaseType, pushEnvironment) => async () => {
    applicationLoads += 1;
    return {
      ApplicationReleaseType: { SIMULATOR: 1, APP_STORE: 5 },
      getIosApplicationReleaseTypeAsync: async () => releaseType,
      getIosPushNotificationServiceEnvironmentAsync: async () => pushEnvironment
    };
  };

  assert.equal(await detectNotificationsUnavailableReason({
    isExpoGo: () => false,
    platformOS: 'ios',
    loadApplication: loadApplication(3, 'development')
  }), null);
  assert.equal(await detectNotificationsUnavailableReason({
    isExpoGo: () => false,
    platformOS: 'ios',
    // Store/TestFlight installs may not expose their provisioning profile to
    // expo-application; retain normal production notification loading.
    loadApplication: loadApplication(5, null)
  }), null);
  assert.equal(await detectNotificationsUnavailableReason({
    isExpoGo: () => false,
    platformOS: 'ios',
    loadApplication: loadApplication(3, null)
  }), NOTIFICATIONS_UNAVAILABLE.IOS_APNS_ENTITLEMENT);
  assert.equal(await detectNotificationsUnavailableReason({
    isExpoGo: () => false,
    platformOS: 'android',
    loadApplication: loadApplication(0, null)
  }), null);
  assert.equal(applicationLoads, 3);
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
    getUnavailableReason: async () => null,
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
  assert.equal(await runtime.isAvailable(), true);
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
  assert.equal(storage.volatileReason, SECURE_STORAGE_MEMORY_REASON.EXPO_GO);
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

test('secure-storage preflight selects memory before native Keychain loading on iOS Simulator', async () => {
  let applicationLoads = 0;
  let nativeLoads = 0;
  let memoryModeLogs = 0;
  const storage = createSecureStorage({
    isExpoGo: () => false,
    platformOS: () => 'ios',
    loadApplication: async () => {
      applicationLoads += 1;
      return {
        ApplicationReleaseType: { SIMULATOR: 1 },
        getIosApplicationReleaseTypeAsync: async () => 1
      };
    },
    loadSecureStore: () => {
      nativeLoads += 1;
      throw new Error('Unsigned simulator must not evaluate SecureStore.');
    },
    onMemoryMode: (reason) => {
      memoryModeLogs += 1;
      assert.equal(reason, SECURE_STORAGE_MEMORY_REASON.IOS_SIMULATOR);
    }
  });

  assert.equal(storage.isVolatile, false);
  assert.equal(storage.volatileReason, null);
  assert.equal(await storage.getItemAsync('session'), null);
  await storage.setItemAsync('session', 'volatile');
  assert.equal(await storage.getItemAsync('session'), 'volatile');
  assert.equal(storage.isVolatile, true);
  assert.equal(storage.volatileReason, SECURE_STORAGE_MEMORY_REASON.IOS_SIMULATOR);
  assert.equal(applicationLoads, 1);
  assert.equal(nativeLoads, 0);
  assert.equal(memoryModeLogs, 1);
});

test('secure-storage preflight preserves native storage on signed physical iOS builds', async () => {
  const values = new Map();
  let applicationLoads = 0;
  let nativeLoads = 0;
  const storage = createSecureStorage({
    isExpoGo: () => false,
    platformOS: 'ios',
    loadApplication: async () => {
      applicationLoads += 1;
      return {
        ApplicationReleaseType: { SIMULATOR: 1, DEVELOPMENT: 3, APP_STORE: 5 },
        getIosApplicationReleaseTypeAsync: async () => 3
      };
    },
    loadSecureStore: async () => {
      nativeLoads += 1;
      return {
        getItemAsync: async (key) => values.get(key) ?? null,
        setItemAsync: async (key, value) => values.set(key, value),
        deleteItemAsync: async (key) => values.delete(key)
      };
    }
  });

  await storage.setItemAsync('session', 'persistent');
  assert.equal(await storage.getItemAsync('session'), 'persistent');
  assert.equal(storage.isVolatile, false);
  assert.equal(applicationLoads, 1);
  assert.equal(nativeLoads, 1);
});

test('secure-storage iOS preflight fails closed when application metadata is unavailable', async () => {
  let nativeLoads = 0;
  const reason = await detectSecureStorageMemoryReason({
    isExpoGo: () => false,
    platformOS: 'ios',
    loadApplication: async () => ({ default: {} })
  });
  assert.equal(reason, SECURE_STORAGE_MEMORY_REASON.IOS_PREFLIGHT_FAILED);

  const storage = createSecureStorage({
    isExpoGo: () => false,
    platformOS: 'ios',
    loadApplication: async () => { throw new Error('stale native metadata module'); },
    loadSecureStore: () => {
      nativeLoads += 1;
      throw new Error('SecureStore must remain unloaded after a failed preflight.');
    }
  });
  assert.equal(await storage.getItemAsync('session'), null);
  assert.equal(storage.isVolatile, true);
  assert.equal(storage.volatileReason, SECURE_STORAGE_MEMORY_REASON.IOS_PREFLIGHT_FAILED);
  assert.equal(nativeLoads, 0);
});

test('only expected development hosts may recover ciphertext after an ephemeral key reset', () => {
  assert.equal(isExpectedEphemeralStorageReason(SECURE_STORAGE_MEMORY_REASON.EXPO_GO), true);
  assert.equal(isExpectedEphemeralStorageReason(SECURE_STORAGE_MEMORY_REASON.IOS_SIMULATOR), true);
  assert.equal(isExpectedEphemeralStorageReason(SECURE_STORAGE_MEMORY_REASON.IOS_PREFLIGHT_FAILED), false);
  assert.equal(isExpectedEphemeralStorageReason(null), false);
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
  assert.match(notifications, /getUnavailableReason:[\s\S]*isExpoGo: isExpoGoRuntime[\s\S]*loadApplication: \(\) => import\('expo-application'\)[\s\S]*loadNotifications: \(\) => import\('expo-notifications'\)/);
  assert.doesNotMatch(mapbox, /import Mapbox from ['"]@rnmapbox\/maps['"]/);
  assert.match(mapbox, /getModule\(\) \{[\s\S]*if \(isExpoGo\(\)\) return null;/);
  assert.doesNotMatch(auth, /import .*expo-secure-store/);
  assert.match(auth, /if \(!secureStorage\.isVolatile\) \{[\s\S]*Could not restore the secure session/);
  assert.doesNotMatch(secureStorage, /import .*expo-secure-store/);
  assert.doesNotMatch(secureStorage, /require\(['"]expo-secure-store['"]\)/);
  assert.match(secureStorage, /loadApplication = \(\) => import\('expo-application'\)/);
  assert.match(secureStorage, /loadSecureStore = \(\) => import\('expo-secure-store'\)/);
  const secureStorageInvoke = secureStorage.slice(
    secureStorage.indexOf('const invoke = async'),
    secureStorage.indexOf('return {', secureStorage.indexOf('const invoke = async'))
  );
  assert.ok(
    secureStorageInvoke.indexOf('if (memoryReason) return memoryBackend')
      < secureStorageInvoke.indexOf('await getNativeBackend()'),
    'Every operation must select preflighted memory before requesting the dynamic SecureStore module'
  );
  assert.doesNotMatch(auth, /import .*expo-apple-authentication/);
  assert.match(auth, /authenticationCapabilities\(config, \{[\s\S]*expoGo: isExpoGoRuntime\(\)/);
  assert.match(auth, /const signInWithApple[\s\S]*requireCapability\('apple'\)[\s\S]*import\('expo-apple-authentication'\)/);
  assert.match(auth, /const signInWithGoogle[\s\S]*requireCapability\('google'\)[\s\S]*import\('@react-native-google-signin\/google-signin'\)/);
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
