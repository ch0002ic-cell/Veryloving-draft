import { Image, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { images } from '../src/constants/assets';
import { useAppState } from '../src/context/AppContext';
import { fonts } from '../src/constants/theme';

export default function DeviceManagement() {
  const { device, setDevice } = useAppState();
  return <Screen><Header title="Device Management" subtitle="Manage your NorthStar device." /><Image source={device.connected ? images.jewelryConnected : images.jewelryDisconnected} style={{ width: '100%', height: 220 }} resizeMode="contain" /><Card><Text style={{ fontFamily: fonts.bold }}>{device.name}</Text><Text>{device.connected ? `Connected · ${device.battery}% battery` : 'No devices connected'}</Text></Card><Button title={device.connected ? 'Disconnect Device' : 'Connect Device'} onPress={() => device.connected ? setDevice({ ...device, connected: false }) : router.push('/(auth)/jewelry-setup?mode=standalone')} /></Screen>;
}
