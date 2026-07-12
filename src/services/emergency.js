import { Alert, Linking } from 'react-native';
import { scheduleLocalSafetyNotification } from './notifications';
import { translate } from '../i18n/core';

export async function triggerSOS(contacts = []) {
  await scheduleLocalSafetyNotification(translate('emergency.notificationTitle'), translate('emergency.notificationBody'));
  const first = contacts[0];
  Alert.alert(
    translate('emergency.readyTitle'),
    first ? translate('emergency.callContact', { name: first.name }) : translate('emergency.addContact')
  );
}

export function callNumber(phone) {
  if (!phone) return;
  Linking.openURL(`tel:${phone}`);
}

export function shareQuickLocation() {
  Alert.alert(translate('emergency.quickShareTitle'), translate('emergency.quickShareMessage'));
}
