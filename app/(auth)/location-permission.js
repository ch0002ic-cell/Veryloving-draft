import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Text } from 'react-native';
import { requestCurrentLocation } from '../../src/services/mapbox';
import { fonts } from '../../src/constants/theme';

export default function LocationPermission() {
  return <Screen><Header title="Location safety" subtitle="Used for map, danger zones, safe arrival, and SOS context." /><Card><Text style={{ fontFamily: fonts.regular }}>VeryLoving asks for location so guardians can understand where help may be needed. You can change this later in Settings.</Text></Card><Button title="Allow location" onPress={async () => { await requestCurrentLocation({ showRationale: false }).catch(() => {}); router.push('/(auth)/notification-permission'); }} /><Button title="Skip for now" variant="ghost" onPress={() => router.push('/(auth)/notification-permission')} /></Screen>;
}
