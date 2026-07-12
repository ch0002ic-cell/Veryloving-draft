import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors } from '../constants/theme';

export function VoiceActivityIndicator({ active }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) {
      scale.setValue(1);
      return;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(scale, { toValue: 1.18, duration: 500, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 500, useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [active, scale]);
  return <Animated.View style={[styles.outer, { transform: [{ scale }] }]}><View style={styles.inner} /></Animated.View>;
}

const styles = StyleSheet.create({
  outer: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#FCE5D8', alignItems: 'center', justifyContent: 'center' },
  inner: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.orange }
});
