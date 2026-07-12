import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { explainPermission } from './permissions';
import { translate } from '../i18n/core';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false })
});

export async function requestNotificationPermission({ showRationale = true } = {}) {
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    if (showRationale && !await explainPermission('notifications')) return false;
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('safety', { name: translate('notifications.channelName'), importance: Notifications.AndroidImportance.MAX });
  }
  return status === 'granted';
}

export async function scheduleLocalSafetyNotification(title, body) {
  return Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
}
