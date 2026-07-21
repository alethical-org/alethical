import { useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { theme as t } from '../../theme/tokens';
import { IaItem, MenuKey } from '../../navigation/ia';
import { useAuth } from '../../providers/AuthProvider';
import { useResponsive } from '../../hooks/useResponsive';
import { useBill } from '../../hooks/useAppQueries';
import { bienniumEyebrow, chiefAuthor, formatNiceDate } from '../../lib/billDetail';
import { SearchPageShell } from '../../components/search/searchPieces';
import { BillHeader, DetailTab } from '../../components/billDetail/BillHeader';
import { SummaryTab } from '../../components/billDetail/SummaryTab';
import { ActionsTab } from '../../components/billDetail/ActionsTab';
import { VotesTab } from '../../components/billDetail/VotesTab';
import { VersionsTab } from '../../components/billDetail/VersionsTab';
import { FullTextTab } from '../../components/billDetail/FullTextTab';
import { Skeleton } from '../../components/Skeleton';

const isWeb = Platform.OS === 'web';
const TABS: DetailTab[] = ['summary', 'actions', 'votes', 'versions', 'fulltext'];

// Web Bill Detail (design_handoff_bill_profile_web). Tabbed two-column layout —
// plain-language summary first, official record deeper in. Tab lives in the URL
// (?tab=votes) so every view is shareable/reload-safe (grounded-answers rule 5).
export function BillDetailWebScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { signInWithGoogle } = useAuth();
  const { isDesktop } = useResponsive();

  const billId = String(route.params?.billId ?? '');
  const tabParam = route.params?.tab;
  const activeTab: DetailTab = TABS.includes(tabParam) ? tabParam : 'summary';

  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  // Section a citation chip asked to jump to; consumed by the Full Text tab
  // after it mounts (inactive tabs are unmounted on web).
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

  const billQuery = useBill(billId);
  const bill = billQuery.data;

  const selectTab = (tab: DetailTab) => {
    navigation.setParams({ tab: tab === 'summary' ? undefined : tab });
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
    navigation.navigate('Ask', { q: question || undefined });
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

  const shell = (children: React.ReactNode, hero: React.ReactNode) => (
    <SearchPageShell
      openMenu={openMenu}
      onOpenMenuChange={setOpenMenu}
      onNavigate={handleNavigate}
      onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
      onSignIn={() => void signInWithGoogle()}
      onAsk={() => navigation.navigate('Ask')}
      onPrivacy={() => navigation.navigate('Privacy')}
      onTerms={() => navigation.navigate('Terms')}
      hero={hero}
    >
      {children}
    </SearchPageShell>
  );

  if (billQuery.isLoading) {
    return shell(<BillBodySkeleton isDesktop={isDesktop} />, <BillHeroSkeleton />);
  }

  if (billQuery.isError || !bill) {
    return shell(
      <View style={styles.stateBox}>
        <Text style={styles.stateText}>
          We couldn’t load this bill right now. Please try again in a moment.
        </Text>
      </View>,
      null,
    );
  }

  const eyebrow = bienniumEyebrow(bill.chamber, bill.id);
  const shareUrl = `https://alethical.com/bills/${bill.id}`;
  const shareTitle = `${bill.identifier} — ${bill.title}`;
  const updatedLabel =
    bill.updatedAt && bill.updatedAt !== 'Unknown'
      ? `Updated ${formatNiceDate(bill.updatedAt)}`
      : 'Minnesota Legislature';
  const author = chiefAuthor(bill);

  const hero = (
    <BillHeader
      title={bill.aiAnalysis?.shortTitle ?? bill.title}
      fullTitle={bill.title}
      eyebrow={eyebrow}
      omnibus={!!bill.isOmnibus}
      shareUrl={shareUrl}
      shareTitle={shareTitle}
      activeTab={activeTab}
      onSelectTab={selectTab}
      onAllBills={() => navigation.navigate('Bills')}
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
        onCitationPress={(sectionId: string) => {
          setPendingAnchor(sectionId);
          selectTab('fulltext');
        }}
      />
    );
  } else if (activeTab === 'actions') {
    body = (
      <ActionsTab bill={bill} onViewVotes={() => selectTab('votes')} updatedLabel={updatedLabel} />
    );
  } else if (activeTab === 'votes') {
    body = (
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
  } else if (activeTab === 'fulltext') {
    body = (
      <FullTextTab
        bill={bill}
        targetSectionId={pendingAnchor}
        onAnchorConsumed={() => setPendingAnchor(null)}
        updatedLabel={updatedLabel}
      />
    );
  }

  return shell(body, hero);
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
