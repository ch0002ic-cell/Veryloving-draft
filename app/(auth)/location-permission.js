import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Text } from 'react-native';
import { requestCurrentLocation } from '../../src/services/mapbox';
import { fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';

export default function LocationPermission() {
  const { t } = useI18n();
  return <Screen><Header title={t('permissions.locationTitle')} subtitle={t('permissions.locationSubtitle')} /><Card><Text style={{ fontFamily: fonts.regular }}>{t('permissions.locationBody')}</Text></Card><Button title={t('permissions.allowLocation')} onPress={async () => { await requestCurrentLocation({ showRationale: false }).catch(() => {}); router.push('/(auth)/notification-permission'); }} /><Button title={t('common.skipForNow')} variant="ghost" onPress={() => router.push('/(auth)/notification-permission')} /></Screen>;
}
