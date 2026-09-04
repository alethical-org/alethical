import { useEffect, useMemo, useRef } from 'react';
import { Animated, DimensionValue, StyleProp, useWindowDimensions, ViewStyle } from 'react-native';

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

/**
 * Holds one window's height, so the footer below it starts under the fold and
 * the page cannot jump when a record lands.
 *
 * A page's own height is not known until its record arrives, and the footer
 * draws directly beneath whatever stands in the meantime. Those stand-ins are
 * far shorter than the pages they replace: a legislator profile settles at
 * 3,712px on a 390x844 phone against a 513px skeleton. So the footer lands
 * inside the first screenful and the arriving record shoves it out of sight in
 * one movement. Measured on the live site on 4 Sep 2026, that single movement
 * was the whole of Google's layout-movement score on both record addresses:
 * 0.39 of 0.39 on a legislator profile and 0.30 of 0.36 on a bill at phone
 * width, 0.64 of 0.65 on a bill at desktop width, against a passing mark of 0.1
 * (issue #1982).
 *
 * Wrap EVERY state of a page in this, never the loading one alone. Reserving
 * only while loading moves the same problem to a failed load, where the reserved
 * space is released and the footer is pulled up INTO view: measured on a local
 * build of this repository, that took a failed bill load from 0.11 to 0.31 at
 * phone width and a failed profile load from 0.19 to 0.49 at desktop width.
 *
 * What a reader sees changes on one state only. `Footer` keeps its
 * `marginTop: 'auto'`, so a settled page taller than the window is untouched;
 * on a page shorter than the window, which here means the "we couldn't load
 * this" states, the footer now sits just below the fold instead of at the bottom
 * of the window.
 */
export function useOneScreenTall(): { minHeight: number } {
  const { height } = useWindowDimensions();
  return useMemo(() => ({ minHeight: height }), [height]);
}
