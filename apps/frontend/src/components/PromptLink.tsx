import { useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useReducedMotion } from '../hooks/useReducedMotion';
import { theme } from '../theme/tokens';

interface PromptLinkProps {
  prompt: string;
  onPress?: () => void;
}

export function PromptLink({ prompt, onPress }: PromptLinkProps) {
  const reducedMotion = useReducedMotion();
  const translateX = useRef(new Animated.Value(0)).current;

  function animateX(next: number) {
    if (reducedMotion) {
      return;
    }

    Animated.timing(translateX, {
      toValue: next,
      duration: 110,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }

  return (
    <Animated.View style={!reducedMotion ? { transform: [{ translateX }] } : undefined}>
      <Pressable
        onPress={onPress}
        onPressIn={() => animateX(3)}
        onPressOut={() => animateX(0)}
        accessibilityRole="button"
        style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
      >
        <View style={styles.row}>
          <Text style={styles.kicker}>Ask</Text>
          <Text style={styles.prompt}>{prompt}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
  },
  pressed: {
    backgroundColor: theme.colors.surfaceAlt,
  },
  row: {
    gap: theme.spacing.xs,
  },
  kicker: {
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.3,
  },
  prompt: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 16,
    lineHeight: 24,
  },
});
