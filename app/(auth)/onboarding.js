import { Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Button } from '../../src/components/Button';
import { images } from '../../src/constants/assets';
import { colors, fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';

export default function Onboarding() {
  const { t } = useI18n();
  return (
    <Screen background={images.onboarding1} scroll={false} style={styles.wrap}>
      <View style={styles.hero}>
        <Image source={images.capybaraMenu} style={styles.capy} resizeMode="contain" />
        <Text style={styles.title}>VeryLoving</Text>
        <Text style={styles.subtitle}>{t('auth.onboardingTagline')}</Text>
      </View>
      <Button title={t('auth.createAccount')} onPress={() => router.push('/(auth)/create-account')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'space-between' },
  hero: { alignItems: 'center', gap: 12, marginTop: 48 },
  capy: { width: 220, height: 220 },
  title: { fontFamily: fonts.display, fontSize: 44, color: colors.ink },
  subtitle: { fontFamily: fonts.regular, fontSize: 16, color: colors.ink, textAlign: 'center', lineHeight: 23 }
});
