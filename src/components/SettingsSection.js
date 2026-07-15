import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './Card';
import { colors, fonts, radii, spacing } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export function SettingsSection({ icon, title, subtitle, children }) {
  const { isRTL } = useI18n();
  return (
    <View style={styles.section}>
      <View style={[styles.heading, isRTL && styles.rtlRow]}>
        <View style={styles.iconBox}>
          <Ionicons name={icon} size={19} color={colors.ink} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={[styles.title, isRTL && styles.rtlText]}>{title}</Text>
          {subtitle ? <Text style={[styles.subtitle, isRTL && styles.rtlText]}>{subtitle}</Text> : null}
        </View>
      </View>
      <Card style={styles.card}>{children}</Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  heading: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: spacing.mdSm },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  iconBox: { width: 36, height: 36, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted },
  headingCopy: { flex: 1 },
  title: { fontFamily: fonts.bold, color: colors.ink, fontSize: 18 },
  subtitle: { marginTop: 2, fontFamily: fonts.regular, color: colors.inkSoft, fontSize: 13, lineHeight: 18 },
  card: { gap: spacing.mdSm }
});
