import { StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export function OnboardingProgress({ current, total }) {
  const { t } = useI18n();
  const safeTotal = Math.max(1, Math.floor(total));
  const safeCurrent = Math.min(safeTotal, Math.max(1, Math.floor(current)));
  return (
    <View
      accessible
      accessibilityLabel={t('tutorial.progressAccessibility')}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: safeTotal, now: safeCurrent }}
      style={styles.track}
    >
      {Array.from({ length: safeTotal }, (_, index) => (
        <View key={index} style={[styles.segment, index < safeCurrent && styles.segmentActive]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { minHeight: 8, flexDirection: 'row', gap: spacing.xs },
  segment: { flex: 1, height: 6, borderRadius: radii.pill, backgroundColor: colors.borderSubtle },
  segmentActive: { backgroundColor: colors.actionAccent }
});
