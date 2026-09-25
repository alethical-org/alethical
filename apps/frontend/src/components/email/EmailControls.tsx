import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { theme as t } from '../../theme/tokens';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

export const emailColors = {
  ink: '#11150f',
  muted: '#4b524b',
  green: '#2ed47e',
  hoverGreen: '#28bf71',
  link: '#0f7a45',
  focus: '#7c5cff',
};

function pointerCanHover() {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
  );
}

function useAnnouncedDisabled(disabled: boolean) {
  const ref = useRef<View>(null);
  // Like auth/LoadingButton, keep the control focusable while announcing its
  // unavailable state. RN-Web Pressable overwrites a supplied aria-disabled;
  // its real disabled prop would remove focus from a busy native button.
  useEffect(() => {
    if (Platform.OS !== 'web' || !ref.current) return;
    const node = ref.current as unknown as HTMLElement;
    if (disabled) node.setAttribute('aria-disabled', 'true');
    else node.removeAttribute('aria-disabled');
  }, [disabled]);
  return ref;
}

export function EmailButton({
  label,
  onPress,
  busy = false,
  locked = false,
  kind = 'green',
  fullWidth = false,
  minHeight = 52,
  reserveLabel,
  testID,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  locked?: boolean;
  kind?: 'green' | 'outline' | 'darkOutline';
  fullWidth?: boolean;
  minHeight?: number;
  reserveLabel?: string;
  testID?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const inactive = busy || locked;
  const controlRef = useAnnouncedDisabled(inactive);
  return (
    <Pressable
      ref={controlRef}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy }}
      aria-busy={busy || undefined}
      aria-disabled={inactive}
      onPress={() => {
        if (!inactive) onPress();
      }}
      onHoverIn={() => {
        if (pointerCanHover()) setHovered(true);
      }}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.button,
        { minHeight },
        fullWidth && styles.full,
        kind === 'green'
          ? styles.green
          : kind === 'darkOutline'
            ? styles.darkOutline
            : styles.outline,
        hovered &&
          !inactive &&
          (kind === 'green'
            ? styles.greenHover
            : kind === 'darkOutline'
              ? styles.darkOutlineHover
              : styles.outlineHover),
        inactive && styles.inactive,
      ]}
    >
      <View style={styles.buttonLabels}>
        {reserveLabel ? (
          <Text aria-hidden style={[styles.buttonText, styles.reservedLabel]}>
            {reserveLabel}
          </Text>
        ) : null}
        <Text
          style={[
            styles.buttonText,
            styles.visibleLabel,
            kind === 'darkOutline' ? styles.whiteText : styles.inkText,
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

export function EmailCheckbox({
  label,
  help,
  value,
  onChange,
  locked = false,
  mark,
}: {
  label: string;
  help?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  locked?: boolean;
  mark?: 'Not saved yet' | 'Not confirmed';
}) {
  const controlRef = useAnnouncedDisabled(locked);
  return (
    <Pressable
      ref={controlRef}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled: locked }}
      aria-checked={value}
      aria-disabled={locked}
      onPress={() => {
        if (!locked) onChange(!value);
      }}
      {...(Platform.OS === 'web'
        ? {
            onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
              if (event.key !== ' ' && event.key !== 'Enter') return;
              event.preventDefault();
              event.stopPropagation();
              if (!locked && !event.repeat) onChange(!value);
            },
            onKeyUp: (event: ReactKeyboardEvent<HTMLElement>) => {
              if (event.key !== ' ' && event.key !== 'Enter') return;
              event.preventDefault();
              event.stopPropagation();
            },
          }
        : {})}
      // App.tsx provides :focus-visible. Unconditional onFocus styling also
      // paints mouse/touch focus and duplicates that keyboard-only treatment.
      style={styles.choice}
    >
      <View style={[styles.box, value && styles.boxChecked]}>
        {value ? <Text style={styles.check}>✓</Text> : null}
      </View>
      <View style={styles.choiceWords}>
        <Text style={styles.choiceLabel}>{label}</Text>
        {help ? <Text style={styles.choiceHelp}>{help}</Text> : null}
      </View>
      {mark ? (
        <Text style={[styles.mark, mark === 'Not confirmed' && styles.markUncertain]}>{mark}</Text>
      ) : null}
    </Pressable>
  );
}

export function EmailNotice({
  children,
  kind,
}: {
  children: ReactNode;
  kind: 'error' | 'uncertain' | 'success';
}) {
  return (
    <View
      accessibilityRole={kind === 'success' ? undefined : 'alert'}
      aria-live={kind === 'success' ? 'polite' : 'assertive'}
      style={[
        styles.notice,
        kind === 'error' ? styles.error : kind === 'uncertain' ? styles.uncertain : styles.success,
      ]}
    >
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  full: { alignSelf: 'stretch', width: '100%' },
  green: { backgroundColor: emailColors.green, borderColor: emailColors.green },
  greenHover: { backgroundColor: emailColors.hoverGreen, borderColor: emailColors.hoverGreen },
  outline: { backgroundColor: '#ffffff', borderColor: 'rgba(17,21,15,0.18)' },
  outlineHover: { backgroundColor: '#f7f8fa', borderColor: 'rgba(17,21,15,0.3)' },
  darkOutline: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.32)' },
  darkOutlineHover: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.5)',
  },
  inactive: { opacity: 0.62 },
  buttonLabels: {
    maxWidth: '100%',
    ...(Platform.OS === 'web' ? ({ display: 'grid' } as object) : {}),
  },
  // Both labels contribute to the same grid cell, including when text wraps.
  // The hidden normal label holds the button's space during shorter states.
  reservedLabel: {
    opacity: 0,
    ...(Platform.OS === 'web' ? ({ gridArea: '1 / 1' } as object) : { display: 'none' }),
  },
  visibleLabel: Platform.OS === 'web' ? ({ gridArea: '1 / 1' } as object) : {},
  buttonText: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.bold,
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
  },
  inkText: { color: '#06231a' },
  whiteText: { color: '#ffffff' },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingVertical: 12,
    gap: 14,
  },
  box: {
    flexShrink: 0,
    width: 24,
    height: 24,
    borderWidth: 1.5,
    borderColor: '#6f756f',
    borderRadius: 6,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: emailColors.green, borderColor: '#0f7a45' },
  check: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.bold,
    color: emailColors.ink,
    fontSize: 19,
    lineHeight: 22,
  },
  choiceWords: { flex: 1, minWidth: 0 },
  choiceLabel: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.bold,
    fontSize: 18,
    lineHeight: 25,
    color: emailColors.ink,
  },
  choiceHelp: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.regular,
    fontSize: 15.5,
    lineHeight: 23,
    color: emailColors.muted,
    marginTop: 3,
  },
  mark: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.bold,
    fontSize: 13,
    lineHeight: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#a76a1a',
    backgroundColor: '#fdf5e8',
    color: '#6e4510',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  markUncertain: { borderStyle: 'solid' },
  notice: { padding: 14, borderRadius: 10, borderWidth: 1 },
  noticeText: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: emailColors.ink,
  },
  error: { backgroundColor: '#fdecec', borderColor: '#f4c9c6' },
  uncertain: { backgroundColor: '#fdf5e8', borderColor: '#efd9b0' },
  success: { backgroundColor: '#e4f8ee', borderColor: '#bfeacf' },
});
