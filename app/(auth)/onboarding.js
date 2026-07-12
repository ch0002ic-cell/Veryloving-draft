import { Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Button } from '../../src/components/Button';
import { images } from '../../src/constants/assets';
import { colors, fonts } from '../../src/constants/theme';

export default function Onboarding() {
  return (
    <Screen background={images.onboarding1} scroll={false} style={styles.wrap}>
      <View style={styles.hero}>
        <Image source={images.capybaraMenu} style={styles.capy} resizeMode="contain" />
        <Text style={styles.title}>VeryLoving</Text>
        <Text style={styles.subtitle}>A personal safety companion for the moments between “I’m fine” and “I need help.”</Text>
      </View>
      <Button title="Create account" onPress={() => router.push('/(auth)/create-account')} />
      <Button title="Continue with onboarding" variant="ghost" onPress={() => router.push('/(auth)/location-permission')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'space-between' },
  hero: { alignItems: 'center', gap: 12, marginTop: 48 },
  capy: { width: 220, height: 220 },
  title: { fontFamily: fonts.display, fontSize: 44, color: colors.ink },
  subtitle: { fontFamily: fonts.regular, fontSize: 16, color: colors.ink, textAlign: 'center', lineHeight: 23 }
});
