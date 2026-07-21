import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { theme as t } from '../../theme/tokens';
import { BillListFilters } from '../../data/api';
import { titleCaseIssue } from '../../lib/issues';
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
  MoreIssuesPill,
  NoResults,
  OmnibusToggle,
  Pagination,
  ResultsHeader,
  SearchHero,
  SearchPageShell,
  SESSION_LABEL_FALLBACK,
  formatSessionLabel,
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

// Issue chips: the AI vocabulary has a long tail (thousands of rare labels), so
// show the most common inline and reveal the rest of the head via a "More"
// toggle — capped at the top MAX_ISSUE_CHIPS by bill count rather than listing
// every value. Counts come from /policy-areas, which folds casing.
const INLINE_ISSUE_CHIPS = 12;
const MAX_ISSUE_CHIPS = 30;

// Ordered most-progressed first (matching the sort=progress ordering), with the
// off-path Vetoed state last. Every value maps to a status the /bills filter can
// actually serve (alethical/api/routers/public.py status_filter_clause).
const STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Signed into Law', value: 'signed_into_law' },
  { label: 'Passed Senate', value: 'passed_senate' },
  { label: 'Passed House', value: 'passed_house' },
  { label: 'In Committee', value: 'in_committee' },
  { label: 'Introduced', value: 'proposed' },
  { label: 'Vetoed', value: 'vetoed' },
];

export function SearchBillsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { isSignedIn, user, signInWithGoogle } = useAuth();

  // URL-addressable filter state (issue #135): the filters live in the /bills
  // query string so a filtered view is shareable, bookmarkable, reload-safe, and
  // works with the browser Back button. The route params are the single source
  // of truth; only the search-box draft and the issue-list expander are local.
  const params: Record<string, unknown> = route.params ?? {};
  const query = typeof params.q === 'string' ? params.q : '';
  const chamber: ChamberFilter =
    params.chamber === 'House' || params.chamber === 'Senate' ? params.chamber : 'All';
  const status = typeof params.status === 'string' ? params.status : '';
  const session = typeof params.session === 'string' ? params.session : '';
  const policyArea = typeof params.issue === 'string' && params.issue ? params.issue : ALL_ISSUES;
  const omnibusOnly = params.omnibus === '1';
  const page = Math.max(1, Number.parseInt(String(params.page ?? ''), 10) || 1);

  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [openFilter, setOpenFilter] = useState<'status' | 'session' | null>(null);
  const [queryInput, setQueryInput] = useState(query);
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [signInBill, setSignInBill] = useState<{ id: string; code: string } | null>(null);
  const [toast, setToast] = useState<{ code: string } | null>(null);

  // Keep the search-box draft in sync when the URL query changes externally
  // (e.g. Back/Forward, a shared link, or Clear filters).
  useEffect(() => {
    setQueryInput(query);
  }, [query]);

  // Merge a filter change into the URL. Any filter change resets to page 1
  // unless the patch sets page itself; undefined removes a param (→ default).
  const updateFilters = (patch: Record<string, string | undefined>) => {
    navigation.setParams({ page: undefined, ...patch });
  };

  const sessionsQuery = useSessions();
  const currentSession =
    sessionsQuery.data?.find((item) => item.isCurrent) ?? sessionsQuery.data?.[0];
  const sessionSlug = session || currentSession?.slug || '';
  const sessionName = sessionsQuery.data?.find((item) => item.slug === sessionSlug)?.name;
  const sessionLabel = sessionName ? formatSessionLabel(sessionName) : SESSION_LABEL_FALLBACK;

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
    ...(policyAreasQuery.data ?? []).slice(0, MAX_ISSUE_CHIPS).map((area) => ({
      value: area.name,
      label: titleCaseIssue(area.name),
      count: area.billCount,
    })),
  ];
  // "All issues" always shows; INLINE_ISSUE_CHIPS issue pills show inline, the
  // rest expand under "More". A selected issue outside the inline set forces the
  // list open so its active pill stays visible.
  const selectedIsHidden =
    policyArea !== ALL_ISSUES &&
    policyOptions.findIndex((option) => option.value === policyArea) > INLINE_ISSUE_CHIPS;
  const issuesExpanded = showAllIssues || selectedIsHidden;
  const visiblePolicyOptions = issuesExpanded
    ? policyOptions
    : policyOptions.slice(0, INLINE_ISSUE_CHIPS + 1);
  const hiddenIssueCount = policyOptions.length - (INLINE_ISSUE_CHIPS + 1);

  const submitSearch = () => {
    updateFilters({ q: queryInput.trim() || undefined });
  };

  // Mirror the prior Clear: reset keyword/chamber/status/issue/omnibus/page but
  // keep the chosen session.
  const clearFilters = () => {
    updateFilters({
      q: undefined,
      chamber: undefined,
      status: undefined,
      issue: undefined,
      omnibus: undefined,
    });
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
    // Sign-in isn't available yet (no post-login experience shipped), so
    // Track stays a visible no-op rather than opening the sign-in modal.
    if (!isSignedIn) {
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
          onChange={(value) => updateFilters({ chamber: value === 'All' ? undefined : value })}
        />
        <FilterDropdown
          label={STATUS_OPTIONS.find((option) => option.value === status)?.label ?? 'All statuses'}
          accessibilityLabel="Filter by status"
          options={STATUS_OPTIONS}
          selectedValue={status}
          open={openFilter === 'status'}
          onOpenChange={(next) => setOpenFilter(next ? 'status' : null)}
          onSelect={(value) => updateFilters({ status: value || undefined })}
        />
        <FilterDropdown
          label={sessionLabel}
          accessibilityLabel="Filter by session"
          options={(sessionsQuery.data ?? []).map((item) => ({
            label: formatSessionLabel(item.name),
            value: item.slug,
          }))}
          selectedValue={sessionSlug}
          open={openFilter === 'session'}
          onOpenChange={(next) => setOpenFilter(next ? 'session' : null)}
          onSelect={(value) => updateFilters({ session: value || undefined })}
        />
        <OmnibusToggle
          value={omnibusOnly}
          onChange={(value) => updateFilters({ omnibus: value ? '1' : undefined })}
        />
      </View>
      <View style={styles.pillRow}>
        {visiblePolicyOptions.map((option) => (
          <FilterPill
            key={option.value}
            label={option.label}
            count={option.count}
            active={policyArea === option.value}
            onPress={() =>
              updateFilters({ issue: option.value === ALL_ISSUES ? undefined : option.value })
            }
          />
        ))}
        {hiddenIssueCount > 0 && !selectedIsHidden ? (
          <MoreIssuesPill
            expanded={issuesExpanded}
            hiddenCount={hiddenIssueCount}
            onPress={() => setShowAllIssues((value) => !value)}
          />
        ) : null}
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
                // Bill detail now ships as the redesigned mobile screen, so the
                // card routes there (and roll-calls deep-link to its Votes
                // section). Legislator profile is still old-design — sponsor
                // taps stay a no-op until that screen's redesign ships.
                onPress={() => navigation.navigate('BillDetail', { billId: bill.id })}
                onToggleTrack={() => handleToggleTrack(bill)}
                onSponsorPress={() => {}}
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
            onPrev={() => navigation.setParams({ page: page > 2 ? String(page - 1) : undefined })}
            onNext={() => navigation.setParams({ page: String(page + 1) })}
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
