import { Alert } from 'react-native';
import { storage } from './storage';
import { translate } from '../i18n/core';

const RATIONALE_PREFIX = 'veryloving.permissionRationale.';

export const permissionRationales = {
  location: {
    titleKey: 'permissions.locationRationaleTitle',
    messageKey: 'permissions.locationRationaleMessage'
  },
  notifications: {
    titleKey: 'permissions.notificationsRationaleTitle',
    messageKey: 'permissions.notificationsRationaleMessage'
  },
  microphone: {
    titleKey: 'permissions.microphoneRationaleTitle',
    messageKey: 'permissions.microphoneRationaleMessage'
  },
  bluetooth: {
    titleKey: 'permissions.bluetoothRationaleTitle',
    messageKey: 'permissions.bluetoothRationaleMessage'
  },
  camera: {
    titleKey: 'permissions.cameraRationaleTitle',
    messageKey: 'permissions.cameraRationaleMessage'
  }
};

export async function hasSeenPermissionRationale(permissionId) {
  return storage.getJSON(`${RATIONALE_PREFIX}${permissionId}`, false);
}

export async function markPermissionRationaleSeen(permissionId) {
  await storage.setJSON(`${RATIONALE_PREFIX}${permissionId}`, true);
}

export async function explainPermission(permissionId, { force = false } = {}) {
  const rationale = permissionRationales[permissionId];
  if (!rationale) return true;
  if (!force && await hasSeenPermissionRationale(permissionId)) return true;

  const accepted = await new Promise((resolve) => {
    Alert.alert(translate(rationale.titleKey), translate(rationale.messageKey), [
      { text: translate('common.notNow'), style: 'cancel', onPress: () => resolve(false) },
      { text: translate('common.continue'), onPress: () => resolve(true) }
    ]);
  });

  if (accepted) await markPermissionRationaleSeen(permissionId);
  return accepted;
}

export { RATIONALE_PREFIX };
