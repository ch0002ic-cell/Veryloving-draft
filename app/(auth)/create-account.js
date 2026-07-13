import { useState } from 'react';
import { Alert, Image, Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { useAuth } from '../../src/context/AuthContext';
import { images } from '../../src/constants/assets';
import { colors, fonts } from '../../src/constants/theme';
import { GlobalPhoneInput } from '../../src/components/GlobalPhoneInput';
import { useI18n } from '../../src/context/I18nContext';
import { isExpoGoRuntime } from '../../src/utils/runtime-environment';

export default function CreateAccount() {
  const { signInWithApple, signInWithGoogle, signInWithPhone } = useAuth();
  const { t } = useI18n();
  const [phone, setPhone] = useState(null);
  const [busyAction, setBusyAction] = useState(null);
  const appleSignInAvailable = Platform.OS === 'ios';
  const googleSignInAvailable = !isExpoGoRuntime();

  const startSocial = async (provider, signIn) => {
    if (busyAction) return;
    setBusyAction(provider);
    try {
      await signIn();
    } catch (error) {
      if (!/cancel/i.test(String(error?.code || error?.message || ''))) {
        Alert.alert(t('auth.signInFailedTitle'), t('auth.signInFailedMessage'));
      }
    } finally {
      setBusyAction(null);
    }
  };

  const startPhone = async () => {
    if (busyAction || !phone?.isValid) return;
    setBusyAction('phone');
    try {
      const verification = await signInWithPhone(phone);
      router.push({
        pathname: '/(auth)/verify-code',
        params: {
          countryCode: verification.countryCode,
          phone: verification.phone,
          verificationId: verification.verificationId
        }
      });
    } catch {
      Alert.alert(t('auth.signInFailedTitle'), t('auth.signInFailedMessage'));
    } finally {
      setBusyAction(null);
    }
  };
  return (
    <Screen>
      <Header title={t('auth.createAccount')} subtitle={t('auth.createSubtitle')} />
      <View style={styles.socialRow}>
        {appleSignInAvailable ? (
          <Button title={t('common.apple')} icon="logo-apple" loading={busyAction === 'apple'} disabled={Boolean(busyAction)} onPress={() => startSocial('apple', signInWithApple)} />
        ) : null}
        {googleSignInAvailable ? (
          <Button title={t('common.google')} variant="ghost" loading={busyAction === 'google'} disabled={Boolean(busyAction)} onPress={() => startSocial('google', signInWithGoogle)} />
        ) : null}
      </View>
      <View style={styles.inputCard}>
        <Text style={styles.label}>{t('auth.phoneVerification')}</Text>
        <GlobalPhoneInput value={phone} onChange={setPhone} />
        <Button
          title={busyAction === 'phone' ? t('auth.sendingCode') : t('auth.sendCode')}
          loading={busyAction === 'phone'}
          onPress={startPhone}
          disabled={Boolean(busyAction) || !phone?.isValid}
        />
      </View>
      <Image source={images.mapOnboarding} style={styles.image} resizeMode="contain" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  socialRow: { gap: 10 },
  inputCard: { backgroundColor: '#fff', borderRadius: 8, padding: 16, gap: 12, borderWidth: 1, borderColor: colors.line },
  label: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 16 },
  image: { width: '100%', height: 180 }
});
