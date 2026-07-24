import { useState } from 'react';
import { Image, Platform, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { Card } from '../../src/components/Card';
import { useAuth } from '../../src/context/AuthContext';
import { images } from '../../src/constants/assets';
import { colors, spacing, typography } from '../../src/constants/theme';
import { GlobalPhoneInput } from '../../src/components/GlobalPhoneInput';
import { useI18n } from '../../src/context/I18nContext';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import { AppleSignInButton } from '../../src/components/AppleSignInButton';
import {
  authenticationCapabilityTranslationKey,
  authenticationErrorTranslationKey,
  isAuthenticationCancellation
} from '../../src/utils/auth-configuration';

export default function CreateAccount() {
  const {
    authCapabilities,
    authError,
    clearAuthError,
    continueAsDemo,
    demoModeAvailable,
    isIOSSimulator,
    signInWithApple,
    signInWithGoogle,
    signInWithPhone
  } = useAuth();
  const { t } = useI18n();
  const [phone, setPhone] = useState(null);
  const [busyAction, setBusyAction] = useState(null);
  const [localErrorKey, setLocalErrorKey] = useState(null);
  const appleSignInAvailable = authCapabilities.apple.enabled;
  const googleSignInAvailable = authCapabilities.google.enabled;
  const activeErrorKey = authError || localErrorKey;
  const activeErrorTone = activeErrorKey === 'releaseCritical.authUnavailable' ? 'info' : 'error';
  const configurationMessages = [...new Set([
    Platform.OS === 'ios' ? authenticationCapabilityTranslationKey(authCapabilities.apple) : null,
    ['ios', 'android'].includes(Platform.OS) ? authenticationCapabilityTranslationKey(authCapabilities.google) : null,
    authenticationCapabilityTranslationKey(authCapabilities.phone)
  ].filter(Boolean))].map((key) => t(key));

  const startSocial = async (provider, signIn) => {
    if (busyAction) return;
    clearAuthError();
    setLocalErrorKey(null);
    setBusyAction(provider);
    try {
      await signIn();
    } catch (error) {
      if (!isAuthenticationCancellation(error)) setLocalErrorKey(authenticationErrorTranslationKey(error));
    } finally {
      setBusyAction(null);
    }
  };

  const startPhone = async () => {
    if (busyAction || !phone?.isValid || !authCapabilities.phone.enabled) return;
    clearAuthError();
    setLocalErrorKey(null);
    setBusyAction('phone');
    try {
      await signInWithPhone(phone);
      router.push('/(auth)/verify-code');
    } catch (error) {
      setLocalErrorKey(authenticationErrorTranslationKey(error));
    } finally {
      setBusyAction(null);
    }
  };

  const startDemo = async () => {
    if (busyAction || !demoModeAvailable) return;
    clearAuthError();
    setLocalErrorKey(null);
    setBusyAction('demo');
    try {
      await continueAsDemo();
    } catch (error) {
      setLocalErrorKey(authenticationErrorTranslationKey(error));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Screen>
      <Header title={t('auth.createAccount')} subtitle={t('auth.createSubtitle')} showBack backLabel={t('common.back')} />
      <FeedbackBanner
        message={activeErrorKey ? t(activeErrorKey) : null}
        tone={activeErrorTone}
      />
      {!activeErrorKey && configurationMessages.length ? (
        <FeedbackBanner message={configurationMessages.join('\n')} tone="info" />
      ) : null}
      {appleSignInAvailable || googleSignInAvailable ? <Card style={styles.socialRow}>
        {appleSignInAvailable ? (
          <AppleSignInButton
            title={t('common.apple')}
            nativeModuleAllowed={isIOSSimulator === null ? null : !isIOSSimulator}
            loading={busyAction === 'apple'}
            disabled={Boolean(busyAction)}
            onPress={() => startSocial('apple', signInWithApple)}
          />
        ) : null}
        {googleSignInAvailable ? (
          <Button title={t('common.google')} variant="ghost" loading={busyAction === 'google'} disabled={Boolean(busyAction)} onPress={() => startSocial('google', signInWithGoogle)} />
        ) : null}
      </Card> : null}
      <Card style={styles.inputCard}>
        <Text style={styles.label}>{t('auth.phoneVerification')}</Text>
        <GlobalPhoneInput
          value={phone}
          onChange={(value) => {
            setPhone(value);
            clearAuthError();
            setLocalErrorKey(null);
          }}
        />
        <Button
          title={busyAction === 'phone' ? t('auth.sendingCode') : t('auth.sendCode')}
          loading={busyAction === 'phone'}
          onPress={startPhone}
          disabled={Boolean(busyAction) || !phone?.isValid || !authCapabilities.phone.enabled}
        />
      </Card>
      {demoModeAvailable ? (
        <Card variant="tinted" style={styles.demoCard}>
          <FeedbackBanner message={t('releaseCritical.demoModeNotice')} tone="info" />
          <Button
            title={t('releaseCritical.continueAsDemo')}
            accessibilityLabel={t('releaseCritical.continueAsDemo')}
            variant="ghost"
            loading={busyAction === 'demo'}
            disabled={Boolean(busyAction)}
            onPress={startDemo}
          />
        </Card>
      ) : null}
      <Image accessible={false} source={images.mapOnboarding} style={styles.image} resizeMode="contain" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  socialRow: { gap: spacing.sm },
  inputCard: { gap: spacing.mdSm },
  demoCard: { gap: spacing.sm },
  label: { ...typography.heading, color: colors.textPrimary },
  image: { width: '100%', height: 150, marginTop: spacing.xs }
});
