import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radii, sizes, spacing, tones, typography } from '../constants/theme';

const palette = {
  ok: { text: tones.success.foreground, border: tones.success.border, background: tones.success.background, icon: 'checkmark-circle' },
  warn: { text: tones.warning.foreground, border: tones.warning.border, background: tones.warning.background, icon: 'warning' },
  danger: { text: tones.danger.foreground, border: tones.danger.border, background: tones.danger.background, icon: 'alert-circle' },
  idle: { text: tones.neutral.foreground, border: tones.neutral.border, background: tones.neutral.background, icon: 'ellipse' },
  active: { text: tones.info.foreground, border: tones.info.border, background: tones.info.background, icon: 'radio-button-on' }
};

export function StatusPill({ label, tone = 'idle', icon = true, accessibilityLabel }) {
  const resolvedPalette = palette[tone] || palette.idle;
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel || label}
      accessibilityRole="text"
      style={[
        styles.pill,
        { borderColor: resolvedPalette.border, backgroundColor: resolvedPalette.background }
      ]}
    >
      {icon ? <Ionicons accessible={false} name={resolvedPalette.icon} size={sizes.iconSmall} color={resolvedPalette.text} style={styles.icon} /> : null}
      <Text style={[styles.text, { color: resolvedPalette.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: sizes.iconLarge + spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: 1, paddingHorizontal: spacing.mdSm, paddingVertical: spacing.xs, borderRadius: radii.pill },
  icon: { flexShrink: 0 },
  text: { flexShrink: 1, ...typography.caption, fontFamily: typography.label.fontFamily }
});
