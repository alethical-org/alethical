import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { useResponsive } from '../../hooks/useResponsive';
import { theme as t } from '../../theme/tokens';

/**
 * The standing under-development notice on the campaign money surfaces that are
 * live while the section is still being built ("Under-development notice on the
 * campaign money pages" handoff, 19 Aug 2026).
 *
 * **Deleting this file plus its call sites is the entire removal.** There is
 * deliberately no dismiss control, no flag, no stored preference and no date
 * expiry: shipping the unfinished work is the only thing that takes it down, so
 * nothing has to be remembered later. Its colours are local hexes rather than
 * design tokens for the same reason — the strip is temporary, and a token that
 * outlives its only reader is a worse leftover than a hex in a file that gets
 * deleted whole.
 *
 * Where it does NOT go: a published research report. A report is a signed, dated
 * snapshot whose masthead already states its publication date, the date its
 * records run through and every filing body it used, and newer filings there
 * earn their own dated notice (`.claude/rules/grounded-answers.md` rule 13). A
 * standing "the figures may change" strip above that would both duplicate and
 * weaken the promise the report already makes more precisely.
 */

/** Pale danger surface, its hairline, and text that clears 7.3:1 on it. */
const SURFACE = '#fdecec';
const HAIRLINE = '#f4c9c6';
const TEXT = '#8f2a20';
const ICON = '#c0392b';

/**
 * The wording names what a reader might expect and will not find — lobbying
 * records are not loaded (#1862) — rather than casting doubt on the figures.
 * Every figure sits under an account a person confirmed and carries its own
 * period and freshness date, so "the figures shown may change" is not the honest
 * sentence and would contradict the page below it (#1863). Challengers are on the
 * money-by-race page and outside spending has its own record page, so neither is
 * named here any more; a gap this strip names must be one the section still has.
 */
const LEAD = 'Under development.';
const SENTENCE = 'This section does not yet cover lobbying.';

function WarningGlyph({ size, nudgeTop }: { size: number; nudgeTop: boolean }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      // Phone only: the icon holds the first line of wrapped text, and 1px down
      // sits it on that line's optical centre rather than its box top.
      style={nudgeTop ? styles.glyphNudged : undefined}
    >
      <Circle cx={12} cy={12} r={9} stroke={ICON} strokeWidth={2} />
      <Path d="M12 7.5 V13" stroke={ICON} strokeWidth={2} strokeLinecap="round" />
      <Circle cx={12} cy={16.4} r={1.2} fill={ICON} />
    </Svg>
  );
}

/**
 * `variant` picks the shape, not the message:
 *
 * - `'band'` spans the whole window directly under the site nav, in normal flow.
 *   It is not sticky and not fixed, so it scrolls away with the top of the page.
 *   Its side padding matches the nav's own inset (56px, 24px on phone) so the
 *   icon lines up under the wordmark.
 * - `'inset'` sits inside a content column, where a full-bleed band is not
 *   available: the campaign money tab opens well below the nav, under the
 *   profile header and the tab row. Same colours and type, boxed on all four
 *   sides with the same corner radius as the cards it sits above, because a band
 *   with cut vertical edges reads as clipped rather than deliberate.
 */
export function UnderDevelopmentNotice({ variant = 'band' }: { variant?: 'band' | 'inset' }) {
  const { isMobile } = useResponsive();
  const inset = variant === 'inset';

  return (
    <View
      role="status"
      style={[
        styles.row,
        isMobile ? styles.rowMobile : styles.rowWide,
        inset && (isMobile ? styles.insetMobile : styles.inset),
      ]}
    >
      <WarningGlyph size={isMobile ? 18 : 20} nudgeTop={isMobile} />
      <Text style={[styles.text, isMobile && styles.textMobile]}>
        <Text style={styles.lead}>{LEAD}</Text> {SENTENCE}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    flexDirection: 'row',
    backgroundColor: SURFACE,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: HAIRLINE,
  },
  // Tablet and desktop: the icon holds the middle of a single line.
  rowWide: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 56,
  },
  // Phone: the icon holds the first line while the text wraps beneath it.
  rowMobile: {
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  inset: { paddingHorizontal: 18, borderWidth: 1, borderRadius: t.radii.lg },
  insetMobile: { paddingHorizontal: 14, borderWidth: 1, borderRadius: t.radii.lg },
  text: {
    flex: 1,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: TEXT,
    fontWeight: t.fontWeights.regular,
  },
  textMobile: { fontSize: 14.5, lineHeight: 21 },
  lead: { fontWeight: t.fontWeights.heavy },
  glyphNudged: { marginTop: 1 },
});
