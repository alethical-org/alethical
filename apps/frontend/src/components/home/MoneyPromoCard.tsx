/**
 * The homepage's campaign-money promo (20 Aug 2026 design handoff).
 *
 * One card, 4 sizes. The sizes are not a responsive scale of each other: a
 * signed-in reader's card sits inside the hero next to the smaller signed-in
 * search buttons, while a signed-out reader's sits in its own pale-green band
 * next to the larger ones, so the card matches its neighbours rather than
 * matching its own other copies. That difference is deliberate and is written
 * into the handoff ("do not fix it to match the signed-out card").
 *
 * Two sentences here are load-bearing and neither may be softened:
 *
 * - The body line says figures are *read from* the filings, never that each
 *   entry is *tied to* the filing it came from. The published rows carry no
 *   report reference to join on, matching by date names a different set of
 *   people than any single report does, and the Board's report documents are
 *   fetched by form submission rather than by address. The earlier wording
 *   promised a link that cannot be built.
 * - The count says which register it counts. 1,603 is campaign filers only —
 *   778 candidate committees, 299 party units, 526 political committees and
 *   funds. Lobbying has its own register and is not in the number, so a bare
 *   "1,603 campaigns, parties, and funds" under a sentence promising campaign
 *   *and lobbying* records reads as the size of both.
 *
 * The count binds to a live query or does not appear at all: never a zero,
 * never a dash, never a remembered number (`.claude/rules/grounded-answers.md`
 * rule 12, and the same rule the /money landing's lane counts follow).
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { isWeb, useHover } from '../billDetail/interactions';
import {
  MONEY_PROMO_BODY,
  MONEY_PROMO_CAVEAT,
  MONEY_PROMO_COUNT_UNIT,
  MONEY_PROMO_CTA,
  MONEY_PROMO_EYEBROW,
  MONEY_PROMO_HEADING,
} from '../../lib/homepage';
import { formatCount } from '../../lib/moneyLanding';
import { linkProps, routePath } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';

/** Which of the 4 drawn sizes to render. Desktop is identical signed in or out;
 *  the narrow sizes are not. */
export type MoneyPromoVariant = 'desktop' | 'phoneSignedOut' | 'phoneSignedIn' | 'tabletSignedIn';

/** Per-variant type and spacing, measured from the handoff's 4 frames. */
const SIZES: Record<
  MoneyPromoVariant,
  {
    eyebrow: number;
    heading: number;
    body: number;
    count: number;
    caveat: number;
    button: number;
    headingTop: number;
    bodyTop: number;
    countTop: number;
    caveatTop: number;
    buttonTop: number;
    buttonMinHeight: number;
    buttonPaddingV: number;
    buttonPaddingH: number;
    buttonRadius: number;
    buttonFullWidth: boolean;
    padV: number;
    padH: number;
  }
> = {
  desktop: {
    eyebrow: 14,
    heading: 48,
    body: 21,
    count: 17,
    caveat: 16,
    button: 18,
    headingTop: 30,
    bodyTop: 28,
    countTop: 20,
    caveatTop: 20,
    buttonTop: 44,
    buttonMinHeight: 44,
    buttonPaddingV: 18,
    buttonPaddingH: 32,
    buttonRadius: 12,
    buttonFullWidth: false,
    padV: 46,
    padH: 44,
  },
  phoneSignedOut: {
    eyebrow: 15,
    heading: 34,
    body: 21,
    count: 17,
    caveat: 17,
    // 17px, not the drawn 19px, and the 2px is a fit correction rather than a
    // taste one. On a real 375px phone the pale-green band's 20px padding leaves
    // a 335px card; its own 24px padding leaves 287px; the button's 20px padding
    // and the arrow leave 247px for the label, and "Search the money records" at
    // 19px measures 238px plus a 16px arrow and its gap — 263px. It wraps to 2
    // lines and stands the button up at 78px. The handoff tuned this size down
    // from 21px for the same reason without reaching a width that fits.
    button: 17,
    headingTop: 14,
    bodyTop: 14,
    countTop: 16,
    caveatTop: 16,
    buttonTop: 24,
    buttonMinHeight: 56,
    buttonPaddingV: 15,
    buttonPaddingH: 20,
    buttonRadius: 14,
    buttonFullWidth: true,
    padV: 26,
    padH: 24,
  },
  phoneSignedIn: {
    eyebrow: 11,
    heading: 26,
    body: 17,
    count: 15,
    caveat: 15,
    button: 16,
    headingTop: 12,
    bodyTop: 11,
    countTop: 13,
    caveatTop: 13,
    buttonTop: 20,
    buttonMinHeight: 48,
    buttonPaddingV: 13,
    buttonPaddingH: 18,
    buttonRadius: 13,
    buttonFullWidth: true,
    padV: 22,
    padH: 20,
  },
  tabletSignedIn: {
    eyebrow: 12,
    heading: 32,
    body: 18,
    count: 16,
    caveat: 16,
    button: 17,
    headingTop: 14,
    bodyTop: 13,
    countTop: 14,
    caveatTop: 14,
    buttonTop: 22,
    buttonMinHeight: 48,
    buttonPaddingV: 14,
    buttonPaddingH: 24,
    buttonRadius: 13,
    buttonFullWidth: false,
    padV: 26,
    padH: 26,
  },
};

function CtaArrow({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M4 12 H19 M14 7 L19 12 L14 17"
        stroke={t.colors.brand.darkest}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function MoneyPromoCard({
  variant,
  filerCount,
  countLoading,
  dimmed = false,
  onPress,
}: {
  variant: MoneyPromoVariant;
  /** null whenever the register did not answer. The line then does not render —
   *  never a zero and never a remembered number. */
  filerCount: number | null;
  countLoading: boolean;
  dimmed?: boolean;
  onPress: () => void;
}) {
  const s = SIZES[variant];
  const [hovered, hoverProps] = useHover();
  const narrow = variant !== 'desktop';
  const countLine = useMemo(
    () => (filerCount === null ? null : formatCount(filerCount)),
    [filerCount],
  );
  const blurOverlay: object = isWeb
    ? {
        backgroundColor: 'rgba(255,255,255,0.6)',
        backdropFilter: 'blur(5px) saturate(0.9)',
        WebkitBackdropFilter: 'blur(5px) saturate(0.9)',
      }
    : { backgroundColor: 'rgba(255,255,255,0.75)' };

  return (
    <View
      style={[
        styles.card,
        narrow ? styles.cardNarrow : styles.cardDesktop,
        { paddingVertical: s.padV, paddingHorizontal: s.padH },
        narrow ? undefined : (t.shadows.lg as object),
        narrow ? (t.shadows.card as object) : undefined,
      ]}
    >
      {dimmed ? <View pointerEvents="none" style={[styles.overlay, blurOverlay]} /> : null}

      <Text style={[styles.eyebrow, { fontSize: s.eyebrow }]}>{MONEY_PROMO_EYEBROW}</Text>

      <Text
        accessibilityRole="header"
        aria-level={2}
        style={[
          styles.heading,
          {
            fontSize: s.heading,
            lineHeight: Math.round(s.heading * 1.04),
            marginTop: s.headingTop,
          },
        ]}
      >
        {MONEY_PROMO_HEADING}
      </Text>

      <Text
        style={[
          styles.body,
          { fontSize: s.body, lineHeight: Math.round(s.body * 1.52), marginTop: s.bodyTop },
        ]}
      >
        {MONEY_PROMO_BODY}
      </Text>

      {/* The count, its skeleton, or nothing at all. Three outcomes, never two:
          a register that did not answer leaves no line rather than a zero. */}
      {countLine !== null ? (
        <Text
          style={[
            styles.count,
            { fontSize: s.count, lineHeight: Math.round(s.count * 1.5), marginTop: s.countTop },
          ]}
        >
          <Text style={styles.countNumber}>{countLine}</Text> {MONEY_PROMO_COUNT_UNIT}
        </Text>
      ) : countLoading ? (
        <View
          aria-busy
          accessibilityLabel="Loading how many filers the register holds"
          style={[
            styles.countSkeleton,
            { height: s.count, marginTop: s.countTop + 2, borderRadius: 6 },
          ]}
        />
      ) : null}

      <Text
        style={[
          styles.caveat,
          { fontSize: s.caveat, lineHeight: Math.round(s.caveat * 1.48), marginTop: s.caveatTop },
        ]}
      >
        {MONEY_PROMO_CAVEAT}
      </Text>

      <Pressable
        {...linkProps(routePath.money(), onPress)}
        {...hoverProps}
        style={[
          styles.cta,
          {
            marginTop: s.buttonTop,
            minHeight: s.buttonMinHeight,
            paddingVertical: s.buttonPaddingV,
            paddingHorizontal: s.buttonPaddingH,
            borderRadius: s.buttonRadius,
            alignSelf: s.buttonFullWidth ? 'stretch' : 'flex-start',
            justifyContent: s.buttonFullWidth ? 'center' : 'flex-start',
          },
          hovered && styles.ctaHover,
        ]}
      >
        <Text style={[styles.ctaLabel, { fontSize: s.button }]}>{MONEY_PROMO_CTA}</Text>
        <CtaArrow size={Math.round(s.button * 0.95)} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: t.colors.surfaces.base,
    borderRadius: 20,
    position: 'relative',
    width: '100%',
  },
  // 583px is the drawn width and it is a cap rather than a size: nothing on this
  // page is centred or width-capped, so without it the card fills its hero
  // column and reaches ~985px on a 2560px display, where its 46/44 padding and
  // 48px heading were never tuned.
  cardDesktop: { maxWidth: 583 },
  cardNarrow: { borderWidth: 1, borderColor: 'rgba(17,21,15,0.10)' },
  overlay: { ...(StyleSheet.absoluteFill as object), borderRadius: 20, zIndex: 5 },
  eyebrow: {
    fontFamily: t.typography.mono,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.9,
    color: t.colors.text.greenOnLight,
  },
  heading: {
    fontFamily: t.typography.title,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.6,
    color: t.colors.text.primary,
  },
  body: { fontFamily: t.typography.body, color: t.colors.text.secondary },
  count: { fontFamily: t.typography.body, color: t.colors.text.secondary },
  // Between the body's ink450 and the heading's ink800: the number is the
  // emphasis inside its own line, not a second heading. No token sits here.
  countNumber: { fontWeight: t.fontWeights.semibold, color: '#2c322c' },
  countSkeleton: { width: 328, maxWidth: '100%', backgroundColor: 'rgba(17,21,15,0.08)' },
  caveat: { fontFamily: t.typography.body, color: t.colors.text.faint },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: t.colors.brand.base,
    borderWidth: 1,
    borderColor: t.colors.brand.base,
  },
  ctaHover: {
    backgroundColor: t.colors.brand.hover,
    borderColor: t.colors.brand.hover,
  },
  ctaLabel: {
    fontFamily: t.typography.ui,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.darkest,
  },
});
