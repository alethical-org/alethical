import { PropsWithChildren, useEffect, useRef } from 'react';
import { Animated, Platform, ViewStyle } from 'react-native';

import { useReducedMotion } from '../hooks/useReducedMotion';

interface MotionInProps extends PropsWithChildren {
  delay?: number;
  distance?: number;
  style?: ViewStyle;
}

export function MotionIn({
  children,
  delay = 0,
  distance = 10,
  style,
}: MotionInProps) {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(reducedMotion ? 0 : distance)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        delay,
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        delay,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start();
  }, [delay, distance, opacity, reducedMotion, translateY]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}
