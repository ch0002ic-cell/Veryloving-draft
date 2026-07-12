import { Alert } from 'react-native';
import { storage } from './storage';

const RATIONALE_PREFIX = 'veryloving.permissionRationale.';

export const permissionRationales = {
  location: {
    title: 'Location keeps safety context accurate',
    message: 'VeryLoving uses your location for the safety map, danger zones, quick share, and SOS context. You can change this later in Settings.'
  },
  notifications: {
    title: 'Safety alerts need notifications',
    message: 'VeryLoving sends check-in reminders, emergency updates, and safety prompts you enable. We do not use notifications for ads.'
  },
  microphone: {
    title: 'Microphone powers safety calls',
    message: 'VeryLoving uses your microphone only when you start an AI companion or safety call.'
  },
  bluetooth: {
    title: 'Bluetooth connects your wearable',
    message: 'VeryLoving uses Bluetooth to pair with NorthStar jewelry, read connection status, and trigger safety flows from the wearable.'
  },
  camera: {
    title: 'Camera is optional',
    message: 'VeryLoving uses the camera only when you choose to take a profile photo or share a safety image.'
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
    Alert.alert(rationale.title, rationale.message, [
      { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Continue', onPress: () => resolve(true) }
    ]);
  });

  if (accepted) await markPermissionRationaleSeen(permissionId);
  return accepted;
}

export { RATIONALE_PREFIX };
