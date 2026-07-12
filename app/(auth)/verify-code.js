import { useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
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
  const verificationId = routeValue(params.verificationId) || `dev-${phone}`;
  const { verifyCode } = useAuth();
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      setError(null);
      await verifyCode(verificationId, code, { phone, countryCode });
      router.replace('/(auth)/device-check');
    } catch (verificationError) {
      setError(verificationError.message);
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
        onChangeText={setCode}
        placeholder="123456"
        style={styles.input}
        textContentType="oneTimeCode"
        value={code}
      />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Button title={t('auth.verify')} onPress={submit} disabled={code.length < 4} />
    </Screen>
  );
}
const styles = StyleSheet.create({
  label: { fontFamily: fonts.semibold, color: colors.ink },
  input: { minHeight: 54, borderRadius: 8, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, backgroundColor: '#fff', fontSize: 20, textAlign: 'center' },
  error: { fontFamily: fonts.regular, color: colors.red, textAlign: 'center' }
});
