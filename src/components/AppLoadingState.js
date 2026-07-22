import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { images } from '../constants/assets';
import { colors, radii, spacing, tones, typography } from '../constants/theme';

export function AppLoadingState({ message = 'Preparing VeryLoving…' }) {
  return (
    <View
      accessible
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      style={styles.screen}
    >
      <View style={styles.brandMark}>
        <Image accessible={false} source={images.capybaraMenu} resizeMode="contain" style={styles.image} />
      </View>
      <Text style={styles.brand}>VeryLoving</Text>
      <Text style={styles.message}>{message}</Text>
      <ActivityIndicator accessible={false} color={colors.actionAccent} size="small" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surfaceCanvas
  },
  brandMark: {
    width: 104,
    height: 104,
    marginBottom: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: tones.accent.background
  },
  image: { width: 88, height: 88 },
  brand: { ...typography.display, color: colors.textPrimary, textAlign: 'center' },
  message: { ...typography.body, color: colors.textSecondary, textAlign: 'center' }
});
