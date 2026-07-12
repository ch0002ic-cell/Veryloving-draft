import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../constants/theme';

const palette = {
  ok: colors.green,
  warn: colors.gold,
  danger: colors.red,
  idle: colors.inkSoft,
  active: colors.blue
};

export function StatusPill({ label, tone = 'idle' }) {
  const color = palette[tone] || palette.idle;
  return <View style={[styles.pill, { borderColor: color }]}><Text style={[styles.text, { color }]}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, backgroundColor: '#fff' },
  text: { fontFamily: fonts.semibold, fontSize: 12 }
});
