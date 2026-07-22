import { SafeAreaView } from 'react-native-safe-area-context';
import { ImageBackground, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { colors, layout, spacing } from '../constants/theme';

export function Screen({ children, scroll = true, background, style }) {
  const screenContent = (
    <View style={[styles.content, !scroll && styles.flex, style]}>
      {children}
    </View>
  );
  const content = scroll ? (
    <ScrollView
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      contentContainerStyle={styles.scrollContent}
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {screenContent}
    </ScrollView>
  ) : screenContent;

  const keyboardSafeContent = (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      {content}
    </KeyboardAvoidingView>
  );

  if (background) {
    return (
      <ImageBackground source={background} style={styles.bg}>
        <SafeAreaView style={[styles.safe, styles.transparent]}>{keyboardSafeContent}</SafeAreaView>
      </ImageBackground>
    );
  }

  return <SafeAreaView style={styles.safe}>{keyboardSafeContent}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surfaceCanvas },
  transparent: { backgroundColor: 'transparent' },
  bg: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', padding: layout.screenPadding, gap: spacing.md },
  flex: { flex: 1 }
});
