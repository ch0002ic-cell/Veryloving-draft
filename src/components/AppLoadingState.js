import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { images } from '../constants/assets';
import { colors, spacing } from '../constants/theme';

export function AppLoadingState({ message = 'Preparing VeryLoving…' }) {
  return (
    <View
      accessible
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      style={styles.screen}
    >
      <View style={styles.brandMark}>
        <Image accessible={false} source={images.capybaraMenu} resizeMode="contain" style={styles.image} />
      </View>
      <Text style={styles.brand}>VeryLoving</Text>
      <Text style={styles.message}>{message}</Text>
      <ActivityIndicator color={colors.orangeAccessible} size="small" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.cream
  },
  brandMark: {
    width: 104,
    height: 104,
    marginBottom: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 52,
    backgroundColor: colors.orangeSoft
  },
  image: { width: 88, height: 88 },
  brand: { color: colors.ink, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  message: { color: colors.inkSoft, fontSize: 15, lineHeight: 21, textAlign: 'center' }
});
