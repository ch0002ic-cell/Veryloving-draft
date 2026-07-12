const fallbackConfig = require('./app.json');

module.exports = ({ config: expo = fallbackConfig } = {}) => {
  const mapboxAccessToken = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '';
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || expo.extra.apiBaseUrl;
  const humeWSProxyURL = process.env.EXPO_PUBLIC_HUME_WS_PROXY_URL || expo.extra.humeWSProxyURL;
  const humeConfigId = process.env.EXPO_PUBLIC_HUME_CONFIG_ID || expo.extra.humeConfigId;
  const humeCustomizationURL = process.env.EXPO_PUBLIC_HUME_CUSTOMIZATION_URL || apiBaseUrl;
  const humeBrandedVoiceId = process.env.EXPO_PUBLIC_HUME_BRANDED_VOICE_ID || '';
  const humeCLMEnabled = process.env.EXPO_PUBLIC_HUME_CLM_ENABLED === 'true';
  const enableOfflineMode = process.env.EXPO_PUBLIC_ENABLE_OFFLINE_MODE === 'true';

  return {
    ...expo,
    extra: {
      ...expo.extra,
      apiBaseUrl,
      humeWSProxyURL,
      humeConfigId,
      humeCustomizationURL,
      humeBrandedVoiceId,
      humeCLMEnabled,
      mapboxAccessToken,
      enableOfflineMode
    }
  };
};
