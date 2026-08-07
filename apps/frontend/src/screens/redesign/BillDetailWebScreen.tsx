import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { theme as t } from '../../theme/tokens';
import { IaItem, MenuKey } from '../../navigation/ia';
import { useAuth } from '../../providers/AuthProvider';
import { useResponsive } from '../../hooks/useResponsive';
import { useBill, usePrefetchBillVotes } from '../../hooks/useAppQueries';
import { useBillTracking } from '../../hooks/useBillTracking';
import { bienniumEyebrow, chiefAuthor, pulledLabel } from '../../lib/billDetail';
import { isHotIssueBill } from '../../lib/hotIssues';
import { SearchPageShell } from '../../components/search/searchPieces';
import { ReturnToast } from '../../components/search/ReturnToast';
import { shouldAnnounceTrack, trackReturnAction } from '../../lib/trackReturn';
import { BillHeader, DetailTab } from '../../components/billDetail/BillHeader';
import { SummaryTab } from '../../components/billDetail/SummaryTab';
import { ActionsTab } from '../../components/billDetail/ActionsTab';
import { VotesTab } from '../../components/billDetail/VotesTab';
import { VersionsTab } from '../../components/billDetail/VersionsTab';
import { FullTextTab } from '../../components/billDetail/FullTextTab';
import { BillNotFound } from '../../components/billDetail/BillNotFound';
import { isNotFoundError } from '../../data/api';
import { Skeleton } from '../../components/Skeleton';
import { GoBackLink } from '../../components/GoBackLink';
import { routePath } from '../../navigation/links';
import {
  billDetailNeedsVotes,
  billDetailVotePrefetchIsUseful,
} from '../../lib/billDetailRequestMode';

const isWeb = Platform.OS === 'web';
const TABS: DetailTab[] = ['summary', 'actions', 'votes', 'text', 'versions'];
// Links shared before the Bill Text tab was renamed carry ?tab=fulltext; keep
// resolving them to the same tab so every already-shared URL still lands
// (grounded-answers rule 5 — a linked location must stay reachable).
const LEGACY_TAB_PARAMS: Record<string, DetailTab> = { fulltext: 'text' };

// Web Bill Detail (design_handoff_bill_profile_web). Tabbed two-column layout —
// plain-language summary first, official record deeper in. Tab lives in the URL
// (?tab=votes) so every view is shareable/reload-safe (grounded-answers rule 5).
export function BillDetailWebScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { isSignedIn } = useAuth();
  const { isDesktop } = useResponsive();

  const billId = String(route.params?.billId ?? '');
  const tabParam = route.params?.tab;
  const activeTab: DetailTab = TABS.includes(tabParam)
    ? tabParam
    : (LEGACY_TAB_PARAMS[tabParam] ?? 'summary');

  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  // Section a citation chip asked to jump to; consumed by the Bill Text tab
  // after it mounts (inactive tabs are unmounted on web).
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

  const billQuery = useBill(billId, {
    includeVotes: billDetailNeedsVotes(true, activeTab),
  });
  const bill = billQuery.data;
  const prefetchBillVotes = usePrefetchBillVotes();

  const { trackedIds, isTracked, toggleTrack, trackedLoading } = useBillTracking();
  const tracked = bill ? isTracked(bill.id) : false;
  const onTrack = () => {
    if (bill) toggleTrack(bill.id, bill.identifier);
  };

  // Intent-preserving track: a signed-out user who tapped Track returns here with
  // ?track=1. Once signed in and the tracked list has loaded, complete the track
  // (unless already tracked) and clear the param so a refresh doesn't repeat it.
  const autoTrackFired = useRef(false);
  const [justTracked, setJustTracked] = useState<string | null>(null);
  useEffect(() => {
    const action = trackReturnAction({
      requestedOnReturn: Boolean(route.params?.track),
      signedIn: isSignedIn,
      billLoaded: Boolean(bill),
      trackedListLoading: trackedLoading,
      alreadyTracked: Boolean(bill && trackedIds.has(bill.id)),
      alreadyFired: autoTrackFired.current,
    });
    if (action === 'wait' || !bill) return;
    if (action === 'track') {
      autoTrackFired.current = true;
      // The message waits for the server to confirm the save. Announcing on the
      // attempt would claim a bill was tracked when the request had failed.
      toggleTrack(
        bill.id,
        bill.identifier,
        shouldAnnounceTrack(action) ? () => setJustTracked(bill.identifier) : undefined,
      );
    }
    navigation.setParams({ track: undefined });
  }, [route.params?.track, isSignedIn, bill, trackedLoading, trackedIds, toggleTrack, navigation]);

  const selectTab = (tab: DetailTab) => {
    navigation.setParams({ tab: tab === 'summary' ? undefined : tab });
  };
  const prefetchVotes = (tab: DetailTab) => {
    if (bill && billDetailVotePrefetchIsUseful(tab)) {
      prefetchBillVotes(bill.id);
    }
  };

  const openUrl = (url: string) => {
    if (isWeb && typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
    else Linking.openURL(url).catch(() => {});
  };
  const openLegislator = (legislatorId: string) => {
    navigation.navigate('LegislatorProfile', { legislatorId });
  };
  const openBill = (nextBillId: string) => {
    navigation.push('BillDetail', { billId: nextBillId });
  };
  const askAboutBill = (question: string) => {
    navigation.navigate('Ask', { q: question || undefined, billId });
  };

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

  // Native uses the navigation stack when it has one, then the bill list. Web's
  // shared GoBackLink makes the stricter decision from marked browser history.
  const goToBillList = () => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
    } else {
      navigation.navigate('Bills');
    }
  };

  const shell = (children: React.ReactNode, hero: React.ReactNode) => (
    <SearchPageShell
      // Pinned outside the scroll, so the confirmation stays put while the page
      // moves under it. Only ever set by a return from sign-in (#1015).
      overlay={
        <ReturnToast
          visible={Boolean(justTracked)}
          billCode={justTracked ?? ''}
          onDismiss={() => setJustTracked(null)}
        />
      }
      openMenu={openMenu}
      onOpenMenuChange={setOpenMenu}
      onNavigate={handleNavigate}
      onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
      onPrivacy={() => navigation.navigate('Privacy')}
      onTerms={() => navigation.navigate('Terms')}
      hero={hero}
      // The hero ends in the tab bar's rule, so the white panel's own 40px top
      // padding is the whole gap below it — one source for that space, matching
      // the design's 40px panel padding (design_handoff_bill_profile_web).
      heroEndsWithRule
    >
      {children}
    </SearchPageShell>
  );

  if (billQuery.isLoading) {
    return shell(<BillBodySkeleton isDesktop={isDesktop} />, <BillHeroSkeleton />);
  }

  // A bill that does not exist is a permanent answer, not a blip: say so and give
  // a way out, instead of inviting a retry that can never work (#720).
  if (isNotFoundError(billQuery.error)) {
    return shell(
      <View>
        <GoBackLink href={routePath.bills()} onPress={goToBillList} />
        <BillNotFound
          billId={billId}
          onBrowseBills={goToBillList}
          onAsk={() => navigation.navigate('Ask')}
        />
      </View>,
      null,
    );
  }

  if (billQuery.isError || !bill) {
    return shell(
      <View style={styles.stateBox}>
        <GoBackLink href={routePath.bills()} onPress={goToBillList} />
        <Text style={styles.stateText}>
          We couldn’t load this bill right now. Please try again in a moment.
        </Text>
      </View>,
      null,
    );
  }

  const eyebrow = bienniumEyebrow(bill.id, bill.sessionLabel);
  const shareUrl = `https://alethical.com/bills/${bill.id}`;
  const shareTitle = `${bill.identifier} — ${bill.title}`;
  // ONE value for the whole page (every tab's source line shows the same stamp).
  // Empty when the bill carries no pull date — billSourceText then drops the segment
  // instead of repeating "Minnesota Legislature" back at the reader.
  const updatedLabel = pulledLabel(bill);
  const author = chiefAuthor(bill);

  const hero = (
    <BillHeader
      title={bill.aiAnalysis?.shortTitle ?? bill.title}
      fullTitle={bill.title}
      eyebrow={eyebrow}
      omnibus={!!bill.isOmnibus}
      hotIssue={isHotIssueBill(bill.id, bill.companion?.id)}
      shareUrl={shareUrl}
      shareTitle={shareTitle}
      tracked={tracked}
      onTrack={onTrack}
      activeTab={activeTab}
      onSelectTab={selectTab}
      onTabIntent={prefetchVotes}
      onAllBills={goToBillList}
    />
  );

  let body: React.ReactNode = null;
  if (activeTab === 'summary') {
    body = (
      <SummaryTab
        bill={bill}
        showAsk
        onAsk={askAboutBill}
        onOpenUrl={openUrl}
        onOpenLegislator={openLegislator}
        onOpenBill={openBill}
        isDesktop={isDesktop}
        updatedLabel={updatedLabel}
        onCitationPress={(sectionAnchor: string) => {
          setPendingAnchor(sectionAnchor);
          selectTab('text');
        }}
        onJumpToActions={() => selectTab('actions')}
      />
    );
  } else if (activeTab === 'actions') {
    body = billQuery.voteError ? (
      <VoteLoadError />
    ) : (
      <ActionsTab
        bill={bill}
        onViewVotes={() => selectTab('votes')}
        onOpenBill={openBill}
        onOpenLegislator={openLegislator}
        updatedLabel={updatedLabel}
      />
    );
  } else if (activeTab === 'votes') {
    body = billQuery.voteError ? (
      <VoteLoadError />
    ) : (
      <VotesTab
        bill={bill}
        chiefParty={author?.party}
        onOpenLegislator={openLegislator}
        onOpenUrl={openUrl}
        onAsk={() => askAboutBill('')}
        updatedLabel={updatedLabel}
      />
    );
  } else if (activeTab === 'versions') {
    body = <VersionsTab bill={bill} onOpenUrl={openUrl} updatedLabel={updatedLabel} />;
  } else if (activeTab === 'text') {
    body = (
      <FullTextTab
        bill={bill}
        targetSectionAnchor={pendingAnchor}
        onAnchorConsumed={() => setPendingAnchor(null)}
        updatedLabel={updatedLabel}
      />
    );
  }

  return shell(body, hero);
}

function VoteLoadError() {
  return (
    <View style={styles.stateBox} accessibilityRole="alert">
      <Text style={styles.stateText}>
        We couldn’t load this bill’s votes right now. Please try again in a moment.
      </Text>
    </View>
  );
}

// Loading skeletons — mirror the hero band (breadcrumb · title · eyebrow · tabs)
// and the tabbed body (main summary column + sidebar card), rendered inside the
// same SearchPageShell so the nav + back link appear instantly.
function BillHeroSkeleton() {
  return (
    <View accessible accessibilityLabel="Loading bill">
      <Skeleton width={90} height={16} style={styles.skHeroCrumb} />
      <Skeleton width="80%" height={40} radius={8} />
      <Skeleton width="52%" height={40} radius={8} style={styles.skGap8} />
      <Skeleton width={180} height={13} style={styles.skGap16} />
      <View style={styles.skTabRow}>
        <Skeleton width={70} height={16} />
        <Skeleton width={60} height={16} />
        <Skeleton width={52} height={16} />
        <Skeleton width={68} height={16} />
      </View>
    </View>
  );
}

function BillBodySkeleton({ isDesktop }: { isDesktop: boolean }) {
  return (
    <View style={[styles.skGrid, isDesktop && styles.skGridDesktop]}>
      <View style={styles.skMainCol}>
        <Skeleton width={160} height={26} radius={8} />
        <View style={styles.skLines}>
          <Skeleton width="100%" height={14} />
          <Skeleton width="97%" height={14} />
          <Skeleton width="92%" height={14} />
          <Skeleton width="95%" height={14} />
        </View>
        <Skeleton width="100%" height={160} radius={t.radii.card} style={styles.skGap20} />
      </View>
      <View style={styles.skSideCol}>
        <Skeleton width="100%" height={220} radius={t.radii.card} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // skeleton loading state
  skHeroCrumb: { marginTop: 8, marginBottom: 20 },
  skGap8: { marginTop: 8 },
  skGap16: { marginTop: 16 },
  skGap20: { marginTop: 20 },
  skTabRow: { flexDirection: 'row', gap: 34, marginTop: 30, flexWrap: 'wrap' },
  skGrid: { gap: 24 },
  skGridDesktop: { flexDirection: 'row', alignItems: 'flex-start' },
  skMainCol: { flex: 2, gap: 6, minWidth: 0 },
  skSideCol: { flex: 1, minWidth: 0 },
  skLines: { marginTop: 8, gap: 12 },
  stateBox: { paddingVertical: 64, alignItems: 'center', justifyContent: 'center', gap: 12 },
  stateText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    color: t.colors.text.muted,
    textAlign: 'center',
  },
});
