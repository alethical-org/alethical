import { useId, useRef, useState, type Ref } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { theme as t } from '../../theme/tokens';

/**
 * The campaign money section's one name field, shared by the /money landing, the
 * committees list and the search results page ("Campaign money IA.dc.html" §02:
 * "one field that takes a person or an organisation").
 *
 * Shared behavior keeps searching consistent across the campaign-money surfaces.
 * The list appearance adds its visible label, outline and clear control. It holds only its own
 * draft text and its focus ring; the applied query lives in the address, which is
 * what makes a search shareable (`.claude/rules/grounded-answers.md` rule 5).
 *
 * There is deliberately no typeahead dropdown. A dropdown is component state, so
 * a reader who found something in it has nothing to send anybody, and the same
 * matching is on a results page that does have an address.
 */
function MagnifierGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Circle cx={11} cy={11} r={6.5} stroke={color} strokeWidth={2} />
      <Path d="M16 16 L21 21" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function MoneyNameSearchField({
  value,
  onChangeText,
  onSubmit,
  placeholder,
  /** Shown when the field needs a name of its own beyond the placeholder — the
   *  committees list, where the page already has a bigger search story. */
  label,
  submitLabel = 'Search',
  /** Callers can keep a visible submit button alongside automatic searching. */
  showSubmitButton = false,
  maxWidth = 760,
  fieldHeight,
  fieldFontSize,
  stacked = false,
  controlGap,
  appearance = 'default',
  /** An outlined field with no list appearance can still offer the clear control. */
  showClear = false,
  accessibilityLabel,
  inputRef: externalInputRef,
  labelStyle,
  maxLength,
}: {
  value: string;
  onChangeText: (next: string) => void;
  onSubmit: () => void;
  placeholder: string;
  label?: string;
  submitLabel?: string;
  showSubmitButton?: boolean;
  maxWidth?: number;
  /** Lobbying uses measured heights at each band; existing callers keep their sizing. */
  fieldHeight?: number;
  fieldFontSize?: number;
  stacked?: boolean;
  controlGap?: number;
  appearance?: 'default' | 'list';
  showClear?: boolean;
  accessibilityLabel?: string;
  inputRef?: Ref<TextInput>;
  labelStyle?: import('react-native').StyleProp<import('react-native').TextStyle>;
  maxLength?: number;
}) {
  const inputId = useId();
  const listAppearance = appearance === 'list';
  const { focused, focusProps } = useFieldFocus();
  const inputRef = useRef<TextInput>(null);
  const [hovered, setHovered] = useState(false);

  return (
    <View style={[styles.wrap, { maxWidth }]}>
      {label ? (
        <Text
          nativeID={`${inputId}-label`}
          style={[styles.label, listAppearance && styles.listLabel, labelStyle]}
        >
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.row,
          fieldHeight != null && { gap: 12 },
          stacked && styles.stackedRow,
          controlGap != null && { gap: controlGap },
        ]}
      >
        <Pressable
          accessible={false}
          focusable={false}
          tabIndex={-1}
          onPress={() => inputRef.current?.focus()}
          style={[
            styles.box,
            fieldHeight != null && {
              height: fieldHeight,
              minWidth: 0,
              paddingVertical: 0,
              paddingHorizontal: 20,
              borderRadius: 14,
            },
            stacked && styles.stackedBox,
            listAppearance && styles.listBox,
            ...fieldFocusRing(focused),
          ]}
        >
          <MagnifierGlyph color={t.colors.text.faint} />
          <TextInput
            ref={(input) => {
              inputRef.current = input;
              if (typeof externalInputRef === 'function') externalInputRef(input);
              else if (externalInputRef) externalInputRef.current = input;
            }}
            maxLength={maxLength}
            nativeID={inputId}
            aria-labelledby={label ? `${inputId}-label` : undefined}
            // The placeholder is the field's accessible name where no visible
            // label sits above it, matching the bill and legislator search boxes.
            value={value}
            onChangeText={onChangeText}
            onFocus={focusProps.onFocus}
            onBlur={focusProps.onBlur}
            onSubmitEditing={onSubmit}
            returnKeyType="search"
            placeholder={placeholder}
            accessibilityLabel={accessibilityLabel ?? label ?? placeholder}
            placeholderTextColor={t.colors.text.faint}
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            style={[
              styles.input,
              fieldHeight != null && { height: '100%', paddingVertical: 0 },
              fieldFontSize != null && { fontSize: fieldFontSize },
              fieldOutlineReset,
            ]}
          />
          {(listAppearance || showClear) && value ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear the field"
              onPress={() => {
                onChangeText('');
                inputRef.current?.focus();
              }}
              style={styles.clearButton}
            >
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden>
                <Path
                  d="M6 6 L18 18 M18 6 L6 18"
                  stroke={t.colors.text.secondary}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                />
              </Svg>
            </Pressable>
          ) : null}
        </Pressable>
        {showSubmitButton ? (
          <Pressable
            onPress={onSubmit}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            accessibilityRole="button"
            style={[
              styles.button,
              fieldHeight != null && {
                minHeight: fieldHeight,
                borderRadius: 14,
                paddingHorizontal: 32,
              },
              listAppearance && styles.listButton,
              stacked && styles.stackedButton,
              hovered && styles.buttonHover,
            ]}
          >
            <Text
              style={[styles.buttonLabel, fieldFontSize != null && { fontSize: fieldFontSize }]}
            >
              {submitLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  listLabel: {
    fontFamily: t.typography.body,
    fontSize: 15,
    letterSpacing: 0,
    textTransform: 'none',
    marginBottom: 12,
  },
  listBox: {
    borderWidth: 2,
    borderColor: t.colors.text.primary,
    minWidth: 0,
    height: 52,
    paddingHorizontal: 14,
    ...(t.shadows.card as object),
  },
  listButton: { minHeight: 52, paddingHorizontal: 18, paddingVertical: 0 },
  clearButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -12,
  },
  label: {
    marginBottom: 8,
    color: t.colors.text.secondary,
    fontFamily: t.typography.mono,
    fontSize: 10.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  stackedRow: { flexDirection: 'column', flexWrap: 'nowrap', gap: 12 },
  stackedBox: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: '100%' },
  stackedButton: { width: '100%', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 10, flexWrap: 'wrap' },
  box: {
    flex: 1,
    minWidth: 220,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 13,
    paddingVertical: 0,
    paddingHorizontal: 17,
  },
  input: {
    flex: 1,
    paddingVertical: 15,
    minWidth: 0,
    color: t.colors.text.primary,
    fontFamily: t.typography.body,
    fontSize: 16.5,
  },
  // The section's own primary button: dark ink with white text, as the payments
  // view's already is. The brand green is a fill colour that does not clear the
  // 4.5:1 text threshold on a light surface, so it is not used behind a label.
  button: {
    justifyContent: 'center',
    backgroundColor: t.colors.text.primary,
    borderRadius: 13,
    paddingVertical: 15,
    paddingHorizontal: 22,
  },
  buttonHover: { opacity: 0.9 },
  buttonLabel: {
    color: t.colors.surfaces.base,
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.bold,
  },
});
