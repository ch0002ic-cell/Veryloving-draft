import Constants from 'expo-constants';
import { isDevelopmentMockEnabled } from './mock-phone-auth';
import { createVL01Protocol } from '../services/vl01-protocol';

const extra = Constants.expoConfig?.extra ?? Constants.manifest?.extra ?? {};
const mockPhoneAuthRequested = process.env.EXPO_PUBLIC_ENABLE_MOCK_PHONE_AUTH === 'true'
  || extra.enableMockPhoneAuth === true;

export const config = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || extra.apiBaseUrl || '',
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || extra.googleWebClientId || '',
  googleIOSClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || extra.googleIOSClientId || '',
  humeWSProxyURL: process.env.EXPO_PUBLIC_HUME_WS_PROXY_URL || '', // Only use env; no fallback to extra
  humeConfigId: process.env.EXPO_PUBLIC_HUME_CONFIG_ID || extra.humeConfigId || '',
  humeApiKey: __DEV__ ? process.env.EXPO_PUBLIC_HUME_API_KEY || '' : '',
  humeCustomizationURL: process.env.EXPO_PUBLIC_HUME_CUSTOMIZATION_URL || extra.humeCustomizationURL || process.env.EXPO_PUBLIC_API_BASE_URL || extra.apiBaseUrl || '',
  humeBrandedVoiceId: process.env.EXPO_PUBLIC_HUME_BRANDED_VOICE_ID || extra.humeBrandedVoiceId || '',
  humeCLMEnabled: process.env.EXPO_PUBLIC_HUME_CLM_ENABLED === 'true' || extra.humeCLMEnabled === true,
  mapboxAccessToken: process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || extra.mapboxAccessToken || '',
  safetyBackendEnabled: process.env.EXPO_PUBLIC_SAFETY_BACKEND_ENABLED === 'true' || extra.safetyBackendEnabled === true,
  enableOfflineMode: process.env.EXPO_PUBLIC_ENABLE_OFFLINE_MODE === 'true' || extra.enableOfflineMode === true,
  enableMockPhoneAuth: isDevelopmentMockEnabled({
    requested: mockPhoneAuthRequested,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
    nodeEnv: process.env.NODE_ENV
  }),
  vl01Protocol: createVL01Protocol({
    enabled: process.env.EXPO_PUBLIC_VL01_ENABLED === 'true' || extra.vl01Enabled === true,
    serviceUUID: process.env.EXPO_PUBLIC_VL01_SERVICE_UUID || extra.vl01ServiceUUID,
    batteryCharacteristicUUID: process.env.EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID || extra.vl01BatteryCharacteristicUUID,
    statusCharacteristicUUID: process.env.EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID || extra.vl01StatusCharacteristicUUID,
    eventCharacteristicUUID: process.env.EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID || extra.vl01EventCharacteristicUUID,
    commandCharacteristicUUID: process.env.EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID || extra.vl01CommandCharacteristicUUID
  })
};
