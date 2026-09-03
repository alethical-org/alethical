import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { linkProps } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';

/**
 * The one shape every long list in the money section draws its rows in
 * ("Money lists.dc.html", RULES FOR THIS SCREEN; issue #1946).
 *
 * Two bands, one switch at 768, and the rows change shape across it:
 *
 * - **Computer (768 and up):** each row is its own card, as the COMPUTER column
 *   draws it — white, hairline border, 12px corners, a soft shadow.
 * - **Phone (below 768):** hairline rows inside ONE card, never a card per row. A
 *   card separates one record from another; a list is one record showing its
 *   contents. Every row is at least 60px tall including its padding, and that is
 *   a floor: a wrapping name makes a row taller and its neighbours do not match it
 *   (phone band rule D4).
 *
 * The register, the name search, a committee's all-payments view and the
 * payments-under-a-name page all draw through this, so the 4 lists cannot drift
 * into 4 row shapes. What goes INSIDE a row is each screen's own business: a
 * row's secondary fields stack under its name in the computer's order and no
 * field is dropped at phone width (rule D3).
 */

export function MoneyListRows({ isMobile, children }: { isMobile: boolean; children: ReactNode }) {
  return <View style={isMobile ? styles.listMobile : styles.list}>{children}</View>;
}

export function MoneyListRow({
  isMobile,
  first,
  link,
  children,
}: {
  isMobile: boolean;
  /** The first row in its list draws no hairline above it on the phone. */
  first: boolean;
  /** Present when the row opens something. A row that opens nothing is a plain
   *  View, so a screen reader never announces a link that goes nowhere. */
  link?: { href: string; onPress: () => void } | null;
  children: ReactNode;
}) {
  const style = isMobile ? [styles.rowMobile, !first && styles.rowMobileDivided] : styles.rowCard;
  if (link) {
    return (
      <Pressable {...linkProps(link.href, link.onPress)} style={style}>
        {children}
      </Pressable>
    );
  }
  return <View style={style}>{children}</View>;
}

/** The arrow the COMPUTER column draws at the right of a row that opens a page.
 *  An SVG path, never the → character: the body face has no glyph for it. */
export function RowArrow() {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" aria-hidden style={styles.arrow}>
      <Path
        d="M5 12 H19 M14 7 L19 12 L14 17"
        stroke={t.colors.text.muted}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 14, gap: 9 },
  // One card for the whole list. 16px inside the card plus the page's own gutter
  // is what a phone reader measures between the text and the screen edge.
  listMobile: {
    marginTop: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 18,
    ...(t.shadows.card as object),
  },
  rowMobile: { paddingVertical: 14, minHeight: 60, justifyContent: 'center' },
  rowMobileDivided: { borderTopWidth: 1, borderTopColor: t.colors.alpha.ink08 },
  arrow: { flexShrink: 0 },
});
