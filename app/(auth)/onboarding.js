import { Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown, FadeInUp, ReduceMotion } from 'react-native-reanimated';
import { Screen } from '../../src/components/Screen';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { images } from '../../src/constants/assets';
import { colors, layout, motion, radii, shadows, spacing, typography } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';

const HERO_ENTERING = FadeInDown.duration(motion.durationEmphasis).reduceMotion(ReduceMotion.System);
const CTA_ENTERING = FadeInUp.delay(motion.durationFast).duration(motion.durationEmphasis).reduceMotion(ReduceMotion.System);

export default function Onboarding() {
  const { t } = useI18n();
  return (
    <Screen background={images.onboarding1} style={styles.wrap}>
      <Animated.View entering={HERO_ENTERING} style={styles.hero}>
        <View style={styles.artHalo}>
          <Image accessible={false} source={images.capybaraMenu} style={styles.capy} resizeMode="contain" />
        </View>
        <View style={styles.copyPanel}>
          <Text style={styles.title}>VeryLoving</Text>
          <Text style={styles.subtitle}>{t('auth.onboardingTagline')}</Text>
        </View>
      </Animated.View>
      <Animated.View entering={CTA_ENTERING}>
        <Card variant="raised" style={styles.ctaCard}>
          <Button
            title={t('auth.createAccount')}
            icon="arrow-forward"
            iconPosition="trailing"
            onPress={() => router.push('/(auth)/create-account')}
          />
        </Card>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'space-between' },
  hero: { alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  artHalo: {
    width: 244,
    height: 244,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    ...shadows.raised
  },
  capy: { width: 220, height: 220 },
  copyPanel: {
    width: '100%',
    maxWidth: layout.readableMaxWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceCanvas
  },
  title: { ...typography.displayLarge, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { ...typography.bodyLarge, color: colors.textPrimary, textAlign: 'center' },
  ctaCard: { gap: spacing.sm, backgroundColor: colors.surfaceRaised }
});
