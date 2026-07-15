import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { theme as t } from '../../theme/tokens';
import { BillListFilters } from '../../data/api';
import { IaItem, MenuKey } from '../../navigation/ia';
import { trackSignInReturnTo } from '../../navigation/webRoutes';
import { useAuth } from '../../providers/AuthProvider';
import {
  useBills,
  useMeta,
  usePolicyAreas,
  useSessions,
  useToggleTrackedBill,
  useTrackedBills,
} from '../../hooks/useAppQueries';
import { BillResultCard } from '../../components/search/BillResultCard';
import { ReturnToast } from '../../components/search/ReturnToast';
import { SignInModal } from '../../components/search/SignInModal';
import {
  ChamberFilter,
  ChamberSegmented,
  FilterDropdown,
  FilterPill,
  NoResults,
  OmnibusToggle,
  Pagination,
  ResultsHeader,
  SearchHero,
  SearchPageShell,
  SESSION_LABEL_FALLBACK,
} from '../../components/search/searchPieces';

// Search Bills (docs/mockups/search-bills). Server-paginated bill discovery over
// the current session with chamber / status / session / omnibus filters + policy
// pills, ordered by legislative progress (sort=progress, #292), with auth-gated
// per-bill tracking.

const PAGE_SIZE = 10;
// "issue" is the layperson entry word for a bill's topic (docs/ui-copy-guide.md
// terminology invariants) — matches the nav's "Issues" menu. The data field and
// API stay `policy_areas` (grounded-answers rule 3 governs displayed strings only).
const ALL_ISSUES = 'All issues';

// Issue chips display in Title Case (e.g. "Public Safety"), but the value sent
// to the API stays the exact stored element (e.g. "public safety") — the /bills
// policy_area filter matches whole elements exactly, so the raw value must be
// preserved. Mirrors formatPolicyAreaLabel in the legacy SearchFilterPanel.
const titleCaseIssue = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');

// Ordered most-progressed first (matching the sort=progress ordering), with the
// off-path Vetoed state last. Every value maps to a status the /bills filter can
// actually serve (alethical/api/routers/public.py status_filter_clause).
const STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Signed into Law', value: 'signed_into_law' },
  { label: 'Passed Senate', value: 'passed_senate' },
  { label: 'Passed House', value: 'passed_house' },
  { label: 'In Committee', value: 'in_committee' },
  { label: 'Proposed', value: 'proposed' },
  { label: 'Vetoed', value: 'vetoed' },
];

export function SearchBillsScreen() {
  const navigation = useNavigation<any>();
  const { isSignedIn, user, signInWithGoogle } = useAuth();

  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [openFilter, setOpenFilter] = useState<'status' | 'session' | null>(null);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [chamber, setChamber] = useState<ChamberFilter>('All');
  const [status, setStatus] = useState('');
  const [session, setSession] = useState('');
  const [omnibusOnly, setOmnibusOnly] = useState(false);
  const [policyArea, setPolicyArea] = useState(ALL_ISSUES);
  const [page, setPage] = useState(1);
  const [signInBill, setSignInBill] = useState<{ id: string; code: string } | null>(null);
  const [toast, setToast] = useState<{ code: string } | null>(null);

  const sessionsQuery = useSessions();
  const currentSession =
    sessionsQuery.data?.find((item) => item.isCurrent) ?? sessionsQuery.data?.[0];
  const sessionSlug = session || currentSession?.slug || '';
  const sessionLabel =
    sessionsQuery.data?.find((item) => item.slug === sessionSlug)?.name ?? SESSION_LABEL_FALLBACK;

  const filters: BillListFilters = {
    chamber: chamber === 'All' ? undefined : chamber,
    status: status || undefined,
    policyArea: policyArea === ALL_ISSUES ? undefined : policyArea,
    omnibus: omnibusOnly ? true : undefined,
    // Default sort per Search Bills design-review (2026-07-15): legislative
    // progress — bills closest to becoming law first (#292).
    sort: 'progress',
  };

  const billsQuery = useBills(query || undefined, sessionSlug || undefined, filters, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const metaQuery = useMeta();
  const policyAreasQuery = usePolicyAreas(sessionSlug || undefined);
  const trackedQuery = useTrackedBills(user?.id);
  const toggleTrack = useToggleTrackedBill(user?.id);

  const trackedSet = new Set((trackedQuery.data ?? []).map((bill) => bill.id));
  const bills = billsQuery.data?.data ?? [];
  const total = billsQuery.data?.page.total ?? null;
  const hasMore = billsQuery.data?.page.hasMore ?? false;
  const totalPages = total != null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : undefined;
  const resultCount = total ?? bills.length;

  const policyOptions: Array<{ value: string; label: string; count?: number }> = [
    { value: ALL_ISSUES, label: ALL_ISSUES },
    ...(policyAreasQuery.data ?? []).map((area) => ({
      value: area.name,
      label: titleCaseIssue(area.name),
      count: area.billCount,
    })),
  ].slice(0, 8);

  const resetToFirstPage = () => setPage(1);

  const submitSearch = () => {
    setQuery(queryInput.trim());
    resetToFirstPage();
  };

  const clearFilters = () => {
    setQueryInput('');
    setQuery('');
    setChamber('All');
    setStatus('');
    setPolicyArea(ALL_ISSUES);
    setOmnibusOnly(false);
    resetToFirstPage();
  };

  const activeFilters: string[] = [sessionLabel];
  if (chamber !== 'All') activeFilters.push(`Chamber: ${chamber}`);
  if (status) {
    const label = STATUS_OPTIONS.find((option) => option.value === status)?.label;
    if (label) activeFilters.push(label);
  }
  if (policyArea !== ALL_ISSUES) activeFilters.push(titleCaseIssue(policyArea));
  if (omnibusOnly) activeFilters.push('Omnibus only');
  if (query) activeFilters.push(`“${query}”`);

  const handleToggleTrack = (bill: { id: string; identifier: string }) => {
    if (!isSignedIn) {
      setSignInBill({ id: bill.id, code: bill.identifier });
      return;
    }
    const wasTracked = trackedSet.has(bill.id);
    toggleTrack.mutate(bill.id);
    if (!wasTracked) setToast({ code: bill.identifier });
  };

  const handleContinueSignIn = () => {
    if (!signInBill) return;
    void signInWithGoogle(trackSignInReturnTo(signInBill.id));
    setSignInBill(null);
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

  const filterRow = (
    <>
      <View style={styles.filterRow}>
        <ChamberSegmented
          value={chamber}
          onChange={(value) => {
            setChamber(value);
            resetToFirstPage();
          }}
        />
        <FilterDropdown
          label={STATUS_OPTIONS.find((option) => option.value === status)?.label ?? 'All statuses'}
          accessibilityLabel="Filter by status"
          options={STATUS_OPTIONS}
          selectedValue={status}
          open={openFilter === 'status'}
          onOpenChange={(next) => setOpenFilter(next ? 'status' : null)}
          onSelect={(value) => {
            setStatus(value);
            resetToFirstPage();
          }}
        />
        <FilterDropdown
          label={sessionLabel}
          accessibilityLabel="Filter by session"
          options={(sessionsQuery.data ?? []).map((item) => ({
            label: item.name,
            value: item.slug,
          }))}
          selectedValue={sessionSlug}
          open={openFilter === 'session'}
          onOpenChange={(next) => setOpenFilter(next ? 'session' : null)}
          onSelect={(value) => {
            setSession(value);
            resetToFirstPage();
          }}
        />
        <OmnibusToggle
          value={omnibusOnly}
          onChange={(value) => {
            setOmnibusOnly(value);
            resetToFirstPage();
          }}
        />
      </View>
      <View style={styles.pillRow}>
        {policyOptions.map((option) => (
          <FilterPill
            key={option.value}
            label={option.label}
            count={option.count}
            active={policyArea === option.value}
            onPress={() => {
              setPolicyArea(option.value);
              resetToFirstPage();
            }}
          />
        ))}
      </View>
    </>
  );

  return (
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
        <>
          <SignInModal
            visible={signInBill !== null}
            billCode={signInBill?.code ?? ''}
            onClose={() => setSignInBill(null)}
            onContinue={handleContinueSignIn}
          />
          <ReturnToast
            visible={toast !== null}
            billCode={toast?.code ?? ''}
            onDismiss={() => setToast(null)}
          />
        </>
      }
      hero={
        <SearchHero
          title="Search bills"
          placeholder="Search by keyword or bill number (e.g. HF 2904, SF 1832)"
          query={queryInput}
          onQueryChange={setQueryInput}
          onSubmit={submitSearch}
          variant="bills"
          filters={filterRow}
        />
      }
    >
      <ResultsHeader
        count={resultCount}
        noun="bills"
        sortLabel="Sorted by legislative progress"
        dataAsOf={metaQuery.data?.dataAsOf}
      />

      {billsQuery.isLoading ? (
        <View style={styles.stateBox}>
          <ActivityIndicator color={t.colors.brand.base} />
          <Text style={styles.stateText}>Loading bills…</Text>
        </View>
      ) : billsQuery.isError ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>
            We couldn’t load bills right now. Please try again in a moment.
          </Text>
        </View>
      ) : bills.length === 0 ? (
        <NoResults variant="bills" activeFilters={activeFilters} onClear={clearFilters} />
      ) : (
        <>
          <View style={styles.list}>
            {bills.map((bill) => (
              <BillResultCard
                key={bill.id}
                bill={bill}
                tracked={trackedSet.has(bill.id)}
                onPress={() => navigation.navigate('BillDetail', { billId: bill.id })}
                onToggleTrack={() => handleToggleTrack(bill)}
                onSponsorPress={(legislatorId) =>
                  navigation.navigate('LegislatorProfile', { legislatorId })
                }
                onRollCalls={() =>
                  navigation.navigate('BillDetail', { billId: bill.id, tab: 'votes' })
                }
              />
            ))}
          </View>
          <Pagination
            page={page}
            totalPages={totalPages}
            hasPrev={page > 1}
            hasNext={totalPages != null ? page < totalPages : hasMore}
            onPrev={() => setPage((value) => Math.max(1, value - 1))}
            onNext={() => setPage((value) => value + 1)}
          />
        </>
      )}
    </SearchPageShell>
  );
}

const styles = StyleSheet.create({
  // The filter row (with its dropdown menus) sits above the policy pill row so an
  // open menu overlays the pills instead of being painted behind them.
  filterRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, zIndex: 2 },
  pillRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, zIndex: 1 },
  list: { marginTop: 22, gap: 18 },
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
});
