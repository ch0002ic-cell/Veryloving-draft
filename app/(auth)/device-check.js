import { router } from 'expo-router';
import { Image, Text } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { images } from '../../src/constants/assets';
import { fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';

export default function DeviceCheck() {
  const { t } = useI18n();
  return <Screen><Header title={t('auth.northStarTitle')} subtitle={t('auth.northStarSubtitle')} /><Image source={images.jewelryDisconnected} style={{ width: '100%', height: 220 }} resizeMode="contain" /><Card><Text style={{ fontFamily: fonts.regular }}>{t('auth.northStarBody')}</Text></Card><Button title={t('auth.setupJewelry')} onPress={() => router.push('/(auth)/jewelry-setup')} /><Button title={t('common.continue')} variant="ghost" onPress={() => router.push('/(auth)/capybear-setup')} /></Screen>;
}
