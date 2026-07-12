import { SafeAreaView } from 'react-native-safe-area-context';
import { ImageBackground, ScrollView, StyleSheet, View } from 'react-native';
import { colors } from '../constants/theme';

export function Screen({ children, scroll = true, background, style }) {
  const content = scroll ? (
    <ScrollView contentContainerStyle={[styles.content, style]} showsVerticalScrollIndicator={false}>{children}</ScrollView>
  ) : (
    <View style={[styles.content, styles.flex, style]}>{children}</View>
  );

  if (background) {
    return <ImageBackground source={background} style={styles.bg}><SafeAreaView style={styles.safe}>{content}</SafeAreaView></ImageBackground>;
  }

  return <SafeAreaView style={styles.safe}>{content}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  bg: { flex: 1 },
  content: { padding: 20, gap: 16 },
  flex: { flex: 1 }
});
