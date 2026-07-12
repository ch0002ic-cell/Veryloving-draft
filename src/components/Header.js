import { Image, StyleSheet, Text, View } from 'react-native';
import { images } from '../constants/assets';
import { colors, fonts } from '../constants/theme';

export function Header({ title = 'VeryLoving', subtitle }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.logoBox}>
        <Image source={images.logo} style={styles.logo} resizeMode="contain" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { minHeight: 64, flexDirection: 'row', gap: 12, alignItems: 'center' },
  logoBox: { width: 48, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink },
  logo: { width: 40, height: 18 },
  title: { fontFamily: fonts.display, color: colors.ink, fontSize: 28, lineHeight: 34 },
  subtitle: { fontFamily: fonts.regular, color: colors.inkSoft, fontSize: 14, lineHeight: 20, marginTop: 2 }
});
