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

export default function DeviceCheck() {
  const { t } = useI18n();
  const { advanceTo, advancing, navigationError } = useOnboardingNavigation();
  return <Screen><Header title={t('auth.northStarTitle')} subtitle={t('auth.northStarSubtitle')} /><Image source={images.jewelryDisconnected} style={{ width: '100%', height: 220 }} resizeMode="contain" /><Card><Text style={{ fontFamily: fonts.regular }}>{t('auth.northStarBody')}</Text></Card><FeedbackBanner message={navigationError} /><Button title={t('auth.setupJewelry')} loading={advancing} onPress={() => advanceTo('/(auth)/jewelry-setup')} /><Button title={t('common.continue')} variant="ghost" disabled={advancing} onPress={() => advanceTo('/(auth)/capybear-setup')} /></Screen>;
}
