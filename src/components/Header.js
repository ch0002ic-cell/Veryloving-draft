import { Image, StyleSheet, Text, View } from 'react-native';
import { images } from '../constants/assets';
import { colors, fonts } from '../constants/theme';

export function Header({ title = 'VeryLoving', subtitle }) {
  return (
    <View style={styles.wrap}>
      <Image source={images.logo} style={styles.logo} resizeMode="contain" />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  logo: { width: 44, height: 44 },
  title: { fontFamily: fonts.display, color: colors.ink, fontSize: 28 },
  subtitle: { fontFamily: fonts.regular, color: colors.inkSoft, fontSize: 14, marginTop: 2 }
});
