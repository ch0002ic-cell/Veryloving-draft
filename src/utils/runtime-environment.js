function loadExpoConstants() {
  try {
    const constantsModule = require('expo-constants');
    return constantsModule.default || constantsModule;
  } catch {
    return null;
  }
}

/**
 * SDK 57 reports both Expo Go and development clients as `storeClient`.
 * `appOwnership === "expo"` is therefore the narrow check that does not
 * accidentally disable native capabilities in a development build.
 */
export function isExpoGoRuntime(constants = loadExpoConstants()) {
  return constants?.appOwnership === 'expo';
}
