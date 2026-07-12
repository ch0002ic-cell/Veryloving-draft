import { Image, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { images } from '../src/constants/assets';
import { useAppState } from '../src/context/AppContext';
import { fonts } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';

export default function DeviceManagement() {
  const { device, setDevice } = useAppState();
  const { t } = useI18n();
  return <Screen><Header title={t('device.title')} subtitle={t('device.subtitle')} /><Image source={device.connected ? images.jewelryConnected : images.jewelryDisconnected} style={{ width: '100%', height: 220 }} resizeMode="contain" /><Card><Text style={{ fontFamily: fonts.bold }}>{device.name}</Text><Text>{device.connected ? t('device.connected', { battery: device.battery }) : t('device.none')}</Text></Card><Button title={device.connected ? t('device.disconnect') : t('device.connect')} onPress={() => device.connected ? setDevice({ ...device, connected: false }) : router.push('/(auth)/jewelry-setup?mode=standalone')} /></Screen>;
}
