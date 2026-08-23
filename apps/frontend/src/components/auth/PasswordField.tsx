import { createElement, ReactNode, Ref, useEffect, useId, useRef, useState } from 'react';
import {
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputSelectionChangeEventData,
  View,
} from 'react-native';

import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { browserFillInputProps } from '../../theme/browserFill';
import { useResponsive } from '../../hooks/useResponsive';
import { theme as t } from '../../theme/tokens';
import { FormError } from './FormError';

type PasswordInputHandle = TextInput | HTMLInputElement;
type PasswordAutoComplete = 'current-password' | 'new-password';
type Selection = { start: number; end: number };

function updateRef(ref: Ref<PasswordInputHandle> | undefined, node: PasswordInputHandle | null) {
  if (!ref) return;
  if (typeof ref === 'function') ref(node);
  else ref.current = node;
}

export function PasswordField({
  id,
  label = 'PASSWORD',
  name,
  value,
  helper,
  error,
  labelAccessory,
  disabled = false,
  compact = false,
  autoComplete = 'current-password',
  returnKeyType = 'go',
  inputRef,
  onChangeText,
  onFocus,
  onSubmitEditing,
}: {
  id?: string;
  label?: string;
  name?: string;
  value: string;
  helper?: string;
  error?: string;
  labelAccessory?: ReactNode;
  disabled?: boolean;
  compact?: boolean;
  autoComplete?: PasswordAutoComplete;
  returnKeyType?: 'next' | 'go' | 'done';
  inputRef?: Ref<PasswordInputHandle>;
  onChangeText: (value: string) => void;
  onFocus?: () => void;
  onSubmitEditing?: () => void;
}) {
  const generatedId = useId();
  const inputId = id ?? `auth-password-${generatedId}`;
  const labelId = `${inputId}-label`;
  const helperId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const describedBy = error ? errorId : helper ? helperId : undefined;
  const [visible, setVisible] = useState(false);
  const [toggleFocused, setToggleFocused] = useState(false);
  const [nativeSelection, setNativeSelection] = useState<Selection | undefined>();
  const domInputRef = useRef<HTMLInputElement | null>(null);
  const nativeInputRef = useRef<TextInput | null>(null);
  const selectionRef = useRef<Selection>({ start: value.length, end: value.length });
  const selectionToRestore = useRef<(Selection & { restoreFocus: boolean }) | null>(null);
  const inputFocused = useRef(false);
  const { focused, focusProps } = useFieldFocus();
  const { isMobile } = useResponsive();
  const inputStyle = [
    styles.input,
    isMobile && styles.inputMobile,
    compact && styles.inputCompact,
    fieldOutlineReset,
  ];
  const webInputStyle = { ...(StyleSheet.flatten(inputStyle) as Record<string, unknown>) };
  delete webInputStyle.paddingVertical;
  webInputStyle.paddingTop = compact ? 12 : isMobile ? 16 : 14;
  webInputStyle.paddingBottom = compact ? 12 : isMobile ? 16 : 14;
  webInputStyle.boxSizing = 'border-box';
  webInputStyle.lineHeight = '22px';
  const shellStyle = [
    styles.inputShell,
    compact && styles.inputShellCompact,
    disabled && styles.inputShellDisabled,
    error && styles.inputShellError,
    ...fieldFocusRing(focused),
  ];

  const assignInputRef = (node: PasswordInputHandle | null) => {
    if (Platform.OS === 'web') domInputRef.current = node as HTMLInputElement | null;
    else nativeInputRef.current = node as TextInput | null;
    updateRef(inputRef, node);
  };

  const rememberSelection = () => {
    if (Platform.OS === 'web') {
      const input = domInputRef.current;
      if (!input) return;
      selectionToRestore.current = {
        start: input.selectionStart ?? value.length,
        end: input.selectionEnd ?? value.length,
        restoreFocus: typeof document !== 'undefined' && document.activeElement === input,
      };
      return;
    }
    selectionToRestore.current = {
      ...selectionRef.current,
      restoreFocus: inputFocused.current,
    };
  };

  useEffect(() => {
    const selection = selectionToRestore.current;
    if (!selection) return;
    selectionToRestore.current = null;

    if (Platform.OS === 'web') {
      const frame = requestAnimationFrame(() => {
        const input = domInputRef.current;
        if (!input) return;
        input.setSelectionRange(selection.start, selection.end);
        if (selection.restoreFocus) input.focus();
      });
      return () => cancelAnimationFrame(frame);
    }

    setNativeSelection({ start: selection.start, end: selection.end });
    if (selection.restoreFocus) nativeInputRef.current?.focus();
    const timer = setTimeout(() => setNativeSelection(undefined), 0);
    return () => clearTimeout(timer);
  }, [visible]);

  const onNativeSelectionChange = (
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => {
    selectionRef.current = event.nativeEvent.selection;
  };

  const input =
    Platform.OS === 'web' ? (
      createElement('input', {
        ...browserFillInputProps,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-labelledby': labelId,
        autoCapitalize: 'none',
        autoComplete,
        autoCorrect: 'off',
        disabled,
        enterKeyHint: returnKeyType,
        id: inputId,
        name: name ?? autoComplete,
        onBlur: () => {
          inputFocused.current = false;
          focusProps.onBlur();
        },
        onChange: (event: { currentTarget: { value: string } }) =>
          onChangeText(event.currentTarget.value),
        onFocus: () => {
          inputFocused.current = true;
          focusProps.onFocus();
          onFocus?.();
        },
        onKeyDown: (event: { key: string; preventDefault: () => void }) => {
          if (event.key !== 'Enter' || !onSubmitEditing) return;
          event.preventDefault();
          onSubmitEditing();
        },
        ref: assignInputRef as Ref<HTMLInputElement>,
        spellCheck: false,
        style: webInputStyle,
        type: visible ? 'text' : 'password',
        value,
      })
    ) : (
      <TextInput
        ref={assignInputRef as Ref<TextInput>}
        nativeID={inputId}
        accessibilityLabel={label}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        autoCapitalize="none"
        autoComplete={autoComplete}
        autoCorrect={false}
        editable={!disabled}
        returnKeyType={returnKeyType}
        secureTextEntry={!visible}
        selection={nativeSelection}
        spellCheck={false}
        value={value}
        onBlur={() => {
          inputFocused.current = false;
          focusProps.onBlur();
        }}
        onChangeText={onChangeText}
        onFocus={() => {
          inputFocused.current = true;
          focusProps.onFocus();
          onFocus?.();
        }}
        onSelectionChange={onNativeSelectionChange}
        onSubmitEditing={onSubmitEditing}
        style={inputStyle}
      />
    );

  return (
    <View style={styles.fieldGroup}>
      <View style={labelAccessory ? styles.labelRow : undefined}>
        <Text
          nativeID={labelId}
          style={[styles.label, labelAccessory ? styles.labelWithAccessory : undefined]}
        >
          {label}
        </Text>
        {labelAccessory}
      </View>
      <View style={shellStyle}>
        {input}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          disabled={disabled}
          onBlur={() => setToggleFocused(false)}
          onFocus={() => setToggleFocused(true)}
          onPressIn={rememberSelection}
          onPress={() => setVisible((shown) => !shown)}
          style={({ pressed }) => [
            styles.visibilityButton,
            toggleFocused && focusRingWeb,
            pressed && styles.visibilityPressed,
          ]}
        >
          <Text style={styles.visibilityText}>{visible ? 'Hide' : 'Show'}</Text>
        </Pressable>
      </View>
      {error ? (
        <FormError id={errorId} message={error} />
      ) : helper ? (
        <Text nativeID={helperId} style={styles.helper}>
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldGroup: { width: '100%' },
  labelRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {
    marginBottom: 8,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    lineHeight: 16,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.32,
    color: t.colors.text.secondary,
  },
  labelWithAccessory: { marginBottom: 0 },
  inputShell: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.18)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  inputShellCompact: { minHeight: 48 },
  inputShellError: { borderColor: '#e0b673' },
  inputShellDisabled: { opacity: 0.6 },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 50,
    borderWidth: 0,
    paddingVertical: 14,
    paddingLeft: 16,
    paddingRight: 8,
    backgroundColor: 'transparent',
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 22,
    color: t.colors.text.primary,
  },
  inputMobile: { paddingVertical: 16 },
  inputCompact: { minHeight: 46, paddingVertical: 12, paddingLeft: 14, fontSize: 16 },
  visibilityButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  visibilityPressed: { backgroundColor: t.colors.surfaces.s300 },
  visibilityText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    lineHeight: 20,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.greenOnLight,
  },
  helper: {
    marginTop: 7,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 20,
    color: t.colors.text.muted,
  },
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
