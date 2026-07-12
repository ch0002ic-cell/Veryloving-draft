import { useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { useAuth } from '../../src/context/AuthContext';
import { colors, fonts } from '../../src/constants/theme';

export default function VerifyCode() {
  const { phone } = useLocalSearchParams();
  const { verifyCode } = useAuth();
  const [code, setCode] = useState('');
  return (
    <Screen>
      <Header title="Verify code" subtitle={`Sent to ${phone || 'your phone'}`} />
      <Text style={styles.label}>Verification code</Text>
      <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" style={styles.input} placeholder="123456" />
      <Button title="Verify" onPress={async () => { await verifyCode(`dev-${phone}`, code); router.replace('/(auth)/device-check'); }} />
    </Screen>
  );
}
const styles = StyleSheet.create({ label: { fontFamily: fonts.semibold, color: colors.ink }, input: { minHeight: 54, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, backgroundColor: '#fff', fontSize: 20, letterSpacing: 4 } });
