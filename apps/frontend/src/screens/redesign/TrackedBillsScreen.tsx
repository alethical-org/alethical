import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Circle, Path } from 'react-native-svg';

import { theme as t } from '../../theme/tokens';
import { IaItem, MenuKey } from '../../navigation/ia';
import { useAuth } from '../../providers/AuthProvider';
import { useSignInModal } from '../../providers/signInModalContext';
import { useResponsive } from '../../hooks/useResponsive';
import { useTrackedBills } from '../../hooks/useAppQueries';
import { useTrackedBillsLastVisit } from '../../hooks/useTrackedBillsLastVisit';
import { useBillTracking } from '../../hooks/useBillTracking';
import { SearchPageShell } from '../../components/search/searchPieces';
import { BillResultCard } from '../../components/search/BillResultCard';
import { Skeleton } from '../../components/Skeleton';
import { isWeb, useHover } from '../../components/billDetail/interactions';
import { isHotIssueBill } from '../../lib/hotIssues';
import { lastVisitFrom } from '../../lib/trackedBillsLastVisit';
import {
  groupTrackedBillsByChange,
  mostRecentChangeLabel,
  trackedBillsSummaryLine,
  type MovedBill,
} from '../../lib/trackedBillsChanges';

const SKELETON_ROWS = [0, 1, 2];

// Tracked page, rebuilt in the redesign (green chrome, top nav) so it matches the
// rest of the web app — the old sidebar-rail TrackedScreen was the last surface on
// the pre-redesign shell (#976, part 2). Same shell + BillResultCard as Search, so
// the now-live Track button toggles a bill straight off this list.
export function TrackedBillsScreen() {
  const navigation = useNavigation<any>();
  const { isSignedIn, user } = useAuth();
  const { openSignIn } = useSignInModal();
  const { isTracked, toggleTrack } = useBillTracking();
  const { isMobile } = useResponsive();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);

  const trackedQuery = useTrackedBills(user?.id);
  const bills = trackedQuery.data ?? [];
  // When this reader last opened the page. Held for the whole browser session, so
  // reloading does not erase what changed (hooks/useTrackedBillsLastVisit).
  const lastVisitQuery = useTrackedBillsLastVisit(user?.id);
  // Stable per mount, so the grouping memo is too.
  const now = useMemo(() => new Date(), []);
  // Built inside the memo: lastVisitFrom returns a fresh object each call, so
  // holding it in a variable outside would break the memo on every render.
  const lastVisitData = lastVisitQuery.data;
  const groups = useMemo(
    () => groupTrackedBillsByChange(bills, lastVisitFrom(lastVisitData), now),
    [bills, lastVisitData, now],
  );
  // `not-checked` means the last-visit lookup never returned — the query errored,
  // since the render below waits while it is loading. The list is still worth
  // showing, so it renders with no caption and no grouping: we cannot say what
  // moved, and saying "nothing moved" would be the false reassurance this whole
  // three-way type exists to prevent (#1026).
  const moved = groups.state === 'grouped' ? groups.moved : [];
  const unchanged = groups.state === 'grouped' ? groups.unchanged : bills;
  const summaryLine =
    trackedBillsSummaryLine({
      total: bills.length,
      movedCount: moved.length,
      lastVisit: lastVisitFrom(lastVisitData),
      mostRecentChange: mostRecentChangeLabel(bills),
    }) ?? null;

  const handleNavigate = (item: IaItem) => {
    switch (item.id) {
      case 'search-bills':
        navigation.navigate('Bills');
        return;
      case 'search-legislators':
        navigation.navigate('Legislators');
        return;
      case 'search-find-my-legislator':
        navigation.navigate('FindMyLegislator');
        return;
      case 'track-bills':
        navigation.navigate('Tracked');
        return;
      default:
        return;
    }
  };

  const hero = (
    <View>
      <Text accessibilityRole="header" style={[styles.h1, isMobile && styles.h1Mobile]}>
        Tracked bills
      </Text>
      {/* No "tap Track to add or remove" instruction any more: the ✓ Tracked button
          is now on every card on both surfaces, so the sentence labelled something
          already visible. The empty state still explains how to add a first bill.
          Nothing here promises a message — the product cannot send one (#36), and
          this page is the whole delivery mechanism. */}
      <Text style={styles.subhead}>
        The bills you’re following. Anything that moves in the official record shows up here.
      </Text>
    </View>
  );

  let body: React.ReactNode;
  if (!isSignedIn) {
    // Tracking needs an account — the value-prop card, with sign-in returning here.
    body = (
      <EmptyCard
        heading="Track the bills you care about"
        body="Sign in to build a watchlist that stays in sync across devices, so the bills you’re following and their current status stay in one place. You can browse and search everything without an account."
        ctaLabel="Sign in"
        onPress={() => openSignIn({ intent: 'nav', returnTo: '/tracked' })}
      />
    );
    // The comparison point is part of the page's answer, not a decoration, so the
    // list waits for it too. Rendering the bills first would show "first visit" or
    // an unlabeled list and then rearrange under the reader.
  } else if (trackedQuery.isLoading || lastVisitQuery.isLoading) {
    body = (
      <View style={styles.list} accessible accessibilityLabel="Loading tracked bills">
        {SKELETON_ROWS.map((i) => (
          <Skeleton key={i} width="100%" height={148} radius={t.radii.card} />
        ))}
      </View>
    );
  } else if (trackedQuery.error) {
    body = (
      <View style={styles.stateBox}>
        <Text style={styles.stateText}>
          We couldn’t load your tracked bills right now. Please try again in a moment.
        </Text>
      </View>
    );
  } else if (bills.length === 0) {
    body = (
      <EmptyCard
        heading="You’re not tracking any bills yet"
        body="Find a bill in search and tap Track. It shows up here, and anything that moves shows up with it."
        ctaLabel="Search bills"
        onPress={() => navigation.navigate('Bills')}
      />
    );
  } else {
    const card = (bill: (typeof bills)[number], change?: MovedChange) => (
      <BillResultCard
        key={bill.id}
        bill={bill}
        // Same editorial flag list the home feed, search and the bill profile read
        // (lib/hotIssues.ts), so a flagged bill looks the same on every surface.
        hotIssue={isHotIssueBill(bill.id)}
        change={change}
        onChangeHistory={() =>
          navigation.navigate('BillDetail', { billId: bill.id, tab: 'actions' })
        }
        tracked={isTracked(bill.id)}
        onToggleTrack={() => toggleTrack(bill.id)}
        onPress={() => navigation.navigate('BillDetail', { billId: bill.id })}
        onSponsorPress={(legislatorId) =>
          navigation.navigate('LegislatorProfile', { legislatorId })
        }
        onRollCalls={() => navigation.navigate('BillDetail', { billId: bill.id, tab: 'votes' })}
      />
    );

    body = (
      <>
        <View style={styles.summary}>
          <View style={styles.countRow}>
            <Text style={styles.count}>{bills.length}</Text>
            <Text style={styles.countNoun}>{bills.length === 1 ? 'bill' : 'bills'}</Text>
          </View>
          {/* No caption at all when we never learned when they last looked. A
              glyph and a sentence would both be claims we cannot ground. */}
          {summaryLine ? (
            <View style={styles.summaryRow}>
              {moved.length > 0 ? <TrendGlyph /> : <ClockGlyph />}
              <Text style={styles.summaryText}>{summaryLine}</Text>
            </View>
          ) : null}
        </View>

        {moved.length > 0 ? (
          <>
            {/* The moved group carries NO header. The caption above already says how
                many moved and since when, and each card states its own "MOVED
                <date>" — a third restatement would be noise. The one divider is the
                grey NO CHANGE below, which is what implies the group above it. */}
            <View style={styles.list}>{moved.map((entry) => card(entry.bill, entry.change))}</View>
            {unchanged.length > 0 ? (
              <>
                <View style={styles.divider}>
                  <Text style={styles.dividerLabel}>NO CHANGE</Text>
                  <View style={styles.dividerRule} />
                </View>
                <View style={styles.listAfterDivider}>{unchanged.map((bill) => card(bill))}</View>
              </>
            ) : null}
          </>
        ) : (
          // Nothing moved, or a first visit: one plain list, no headers, no
          // empty-state framing. This is the common case, not a failure.
          <View style={styles.list}>{unchanged.map((bill) => card(bill))}</View>
        )}
      </>
    );
  }

  return (
    <SearchPageShell
      openMenu={openMenu}
      onOpenMenuChange={setOpenMenu}
      onNavigate={handleNavigate}
      onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
      onPrivacy={() => navigation.navigate('Privacy')}
      onTerms={() => navigation.navigate('Terms')}
      hero={hero}
    >
      {body}
    </SearchPageShell>
  );
}

type MovedChange = MovedBill<unknown>['change'];

// Rising line: something moved. Green, matching the change blocks below it.
function TrendGlyph() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" style={styles.glyph}>
      <Path
        d="M5 16 L11 10 L14 13 L19 8"
        stroke={t.colors.brand.graphics}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M14.5 8 H19 V12.5"
        stroke={t.colors.brand.graphics}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// Clock: nothing moved, or nothing to compare against yet. Neutral grey, because a
// quiet list is the normal state and not a problem to flag.
function ClockGlyph() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" style={styles.glyph}>
      <Circle cx={12} cy={12} r={8.5} stroke={t.colors.text.muted} strokeWidth={1.9} />
      <Path
        d="M12 7.6 V12 L15 14"
        stroke={t.colors.text.muted}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// Dashed value-prop / empty card with a single green CTA, matching Search's
// NoResults treatment so the Tracked page's empty and signed-out states read as
// the same family.
function EmptyCard({
  heading,
  body,
  ctaLabel,
  onPress,
}: {
  heading: string;
  body: string;
  ctaLabel: string;
  onPress: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardHeading}>
        {heading}
      </Text>
      <Text style={styles.cardBody}>{body}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
        onPress={onPress}
        {...hover}
        style={[styles.cta, hovered && styles.ctaHover]}
      >
        <Text style={styles.ctaText}>{ctaLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  h1: {
    fontFamily: t.typography.title,
    fontSize: 58,
    lineHeight: 58,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1.16,
    color: t.colors.text.primary,
  },
  h1Mobile: { fontSize: 40, lineHeight: 42, letterSpacing: -0.8 },
  subhead: {
    marginTop: 16,
    // Wide enough that the sentence sits on ONE line at desktop width. At 640 it
    // broke after "record", which reads as two thoughts. Still capped, so it never
    // runs the full ~150 characters on a wide monitor.
    maxWidth: 980,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    lineHeight: 26,
    color: t.colors.text.muted,
  },
  // Count + the dated caption, sitting above a hairline that separates the page's
  // answer from the list it describes.
  summary: {
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink08,
  },
  countRow: { flexDirection: 'row', alignItems: 'baseline', gap: 9 },
  count: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h3,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.22,
    color: t.colors.text.primary,
  },
  countNoun: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    color: t.colors.text.muted,
  },
  summaryRow: { marginTop: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  // Nudged onto the first line's cap height rather than its box top.
  glyph: { marginTop: 2 },
  summaryText: {
    flex: 1,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subhead,
    lineHeight: 26,
    color: t.colors.text.secondary,
    maxWidth: 900,
  },
  // The page's only group header: where the unchanged bills begin.
  divider: { marginTop: 26, flexDirection: 'row', alignItems: 'center', gap: 12 },
  dividerLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.68,
    color: t.colors.text.muted,
  },
  dividerRule: { flex: 1, height: 1, backgroundColor: t.colors.alpha.ink08 },
  list: { marginTop: 22, gap: 18 },
  listAfterDivider: { marginTop: 16, gap: 18 },
  stateBox: {
    paddingVertical: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  stateText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  card: {
    maxWidth: 860,
    width: '100%',
    alignSelf: 'center',
    marginTop: 34,
    alignItems: 'center',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.alpha.ink20,
    borderRadius: 20,
    paddingVertical: 56,
    paddingHorizontal: 48,
  },
  cardHeading: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h1,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.28,
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  cardBody: {
    marginTop: 12,
    maxWidth: 560,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    lineHeight: 25,
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  cta: {
    marginTop: 24,
    backgroundColor: t.colors.brand.base,
    borderRadius: t.radii.md,
    paddingVertical: 12,
    paddingHorizontal: 22,
    ...(isWeb
      ? ({ transitionProperty: 'background-color', transitionDuration: '0.15s' } as object)
      : null),
  },
  ctaHover: { backgroundColor: t.colors.brand.graphics },
  ctaText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.onGreen,
  },
});
