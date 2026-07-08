import { Pressable, StyleSheet, Text } from 'react-native';

import { theme } from '../theme/tokens';

interface ChipProps {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}

export function Chip({ label, selected = false, disabled = false, onPress }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        selected ? styles.selected : styles.idle,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[styles.label, selected && styles.selectedLabel, disabled && styles.disabledLabel]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idle: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
  },
  selected: {
    backgroundColor: theme.colors.ink,
    borderColor: theme.colors.primary,
  },
  pressed: {
    opacity: 0.9,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  selectedLabel: {
    color: theme.colors.white,
  },
  disabledLabel: {
    color: theme.colors.mutedInk,
  },
});
