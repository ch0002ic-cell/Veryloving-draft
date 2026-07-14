import { Text } from 'react-native';
import { Redirect } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Card } from '../src/components/Card';
import { config } from '../src/utils/config';
import { useI18n } from '../src/context/I18nContext';

function safeConfigSummary() {
  return {
    apiBaseUrlConfigured: Boolean(config.apiBaseUrl),
    appleClientIdConfigured: Boolean(config.appleClientId),
    googleWebClientIdConfigured: Boolean(config.googleWebClientId),
    googleIOSClientIdConfigured: Boolean(config.googleIOSClientId),
    humeWebSocketProxyConfigured: Boolean(config.humeWSProxyURL),
    humeConfigIdConfigured: Boolean(config.humeConfigId),
    humeDirectDevelopmentKeyConfigured: Boolean(config.humeApiKey),
    humeCustomizationConfigured: Boolean(config.humeCustomizationURL),
    humeCLMEnabled: config.humeCLMEnabled,
    mapboxConfigured: Boolean(config.mapboxAccessToken),
    offlineModeForced: config.enableOfflineMode
  };
}

export default function Debug() {
  const { t } = useI18n();
  if (!__DEV__) return <Redirect href="/" />;
  return <Screen><Header title={t('debug.title')} subtitle={t('debug.subtitle')} showBack backLabel={t('common.back')} /><Card><Text>{JSON.stringify(safeConfigSummary(), null, 2)}</Text></Card></Screen>;
}
