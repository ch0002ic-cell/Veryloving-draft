import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? Constants.manifest?.extra ?? {};

export const config = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || extra.apiBaseUrl || 'https://veryloving-backend-production.up.railway.app',
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || extra.googleWebClientId || '',
  humeWSProxyURL: process.env.EXPO_PUBLIC_HUME_WS_PROXY_URL || '', // Only use env; no fallback to extra
  humeConfigId: process.env.EXPO_PUBLIC_HUME_CONFIG_ID || extra.humeConfigId || '',
  humeApiKey: __DEV__ ? process.env.EXPO_PUBLIC_HUME_API_KEY || '' : '',
  humeCustomizationURL: process.env.EXPO_PUBLIC_HUME_CUSTOMIZATION_URL || extra.humeCustomizationURL || process.env.EXPO_PUBLIC_API_BASE_URL || extra.apiBaseUrl || 'https://veryloving-backend-production.up.railway.app',
  humeBrandedVoiceId: process.env.EXPO_PUBLIC_HUME_BRANDED_VOICE_ID || extra.humeBrandedVoiceId || '',
  humeCLMEnabled: process.env.EXPO_PUBLIC_HUME_CLM_ENABLED === 'true' || extra.humeCLMEnabled === true,
  mapboxAccessToken: process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || extra.mapboxAccessToken || '',
  enableOfflineMode: process.env.EXPO_PUBLIC_ENABLE_OFFLINE_MODE === 'true' || extra.enableOfflineMode === true
};
