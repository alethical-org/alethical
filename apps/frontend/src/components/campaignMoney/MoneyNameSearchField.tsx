import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { theme as t } from '../../theme/tokens';

/**
 * The campaign money section's one name field, shared by the /money landing, the
 * committees list and the search results page ("Campaign money IA.dc.html" §02:
 * "one field that takes a person or an organisation").
 *
 * One component rather than 3 so the field cannot look or behave differently on
 * the page that offers it and the page that answers it. It holds only its own
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
  /** The landing needs the button; the results page commits as you type and does
   *  not. */
  showSubmitButton = false,
  maxWidth = 760,
}: {
  value: string;
  onChangeText: (next: string) => void;
  onSubmit: () => void;
  placeholder: string;
  label?: string;
  submitLabel?: string;
  showSubmitButton?: boolean;
  maxWidth?: number;
}) {
  const { focused, focusProps } = useFieldFocus();
  const [hovered, setHovered] = useState(false);

  return (
    <View style={[styles.wrap, { maxWidth }]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.row}>
        <View style={[styles.box, ...fieldFocusRing(focused)]}>
          <MagnifierGlyph color={t.colors.text.faint} />
          <TextInput
            // The placeholder is the field's accessible name where no visible
            // label sits above it, matching the bill and legislator search boxes.
            value={value}
            onChangeText={onChangeText}
            onFocus={focusProps.onFocus}
            onBlur={focusProps.onBlur}
            onSubmitEditing={onSubmit}
            returnKeyType="search"
            placeholder={placeholder}
            accessibilityLabel={label ?? placeholder}
            placeholderTextColor={t.colors.text.faint}
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            style={[styles.input, fieldOutlineReset]}
          />
        </View>
        {showSubmitButton ? (
          <Pressable
            onPress={onSubmit}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            accessibilityRole="button"
            style={[styles.button, hovered && styles.buttonHover]}
          >
            <Text style={styles.buttonLabel}>{submitLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  label: {
    marginBottom: 8,
    color: t.colors.text.secondary,
    fontFamily: t.typography.mono,
    fontSize: 10.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
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
    paddingVertical: 15,
    paddingHorizontal: 17,
  },
  input: {
    flex: 1,
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
