import { useEffect, useRef } from 'react';
import { Animated, DimensionValue, StyleProp, ViewStyle } from 'react-native';

import { theme as t, prefersReducedMotion } from '../theme/tokens';

// A single rounded gray placeholder block with a subtle opacity pulse. Compose
// several of these to build a skeleton loading state that mirrors a screen's
// real layout, so a cold load shows the page's shape instead of a spinner.
// Honors prefers-reduced-motion on web (no pulse — a static, slightly dimmed
// block) so it stays within the reduced-motion contract (#193).
export function Skeleton({
  width,
  height = 14,
  radius = t.radii.xs,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = prefersReducedMotion();
  const pulse = useRef(new Animated.Value(reduceMotion ? 0.7 : 0.5)).current;

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: t.colors.status.progressEmpty,
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}
