import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { explainPermission } from './permissions';
import { translate } from '../i18n/core';
import { logger } from '../utils/logger';
import { isExpoGoRuntime } from '../utils/runtime-environment';
import {
  createNotificationsRuntime,
  detectNotificationsUnavailableReason,
  NOTIFICATIONS_UNAVAILABLE
} from './notifications-runtime';
import { safetyRequest } from './safety-api';

const notificationsRuntime = createNotificationsRuntime({
  getUnavailableReason: () => detectNotificationsUnavailableReason({
    isExpoGo: isExpoGoRuntime,
    platformOS: Platform.OS,
    // expo-application reads the provisioning profile without touching the
    // notification registration Keychain state.
    loadApplication: () => import('expo-application')
  }),
  // The package root starts a Keychain-backed registration read during module
  // initialization. Never evaluate it until the runtime and APNs preflight has
  // passed.
  loadNotifications: () => import('expo-notifications'),
  onUnavailable: (reason) => logger.info(
    reason === NOTIFICATIONS_UNAVAILABLE.EXPO_GO
      ? '[Notifications] Expo Go detected; notification initialization is skipped'
      : reason === NOTIFICATIONS_UNAVAILABLE.IOS_SIMULATOR
        ? '[Notifications] iOS Simulator detected; notification initialization is skipped'
        : '[Notifications] APNs entitlement unavailable; notification initialization is skipped'
  )
});

export async function notificationsAvailableInRuntime() {
  return notificationsRuntime.isAvailable();
}

export async function initializeNotifications() {
  return Boolean(await notificationsRuntime.getModule());
}

export async function getNotificationsModule() {
  return notificationsRuntime.getModule();
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

export async function registerDevicePushToken(accessToken, options = {}) {
  const Notifications = await notificationsRuntime.getModule();
  if (!Notifications || !accessToken) return false;
  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') return false;
  const projectId = Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return false;
  const result = await Notifications.getExpoPushTokenAsync({ projectId });
  if (!result?.data) return false;
  await safetyRequest('/v1/devices/push-token', {
    ...options,
    accessToken,
    method: 'POST',
    body: { token: result.data }
  });
  return true;
}
