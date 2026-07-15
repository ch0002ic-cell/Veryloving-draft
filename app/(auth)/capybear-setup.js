import { Image, Text } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { images } from '../../src/constants/assets';
import { fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import { useOnboardingNavigation } from '../../src/hooks/useOnboardingNavigation';

export default function CapybearSetup() {
  const { t } = useI18n();
  const { advanceTo, advancing, navigationError } = useOnboardingNavigation();
  return <Screen><Header title={t('auth.meetCapybear')} subtitle={t('auth.meetCapybearSubtitle')} /><Image source={images.capybaraMenu} style={{ width: '100%', height: 240 }} resizeMode="contain" /><Card><Text style={{ fontFamily: fonts.regular }}>{t('auth.capybearBody')}</Text></Card><FeedbackBanner message={navigationError} /><Button title={t('auth.chooseVoice')} loading={advancing} onPress={() => advanceTo('/(auth)/tutorial/choose-voice')} /><Button title={t('common.finish')} variant="ghost" disabled={advancing} onPress={() => advanceTo('/(auth)/completion', { replace: true })} /></Screen>;
}
