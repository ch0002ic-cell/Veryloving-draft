import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, motion, radii, sizes, spacing, typography } from '../constants/theme';

const variantPalette = {
  primary: { content: colors.textInverse, ripple: colors.actionInversePressed },
  orange: { content: colors.textInverse, ripple: colors.actionInversePressed },
  danger: { content: colors.textInverse, ripple: colors.actionInversePressed },
  ghost: { content: colors.textPrimary, ripple: colors.borderSubtle },
  secondary: { content: colors.blueAccessible, ripple: colors.blueSoft },
  success: { content: colors.greenAccessible, ripple: colors.greenSoft }
};

export function Button({
  title,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  selected = false,
  loading = false,
  compact = false,
  accessibilityLabel,
  accessibilityHint,
  iconPosition = 'leading',
  labelStyle,
  loadingLabel,
  style,
  ...pressableProps
}) {
  const inactive = disabled || loading;
  const resolvedVariant = variantPalette[variant] ? variant : 'primary';
  const palette = variantPalette[resolvedVariant];
  const visibleTitle = loading && loadingLabel ? loadingLabel : title;
  const iconElement = !loading && icon
    ? <Ionicons accessible={false} name={icon} size={sizes.iconSmall} color={palette.content} />
    : null;
  return (
    <Pressable
      {...pressableProps}
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={accessibilityHint}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: inactive, selected }}
      android_ripple={{ color: palette.ripple }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        styles[resolvedVariant],
        selected && styles.selected,
        pressed && !inactive && styles.pressed,
        inactive && styles.disabled,
        style
      ]}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator size="small" color={palette.content} /> : null}
        {iconPosition === 'leading' ? iconElement : null}
        <Text style={[styles.text, { color: palette.content }, labelStyle]}>{visibleTitle}</Text>
        {iconPosition === 'trailing' ? iconElement : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: sizes.control,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: 'transparent'
  },
  compact: { minHeight: sizes.controlCompact, paddingHorizontal: spacing.mdSm },
  primary: { backgroundColor: colors.actionPrimary },
  orange: { backgroundColor: colors.actionAccent },
  danger: { backgroundColor: colors.actionDanger },
  ghost: { backgroundColor: colors.surfaceRaised, borderColor: colors.borderControl },
  secondary: { backgroundColor: colors.blueSoft, borderColor: colors.blueAccessible },
  success: { backgroundColor: colors.greenSoft, borderColor: colors.greenAccessible },
  selected: { borderWidth: 2, borderColor: colors.gold },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.9, transform: [{ scale: motion.pressedScale }] },
  row: { minHeight: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexShrink: 1, gap: spacing.sm },
  text: { flexShrink: 1, ...typography.bodyLarge, fontFamily: typography.label.fontFamily, textAlign: 'center' }
});
