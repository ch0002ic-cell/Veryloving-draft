import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radii } from '../constants/theme';

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
  style
}) {
  const inactive = disabled || loading;
  const contentColor = variant === 'ghost' ? colors.ink : '#fff';
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: inactive, selected }}
      android_ripple={{ color: variant === 'ghost' ? colors.line : '#FFFFFF22' }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        styles[variant],
        pressed && styles.pressed,
        inactive && styles.disabled,
        style
      ]}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator size="small" color={contentColor} /> : null}
        {!loading && icon ? <Ionicons name={icon} size={18} color={contentColor} /> : null}
        <Text style={[styles.text, variant === 'ghost' && styles.ghostText]}>{title}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 50, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  compact: { minHeight: 44, paddingHorizontal: 12 },
  primary: { backgroundColor: colors.ink },
  orange: { backgroundColor: colors.orangeAccessible },
  danger: { backgroundColor: colors.redAccessible },
  ghost: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.controlBorder },
  disabled: { opacity: 0.45 },
  pressed: { transform: [{ scale: 0.98 }] },
  row: { minHeight: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexShrink: 1, gap: 8 },
  text: { flexShrink: 1, color: '#fff', fontFamily: fonts.semibold, fontSize: 16, textAlign: 'center' },
  ghostText: { color: colors.ink }
});
