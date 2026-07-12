import { Text } from 'react-native';
import { Redirect } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Card } from '../src/components/Card';
import { config } from '../src/utils/config';
import { useI18n } from '../src/context/I18nContext';

export default function Debug() {
  const { t } = useI18n();
  if (!__DEV__) return <Redirect href="/" />;
  return <Screen><Header title={t('debug.title')} subtitle={t('debug.subtitle')} /><Card><Text>{JSON.stringify(config, null, 2)}</Text></Card></Screen>;
}
