import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeOutDown, ReduceMotion } from 'react-native-reanimated';
import { colors, motion, radii, shadows, sizes, spacing, tones, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const ENTERING = FadeInDown.duration(motion.durationStandard).reduceMotion(ReduceMotion.System);
const EXITING = FadeOutDown.duration(motion.durationFast).reduceMotion(ReduceMotion.System);

const palettes = {
  success: { icon: 'checkmark-circle', foreground: tones.success.foreground, background: tones.success.background, border: tones.success.border },
  info: { icon: 'information-circle', foreground: tones.info.foreground, background: tones.info.background, border: tones.info.border },
  warning: { icon: 'warning', foreground: tones.warning.foreground, background: tones.warning.background, border: tones.warning.border },
  error: { icon: 'alert-circle', foreground: tones.danger.foreground, background: tones.danger.background, border: tones.danger.border }
};

export function Snackbar({ message, tone = 'success', duration = 3500, onDismiss }) {
  const { isRTL, t } = useI18n();
  const dismissRef = useRef(onDismiss);
  const canDismiss = typeof onDismiss === 'function';

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!message || !canDismiss || !Number.isFinite(duration) || duration <= 0) return undefined;
    const timer = setTimeout(() => dismissRef.current?.(), duration);
    return () => clearTimeout(timer);
  }, [canDismiss, duration, message]);

  if (!message) return null;
  const palette = palettes[tone] || palettes.info;
  return (
    <Animated.View
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      accessibilityRole={tone === 'error' ? 'alert' : 'summary'}
      entering={ENTERING}
      exiting={EXITING}
      style={[
        styles.snackbar,
        isRTL && styles.rtlRow,
        { backgroundColor: palette.background, borderColor: palette.border }
      ]}
    >
      <Ionicons accessible={false} name={palette.icon} size={sizes.icon} color={palette.foreground} />
      <Text style={[styles.message, isRTL && styles.rtlText, { color: palette.foreground }]}>{message}</Text>
      {onDismiss ? (
        <Pressable
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
          hitSlop={4}
          onPress={onDismiss}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Ionicons accessible={false} name="close" size={sizes.icon} color={palette.foreground} />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  snackbar: {
    minHeight: sizes.controlLarge,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderWidth: 1,
    borderRadius: radii.lg,
    ...shadows.raised
  },
  message: { flex: 1, ...typography.label },
  close: { width: sizes.touchTarget, height: sizes.touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill },
  pressed: { opacity: 0.62 },
  rtlRow: { flexDirection: 'row-reverse', paddingLeft: spacing.xs, paddingRight: spacing.md },
  rtlText: { textAlign: 'right' }
});
