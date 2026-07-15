import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { Button } from './Button';
import { colors, fonts, radii, spacing } from '../constants/theme';

const ENTERING = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
const EXITING = FadeOut.duration(140).reduceMotion(ReduceMotion.System);
const toneStyles = {
  error: { backgroundColor: colors.redSoft, borderColor: '#F2C9C9', icon: 'alert-circle', color: colors.redAccessible },
  info: { backgroundColor: colors.blueSoft, borderColor: '#C9DCF8', icon: 'information-circle', color: colors.blueAccessible },
  success: { backgroundColor: colors.greenSoft, borderColor: '#C5E8D5', icon: 'checkmark-circle', color: colors.greenAccessible }
};

export function FeedbackBanner({ message, tone = 'error', actionLabel, onAction }) {
  if (!message) return null;
  const palette = toneStyles[tone] || toneStyles.info;
  return (
    <Animated.View
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      accessibilityRole={tone === 'error' ? 'alert' : 'summary'}
      entering={ENTERING}
      exiting={EXITING}
      style={[styles.wrap, { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor }]}
    >
      <Ionicons name={palette.icon} size={21} color={palette.color} />
      <Text style={[styles.message, { color: palette.color }]}>{message}</Text>
      {actionLabel && onAction ? <Button title={actionLabel} variant="ghost" compact onPress={onAction} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.mdSm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radii.md },
  message: { flex: 1, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 }
});
