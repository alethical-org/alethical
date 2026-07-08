import { useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { useReducedMotion } from '../hooks/useReducedMotion';
import { theme } from '../theme/tokens';

interface PrimaryButtonProps {
  label: string;
  onPress?: () => void;
  tone?: 'primary' | 'secondary';
  style?: ViewStyle;
}

export function PrimaryButton({ label, onPress, tone = 'primary', style }: PrimaryButtonProps) {
  const primary = tone === 'primary';
  const disabled = !onPress;
  const reducedMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;

  function animateScale(next: number) {
    if (reducedMotion) {
      return;
    }

    Animated.timing(scale, {
      toValue: next,
      duration: 110,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }

  return (
    <Animated.View style={[style, !reducedMotion ? { transform: [{ scale }] } : undefined]}>
      <Pressable
        accessibilityState={{ disabled }}
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => {
          if (!disabled) {
            animateScale(0.985);
          }
        }}
        onPressOut={() => animateScale(1)}
        style={({ pressed }) => [
          styles.base,
          primary ? styles.primary : styles.secondary,
          pressed && !disabled ? styles.pressed : null,
          disabled ? styles.disabled : null,
        ]}
      >
        <Text
          style={[
            styles.label,
            primary ? styles.primaryLabel : styles.secondaryLabel,
            disabled ? styles.disabledLabel : null,
          ]}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  primary: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderColor: theme.colors.border,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.48,
  },
  label: {
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  primaryLabel: {
    color: theme.colors.white,
  },
  secondaryLabel: {
    color: theme.colors.ink,
  },
  disabledLabel: {
    color: theme.colors.mutedInk,
  },
});
