import { router } from 'expo-router';
import { Text } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { Header } from '../../../src/components/Header';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { fonts } from '../../../src/constants/theme';

export default function TutorialPage() {
  return <Screen><Header title='Guardian mode' subtitle='Share context with trusted people.' /><Card><Text style={{ fontFamily: fonts.regular, lineHeight: 22 }}>VeryLoving keeps this flow available from Settings and the dashboard.</Text></Card><Button title='Continue' onPress={() => router.push('/(auth)/tutorial/emergency-mode')} /><Button title='Skip tutorial' variant='ghost' onPress={() => router.replace('/(tabs)')} /></Screen>;
}
