import { Text } from 'react-native';
import { Screen } from './Screen';
import { Header } from './Header';
import { Card } from './Card';
import { Button } from './Button';
import { useI18n } from '../context/I18nContext';
import { fonts } from '../constants/theme';
import { FeedbackBanner } from './FeedbackBanner';
import { useOnboardingNavigation } from '../hooks/useOnboardingNavigation';

export function TutorialPage({ titleKey, subtitleKey, nextPath }) {
  const { t } = useI18n();
  const { advanceTo, advancing, navigationError } = useOnboardingNavigation();
  return (
    <Screen>
      <Header title={t(titleKey)} subtitle={t(subtitleKey)} />
      <Card><Text style={{ fontFamily: fonts.regular, lineHeight: 22 }}>{t('tutorial.sharedBody')}</Text></Card>
      <FeedbackBanner message={navigationError} />
      <Button title={t('common.continue')} loading={advancing} onPress={() => advanceTo(nextPath)} />
      <Button title={t('common.skipTutorial')} variant="ghost" disabled={advancing} onPress={() => advanceTo('/(auth)/completion', { replace: true })} />
    </Screen>
  );
}
