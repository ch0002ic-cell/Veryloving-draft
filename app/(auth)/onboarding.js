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
    <Screen background={images.onboarding1} style={styles.wrap}>
      <View style={styles.hero}>
        <Image source={images.capybaraMenu} style={styles.capy} resizeMode="contain" />
        <View style={styles.copyPanel}>
          <Text style={styles.title}>VeryLoving</Text>
          <Text style={styles.subtitle}>{t('auth.onboardingTagline')}</Text>
        </View>
      </View>
      <Button title={t('auth.createAccount')} onPress={() => router.push('/(auth)/create-account')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'space-between' },
  hero: { alignItems: 'center', gap: 12, marginTop: 48 },
  capy: { width: 220, height: 220 },
  copyPanel: { width: '100%', maxWidth: 640, paddingHorizontal: 18, paddingVertical: 14, alignItems: 'center', gap: 8, borderRadius: 16, backgroundColor: 'rgba(255, 248, 239, 0.92)' },
  title: { fontFamily: fonts.display, fontSize: 44, color: colors.ink, textAlign: 'center' },
  subtitle: { fontFamily: fonts.regular, fontSize: 16, color: colors.ink, textAlign: 'center', lineHeight: 23 }
});
