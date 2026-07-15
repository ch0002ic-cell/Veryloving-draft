import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { Button } from './Button';
import { colors, fonts, spacing } from '../constants/theme';

const EMPTY_ENTERING = FadeIn.duration(220).reduceMotion(ReduceMotion.System);

export function EmptyState({ image, title, message, actionLabel, onAction, compact = false }) {
  return (
    <Animated.View
      accessibilityRole="summary"
      entering={EMPTY_ENTERING}
      style={[styles.wrap, compact && styles.compactWrap]}
    >
      {image ? <Image accessible={false} source={image} resizeMode="contain" style={[styles.image, compact && styles.compactImage]} /> : null}
      <View style={[styles.copy, compact && styles.compactCopy]}>
        <Text style={[styles.title, compact && styles.compactText]}>{title}</Text>
        <Text style={[styles.message, compact && styles.compactText]}>{message}</Text>
      </View>
      {actionLabel && onAction ? <Button title={actionLabel} variant="ghost" compact onPress={onAction} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: spacing.lg, paddingHorizontal: spacing.md, alignItems: 'center', gap: spacing.md },
  compactWrap: { minHeight: 92, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.mdSm },
  image: { width: 132, height: 116 },
  compactImage: { width: 64, height: 64 },
  copy: { maxWidth: 420, alignItems: 'center', gap: spacing.xs },
  compactCopy: { flex: 1, alignItems: 'stretch' },
  compactText: { textAlign: 'auto' },
  title: { fontFamily: fonts.bold, color: colors.ink, fontSize: 18, textAlign: 'center' },
  message: { fontFamily: fonts.regular, color: colors.inkSoft, fontSize: 14, lineHeight: 20, textAlign: 'center' }
});
