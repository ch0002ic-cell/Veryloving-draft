import { Image, StyleSheet, Text } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { OnboardingProgress } from '../../src/components/OnboardingProgress';
import { images } from '../../src/constants/assets';
import { colors, radii, spacing, typography } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import { useOnboardingNavigation } from '../../src/hooks/useOnboardingNavigation';

export default function DeviceCheck() {
  const { isRTL, t } = useI18n();
  const { advanceTo, advancing, navigationError } = useOnboardingNavigation();
  return (
    <Screen>
      <OnboardingProgress current={1} total={2} />
      <Header title={t('auth.northStarTitle')} subtitle={t('auth.northStarSubtitle')} />
      <Card variant="tinted" style={styles.hero}>
        <Image accessible={false} source={images.jewelryDisconnected} style={styles.image} resizeMode="contain" />
        <Text style={[styles.body, isRTL && styles.rtlText]}>{t('auth.northStarBody')}</Text>
      </Card>
      <FeedbackBanner message={navigationError} />
      <Button
        title={t('auth.setupJewelry')}
        icon="bluetooth"
        loading={advancing}
        onPress={() => advanceTo('/(auth)/jewelry-setup')}
      />
      <Button
        title={t('common.continue')}
        variant="ghost"
        disabled={advancing}
        onPress={() => advanceTo('/(auth)/capybear-setup')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.md, borderRadius: radii.xl },
  image: { width: '100%', height: 220 },
  body: { ...typography.bodyLarge, color: colors.textPrimary },
  rtlText: { textAlign: 'right' }
});
