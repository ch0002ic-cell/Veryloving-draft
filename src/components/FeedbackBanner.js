import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { Button } from './Button';
import { motion, radii, sizes, spacing, tones, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const ENTERING = FadeIn.duration(motion.durationStandard).reduceMotion(ReduceMotion.System);
const EXITING = FadeOut.duration(motion.durationFast).reduceMotion(ReduceMotion.System);
const toneStyles = {
  error: { backgroundColor: tones.danger.background, borderColor: tones.danger.border, icon: 'alert-circle', color: tones.danger.foreground },
  warning: { backgroundColor: tones.warning.background, borderColor: tones.warning.border, icon: 'warning', color: tones.warning.foreground },
  info: { backgroundColor: tones.info.background, borderColor: tones.info.border, icon: 'information-circle', color: tones.info.foreground },
  success: { backgroundColor: tones.success.background, borderColor: tones.success.border, icon: 'checkmark-circle', color: tones.success.foreground }
};

export function FeedbackBanner({
  message,
  tone = 'error',
  actionLabel,
  onAction,
  dismissLabel,
  onDismiss,
  style
}) {
  const { isRTL } = useI18n();
  if (!message) return null;
  const palette = toneStyles[tone] || toneStyles.info;
  return (
    <Animated.View
      entering={ENTERING}
      exiting={EXITING}
      style={[styles.wrap, { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor }, style]}
    >
      <View style={[styles.topRow, isRTL && styles.rtlRow]}>
        <View
          accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
          accessibilityRole={tone === 'error' ? 'alert' : 'summary'}
          style={[styles.content, isRTL && styles.rtlRow]}
        >
          <Ionicons accessible={false} name={palette.icon} size={sizes.icon} color={palette.color} />
          <Text style={[styles.message, isRTL && styles.rtlText, { color: palette.color }]}>{message}</Text>
        </View>
        {dismissLabel && onDismiss ? (
          <Pressable
            accessibilityLabel={dismissLabel}
            accessibilityRole="button"
            hitSlop={4}
            onPress={onDismiss}
            style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
          >
            <Ionicons accessible={false} name="close" size={sizes.icon} color={palette.color} />
          </Pressable>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Button
          title={actionLabel}
          accessibilityLabel={actionLabel}
          variant="ghost"
          compact
          onPress={onAction}
          style={styles.action}
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.mdSm, gap: spacing.sm, borderWidth: 1, borderRadius: radii.lg },
  topRow: { flexDirection: 'row', alignItems: 'flex-start' },
  content: { minHeight: sizes.icon, flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  message: { flex: 1, ...typography.body, fontFamily: typography.label.fontFamily },
  dismiss: { width: sizes.touchTarget, height: sizes.touchTarget, marginVertical: -spacing.mdSm, marginEnd: -spacing.mdSm, alignItems: 'center', justifyContent: 'center' },
  action: { alignSelf: 'stretch' },
  pressed: { opacity: 0.58 }
});
