import { useId, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { CandidateButton } from '../candidates/CandidateControls';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { theme as t } from '../../theme/tokens';

export function ReviewAction({
  label,
  accessibilityLabel,
  onPress,
  disabled = false,
  busy = false,
}: {
  label: string;
  /** A fuller name for assistive technology; it must begin with the visible label. */
  accessibilityLabel?: string;
  onPress(): void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const busyLabel = 'Saving…';
  // Both labels share one grid cell so wrapping reserves the tallest and widest
  // box at this viewport. Only the real button participates in accessibility.
  return (
    <div
      data-tv-review-action="true"
      style={{
        display: 'inline-grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
        position: 'relative',
        alignSelf: 'flex-start',
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      {[label, busyLabel].map((text, index) => (
        <span
          key={index}
          aria-hidden="true"
          style={{
            gridArea: '1 / 1',
            visibility: 'hidden',
            pointerEvents: 'none',
            userSelect: 'none',
            fontFamily: t.typography.body,
            fontSize: 16,
            fontWeight: 700,
            lineHeight: '24px',
            textAlign: 'center',
            overflowWrap: 'anywhere',
            padding: '11px 22px',
            border: '1px solid transparent',
            minHeight: 48,
            boxSizing: 'border-box',
          }}
        >
          {text}
        </span>
      ))}
      <CandidateButton
        label={label}
        accessibilityLabel={busy ? busyLabel : (accessibilityLabel ?? label)}
        onPress={onPress}
        disabled={disabled}
        busy={busy}
        busyLabel={busyLabel}
        icon="none"
        kind="outline"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          width: '100%',
          paddingVertical: 11,
        }}
      />
    </div>
  );
}
export function ReviewField({
  label,
  value,
  onChange,
  multiline = false,
  disabled = false,
  hint,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  multiline?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  const { focused, focusProps } = useFieldFocus();
  return (
    <View style={reviewStyles.field}>
      <Text nativeID={id} style={reviewStyles.label}>
        {label}
      </Text>
      {hint ? (
        <Text nativeID={`${id}-hint`} style={reviewStyles.note}>
          {hint}
        </Text>
      ) : null}
      <TextInput
        aria-labelledby={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        multiline={multiline}
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        {...focusProps}
        style={[
          reviewStyles.input,
          multiline && reviewStyles.multiline,
          fieldOutlineReset,
          ...fieldFocusRing(focused),
        ]}
      />
    </View>
  );
}
export function ReviewSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={reviewStyles.section}>
      <Text accessibilityRole="header" aria-level={2} style={reviewStyles.h2}>
        {title}
      </Text>
      {children}
    </View>
  );
}
export const reviewStyles = StyleSheet.create({
  body: {
    fontFamily: t.typography.body,
    color: t.colors.text.primary,
    fontSize: 16,
    lineHeight: 25,
    fontVariant: ['tabular-nums'],
  },
  note: {
    fontFamily: t.typography.body,
    color: t.colors.text.secondary,
    fontSize: 14,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
  },
  label: {
    fontFamily: t.typography.ui,
    color: t.colors.text.primary,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '600',
  },
  h2: {
    fontFamily: t.typography.ui,
    color: t.colors.text.primary,
    fontSize: 23,
    lineHeight: 30,
    fontWeight: '700',
  },
  field: { gap: 6, minWidth: 0, flexGrow: 1 },
  input: {
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 16,
    lineHeight: 24,
    color: t.colors.text.primary,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: 8,
    padding: 12,
    minHeight: 48,
    backgroundColor: '#ffffff',
  },
  multiline: { minHeight: 112, textAlignVertical: 'top' },
  section: { gap: 16, paddingVertical: 24, borderTopWidth: 1, borderTopColor: t.colors.border },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  stack: { gap: 16, minWidth: 0 },
  card: { borderWidth: 1, borderColor: t.colors.border, borderRadius: 10, padding: 16, gap: 12 },
  notice: { minHeight: 48, justifyContent: 'center', paddingVertical: 8 },
  image: { width: '100%', height: undefined, aspectRatio: 0.77, backgroundColor: '#f1f2f4' },
});
