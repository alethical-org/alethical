import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Circle, Path } from 'react-native-svg';

import { theme as t } from '../../theme/tokens';
import { IaItem, MenuKey } from '../../navigation/ia';
import { useAuth } from '../../providers/AuthProvider';
import { useSignInModal } from '../../providers/signInModalContext';
import { useResponsive } from '../../hooks/useResponsive';
import { useTrackedBills, useTrackedCommittees } from '../../hooks/useAppQueries';
import { useTrackedBillsLastVisit } from '../../hooks/useTrackedBillsLastVisit';
import { useBillTracking } from '../../hooks/useBillTracking';
import { SearchPageShell } from '../../components/search/searchPieces';
import { BillResultCard } from '../../components/search/BillResultCard';
import { TrackedCommitteeCard } from '../../components/tracked/TrackedCommitteeCard';
import { Skeleton } from '../../components/Skeleton';
import { isWeb, useHover } from '../../components/billDetail/interactions';
import { isHotIssueBill } from '../../lib/hotIssues';
import { lastVisitFrom } from '../../lib/trackedBillsLastVisit';
import {
  COMMITTEES_HEADING,
  KIND_LABEL_BILL,
  LOADING_TRACKED,
  NOTHING_TRACKED_YET,
  TRACKED_SUBHEAD,
  TRACKED_TITLE,
  TRACKED_UNAVAILABLE,
  hasNothingTracked,
  trackedCommitteeSlug,
} from '../../lib/trackedPage';
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
//
// Two lists since #1943. Bills keep their moved / no-change grouping, because a
// bill's own record lets the page compute what moved since the reader's last
// visit. Followed committees get their own list under COMMITTEES YOU FOLLOW and
// never enter that grouping: following a committee is a bookmark, nothing computes
// whether its filings moved, and filing one under NO CHANGE would claim a check
// nobody performs. If filings ever notify, committees join the grouping and the
// third list dissolves — a move, not a redesign. Every fixed sentence on this page
// comes from lib/trackedPage.ts.
export function TrackedBillsScreen() {
  const navigation = useNavigation<any>();
  const { isSignedIn, user } = useAuth();
  const { openSignIn } = useSignInModal();
  const { isTracked, toggleTrack } = useBillTracking();
  const { isMobile } = useResponsive();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);

  const trackedQuery = useTrackedBills(user?.id);
  const bills = trackedQuery.data ?? [];
  const committeesQuery = useTrackedCommittees(user?.id);
  const committees = committeesQuery.data ?? [];
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
      <Text
        accessibilityRole="header"
        aria-level={1}
        style={[styles.h1, isMobile && styles.h1Mobile]}
      >
        {TRACKED_TITLE}
      </Text>
      {/* No "tap Track to add or remove" instruction any more: the ✓ Tracked button
          is now on every card on both surfaces, so the sentence labelled something
          already visible. Nothing here promises a message — the product cannot send
          one (#36), and this page is the whole delivery mechanism. The old second
          clause, "anything that moves in the official record shows up here", is gone
          with #1943: a committee's filings are moves in that record and will NOT show
          up, so the sentence would promise watching the page does not do. */}
      <Text style={styles.subhead}>{TRACKED_SUBHEAD}</Text>
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
  } else if (trackedQuery.isLoading || lastVisitQuery.isLoading || committeesQuery.isLoading) {
    body = (
      <View style={styles.list} accessible accessibilityLabel={LOADING_TRACKED}>
        {SKELETON_ROWS.map((i) => (
          <Skeleton key={i} width="100%" height={148} radius={t.radii.card} />
        ))}
      </View>
    );
  } else if (trackedQuery.error || committeesQuery.error) {
    // Either list failing blanks the page rather than showing the other alone: a
    // half list looks exactly like a whole one, and this page's only job is to say
    // what the reader saved.
    body = (
      <View style={styles.stateBox}>
        <Text style={styles.stateText}>{TRACKED_UNAVAILABLE}</Text>
      </View>
    );
  } else if (hasNothingTracked(bills.length, committees.length)) {
    // One sentence, no heading and no button (drawn that way): it promises that a
    // saved thing stays on this list, never that anyone will be told anything.
    body = (
      <View style={styles.card}>
        <Text style={styles.cardBody}>{NOTHING_TRACKED_YET}</Text>
      </View>
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
        // The kind label is on for this page only: the other 5 places this card
        // draws hold bills alone (#1943).
        kindLabel={KIND_LABEL_BILL}
        onPress={() => navigation.navigate('BillDetail', { billId: bill.id })}
        onSponsorPress={(legislatorId) =>
          navigation.navigate('LegislatorProfile', { legislatorId })
        }
        onRollCalls={() => navigation.navigate('BillDetail', { billId: bill.id, tab: 'votes' })}
      />
    );

    // The committee list: its own heading, never inside the bills' grouping, and
    // only when there is one to draw. Order is the server's, newest-followed first.
    const committeeList =
      committees.length > 0 ? (
        <>
          <View style={[styles.divider, bills.length === 0 && styles.dividerFirst]}>
            <Text style={styles.dividerLabel}>{COMMITTEES_HEADING}</Text>
            <View style={styles.dividerRule} />
          </View>
          <View style={styles.listAfterDivider}>
            {committees.map((committee) => (
              <TrackedCommitteeCard
                key={committee.registrationNumber}
                committee={committee}
                onPress={() =>
                  navigation.navigate('CommitteeMoney', { slug: trackedCommitteeSlug(committee) })
                }
              />
            ))}
          </View>
        </>
      ) : null;

    body = (
      <>
        {/* The count and its dated caption speak for the bills alone — the moved /
            no-change comparison is a bills-only fact — so they draw only when there
            are bills to count. */}
        {bills.length > 0 ? (
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
        ) : null}

        {bills.length === 0 ? null : moved.length > 0 ? (
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

        {committeeList}
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
      <Text accessibilityRole="header" aria-level={2} style={styles.cardHeading}>
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
  // The committee heading directly under the hero, when no bill is tracked.
  dividerFirst: { marginTop: 8 },
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
