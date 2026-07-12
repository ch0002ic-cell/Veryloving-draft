import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { useAuth } from '../../src/context/AuthContext';
import { images } from '../../src/constants/assets';
import { colors, fonts } from '../../src/constants/theme';
import { GlobalPhoneInput } from '../../src/components/GlobalPhoneInput';
import { useI18n } from '../../src/context/I18nContext';

export default function CreateAccount() {
  const { signInWithApple, signInWithGoogle, signInWithPhone } = useAuth();
  const { t } = useI18n();
  const [phone, setPhone] = useState(null);
  const startPhone = async () => {
    const verification = await signInWithPhone(phone);
    router.push({
      pathname: '/(auth)/verify-code',
      params: {
        countryCode: verification.countryCode,
        phone: verification.phone,
        verificationId: verification.verificationId
      }
    });
  };
  return (
    <Screen>
      <Header title={t('auth.createAccount')} subtitle={t('auth.createSubtitle')} />
      <View style={styles.socialRow}>
        <Button title={t('common.apple')} icon="logo-apple" onPress={async () => { await signInWithApple(); router.replace('/(auth)/device-check'); }} />
        <Button title={t('common.google')} variant="ghost" onPress={async () => { await signInWithGoogle(); router.replace('/(auth)/device-check'); }} />
      </View>
      <View style={styles.inputCard}>
        <Text style={styles.label}>{t('auth.phoneVerification')}</Text>
        <GlobalPhoneInput value={phone} onChange={setPhone} />
        <Button title={t('auth.sendCode')} onPress={startPhone} disabled={!phone?.isValid} />
      </View>
      <Image source={images.mapOnboarding} style={styles.image} resizeMode="contain" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  socialRow: { gap: 10 },
  inputCard: { backgroundColor: '#fff', borderRadius: 18, padding: 16, gap: 12 },
  label: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 16 },
  image: { width: '100%', height: 180 }
});
