import { Platform } from 'react-native';
import { explainPermission } from './permissions';
import { translate } from '../i18n/core';
import { logger } from '../utils/logger';
import { isExpoGoRuntime } from '../utils/runtime-environment';
import { createNotificationsRuntime } from './notifications-runtime';

const notificationsRuntime = createNotificationsRuntime({
  isExpoGo: isExpoGoRuntime,
  // The package root starts a Keychain-backed registration read as an import
  // side effect. Never evaluate it until the Expo Go guard has passed.
  loadNotifications: () => import('expo-notifications'),
  onExpoGoSkip: () => logger.info(
    '[Notifications] Expo Go detected; notification initialization is skipped'
  )
});

export function notificationsAvailableInRuntime() {
  return !isExpoGoRuntime();
}

export async function initializeNotifications() {
  return Boolean(await notificationsRuntime.getModule());
}

export async function requestNotificationPermission({ showRationale = true } = {}) {
  const Notifications = await notificationsRuntime.getModule();
  if (!Notifications) return false;
  // Android 13+ needs a channel before the operating system can present the
  // notification permission prompt.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('safety', {
      name: translate('notifications.channelName'),
      importance: Notifications.AndroidImportance.MAX
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    if (showRationale && !await explainPermission('notifications')) return false;
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  return status === 'granted';
}

export async function scheduleLocalSafetyNotification(title, body) {
  const Notifications = await notificationsRuntime.getModule();
  if (!Notifications) return null;
  return Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
}
