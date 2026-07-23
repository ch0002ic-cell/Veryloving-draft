function loadExpoConstants() {
  try {
    const constantsModule = require('expo-constants');
    return constantsModule.default || constantsModule;
  } catch {
    return null;
  }
}

function defaultDevelopmentMode() {
  if (typeof __DEV__ !== 'undefined') return __DEV__ === true;
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
}

function normalizeApplicationModule(applicationModule) {
  const candidates = [applicationModule, applicationModule?.default];
  return candidates.find((candidate) => candidate
    && typeof candidate.getIosApplicationReleaseTypeAsync === 'function'
    && Number.isFinite(candidate.ApplicationReleaseType?.SIMULATOR)) || null;
}

export function runtimePlatformOS(
  constants = loadExpoConstants(),
  expoOS = typeof process !== 'undefined' ? process.env?.EXPO_OS : undefined
) {
  if (['ios', 'android', 'web'].includes(expoOS)) return expoOS;
  if (constants?.platform?.ios) return 'ios';
  if (constants?.platform?.android) return 'android';
  if (constants?.platform?.web) return 'web';
  return null;
}

/**
 * SDK 57 reports both Expo Go and development clients as `storeClient`, while
 * `expoVersion` is populated only by the Expo Go host. Keep app ownership as
 * the primary signal and use the newer execution-environment value only when
 * that Expo Go-only discriminator is also present.
 */
export function isExpoGoRuntime(constants = loadExpoConstants()) {
  return constants?.appOwnership === 'expo'
    || (constants?.executionEnvironment === 'storeClient' && Boolean(constants?.expoVersion));
}

/**
 * Detect the iOS Simulator without loading provider SDKs that may touch the
 * Keychain during evaluation. expo-application is the primary signal; the
 * deprecated Constants model is retained only as a compatibility fallback.
 */
export async function detectIOSSimulatorRuntime({
  platformOS = runtimePlatformOS(),
  constants = loadExpoConstants(),
  loadApplication = () => import('expo-application')
} = {}) {
  if (platformOS !== 'ios') return false;

  const legacyModel = constants?.platform?.ios?.model;
  if (typeof legacyModel === 'string' && /simulator/i.test(legacyModel)) return true;

  try {
    const Application = normalizeApplicationModule(await loadApplication());
    if (!Application) return false;
    const releaseType = await Application.getIosApplicationReleaseTypeAsync();
    return releaseType === Application.ApplicationReleaseType.SIMULATOR;
  } catch {
    // An unavailable metadata preflight must never expose demo auth on an
    // unknown runtime or incorrectly block a real-device provider flow.
    return false;
  }
}

export function createAuthenticationRuntime({
  isDevelopment = defaultDevelopmentMode,
  isExpoGo = isExpoGoRuntime,
  isDemoAuthEnabled = () => {
    const extra = constants?.expoConfig?.extra ?? constants?.manifest?.extra ?? {};
    if (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_DEMO_AUTH_ENABLED === 'true') {
      return true;
    }
    if (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_DEMO_AUTH_ENABLED === 'false') {
      return false;
    }
    return extra.demoAuthEnabled === true;
  },
  platformOS = runtimePlatformOS,
  constants = loadExpoConstants(),
  loadApplication = () => import('expo-application')
} = {}) {
  let simulatorPromise = null;

  const isIOSSimulator = () => {
    if (!simulatorPromise) {
      const resolvedPlatform = typeof platformOS === 'function' ? platformOS() : platformOS;
      simulatorPromise = detectIOSSimulatorRuntime({
        platformOS: resolvedPlatform,
        constants,
        loadApplication
      });
    }
    return simulatorPromise;
  };

  const isDemoModeAvailable = async () => {
    const development = typeof isDevelopment === 'function' ? isDevelopment() : isDevelopment;
    const enabled = typeof isDemoAuthEnabled === 'function'
      ? isDemoAuthEnabled()
      : isDemoAuthEnabled;
    if (development !== true || enabled !== true || isExpoGo(constants)) return false;
    const resolvedPlatform = typeof platformOS === 'function' ? platformOS() : platformOS;
    if (resolvedPlatform === 'android') return true;
    if (resolvedPlatform !== 'ios') return false;
    return isIOSSimulator();
  };

  return Object.freeze({ isIOSSimulator, isDemoModeAvailable });
}

export const authenticationRuntime = createAuthenticationRuntime();
