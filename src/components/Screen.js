import { SafeAreaView } from 'react-native-safe-area-context';
import { ImageBackground, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { colors, spacing } from '../constants/theme';

const SCREEN_ENTERING = FadeInDown.duration(240).reduceMotion(ReduceMotion.System);

export function Screen({ children, scroll = true, background, style }) {
  const animatedContent = (
    <Animated.View entering={SCREEN_ENTERING} style={[styles.content, !scroll && styles.flex, style]}>
      {children}
    </Animated.View>
  );
  const content = scroll ? (
    <ScrollView
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      contentContainerStyle={styles.scrollContent}
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {animatedContent}
    </ScrollView>
  ) : animatedContent;

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
  safe: { flex: 1, backgroundColor: colors.cream },
  transparent: { backgroundColor: 'transparent' },
  bg: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { padding: 20, gap: spacing.md },
  flex: { flex: 1 }
});
