import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { theme as t, prefersReducedMotion } from '../../theme/tokens';
import { citationChipLabel, citationExcerpt } from '../../lib/billDetail';
import { useFieldFocus } from '../../theme/fieldFocus';
import { useHover } from './interactions';
import { useResponsive } from '../../hooks/useResponsive';

const isWeb = Platform.OS === 'web';

// Citation-card hover/focus easing. Web-only, and dropped under reduced motion
// (#193) so the lift lands instantly rather than animating.
const CARD_TRANSITION = isWeb
  ? ({
      transitionProperty: 'background-color, border-color, box-shadow',
      transitionDuration: '0.15s',
      transitionTimingFunction: 'ease',
    } as object)
  : null;

// "From the bill" citation card — the quiet grey card carrying a purple section
// chip and the quoted passage. Shared by Bill Detail's Summary tab and the Ask
// answer page's rail, so the two cannot drift apart
// (docs/product-onboarding/grounded-ask-spec.md §9.5, The chip-reached answer page
// — decided web design, decision 4).
//
// Two ways to make it clickable, and at most one applies:
//  - `onPress` alone: a button that jumps within the page it is already on (the
//    Summary tab switching to Bill Text).
//  - `linkProps`: the spread of `navigation/links.ts` linkProps / a plain href, so
//    the whole card is a real anchor with its own URL. The answer page uses this,
//    because the passage it opens lives on another page.
// With neither, the card is a static quote (a section the anchor could not be
// resolved for keeps its quote and its chip, it just does not lift or link).
//
// The chip reads "Sec. 4 · License classes →" — one format on every surface
// (citationChipLabel). The trailing arrow is the U+2192 text glyph in the chip's
// own JetBrains Mono at its font size, weight 400, aria-hidden so the label is
// announced alone: a fixed-size SVG icon renders as a stub sitting high near the
// cap line instead of optically centred on the label.
export function CitationCard({
  label,
  sectionTopic,
  excerpts,
  onPress,
  linkProps,
  accessibilityLabel,
  variant = 'default',
}: {
  label: string;
  sectionTopic?: string;
  /** Every passage quoted from this section, set in italic grey type. The
   *  Summary tab passes one; the Ask answer page passes all of the section's, because
   *  a section that contributed three passages contributed three different facts
   *  (grounded-ask-spec §9.5 decision 1). */
  excerpts: string[];
  onPress?: () => void;
  linkProps?: object;
  accessibilityLabel?: string;
  /** Answer groups several passages under one source chip. Its wider
   *  quote-to-quote spacing is deliberately not used by Bill Detail. */
  variant?: 'default' | 'answer';
}) {
  const { isMobile } = useResponsive();
  const [hovered, hover] = useHover();
  const { focused, focusProps } = useFieldFocus();
  const pressable = !!onPress || !!linkProps;
  const chipLabel = citationChipLabel(label, sectionTopic);
  const lifted = pressable && (hovered || focused);
  return (
    <Pressable
      accessibilityLabel={
        pressable ? (accessibilityLabel ?? `Jump to ${chipLabel} in Bill Text`) : undefined
      }
      disabled={!pressable}
      {...(pressable ? hover : {})}
      {...(pressable ? focusProps : {})}
      // Either the link props or the button props — never both, or the link's own
      // handler gets overwritten by the button branch's `undefined`.
      {...(linkProps ?? { accessibilityRole: pressable ? 'button' : undefined, onPress })}
      style={[
        styles.card,
        pressable && !prefersReducedMotion() ? CARD_TRANSITION : null,
        lifted && styles.cardLift,
      ]}
    >
      <View style={styles.chipRow}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>
            {chipLabel}
            <Text aria-hidden style={styles.chipArrow}>
              {' →'}
            </Text>
          </Text>
        </View>
      </View>
      {excerpts.map((excerpt, i) => (
        <Text
          key={i}
          style={[
            styles.quote,
            isMobile && styles.quoteMobile,
            variant === 'answer' ? null : styles.defaultQuote,
            variant === 'answer' &&
              (i === 0 ? styles.firstAnswerQuote : styles.followingAnswerQuote),
          ]}
        >
          {citationExcerpt(excerpt)}
        </Text>
      ))}
    </Pressable>
  );
}

// A suggested-question chip. `linkProps` makes it a real anchor (the answer page's
// "Ask another question", where each chip has its own /ask URL); `onPress` alone
// makes it a button (Bill Detail's Ask card, which submits in place).
//
// The chip sizes to its own label: inline-flex, max-width 100%, wrapping text.
// Chip labels are generated from the bill's stored prompts and run long ("What
// does the bill say about water infrastructure and drinking water grants?"), so
// they must wrap and grow rather than overflow the pill.
export function SuggestedQuestionChip({
  label,
  onPress,
  linkProps,
}: {
  label: string;
  onPress?: () => void;
  linkProps?: object;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      {...hover}
      {...(linkProps ?? { accessibilityRole: 'button' as const, onPress })}
      style={[styles.askChip, hovered && styles.askChipHover]}
    >
      <Text style={[styles.askChipText, hovered && styles.askChipTextHover]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f7f9f8',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  // Hover AND keyboard focus: the surface LIFTS off the page's grey (#f7f9f8 →
  // white) and the colour is carried by the border + one tight ring. It must not
  // tint, because the purple tint it used to take is the same fill the section
  // chip inside the card uses — so the chip dissolved into the card at the exact
  // moment you were about to click through it, leaving only its 1px border.
  //
  // The rule this sets, anywhere a filled chip or badge sits inside a card
  // (citation cards, bill cards with the amber code badge, result rows with facet
  // chips): the container's hover moves along the NEUTRAL axis, never into the
  // chip's own colour family. Ring matches askChipHover below.
  cardLift: {
    backgroundColor: t.colors.white,
    borderColor: t.colors.purple.base,
    ...(isWeb
      ? { boxShadow: '0 0 0 3px rgba(91,48,214,0.14)' }
      : (t.shadows.focusPurple as object)),
  },
  chipRow: { flexDirection: 'row', maxWidth: '100%' },
  chip: {
    // Same reason as the mobile chip: the topic can make the label longer than a
    // narrow card, so let it stop at the card and wrap rather than run past it.
    maxWidth: '100%',
    flexShrink: 1,
    backgroundColor: t.colors.purple.tint,
    borderWidth: 1,
    borderColor: t.colors.purple.border,
    borderRadius: t.radii.badge,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  chipText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.3,
    color: t.colors.purple.base,
  },
  // Decorative "→": the chip's own font and size, weight 400 so it reads lighter
  // than the 700 label.
  //
  // Nudged up 2.6px (0.2 × the 13px font size) because the glyph is not actually
  // JetBrains Mono's. Measured: in JetBrains Mono every glyph shares one advance
  // (digit 48.0, letter 48.0 at 80px) but "→" comes out 48.16 — the font has no
  // U+2192, so the browser substitutes it from a fallback. That fallback centres
  // the arrow on the maths axis (0.175em above the baseline) while digits and
  // capitals centre at 0.375em, leaving it 0.2em low against its own label.
  // `position: relative` + `top`, not `transform`: CSS ignores transforms on
  // inline boxes, and splitting the arrow out of the text flow would break
  // wrapping. Same root cause as the missing arrow in Libre Franklin.
  chipArrow: {
    fontWeight: t.fontWeights.regular,
    position: 'relative',
    top: -2.6,
  },
  quote: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.secondary,
    fontStyle: 'italic',
  },
  quoteMobile: { fontSize: 16, lineHeight: 24 },
  defaultQuote: { marginTop: 9 },
  firstAnswerQuote: { marginTop: 8 },
  followingAnswerQuote: { marginTop: 15 },
  askChip: {
    ...(isWeb ? ({ display: 'inline-flex', overflowWrap: 'anywhere' } as object) : null),
    maxWidth: '100%',
    flexShrink: 1,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink12,
    borderRadius: t.radii.pill,
  },
  askChipHover: {
    borderColor: t.colors.purple.base,
    ...(isWeb
      ? { boxShadow: '0 0 0 3px rgba(91,48,214,0.14)' }
      : (t.shadows.focusPurple as object)),
  },
  askChipText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.medium,
    color: t.colors.text.secondary,
  },
  askChipTextHover: { color: t.colors.purple.base },
});
