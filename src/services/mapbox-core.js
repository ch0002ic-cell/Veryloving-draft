import * as Location from 'expo-location';
import { explainPermission } from './permissions';
import { withTimeout } from '../utils/async';

export const dangerZones = [
  { id: 'queen-west', name: 'Late night crowding', coordinate: [-79.400, 43.648], radius: 220, risk: 'medium' },
  { id: 'casa-loma', name: 'Low lighting area', coordinate: [-79.409, 43.678], radius: 180, risk: 'low' }
];

export async function requestCurrentLocation({ showRationale = true } = {}) {
  const existing = await Location.getForegroundPermissionsAsync();
  if (!existing.granted && showRationale && !await explainPermission('location')) {
    throw new Error('Location access was not requested. You can enable it later from Settings.');
  }
  const permission = existing.granted ? existing : await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Location access is off. Enable it in Settings to center the safety map on you.');
  return withTimeout(
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    10000,
    'Your location is taking longer than expected. Move somewhere with a clearer signal and try again.'
  );
}
