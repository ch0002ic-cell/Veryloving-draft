import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../constants/theme';

export function LoadingState({ message, compact = false }) {
  return (
    <View
      accessible
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      style={[styles.wrap, compact && styles.compact]}
    >
      <ActivityIndicator color={colors.orangeAccessible} />
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { minHeight: 150, padding: spacing.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  compact: { minHeight: 64, padding: spacing.sm },
  message: { ...typography.body, fontFamily: typography.label.fontFamily, color: colors.textSecondary, textAlign: 'center' }
});
