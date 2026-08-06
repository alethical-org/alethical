import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useHover } from './billDetail/interactions';
import { changeEyebrow } from '../lib/trackedBillsChanges';
import type { BillChanges } from '../lib/billDetail';
import { pressInsideLink } from '../navigation/links';
import { theme as t } from '../theme/tokens';

// "What moved since you last looked" — a soft green panel INSIDE a card, not a
// badge on it: a dated report, not an alert (#1009). The mono eyebrow carries the
// date of the change itself.
//
// Its own component because TWO surfaces show it — the tracked-bills page's cards
// and the signed-in homepage's Session watch card (#1034) — and both specs ask for
// "the identical treatment". Sharing the component makes that structural instead of
// a convention someone has to remember, the same reasoning that made the Ask answer
// page reuse `BillResultCard` rather than re-implement it.
//
// A change the record states no date for names the absence rather than going
// quiet: "MOVED · DATE NOT RECORDED", the qualifier in a lighter tone. The
// Legislature genuinely files undated entries ("Laid on table", conference-
// committee steps), and the sentence still names what happened — we neither invent
// a date nor hide a real change (grounded-answers rule 1). Naming it says the
// silence is the record's, not ours; a bare "MOVED" read as our omission. The
// eyebrow stays first and stays green in both cases, because dated and undated
// blocks sit in the same list and one composition is what makes them read as the
// same thing.
//
// The earlier-steps link exists so one sentence never implies it was the only
// thing that happened. It states a COUNT and nothing else: the window is already
// named once in the summary line above each list, so repeating it per row is
// redundant — and "since your last visit" was retired as inaccurate, because only
// opening the tracked list advances the mark, so a homepage reader's window is not
// "since your last visit" at all (#1069, reversing #1009's longer label). A
// plain Pressable rather than an anchor — the card around it is a real <a>, and an
// <a> inside an <a> is invalid markup that reads as one confused control to a
// screen reader (the same reason the author name and roll-calls chip are plain).
export function ChangeBlock({
  change,
  onHistory,
  /** Tighter padding and type for the homepage card, which is narrower than a
   *  full-width bill card and shows two of these inside a hero. */
  compact = false,
}: {
  change: BillChanges;
  onHistory?: () => void;
  compact?: boolean;
}) {
  const [hovered, hover] = useHover();
  const earlier = change.earlierCount;
  // Both branches of the wording live in changeEyebrow (lib/trackedBillsChanges),
  // where a test pins them; this only decides how the two parts are toned.
  const eyebrow = changeEyebrow(change.date);
  return (
    <View style={[styles.change, compact && styles.changeCompact]}>
      {/* One Text, so the two tones stay on one line and wrap as one phrase. */}
      <Text style={styles.changeEyebrow}>
        {eyebrow.moved}
        {eyebrow.qualifier ? (
          <Text style={styles.changeEyebrowQualifier}>{eyebrow.qualifier}</Text>
        ) : null}
      </Text>
      <Text style={[styles.changeText, compact && styles.changeTextCompact]}>{change.label}</Text>
      {earlier > 0 && onHistory ? (
        <Pressable
          accessibilityRole="link"
          onPress={pressInsideLink(onHistory)}
          {...hover}
          style={styles.changeMore}
        >
          <Text style={[styles.changeMoreText, hovered && styles.changeMoreTextHover]}>
            {earlier === 1 ? '1 earlier step' : `${earlier} earlier steps`}{' '}
            <Text style={styles.changeMoreArrow} aria-hidden>
              →
            </Text>
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  change: {
    maxWidth: 1040,
    backgroundColor: t.colors.tint.t50,
    borderWidth: 1,
    borderColor: t.colors.tint.t300,
    borderRadius: t.radii.md,
    paddingVertical: 13,
    paddingHorizontal: 15,
    gap: 7,
  },
  changeCompact: { paddingVertical: 11, paddingHorizontal: 13, gap: 6 },
  changeEyebrow: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.32,
    // brand.forest (#0f7a45), not the mockup's #149d5b: at 11px this is small text,
    // and #149d5b sits at 3.27:1 on the panel — short of WCAG AA's 4.5:1. Forest
    // measures 5.05:1. Same call, same reason, as the omnibus token's own note
    // (theme/tokens.ts) — accessibility overrides the spec.
    //
    // This travels with the component ON PURPOSE. #6f756f is the right value on white;
    // #149d5b is reserved for graphics and large display text. Inside this pale green
    // panel, both this green and the old muted gray fail AA. Reusing the block in a new container must not mean
    // re-picking these from the on-white palette.
    color: t.colors.brand.forest,
  },
  // The "· DATE NOT RECORDED" half, quieter than the green so it reads as a
  // qualifier and not a second heading. text.muted (#656c66) rather than the
  // mock's #6f756f: at 11px that measures 4.41:1 on the panel, just under WCAG
  // AA's 4.5:1, and #656c66 measures 5.05:1 — the same figure as the green beside
  // it, so neither half dominates the other.
  changeEyebrowQualifier: { color: t.colors.text.muted },
  changeText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 24,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  changeTextCompact: { fontSize: t.fontSizes.body, lineHeight: 22 },
  changeMore: { alignSelf: 'flex-start' },
  changeMoreText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.brand.forest, // 5.05:1 on the panel; see changeEyebrow
  },
  changeMoreTextHover: { color: t.colors.text.primary },
  changeMoreArrow: { fontWeight: t.fontWeights.regular },
});
