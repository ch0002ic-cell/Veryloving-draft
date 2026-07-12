import { router } from 'expo-router';
import { Text } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { Header } from '../../../src/components/Header';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { fonts } from '../../../src/constants/theme';

export default function TutorialPage() {
  return <Screen><Header title='Home mode' subtitle='Quiet monitoring for daily safety.' /><Card><Text style={{ fontFamily: fonts.regular, lineHeight: 22 }}>VeryLoving keeps this flow available from Settings and the dashboard.</Text></Card><Button title='Continue' onPress={() => router.push('/(auth)/tutorial/guardian-mode')} /><Button title='Skip tutorial' variant='ghost' onPress={() => router.replace('/(tabs)')} /></Screen>;
}
