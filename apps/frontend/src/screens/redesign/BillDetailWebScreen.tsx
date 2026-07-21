import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { theme as t } from '../../theme/tokens';
import { IaItem, MenuKey } from '../../navigation/ia';
import { Legislator } from '../../data/types';
import { useAuth } from '../../providers/AuthProvider';
import { useResponsive } from '../../hooks/useResponsive';
import { useBill, useLegislators } from '../../hooks/useAppQueries';
import { bienniumEyebrow, chiefAuthor, formatNiceDate } from '../../lib/billDetail';
import { SearchPageShell } from '../../components/search/searchPieces';
import { BillHeader, DetailTab } from '../../components/billDetail/BillHeader';
import { SummaryTab } from '../../components/billDetail/SummaryTab';
import { ActionsTab } from '../../components/billDetail/ActionsTab';
import { VotesTab } from '../../components/billDetail/VotesTab';
import { VersionsTab } from '../../components/billDetail/VersionsTab';
import { VotesSignInModal } from '../../components/billDetail/VotesSignInModal';

const isWeb = Platform.OS === 'web';
const TABS: DetailTab[] = ['summary', 'actions', 'votes', 'versions'];

// Web Bill Detail (design_handoff_bill_profile_web). Tabbed two-column layout —
// plain-language summary first, official record deeper in. Tab lives in the URL
// (?tab=votes) so every view is shareable/reload-safe (grounded-answers rule 5).
export function BillDetailWebScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { isSignedIn, signInWithGoogle } = useAuth();
  const { isDesktop } = useResponsive();

  const billId = String(route.params?.billId ?? '');
  const tabParam = route.params?.tab;
  const activeTab: DetailTab = TABS.includes(tabParam) ? tabParam : 'summary';

  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);

  const billQuery = useBill(billId);
  const bill = billQuery.data;
  const legislatorsQuery = useLegislators();
  const legislatorsById = useMemo(() => {
    const map = new Map<string, Legislator>();
    (legislatorsQuery.data ?? []).forEach((leg) => map.set(leg.id, leg));
    return map;
  }, [legislatorsQuery.data]);

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
      overlay={
        <VotesSignInModal
          visible={signInOpen}
          onClose={() => setSignInOpen(false)}
          onContinue={() => {
            setSignInOpen(false);
            void signInWithGoogle();
          }}
        />
      }
      hero={hero}
    >
      {children}
    </SearchPageShell>
  );

  if (billQuery.isLoading) {
    return shell(
      <View style={styles.stateBox}>
        <ActivityIndicator color={t.colors.brand.base} />
        <Text style={styles.stateText}>Loading bill…</Text>
      </View>,
      null,
    );
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
      title={bill.title}
      eyebrow={eyebrow}
      omnibus={!!bill.isOmnibus}
      shareUrl={shareUrl}
      shareTitle={shareTitle}
      activeTab={activeTab}
      onSelectTab={selectTab}
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
        isDesktop={isDesktop}
        updatedLabel={updatedLabel}
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
        legislatorsById={legislatorsById}
        signedIn={isSignedIn}
        showYourLegislators
        chiefParty={author?.party}
        onOpenSignIn={() => setSignInOpen(true)}
        onOpenLegislator={openLegislator}
        onAsk={() => askAboutBill('')}
        updatedLabel={updatedLabel}
      />
    );
  } else {
    body = <VersionsTab bill={bill} onOpenUrl={openUrl} updatedLabel={updatedLabel} />;
  }

  return shell(body, hero);
}

const styles = StyleSheet.create({
  stateBox: { paddingVertical: 64, alignItems: 'center', justifyContent: 'center', gap: 12 },
  stateText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    color: t.colors.text.muted,
    textAlign: 'center',
  },
});
