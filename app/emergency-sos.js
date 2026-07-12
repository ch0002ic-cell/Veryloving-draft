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
import { useI18n } from '../src/context/I18nContext';

export default function EmergencySOS() {
  const { contacts } = useAppState();
  const { t } = useI18n();
  return <Screen><Header title={t('emergency.title')} subtitle={t('emergency.subtitle')} /><Image source={images.star} style={{ width: '100%', height: 160 }} resizeMode="contain" /><Card><Text style={{ fontFamily: fonts.regular }}>{t('emergency.body')}</Text></Card><Button title={t('emergency.activate')} variant="danger" onPress={() => triggerSOS(contacts)} /><Button title={t('emergency.callCompanion')} onPress={() => router.push('/safety-call')} /><Button title={t('common.cancel')} variant="ghost" onPress={() => router.back()} /></Screen>;
}
