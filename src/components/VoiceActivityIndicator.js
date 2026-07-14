import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from 'react-native-reanimated';
import { colors } from '../constants/theme';

export function VoiceActivityIndicator({ active }) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }]
  }));

  useEffect(() => {
    cancelAnimation(scale);
    scale.value = active
      ? withRepeat(withTiming(1.18, {
        duration: 500,
        easing: Easing.inOut(Easing.ease),
        reduceMotion: ReduceMotion.System
      }), -1, true)
      : withTiming(1, {
        duration: 150,
        reduceMotion: ReduceMotion.System
      });

    return () => cancelAnimation(scale);
  }, [active, scale]);

  return <Animated.View style={[styles.outer, animatedStyle]}><View style={styles.inner} /></Animated.View>;
}

const styles = StyleSheet.create({
  outer: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#FCE5D8', alignItems: 'center', justifyContent: 'center' },
  inner: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.orange }
});
