import { Alert, Linking } from 'react-native';
import { scheduleLocalSafetyNotification } from './notifications';

export async function triggerSOS(contacts = []) {
  await scheduleLocalSafetyNotification('SOS activated', 'Your emergency flow is ready.');
  const first = contacts[0];
  Alert.alert('SOS ready', first ? `Call ${first.name}?` : 'Add an emergency contact in Settings.');
}

export function callNumber(phone) {
  if (!phone) return;
  Linking.openURL(`tel:${phone}`);
}

export function shareQuickLocation() {
  Alert.alert('Quick share', 'Location sharing stub is ready. Connect backend share endpoint to send live links.');
}
