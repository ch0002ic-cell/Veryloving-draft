import { useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { useAuth } from '../../src/context/AuthContext';
import { colors, fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';
import { formatE164ForDisplay } from '../../src/utils/phone';

function routeValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

export default function VerifyCode() {
  const params = useLocalSearchParams();
  const phone = routeValue(params.phone);
  const countryCode = routeValue(params.countryCode);
  const verificationId = routeValue(params.verificationId);
  const { verifyCode } = useAuth();
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (submitting) return;
    try {
      setSubmitting(true);
      setError(null);
      await verifyCode(verificationId, code);
    } catch (verificationError) {
      setError(verificationError.message);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Screen>
      <Header
        title={t('auth.verifyCode')}
        subtitle={t('auth.sentTo', { phone: phone ? formatE164ForDisplay(phone) : t('auth.yourPhone') })}
      />
      <Text style={styles.label}>{t('auth.verificationCode')}</Text>
      <TextInput
        autoComplete="one-time-code"
        keyboardType="number-pad"
        maxLength={6}
        onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
        placeholder="123456"
        style={styles.input}
        textContentType="oneTimeCode"
        value={code}
      />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Button
        title={submitting ? t('auth.verifying') : t('auth.verify')}
        loading={submitting}
        onPress={submit}
        disabled={submitting || !verificationId || !/^\d{6}$/.test(code)}
      />
    </Screen>
  );
}
const styles = StyleSheet.create({
  label: { fontFamily: fonts.semibold, color: colors.ink },
  input: { minHeight: 54, borderRadius: 8, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, backgroundColor: '#fff', fontSize: 20, textAlign: 'center' },
  error: { fontFamily: fonts.regular, color: colors.red, textAlign: 'center' }
});
