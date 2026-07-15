import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { Button } from './Button';
import { colors, fonts, spacing } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const EMPTY_ENTERING = FadeIn.duration(220).reduceMotion(ReduceMotion.System);

export function EmptyState({ image, title, message, actionLabel, onAction, compact = false }) {
  const { isRTL } = useI18n();
  return (
    <Animated.View
      accessibilityRole="summary"
      entering={EMPTY_ENTERING}
      style={[styles.wrap, compact && styles.compactWrap, compact && isRTL && styles.rtlRow]}
    >
      {image ? <Image accessible={false} source={image} resizeMode="contain" style={[styles.image, compact && styles.compactImage]} /> : null}
      <View style={[styles.copy, compact && styles.compactCopy]}>
        <Text style={[styles.title, compact && styles.compactText, compact && isRTL && styles.rtlText]}>{title}</Text>
        <Text style={[styles.message, compact && styles.compactText, compact && isRTL && styles.rtlText]}>{message}</Text>
      </View>
      {actionLabel && onAction ? <Button title={actionLabel} variant="ghost" compact onPress={onAction} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: spacing.lg, paddingHorizontal: spacing.md, alignItems: 'center', gap: spacing.md },
  compactWrap: { minHeight: 92, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.mdSm },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  image: { width: 132, height: 116 },
  compactImage: { width: 64, height: 64 },
  copy: { maxWidth: 420, alignItems: 'center', gap: spacing.xs },
  compactCopy: { flex: 1, alignItems: 'stretch' },
  compactText: { textAlign: 'auto' },
  title: { fontFamily: fonts.bold, color: colors.ink, fontSize: 18, textAlign: 'center' },
  message: { fontFamily: fonts.regular, color: colors.inkSoft, fontSize: 14, lineHeight: 20, textAlign: 'center' }
});
