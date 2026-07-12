import { Image, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { images } from '../src/constants/assets';
import { triggerSOS } from '../src/services/emergency';
import { useAppState } from '../src/context/AppContext';
import { fonts } from '../src/constants/theme';

export default function EmergencySOS() {
  const { contacts } = useAppState();
  return <Screen><Header title="Emergency SOS" subtitle="Escalate only when you need immediate support." /><Image source={images.star} style={{ width: '100%', height: 160 }} resizeMode="contain" /><Card><Text style={{ fontFamily: fonts.regular }}>This will notify your safety flow and prepare emergency contacts.</Text></Card><Button title="Activate SOS" variant="danger" onPress={() => triggerSOS(contacts)} /><Button title="Call AI companion" onPress={() => router.push('/safety-call')} /><Button title="Cancel" variant="ghost" onPress={() => router.back()} /></Screen>;
}
