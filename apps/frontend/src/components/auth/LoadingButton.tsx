import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useResponsive } from '../../hooks/useResponsive';
import { theme as t } from '../../theme/tokens';

type LoadingButtonTone = 'primary' | 'secondary' | 'quiet';

export function LoadingButton({
  label,
  busyLabel,
  onPress,
  busy = false,
  disabled = false,
  tone = 'primary',
  style,
}: {
  label: string;
  busyLabel: string;
  onPress?: () => void | Promise<void>;
  busy?: boolean;
  disabled?: boolean;
  tone?: LoadingButtonTone;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  const { isMobile } = useResponsive();
  const [locallyBusy, setLocallyBusy] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const pressLock = useRef(false);
  const externalBusy = useRef(busy);
  const sawExternalBusy = useRef(busy);
  const buttonRef = useRef<View>(null);
  const pending = busy || locallyBusy;

  externalBusy.current = busy;

  useEffect(() => {
    if (busy) {
      sawExternalBusy.current = true;
      pressLock.current = true;
      return;
    }
    if (!sawExternalBusy.current) return;
    sawExternalBusy.current = false;
    pressLock.current = false;
    setLocallyBusy(false);
  }, [busy]);

  // RN-Web drops aria-disabled unless its real `disabled` prop is set. Busy must
  // stay focusable, so write the announced state without disabling the element.
  useEffect(() => {
    if (Platform.OS !== 'web' || !buttonRef.current) return;
    const button = buttonRef.current as unknown as HTMLElement;
    if (pending) {
      button.setAttribute('aria-busy', 'true');
      button.setAttribute('aria-disabled', 'true');
    } else {
      button.removeAttribute('aria-busy');
      if (!disabled) button.removeAttribute('aria-disabled');
    }
  }, [disabled, pending]);

  const handlePress = async () => {
    if (!onPress || disabled || busy || pressLock.current) return;
    pressLock.current = true;
    setLocallyBusy(true);
    if (Platform.OS === 'web') {
      (buttonRef.current as unknown as HTMLElement | null)?.focus?.();
    }
    try {
      await onPress();
    } finally {
      if (!externalBusy.current) {
        pressLock.current = false;
        setLocallyBusy(false);
      }
    }
  };

  return (
    <Pressable
      ref={buttonRef}
      accessibilityRole="button"
      accessibilityLabel={pending ? busyLabel : label}
      accessibilityState={{ busy: pending, disabled: disabled || pending }}
      aria-busy={pending || undefined}
      aria-disabled={disabled || pending || undefined}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={() => void handlePress()}
      style={({ pressed }) => [
        styles.base,
        isMobile && styles.baseMobile,
        tone === 'primary' && styles.primary,
        tone === 'secondary' && styles.secondary,
        tone === 'quiet' && styles.quiet,
        hovered && !pending && !disabled && tone === 'primary' && styles.primaryHovered,
        hovered && !pending && !disabled && tone === 'secondary' && styles.secondaryHovered,
        pressed && !pending && !disabled && styles.pressed,
        pending && styles.busy,
        disabled && styles.disabled,
        focused && focusRingWeb,
        style,
      ]}
    >
      {pending && !reduceMotion ? (
        <View
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <ActivityIndicator
            size="small"
            color={tone === 'primary' ? t.colors.brand.darkest : t.colors.brand.graphics}
          />
        </View>
      ) : null}
      <Text
        accessibilityLiveRegion={pending ? 'polite' : 'none'}
        style={[
          styles.label,
          isMobile && styles.labelMobile,
          tone === 'quiet' && styles.quietLabel,
          disabled && styles.disabledLabel,
        ]}
      >
        {pending ? busyLabel : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 18,
  },
  baseMobile: { minHeight: 54, borderRadius: 13 },
  primary: { backgroundColor: t.colors.brand.base },
  primaryHovered: { backgroundColor: t.colors.brand.hover },
  secondary: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.18)',
  },
  secondaryHovered: { borderColor: t.colors.borders.strong },
  quiet: { minHeight: 44, backgroundColor: 'transparent' },
  pressed: { transform: [{ scale: 0.98 }] },
  busy: { opacity: 0.75 },
  disabled: { backgroundColor: '#e8ebe9', borderColor: '#e8ebe9' },
  label: {
    fontFamily: t.typography.ui,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.darkest,
    textAlign: 'center',
  },
  labelMobile: { fontSize: 18, lineHeight: 23 },
  quietLabel: { fontSize: 15, color: '#6f756f' },
  disabledLabel: { color: '#8a908a' },
});

const focusRingWeb =
  Platform.OS === 'web'
    ? ({
        outlineColor: '#7c5cff',
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      } as object)
    : null;
