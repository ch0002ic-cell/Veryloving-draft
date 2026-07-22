import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './Card';
import { colors, radii, sizes, spacing, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export function SettingsSection({ icon, title, subtitle, children }) {
  const { isRTL } = useI18n();
  return (
    <View style={styles.section}>
      <View style={[styles.heading, isRTL && styles.rtlRow]}>
        <View style={styles.iconBox}>
          <Ionicons accessible={false} name={icon} size={sizes.iconSmall} color={colors.textPrimary} />
        </View>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{title}</Text>
          {subtitle ? <Text style={[styles.subtitle, isRTL && styles.rtlText]}>{subtitle}</Text> : null}
        </View>
      </View>
      <Card style={styles.card}>{children}</Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  heading: { minHeight: sizes.touchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.mdSm },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  iconBox: { width: sizes.iconLarge + spacing.sm, height: sizes.iconLarge + spacing.sm, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  headingCopy: { flex: 1 },
  title: { ...typography.heading, color: colors.textPrimary },
  subtitle: { marginTop: spacing.xs, ...typography.caption, color: colors.textSecondary },
  card: { gap: spacing.mdSm }
});
