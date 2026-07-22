import { StyleSheet, View } from 'react-native';
import { colors, radii, shadows, spacing, tones } from '../constants/theme';

const paddingStyles = {
  none: null,
  sm: { padding: spacing.mdSm },
  md: { padding: spacing.md },
  lg: { padding: spacing.lg }
};

export function Card({ children, style, variant = 'default', padding = 'md', ...viewProps }) {
  const resolvedVariant = styles[variant] ? variant : 'default';
  const resolvedPadding = paddingStyles[padding] === undefined ? paddingStyles.md : paddingStyles[padding];
  return <View {...viewProps} style={[styles.card, styles[resolvedVariant], resolvedPadding, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  default: shadows.subtle,
  flat: { shadowOpacity: 0, elevation: 0 },
  raised: shadows.raised,
  tinted: { backgroundColor: tones.accent.background, borderColor: tones.accent.border, shadowOpacity: 0, elevation: 0 },
  critical: { backgroundColor: tones.danger.background, borderColor: tones.danger.border, shadowOpacity: 0, elevation: 0 }
});
