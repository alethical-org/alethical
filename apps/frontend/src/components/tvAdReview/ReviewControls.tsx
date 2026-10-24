import { useEffect, useId, type ReactNode, type Ref } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { CandidateButton } from '../candidates/CandidateControls';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { theme as t } from '../../theme/tokens';

export function ReviewAction({
  label,
  accessibilityLabel,
  onPress,
  disabled = false,
  busy = false,
  fill = false,
}: {
  label: string;
  /** A fuller name for assistive technology; it must begin with the visible label. */
  accessibilityLabel?: string;
  /** Full column width, as a phone's action button under its field. */
  fill?: boolean;
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
        alignSelf: fill ? 'stretch' : 'flex-start',
        width: fill ? '100%' : undefined,
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
  inputRef,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  multiline?: boolean;
  disabled?: boolean;
  hint?: string;
  inputRef?: Ref<TextInput>;
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
        ref={inputRef}
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
export function ReviewSection({
  title,
  children,
  narrow = false,
}: {
  title: string;
  children: ReactNode;
  /** Forms and suggestion cards read best at the /money/ads search width. */
  narrow?: boolean;
}) {
  return (
    <View style={reviewStyles.section}>
      <Text accessibilityRole="header" aria-level={2} style={reviewStyles.h2}>
        {title}
      </Text>
      {narrow ? <View style={[reviewStyles.stack, { maxWidth: 780 }]}>{children}</View> : children}
    </View>
  );
}
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2311150f' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")";
/** A native menu drawn like the folder-filter menu button: 48px, rounded, chevron. */
export function ReviewSelect({
  label,
  value,
  onChange,
  options,
  disabled = false,
  fill = true,
  children,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  /** Stretch to the column, or size to the longest option. */
  fill?: boolean;
  children?: ReactNode;
}) {
  useEffect(() => {
    if (Platform.OS !== 'web' || document.getElementById('tv-review-select-style')) return;
    const sheet = document.createElement('style');
    sheet.id = 'tv-review-select-style';
    sheet.textContent =
      'select[data-tv-review-select]{transition:border-color .16s ease,background-color .16s ease}' +
      '@media(hover:hover) and (pointer:fine){select[data-tv-review-select]:not(:disabled):hover{border-color:rgba(17,21,15,.3)}}' +
      'select[data-tv-review-select]:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}';
    document.head.append(sheet);
  }, []);
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0,
        fontFamily: t.typography.ui,
        fontSize: 15,
        lineHeight: '23px',
        fontWeight: 600,
        color: t.colors.text.primary,
      }}
    >
      {label}
      <select
        data-tv-review-select="true"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          display: 'block',
          width: fill ? '100%' : undefined,
          maxWidth: '100%',
          minHeight: 48,
          boxSizing: 'border-box',
          padding: '0 42px 0 16px',
          borderRadius: 12,
          border: '1px solid rgba(17,21,15,0.16)',
          backgroundColor: '#ffffff',
          backgroundImage: CHEVRON,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 14px center',
          color: t.colors.text.primary,
          font: 'inherit',
          fontFamily: t.typography.body,
          fontSize: 16,
          fontWeight: 600,
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {children}
    </label>
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
  field: { gap: 8, minWidth: 0, flexGrow: 1 },
  input: {
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 16,
    lineHeight: 24,
    color: t.colors.text.primary,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    // 11 + 24 + 11 + the 2 border pixels keeps a one-line field at 48px,
    // level with the menus and buttons beside it.
    paddingVertical: 11,
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
