import { Image, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { images } from '../../src/constants/assets';
import { fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';

export default function CapybearSetup() {
  const { t } = useI18n();
  return <Screen><Header title={t('auth.meetCapybear')} subtitle={t('auth.meetCapybearSubtitle')} /><Image source={images.capybaraMenu} style={{ width: '100%', height: 240 }} resizeMode="contain" /><Card><Text style={{ fontFamily: fonts.regular }}>{t('auth.capybearBody')}</Text></Card><Button title={t('auth.chooseVoice')} onPress={() => router.push('/(auth)/tutorial/choose-voice')} /><Button title={t('common.finish')} variant="ghost" onPress={() => router.replace('/(auth)/completion')} /></Screen>;
}
