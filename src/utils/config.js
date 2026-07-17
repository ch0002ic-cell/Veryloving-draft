import Constants from 'expo-constants';
import { createVL01Protocol } from '../services/vl01-protocol';

const extra = Constants.expoConfig?.extra ?? Constants.manifest?.extra ?? {};
const configuredString = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';

export const config = {
  apiBaseUrl: configuredString(process.env.EXPO_PUBLIC_API_BASE_URL, extra.apiBaseUrl),
  actionGatewayURL: configuredString(process.env.EXPO_PUBLIC_ACTION_GATEWAY_URL, extra.actionGatewayURL),
  // Native Sign in with Apple uses the iOS bundle identifier as the token
  // audience. It is public app metadata, not a client secret or a separate
  // mobile environment credential.
  appleClientId: configuredString(extra.appleClientId, Constants.expoConfig?.ios?.bundleIdentifier),
  googleWebClientId: configuredString(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, extra.googleWebClientId),
  googleIOSClientId: configuredString(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID, extra.googleIOSClientId),
  phoneAuthEnabled: process.env.EXPO_PUBLIC_PHONE_AUTH_ENABLED === 'true' || extra.phoneAuthEnabled === true,
  humeWSProxyURL: process.env.EXPO_PUBLIC_HUME_WS_PROXY_URL || '', // Only use env; no fallback to extra
  actionSigningPublicKey: configuredString(process.env.EXPO_PUBLIC_ACTION_SIGNING_PUBLIC_KEY, extra.actionSigningPublicKey),
  humeConfigId: process.env.EXPO_PUBLIC_HUME_CONFIG_ID || extra.humeConfigId || '',
  humeApiKey: __DEV__ ? process.env.EXPO_PUBLIC_HUME_API_KEY || '' : '',
  humeCustomizationURL: process.env.EXPO_PUBLIC_HUME_CUSTOMIZATION_URL || extra.humeCustomizationURL || process.env.EXPO_PUBLIC_API_BASE_URL || extra.apiBaseUrl || '',
  humeBrandedVoiceId: process.env.EXPO_PUBLIC_HUME_BRANDED_VOICE_ID || extra.humeBrandedVoiceId || '',
  humeCLMEnabled: process.env.EXPO_PUBLIC_HUME_CLM_ENABLED === 'true' || extra.humeCLMEnabled === true,
  mapboxAccessToken: process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || extra.mapboxAccessToken || '',
  safetyBackendEnabled: process.env.EXPO_PUBLIC_SAFETY_BACKEND_ENABLED === 'true' || extra.safetyBackendEnabled === true,
  enableOfflineMode: process.env.EXPO_PUBLIC_ENABLE_OFFLINE_MODE === 'true' || extra.enableOfflineMode === true,
  vl01Protocol: createVL01Protocol({
    enabled: process.env.EXPO_PUBLIC_VL01_ENABLED === 'true' || extra.vl01Enabled === true,
    serviceUUID: process.env.EXPO_PUBLIC_VL01_SERVICE_UUID || extra.vl01ServiceUUID,
    batteryCharacteristicUUID: process.env.EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID || extra.vl01BatteryCharacteristicUUID,
    statusCharacteristicUUID: process.env.EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID || extra.vl01StatusCharacteristicUUID,
    eventCharacteristicUUID: process.env.EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID || extra.vl01EventCharacteristicUUID,
    commandCharacteristicUUID: process.env.EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID || extra.vl01CommandCharacteristicUUID
  })
};
