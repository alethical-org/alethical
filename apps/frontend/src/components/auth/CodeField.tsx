import { createElement, Ref, useId } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { useResponsive } from '../../hooks/useResponsive';
import { browserFillInputProps } from '../../theme/browserFill';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { theme as t } from '../../theme/tokens';
import { FormError } from './FormError';

type CodeInputHandle = TextInput | HTMLInputElement;

export function CodeField({
  value,
  error,
  disabled = false,
  inputRef,
  onChangeText,
  onSubmitEditing,
}: {
  value: string;
  error?: string;
  disabled?: boolean;
  inputRef?: Ref<CodeInputHandle>;
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
}) {
  const generatedId = useId();
  const inputId = `auth-code-${generatedId}`;
  const labelId = `${inputId}-label`;
  const errorId = `${inputId}-error`;
  const { focused, focusProps } = useFieldFocus();
  const { isMobile } = useResponsive();
  const inputStyle = [styles.input, isMobile && styles.inputMobile, fieldOutlineReset];
  const webInputStyle = { ...(StyleSheet.flatten(inputStyle) as Record<string, unknown>) };
  delete webInputStyle.paddingVertical;
  delete webInputStyle.paddingHorizontal;
  webInputStyle.paddingTop = isMobile ? 16 : 14;
  webInputStyle.paddingBottom = isMobile ? 16 : 14;
  webInputStyle.paddingLeft = 16;
  webInputStyle.paddingRight = 16;
  webInputStyle.boxSizing = 'border-box';
  webInputStyle.lineHeight = '22px';
  const shellStyle = [
    styles.inputShell,
    disabled && styles.inputShellDisabled,
    error && styles.inputShellError,
    ...fieldFocusRing(focused),
  ];

  const input =
    Platform.OS === 'web' ? (
      createElement('input', {
        ...browserFillInputProps,
        'aria-describedby': error ? errorId : undefined,
        'aria-invalid': error ? true : undefined,
        'aria-labelledby': labelId,
        autoCapitalize: 'none',
        autoComplete: 'one-time-code',
        autoCorrect: 'off',
        disabled,
        enterKeyHint: 'done',
        id: inputId,
        inputMode: 'numeric',
        name: 'one-time-code',
        onBlur: focusProps.onBlur,
        onChange: (event: { currentTarget: { value: string } }) =>
          onChangeText(event.currentTarget.value),
        onFocus: focusProps.onFocus,
        onKeyDown: (event: { key: string; preventDefault: () => void }) => {
          if (event.key !== 'Enter' || !onSubmitEditing) return;
          event.preventDefault();
          onSubmitEditing();
        },
        ref: inputRef as Ref<HTMLInputElement>,
        spellCheck: false,
        style: webInputStyle,
        type: 'text',
        value,
      })
    ) : (
      <TextInput
        ref={inputRef as Ref<TextInput>}
        nativeID={inputId}
        accessibilityLabel="CODE"
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        autoCapitalize="none"
        autoComplete="one-time-code"
        autoCorrect={false}
        editable={!disabled}
        inputMode="numeric"
        keyboardType="number-pad"
        returnKeyType="done"
        spellCheck={false}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        {...focusProps}
        style={inputStyle}
      />
    );

  return (
    <View style={styles.fieldGroup}>
      <Text nativeID={labelId} style={styles.label}>
        CODE
      </Text>
      <View style={shellStyle}>{input}</View>
      {error ? <FormError id={errorId} message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldGroup: { width: '100%' },
  label: {
    marginBottom: 8,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    lineHeight: 16,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.32,
    color: t.colors.text.secondary,
  },
  inputShell: {
    minHeight: 52,
    justifyContent: 'center',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.18)',
    borderRadius: 12,
    ...(Platform.OS === 'web' ? ({ overflow: 'hidden' } as object) : null),
  },
  inputShellError: { borderColor: '#e0b673' },
  inputShellDisabled: { opacity: 0.6 },
  input: {
    width: '100%',
    minHeight: 50,
    borderWidth: 0,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 22,
    color: t.colors.text.primary,
  },
  inputMobile: { paddingVertical: 16 },
});
