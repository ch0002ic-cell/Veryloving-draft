import { router } from 'expo-router';
import { Text } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { requestNotificationPermission } from '../../src/services/notifications';
import { fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';

export default function NotificationPermission() {
  const { t } = useI18n();
  return <Screen><Header title={t('permissions.notificationsTitle')} subtitle={t('permissions.notificationsSubtitle')} /><Card><Text style={{ fontFamily: fonts.regular }}>{t('permissions.notificationsBody')}</Text></Card><Button title={t('permissions.enableNotifications')} onPress={async () => { await requestNotificationPermission({ showRationale: false }); router.push('/(auth)/device-check'); }} /><Button title={t('common.skip')} variant="ghost" onPress={() => router.push('/(auth)/device-check')} /></Screen>;
}
