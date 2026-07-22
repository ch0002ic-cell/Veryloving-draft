import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import { useAuth } from '../../src/context/AuthContext';
import { colors, radii, sizes, spacing, typography } from '../../src/constants/theme';
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
  const { isRTL, t } = useI18n();
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [errorKey, setErrorKey] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const codeValid = /^\d{6}$/.test(code);
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
      <Text style={[styles.label, isRTL && styles.rtlText]}>{t('auth.verificationCode')}</Text>
      <TextInput
        aria-invalid={codeTouched && !codeValid}
        accessibilityLabel={t('auth.verificationCode')}
        accessibilityState={{ busy: submitting, disabled: submitting }}
        autoComplete="one-time-code"
        editable={!submitting}
        keyboardType="number-pad"
        maxLength={6}
        onBlur={() => setCodeTouched(true)}
        onChangeText={(value) => {
          setCode(value.replace(/\D/g, '').slice(0, 6));
          setErrorKey(null);
          clearAuthError();
        }}
        placeholder={t('auth.verificationCode')}
        placeholderTextColor={colors.textSecondary}
        style={[styles.input, codeTouched && !codeValid && styles.invalidInput]}
        textContentType="oneTimeCode"
        value={code}
      />
      {codeTouched && !codeValid ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>
          {t('auth.invalidCode')}
        </Text>
      ) : null}
      <Button
        title={submitting ? t('auth.verifying') : t('auth.verify')}
        loading={submitting}
        onPress={submit}
        disabled={submitting || !hasPendingPhoneVerification || !codeValid}
      />
    </Screen>
  );
}
const styles = StyleSheet.create({
  label: { ...typography.label, color: colors.textPrimary },
  input: {
    minHeight: sizes.controlLarge,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderControl,
    paddingHorizontal: spacing.mdSm,
    backgroundColor: colors.surfaceRaised,
    color: colors.textPrimary,
    ...typography.title,
    fontVariant: ['tabular-nums'],
    letterSpacing: spacing.xs,
    textAlign: 'center',
    writingDirection: 'ltr'
  },
  invalidInput: { borderWidth: 2, borderColor: colors.redAccessible },
  error: { ...typography.caption, color: colors.redAccessible },
  rtlText: { textAlign: 'right' }
});
