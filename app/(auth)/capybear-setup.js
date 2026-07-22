import { Image, StyleSheet, Text, View } from 'react-native';
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

export default function CapybearSetup() {
  const { isRTL, t } = useI18n();
  const { advanceTo, advancing, navigationError } = useOnboardingNavigation();
  return (
    <Screen>
      <OnboardingProgress current={2} total={2} />
      <Header title={t('auth.meetCapybear')} subtitle={t('auth.meetCapybearSubtitle')} />
      <Card variant="tinted" style={styles.hero}>
        <View style={styles.halo}>
          <Image accessible={false} source={images.capybaraMenu} style={styles.image} resizeMode="contain" />
        </View>
        <Text style={[styles.body, isRTL && styles.rtlText]}>{t('auth.capybearBody')}</Text>
      </Card>
      <FeedbackBanner message={navigationError} />
      <Button
        title={t('auth.chooseVoice')}
        icon="sparkles-outline"
        loading={advancing}
        onPress={() => advanceTo('/(auth)/tutorial/choose-voice')}
      />
      <Button
        title={t('common.finish')}
        variant="ghost"
        disabled={advancing}
        onPress={() => advanceTo('/(auth)/completion', { replace: true })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.md, borderRadius: radii.xl },
  halo: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.surfaceRaised },
  image: { width: 205, height: 205 },
  body: { ...typography.bodyLarge, color: colors.textPrimary },
  rtlText: { textAlign: 'right' }
});
