import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import { useAuth } from '../../src/context/AuthContext';
import { colors, fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';
import { formatE164ForDisplay } from '../../src/utils/phone';
import { authenticationErrorTranslationKey } from '../../src/utils/auth-configuration';

export default function VerifyCode() {
  const {
    authError,
    clearAuthError,
    hasPendingPhoneVerification,
    pendingPhoneNumber,
    user,
    verifyCode
  } = useAuth();
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [errorKey, setErrorKey] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!user && !hasPendingPhoneVerification) {
      router.replace('/(auth)/create-account');
    }
  }, [hasPendingPhoneVerification, user]);
  const submit = async () => {
    if (submitting) return;
    try {
      setSubmitting(true);
      setErrorKey(null);
      await verifyCode(code);
    } catch (verificationError) {
      setErrorKey(authenticationErrorTranslationKey(verificationError));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Screen>
      <Header
        title={t('auth.verifyCode')}
        subtitle={t('auth.sentTo', {
          phone: pendingPhoneNumber
            ? formatE164ForDisplay(pendingPhoneNumber)
            : t('auth.yourPhone')
        })}
      />
      <FeedbackBanner message={(errorKey || authError) ? t(errorKey || authError) : null} />
      <Text style={styles.label}>{t('auth.verificationCode')}</Text>
      <TextInput
        accessibilityLabel={t('auth.verificationCode')}
        autoComplete="one-time-code"
        keyboardType="number-pad"
        maxLength={6}
        onChangeText={(value) => {
          setCode(value.replace(/\D/g, '').slice(0, 6));
          setErrorKey(null);
          clearAuthError();
        }}
        placeholder={t('auth.verificationCode')}
        placeholderTextColor={colors.inkSoft}
        style={styles.input}
        textContentType="oneTimeCode"
        value={code}
      />
      <Button
        title={submitting ? t('auth.verifying') : t('auth.verify')}
        loading={submitting}
        onPress={submit}
        disabled={submitting || !hasPendingPhoneVerification || !/^\d{6}$/.test(code)}
      />
    </Screen>
  );
}
const styles = StyleSheet.create({
  label: { fontFamily: fonts.semibold, color: colors.ink },
  input: { minHeight: 54, borderRadius: 8, borderWidth: 1, borderColor: colors.controlBorder, paddingHorizontal: 14, backgroundColor: '#fff', color: colors.ink, fontSize: 20, textAlign: 'center' },
});
