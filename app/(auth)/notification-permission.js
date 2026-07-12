import { router } from 'expo-router';
import { Text } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { requestNotificationPermission } from '../../src/services/notifications';
import { fonts } from '../../src/constants/theme';

export default function NotificationPermission() {
  return <Screen><Header title="Safety alerts" subtitle="Notifications support check-ins and emergency events." /><Card><Text style={{ fontFamily: fonts.regular }}>We only use notifications for safety prompts, emergency updates, and reminders you enable.</Text></Card><Button title="Enable notifications" onPress={async () => { await requestNotificationPermission({ showRationale: false }); router.push('/(auth)/device-check'); }} /><Button title="Skip" variant="ghost" onPress={() => router.push('/(auth)/device-check')} /></Screen>;
}
