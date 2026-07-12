import { Image, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { images } from '../../src/constants/assets';
import { fonts } from '../../src/constants/theme';

export default function CapybearSetup() {
  return <Screen><Header title="Meet Capybear" subtitle="Your gentle safety companion on the map and in calls." /><Image source={images.capybaraMenu} style={{ width: '100%', height: 240 }} resizeMode="contain" /><Card><Text style={{ fontFamily: fonts.regular }}>Capybear can help with home mode, guardian mode, emergency mode, excuse calls, and voice support.</Text></Card><Button title="Choose a voice" onPress={() => router.push('/(auth)/tutorial/choose-voice')} /><Button title="Finish" variant="ghost" onPress={() => router.replace('/(tabs)')} /></Screen>;
}
