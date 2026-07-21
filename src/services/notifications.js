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
import { secureStorage } from './secure-storage';

export const PENDING_PUSH_UNREGISTER_KEY = 'veryloving.push.pendingUnregister.v1';
const PUSH_UNREGISTER_RECEIPT_PATTERN = /^[A-Za-z0-9_-]{80,1024}$/;
let pushRegistrationQueue = Promise.resolve();

function serializePushRegistration(operation) {
  const next = pushRegistrationQueue.catch(() => {}).then(operation);
  pushRegistrationQueue = next.catch(() => {});
  return next;
}

async function pendingUnregisterReceipt() {
  const raw = await secureStorage.getItemAsync(PENDING_PUSH_UNREGISTER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && PUSH_UNREGISTER_RECEIPT_PATTERN.test(parsed.receipt || '')) {
      return parsed.receipt;
    }
  } catch {}
  await secureStorage.deleteItemAsync(PENDING_PUSH_UNREGISTER_KEY);
  return null;
}

async function retryPendingReceipt(options = {}) {
  const receipt = await pendingUnregisterReceipt();
  if (!receipt) return true;
  await safetyRequest('/v1/devices/push-token/receipt', {
    ...options,
    // The receipt is a narrowly scoped bearer capability. The generic safety
    // client requires a non-empty credential, while this endpoint deliberately
    // does not accept an account session after logout.
    accessToken: 'push-unregister-receipt',
    method: 'DELETE',
    body: { receipt }
  });
  await secureStorage.deleteItemAsync(PENDING_PUSH_UNREGISTER_KEY);
  return true;
}

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
  return serializePushRegistration(async () => {
    // Never bind one physical token to a second account while a durable
    // unregistration receipt for its prior owner is still outstanding.
    await retryPendingReceipt(options);
    const Notifications = await notificationsRuntime.getModule();
    if (!Notifications || !accessToken) return false;
    const permissions = await Notifications.getPermissionsAsync();
    if (permissions.status !== 'granted') return false;
    const projectId = Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return false;
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!result?.data) return false;
    const registration = await safetyRequest('/v1/devices/push-token', {
      ...options,
      accessToken,
      method: 'POST',
      body: { token: result.data }
    });
    if (!PUSH_UNREGISTER_RECEIPT_PATTERN.test(registration?.unregisterReceipt || '')) {
      const error = new Error('The push registration server returned an invalid unregistration receipt.');
      error.code = 'PUSH_UNREGISTER_RECEIPT_INVALID';
      throw error;
    }
    await secureStorage.setItemAsync(PENDING_PUSH_UNREGISTER_KEY, JSON.stringify({
      version: 1,
      receipt: registration.unregisterReceipt
    }));
    return true;
  });
}

export function retryPendingPushTokenUnregister(options = {}) {
  return serializePushRegistration(() => retryPendingReceipt(options));
}
