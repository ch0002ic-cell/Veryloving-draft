function loadExpoConstants() {
  try {
    const constantsModule = require('expo-constants');
    return constantsModule.default || constantsModule;
  } catch {
    return null;
  }
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
