import { useState } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { useAuth } from '../../src/context/AuthContext';
import { images } from '../../src/constants/assets';
import { colors, fonts } from '../../src/constants/theme';

export default function CreateAccount() {
  const { signInWithApple, signInWithGoogle, signInWithPhone } = useAuth();
  const [phone, setPhone] = useState('');
  const startPhone = async () => {
    await signInWithPhone(phone);
    router.push({ pathname: '/(auth)/verify-code', params: { phone } });
  };
  return (
    <Screen>
      <Header title="Create account" subtitle="Choose a sign-in method to protect your safety graph." />
      <View style={styles.socialRow}>
        <Button title="Apple" icon="logo-apple" onPress={async () => { await signInWithApple(); router.replace('/(auth)/device-check'); }} />
        <Button title="Google" variant="ghost" onPress={async () => { await signInWithGoogle(); router.replace('/(auth)/device-check'); }} />
      </View>
      <View style={styles.inputCard}>
        <Text style={styles.label}>Phone verification</Text>
        <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+1 555 0100" style={styles.input} />
        <Button title="Send code" onPress={startPhone} disabled={!phone} />
      </View>
      <Image source={images.mapOnboarding} style={styles.image} resizeMode="contain" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  socialRow: { gap: 10 },
  inputCard: { backgroundColor: '#fff', borderRadius: 18, padding: 16, gap: 12 },
  label: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 16 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, fontFamily: fonts.regular },
  image: { width: '100%', height: 180 }
});
