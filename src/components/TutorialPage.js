import { Image, StyleSheet, Text } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { Screen } from './Screen';
import { Header } from './Header';
import { Card } from './Card';
import { Button } from './Button';
import { useI18n } from '../context/I18nContext';
import { FeedbackBanner } from './FeedbackBanner';
import { useOnboardingNavigation } from '../hooks/useOnboardingNavigation';
import { OnboardingProgress } from './OnboardingProgress';
import { images } from '../constants/assets';
import { colors, motion, radii, spacing, typography } from '../constants/theme';

const tutorialSteps = [
  'tutorial.homeTitle',
  'tutorial.guardianTitle',
  'tutorial.emergencyTitle',
  'tutorial.excuseTitle',
  'tutorial.safetyCallTitle',
  'tutorial.practiceTitle'
];

const tutorialArt = {
  'tutorial.homeTitle': images.modeHome,
  'tutorial.guardianTitle': images.modeGuardian,
  'tutorial.emergencyTitle': images.modeEmergency,
  'tutorial.excuseTitle': images.tutorialCall,
  'tutorial.safetyCallTitle': images.tutorialTap,
  'tutorial.practiceTitle': images.instructionCapybara
};

const ART_ENTERING = FadeIn.duration(motion.durationEmphasis).reduceMotion(ReduceMotion.System);

export function TutorialPage({ titleKey, subtitleKey, nextPath }) {
  const { t } = useI18n();
  const { advanceTo, advancing, navigationError } = useOnboardingNavigation();
  const stepIndex = Math.max(0, tutorialSteps.indexOf(titleKey));
  return (
    <Screen>
      <OnboardingProgress current={stepIndex + 1} total={tutorialSteps.length} />
      <Header title={t(titleKey)} subtitle={t(subtitleKey)} />
      <Animated.View entering={ART_ENTERING} style={styles.artFrame}>
        <Image accessible={false} source={tutorialArt[titleKey] || images.magicWand} style={styles.art} resizeMode="contain" />
      </Animated.View>
      <Card variant="tinted" style={styles.copyCard}>
        <Text style={styles.body}>{t('tutorial.sharedBody')}</Text>
      </Card>
      <FeedbackBanner message={navigationError} />
      <Button title={t('common.continue')} loading={advancing} onPress={() => advanceTo(nextPath)} />
      <Button title={t('common.skipTutorial')} variant="ghost" disabled={advancing} onPress={() => advanceTo('/(auth)/completion', { replace: true })} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  artFrame: {
    minHeight: 210,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.xl,
    backgroundColor: colors.paper
  },
  art: { width: '88%', height: 200 },
  copyCard: { gap: spacing.sm },
  body: { ...typography.bodyLarge, color: colors.textPrimary }
});
