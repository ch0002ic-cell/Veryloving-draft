function loadExpoConstants() {
  try {
    const constantsModule = require('expo-constants');
    return constantsModule.default || constantsModule;
  } catch {
    return null;
  }
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
