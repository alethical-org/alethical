import { createElement, Ref, useId } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { useResponsive } from '../../hooks/useResponsive';
import { theme as t } from '../../theme/tokens';
import { FormError } from './FormError';

type EmailInputHandle = TextInput | HTMLInputElement;

export function EmailField({
  id,
  label = 'EMAIL',
  name = 'email',
  value,
  error,
  disabled = false,
  returnKeyType = 'next',
  inputRef,
  onChangeText,
  onSubmitEditing,
}: {
  id?: string;
  label?: string;
  name?: string;
  value: string;
  error?: string;
  disabled?: boolean;
  returnKeyType?: 'next' | 'go' | 'done';
  inputRef?: Ref<EmailInputHandle>;
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
}) {
  const generatedId = useId();
  const inputId = id ?? `auth-email-${generatedId}`;
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
        'aria-describedby': error ? errorId : undefined,
        'aria-invalid': error ? true : undefined,
        'aria-labelledby': labelId,
        autoCapitalize: 'none',
        autoComplete: 'email',
        autoCorrect: 'off',
        disabled,
        enterKeyHint: returnKeyType,
        id: inputId,
        inputMode: 'email',
        name,
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
        type: 'email',
        value,
      })
    ) : (
      <TextInput
        ref={inputRef as Ref<TextInput>}
        nativeID={inputId}
        accessibilityLabel={label}
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        editable={!disabled}
        inputMode="email"
        keyboardType="email-address"
        returnKeyType={returnKeyType}
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
        {label}
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
