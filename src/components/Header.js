import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { images } from '../constants/assets';
import { colors, radii, sizes, spacing, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export function Header({
  title = 'VeryLoving',
  subtitle,
  eyebrow,
  showBack = false,
  backLabel = 'Back',
  onBack,
  trailing
}) {
  const { isRTL } = useI18n();
  const goBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };
  return (
    <View style={[styles.wrap, isRTL && styles.rtlRow]}>
      {showBack ? (
        <Pressable
          accessibilityLabel={backLabel}
          accessibilityRole="button"
          hitSlop={4}
          onPress={goBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ionicons
            accessible={false}
            name={isRTL ? 'chevron-forward' : 'chevron-back'}
            size={26}
            color={colors.textPrimary}
          />
        </Pressable>
      ) : (
        <View style={styles.logoBox}>
          <Image accessible={false} source={images.logo} style={styles.logo} resizeMode="contain" />
        </View>
      )}
      <View style={styles.copy}>
        {eyebrow ? <Text style={[styles.eyebrow, isRTL && styles.rtlText]}>{eyebrow}</Text> : null}
        <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, isRTL && styles.rtlText]}>{subtitle}</Text> : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { minHeight: 64, flexDirection: 'row', gap: spacing.mdSm, alignItems: 'center' },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  copy: { flex: 1, minWidth: 0 },
  logoBox: { width: sizes.headerControl, height: sizes.headerControl, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.actionPrimary },
  backButton: { width: 48, height: 48, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderControl },
  pressed: { opacity: 0.62 },
  logo: { width: 40, height: 18 },
  eyebrow: { ...typography.caption, fontFamily: typography.label.fontFamily, color: colors.actionAccent, marginBottom: spacing.xs },
  title: { ...typography.display, color: colors.textPrimary },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary, marginTop: spacing.xs },
  trailing: { minWidth: sizes.touchTarget, minHeight: sizes.touchTarget, alignItems: 'flex-end', justifyContent: 'center' }
});
