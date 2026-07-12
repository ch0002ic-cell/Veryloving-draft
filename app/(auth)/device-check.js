import { router } from 'expo-router';
import { Image, Text } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { images } from '../../src/constants/assets';
import { fonts } from '../../src/constants/theme';

export default function DeviceCheck() {
  return <Screen><Header title="NorthStar jewelry" subtitle="Pair now or continue and add it later." /><Image source={images.jewelryDisconnected} style={{ width: '100%', height: 220 }} resizeMode="contain" /><Card><Text style={{ fontFamily: fonts.regular }}>The VL01 wearable can trigger safety flows with taps and long press gestures.</Text></Card><Button title="Set up jewelry" onPress={() => router.push('/(auth)/jewelry-setup')} /><Button title="Continue" variant="ghost" onPress={() => router.push('/(auth)/capybear-setup')} /></Screen>;
}
