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
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import { AppleSignInButton } from '../../src/components/AppleSignInButton';
import { isAuthenticationCancellation } from '../../src/utils/auth-configuration';

export default function CreateAccount() {
  const {
    authCapabilities,
    authError,
    clearAuthError,
    signInWithApple,
    signInWithGoogle,
    signInWithPhone
  } = useAuth();
  const { t } = useI18n();
  const [phone, setPhone] = useState(null);
  const [busyAction, setBusyAction] = useState(null);
  const appleSignInAvailable = authCapabilities.apple.enabled;
  const googleSignInAvailable = authCapabilities.google.enabled;
  const configurationMessages = [
    Platform.OS === 'ios' ? authCapabilities.apple.message : null,
    ['ios', 'android'].includes(Platform.OS) ? authCapabilities.google.message : null,
    authCapabilities.phone.message
  ].filter(Boolean);

  const startSocial = async (provider, signIn) => {
    if (busyAction) return;
    clearAuthError();
    setBusyAction(provider);
    try {
      await signIn();
    } catch (error) {
      if (!isAuthenticationCancellation(error)) {
        Alert.alert(t('auth.signInFailedTitle'), error?.userMessage || t('auth.signInFailedMessage'));
      }
    } finally {
      setBusyAction(null);
    }
  };

  const startPhone = async () => {
    if (busyAction || !phone?.isValid || !authCapabilities.phone.enabled) return;
    clearAuthError();
    setBusyAction('phone');
    try {
      await signInWithPhone(phone);
      router.push('/(auth)/verify-code');
    } catch (error) {
      Alert.alert(t('auth.signInFailedTitle'), error?.userMessage || t('auth.signInFailedMessage'));
    } finally {
      setBusyAction(null);
    }
  };
  return (
    <Screen>
      <Header title={t('auth.createAccount')} subtitle={t('auth.createSubtitle')} />
      <FeedbackBanner message={authError} />
      {configurationMessages.length ? (
        <FeedbackBanner message={configurationMessages.join('\n')} tone="info" />
      ) : null}
      {appleSignInAvailable || googleSignInAvailable ? <View style={styles.socialRow}>
        {appleSignInAvailable ? (
          <AppleSignInButton
            title={t('common.apple')}
            loading={busyAction === 'apple'}
            disabled={Boolean(busyAction)}
            onPress={() => startSocial('apple', signInWithApple)}
          />
        ) : null}
        {googleSignInAvailable ? (
          <Button title={t('common.google')} variant="ghost" loading={busyAction === 'google'} disabled={Boolean(busyAction)} onPress={() => startSocial('google', signInWithGoogle)} />
        ) : null}
      </View> : null}
      <View style={styles.inputCard}>
        <Text style={styles.label}>{t('auth.phoneVerification')}</Text>
        <GlobalPhoneInput
          value={phone}
          onChange={(value) => {
            setPhone(value);
            clearAuthError();
          }}
        />
        <Button
          title={busyAction === 'phone' ? t('auth.sendingCode') : t('auth.sendCode')}
          loading={busyAction === 'phone'}
          onPress={startPhone}
          disabled={Boolean(busyAction) || !phone?.isValid || !authCapabilities.phone.enabled}
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
