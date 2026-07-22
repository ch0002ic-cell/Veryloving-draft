import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, motion, radii, shadows, sizes, spacing, tones, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const tonePalette = {
  default: { background: colors.surfaceRaised, border: tones.neutral.border, iconBackground: tones.neutral.background, icon: colors.textPrimary },
  wearable: { background: tones.accent.background, border: tones.accent.border, iconBackground: colors.surfaceRaised, icon: tones.accent.foreground },
  robot: { background: tones.info.background, border: tones.info.border, iconBackground: colors.surfaceRaised, icon: tones.info.foreground },
  safety: { background: tones.success.background, border: tones.success.border, iconBackground: colors.surfaceRaised, icon: tones.success.foreground },
  danger: { background: tones.danger.background, border: tones.danger.border, iconBackground: colors.surfaceRaised, icon: tones.danger.foreground }
};

export function ActionTile({
  title,
  description,
  value,
  icon = 'sparkles-outline',
  tone = 'default',
  onPress,
  disabled = false,
  selected,
  accessibilityLabel,
  accessibilityHint,
  style,
  ...pressableProps
}) {
  const { isRTL } = useI18n();
  const resolvedTone = tonePalette[tone] || tonePalette.default;
  return (
    <Pressable
      {...pressableProps}
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={accessibilityHint || description}
      accessibilityRole="button"
      accessibilityState={{
        disabled,
        ...(typeof selected === 'boolean' ? { selected } : {})
      }}
      android_ripple={{ color: colors.borderSubtle }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: resolvedTone.background,
          borderColor: resolvedTone.border
        },
        selected === true && styles.selected,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style
      ]}
    >
      <View style={[styles.row, isRTL && styles.rtlRow]}>
        <View style={[styles.iconBox, { backgroundColor: resolvedTone.iconBackground }]}>
          <Ionicons accessible={false} name={icon} size={sizes.iconLarge} color={resolvedTone.icon} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, isRTL && styles.rtlText]}>{title}</Text>
          {description ? <Text style={[styles.description, isRTL && styles.rtlText]}>{description}</Text> : null}
        </View>
        {value !== undefined && value !== null ? <Text style={[styles.value, isRTL && styles.rtlText]}>{value}</Text> : null}
        <Ionicons
          accessible={false}
          name={isRTL ? 'chevron-back' : 'chevron-forward'}
          size={sizes.icon}
          color={colors.textSecondary}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    minHeight: 92,
    justifyContent: 'center',
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radii.xl,
    ...shadows.subtle
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdSm },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  iconBox: { width: 48, height: 48, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  title: { ...typography.heading, color: colors.textPrimary },
  description: { ...typography.caption, color: colors.textSecondary },
  value: { ...typography.label, color: colors.textPrimary, flexShrink: 1 },
  pressed: { opacity: 0.9, transform: [{ scale: motion.pressedScale }] },
  selected: { borderWidth: 2, borderColor: colors.focus },
  disabled: { opacity: 0.5 }
});
