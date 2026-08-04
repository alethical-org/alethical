import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { theme as t } from '../../theme/tokens';
import { linkProps, routePath } from '../../navigation/links';
import { useResponsive } from '../../hooks/useResponsive';
import { BillTrackButton } from './BillTrackButton';
import { SharePopover } from './SharePopover';
import { isWeb, useHover } from './interactions';

export type DetailTab = 'summary' | 'actions' | 'votes' | 'text' | 'versions';

// "Bill Text" (not "Full Text"): it names what the tab IS and matches the
// document-link vocabulary the product already uses ("Read the bill text" for a
// draft, "Read the full law" for an enacted Session Law). "Full Text" described
// length and collided with Versions, which also holds texts.
//
// It sits 4th, ahead of Versions: the summary's citation cards send traffic
// straight here, so it outranks Versions — which stays last as the deliberately
// lowest-priority tab.
const TABS: Array<{ key: DetailTab; label: string }> = [
  { key: 'summary', label: 'Summary' },
  { key: 'actions', label: 'Actions' },
  { key: 'votes', label: 'Votes' },
  { key: 'text', label: 'Bill Text' },
  { key: 'versions', label: 'Versions' },
];

// Bill header — stable across tabs (spec §Header — title-first). H1 title (hero) +
// one eyebrow line (session + optional OMNIBUS), then the tab bar with a Share
// button at its right end opening an anchored popover.
export function BillHeader({
  title,
  fullTitle,
  eyebrow,
  omnibus,
  hotIssue = false,
  shareUrl,
  shareTitle,
  tracked,
  onTrack,
  activeTab,
  onSelectTab,
  onAllBills,
}: {
  title: string;
  // Full official statutory title ("A bill for an act relating to…"). The H1 shows
  // the concise plain-language `title`; the statutory text stays one hover away.
  fullTitle: string;
  eyebrow: string;
  omnibus: boolean;
  // Editorial "🔥 Hot issue" flag (../../lib/hotIssues). Renders a neutral pill in
  // the qualifier-tag row after the session year / OMNIBUS tag.
  hotIssue?: boolean;
  shareUrl: string;
  shareTitle: string;
  // Track button (ink) sits immediately left of Share. `tracked` toggles its
  // label/icon; `onTrack` routes a signed-out user to sign-in or toggles the
  // signed-in user's watchlist.
  tracked: boolean;
  onTrack: () => void;
  activeTab: DetailTab;
  onSelectTab: (tab: DetailTab) => void;
  onAllBills: () => void;
}) {
  const { isMobile } = useResponsive();
  // Keep the authoritative statutory title reachable as a hover tooltip on web.
  // RN-Web doesn't forward the DOM `title` attribute, so set it on the host node.
  const headingRef = useRef<any>(null);
  useEffect(() => {
    const node = headingRef.current;
    if (isWeb && node && typeof node.setAttribute === 'function') {
      node.setAttribute('title', fullTitle);
    }
  }, [fullTitle]);
  return (
    <View>
      <Breadcrumb onPress={onAllBills} isMobile={isMobile} />
      <Text
        ref={headingRef}
        accessibilityRole="header"
        accessibilityLabel={fullTitle}
        style={[styles.h1, isMobile && styles.h1Mobile]}
      >
        {title}
      </Text>
      <View style={styles.eyebrowRow}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        {omnibus ? <OmnibusTag /> : null}
        {hotIssue ? <HotIssuePill /> : null}
      </View>

      <View style={[styles.tabBar, isMobile && styles.tabBarMobile]}>
        <View style={[styles.tabList, isMobile && styles.tabListMobile]}>
          {TABS.map((tab) => (
            <TabButton
              key={tab.key}
              label={tab.label}
              active={tab.key === activeTab}
              onPress={() => onSelectTab(tab.key)}
            />
          ))}
        </View>
        <View style={styles.headerActions}>
          <View style={styles.trackSlot}>
            <BillTrackButton tracked={tracked} onPress={onTrack} size="web" />
          </View>
          <SharePopover url={shareUrl} title={shareTitle} subject="bill" />
        </View>
      </View>
    </View>
  );
}

// "‹ All bills" back-link — first element in the header, above the title. Whole
// link darkens from grey to ink on hover. Links back to the Search Bills screen.
function Breadcrumb({ onPress, isMobile }: { onPress: () => void; isMobile: boolean }) {
  const [hovered, hover] = useHover();
  const color = hovered ? t.colors.ink : BREADCRUMB_GREY;
  return (
    <Pressable
      accessibilityLabel="All bills"
      {...linkProps(routePath.bills(), onPress)}
      {...hover}
      style={styles.breadcrumb}
    >
      <Svg width={isMobile ? 17 : 18} height={isMobile ? 17 : 18} viewBox="0 0 24 24" fill="none">
        <Path
          d="M15 6 L9 12 L15 18"
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <Text style={[styles.breadcrumbLabel, isMobile && styles.breadcrumbLabelMobile, { color }]}>
        All bills
      </Text>
    </Pressable>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={`${label} tab`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      {...hover}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text
        style={[
          styles.tabLabel,
          active ? styles.tabLabelActive : hovered ? styles.tabLabelHover : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function OmnibusTag() {
  return (
    <View style={styles.omnibus} accessibilityRole="text" accessibilityLabel="Omnibus bill">
      <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
        <Path
          d="M12 4 v16 M6 8 h12 M7 8 l-3 6 h6 Z M17 8 l-3 6 h6 Z"
          stroke={t.colors.omnibus.text}
          strokeWidth={1.9}
          strokeLinejoin="round"
        />
      </Svg>
      <Text style={styles.omnibusText}>OMNIBUS</Text>
    </View>
  );
}
// Editorial "🔥 Hot issue" flag — a NEUTRAL pill, identical to the home feed and
// search cards (never amber; amber is reserved for bill-code identity). The 🔥
// carries the signal; the pill stays quiet grey.
function HotIssuePill() {
  return (
    <View style={styles.hotPill} accessibilityRole="text" accessibilityLabel="Hot issue">
      <Text style={styles.hotPillText}>🔥 Hot issue</Text>
    </View>
  );
}

// Breadcrumb grey (palette.ink500) — no semantic text alias maps to it, so it's a
// local const like the other bespoke header colors.
const BREADCRUMB_GREY = '#4b524b';

const styles = StyleSheet.create({
  // ~8px added on top of SearchPageShell's 36px hero paddingTop → ~44px from the
  // nav to the breadcrumb, and ~20px down to the title.
  breadcrumb: {
    marginTop: 8,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  breadcrumbLabel: {
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.semibold,
  },
  breadcrumbLabelMobile: { fontSize: 15 },
  h1: {
    fontFamily: t.typography.title,
    fontSize: 42,
    lineHeight: 45,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.9,
    color: t.colors.text.primary,
  },
  // Narrow widths: scale the hero title down so a long statutory title doesn't
  // swamp a phone viewport (the desktop 42px wraps to ~13 lines at 375px).
  h1Mobile: { fontSize: 28, lineHeight: 32, letterSpacing: -0.4 },
  eyebrowRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  eyebrow: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.medium,
    letterSpacing: 0.7,
    color: t.colors.text.muted,
  },
  omnibus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: t.colors.omnibus.ghostBorder,
    borderRadius: t.radii.sm,
  },
  omnibusText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
    color: t.colors.omnibus.text,
  },
  hotPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaces.s400, // #f1f1f4 — neutral grey, never amber
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.pill,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  hotPillText: {
    fontFamily: t.typography.ui,
    fontSize: 13,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.26,
    color: t.colors.text.secondary, // #4f5651
    ...(isWeb ? ({ whiteSpace: 'nowrap' } as object) : null),
  },
  tabBar: {
    marginTop: 30,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 24,
    flexWrap: 'wrap',
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink10,
  },
  // Narrow: let Share wrap below the tabs and tighten the tab spacing so all four
  // tabs stay reachable within the phone-width column (no clipped 4th tab).
  tabBarMobile: { marginTop: 22, rowGap: 4 },
  // Track + Share grouped at the right end of the tab row. flex-end so both sit
  // on the tab bar's baseline; the trackSlot's marginBottom mirrors SharePopover's
  // own (shareWrap marginBottom 10) so the two buttons align.
  headerActions: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  trackSlot: { marginBottom: 10 },
  tabList: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 34,
    flexWrap: 'wrap',
  },
  tabListMobile: { gap: 22, flex: 1, minWidth: 240 },
  tab: {
    paddingHorizontal: 2,
    paddingBottom: 14,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: t.colors.brand.base,
  },
  tabLabel: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  tabLabelActive: {
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },
  tabLabelHover: {
    color: t.colors.text.primary,
  },
});
