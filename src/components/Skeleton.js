import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';
import { colors, motion, radii, spacing } from '../constants/theme';

let reduceMotionSnapshot = true;
let reduceMotionSubscription = null;
const reduceMotionListeners = new Set();

function publishReduceMotion(enabled) {
  reduceMotionSnapshot = Boolean(enabled);
  for (const listener of reduceMotionListeners) listener();
}

function subscribeToReduceMotion(listener) {
  reduceMotionListeners.add(listener);
  if (!reduceMotionSubscription) {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(publishReduceMotion)
      .catch(() => {});
    reduceMotionSubscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      publishReduceMotion
    );
  }
  return () => {
    reduceMotionListeners.delete(listener);
    if (!reduceMotionListeners.size) {
      reduceMotionSubscription?.remove();
      reduceMotionSubscription = null;
    }
  };
}

const getReduceMotionSnapshot = () => reduceMotionSnapshot;
const getServerReduceMotionSnapshot = () => true;

export function Skeleton({ width = '100%', height = 16, borderRadius = radii.md, style }) {
  const opacity = useRef(new Animated.Value(0.58)).current;
  const reduceMotion = useSyncExternalStore(
    subscribeToReduceMotion,
    getReduceMotionSnapshot,
    getServerReduceMotionSnapshot
  );

  useEffect(() => {
    opacity.stopAnimation();
    if (reduceMotion) {
      opacity.setValue(0.58);
      return undefined;
    }
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: motion.durationEmphasis * 3,
        useNativeDriver: true
      }),
      Animated.timing(opacity, {
        toValue: 0.58,
        duration: motion.durationEmphasis * 3,
        useNativeDriver: true
      })
    ]));
    pulse.start();
    return () => pulse.stop();
  }, [opacity, reduceMotion]);

  return (
    <Animated.View
      accessible={false}
      style={[styles.block, { width, height, borderRadius, opacity }, style]}
    />
  );
}

export function SkeletonText({ lines = 3, style }) {
  const safeLineCount = Math.max(1, Math.min(8, Math.trunc(lines) || 1));
  return (
    <View accessible={false} style={[styles.textGroup, style]}>
      {Array.from({ length: safeLineCount }, (_, index) => (
        <Skeleton
          key={index}
          height={14}
          width={index === safeLineCount - 1 && safeLineCount > 1 ? '68%' : '100%'}
        />
      ))}
    </View>
  );
}

export function SkeletonGroup({ label, children, style }) {
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      style={style}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.skeleton },
  textGroup: { gap: spacing.sm }
});
