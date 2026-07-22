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
import { colors, motion, radii, tones } from '../constants/theme';

export function VoiceActivityIndicator({ active }) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }]
  }));

  useEffect(() => {
    cancelAnimation(scale);
    scale.value = active
      ? withRepeat(withTiming(1.18, {
        duration: motion.durationEmphasis * 2,
        easing: Easing.inOut(Easing.ease),
        reduceMotion: ReduceMotion.System
      }), -1, true)
      : withTiming(1, {
        duration: motion.durationFast,
        reduceMotion: ReduceMotion.System
      });

    return () => cancelAnimation(scale);
  }, [active, scale]);

  return <Animated.View accessible={false} style={[styles.outer, animatedStyle]}><View style={styles.inner} /></Animated.View>;
}

const styles = StyleSheet.create({
  outer: { width: 90, height: 90, borderRadius: radii.pill, backgroundColor: tones.accent.background, alignItems: 'center', justifyContent: 'center' },
  inner: { width: 56, height: 56, borderRadius: radii.pill, backgroundColor: colors.actionAccent }
});
