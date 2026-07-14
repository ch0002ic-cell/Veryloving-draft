import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { images } from '../constants/assets';
import { colors, fonts } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export function Header({ title = 'VeryLoving', subtitle, showBack = false, backLabel = 'Back', onBack }) {
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
    <View style={styles.wrap}>
      {showBack ? (
        <Pressable
          accessibilityLabel={backLabel}
          accessibilityRole="button"
          hitSlop={4}
          onPress={goBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ionicons
            name={isRTL ? 'chevron-forward' : 'chevron-back'}
            size={26}
            color={colors.ink}
          />
        </Pressable>
      ) : (
        <View style={styles.logoBox}>
          <Image source={images.logo} style={styles.logo} resizeMode="contain" />
        </View>
      )}
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
  backButton: { width: 48, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.controlBorder },
  pressed: { opacity: 0.62 },
  logo: { width: 40, height: 18 },
  title: { fontFamily: fonts.display, color: colors.ink, fontSize: 28, lineHeight: 34 },
  subtitle: { fontFamily: fonts.regular, color: colors.inkSoft, fontSize: 14, lineHeight: 20, marginTop: 2 }
});
