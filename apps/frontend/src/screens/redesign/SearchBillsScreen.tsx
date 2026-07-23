import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { theme as t } from '../../theme/tokens';
import { BillListFilters } from '../../data/api';
import { titleCaseIssue } from '../../lib/issues';
import { IaItem, MenuKey } from '../../navigation/ia';
import { useAuth } from '../../providers/AuthProvider';
import {
  useBills,
  useMeta,
  usePolicyAreas,
  usePrefetchBills,
  useSessions,
} from '../../hooks/useAppQueries';
import { useDebouncedSearchCommit } from '../../hooks/useDebouncedSearchCommit';
import { useResponsive } from '../../hooks/useResponsive';
import { BillResultCard } from '../../components/search/BillResultCard';
import {
  ChamberFilter,
  ChamberSegmented,
  FilterChip,
  FilterChipRow,
  FilterDropdown,
  FilterEyebrow,
  FilterPill,
  MoreIssuesPill,
  NoResults,
  OmnibusToggle,
  Pagination,
  ResultsHeader,
  SearchHelperLine,
  SearchHero,
  SearchPageShell,
  SESSION_LABEL_FALLBACK,
  SortControl,
  SortOption,
  formatSessionLabel,
} from '../../components/search/searchPieces';
import { Skeleton } from '../../components/Skeleton';

// Placeholder card rows shown while the first page of bills loads.
const SKELETON_ROWS = [0, 1, 2, 3, 4];

// Search Bills (docs/mockups/search-bills). Server-paginated bill discovery over
// the current session with chamber / status / session / omnibus filters + policy
// pills, ordered by legislative progress (sort=progress, #292), with auth-gated
// per-bill tracking.

const PAGE_SIZE = 10;

// Issue chips: the AI vocabulary has a long tail (thousands of rare labels), so
// show the most common inline and reveal the rest of the head via a "More"
// toggle — capped at the top MAX_ISSUE_CHIPS by bill count rather than listing
// every value. Counts come from /policy-areas, which folds casing. There is no
// "All issues" pill — the resting state IS all issues, and removing the last
// selected issue returns to it (v2 spec §C). Issues multi-select: OR within the
// facet (a bill in ANY selected issue), AND-intersected with the other facets.
const INLINE_ISSUE_CHIPS = 12;
const MAX_ISSUE_CHIPS = 30;

// Multiple selected issues ride the URL as one comma-joined `issue` param
// (canonical issue names carry no commas, so the round-trip is lossless and the
// filtered view stays shareable/bookmarkable — grounded-answers rule 5).
const ISSUE_SEPARATOR = ',';

// Ordered most-progressed first (matching the sort=progress ordering), with the
// off-path Vetoed state last. Every value maps to a status the /bills filter can
// actually serve (alethical/api/routers/public.py status_filter_clause). The v2
// mock lists a "Passed both chambers" option too, but the corpus can't yet
// classify it reliably (status is derived from current_status text, which
// mis-attributes chamber) — tracked as its own backend fix; we ship the statuses
// the data backs.
const STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Signed into Law', value: 'signed_into_law' },
  { label: 'Passed Senate', value: 'passed_senate' },
  { label: 'Passed House', value: 'passed_house' },
  { label: 'In Committee', value: 'in_committee' },
  { label: 'Introduced', value: 'proposed' },
  { label: 'Vetoed', value: 'vetoed' },
];

// Per-status natural phrasing for the plain-English result description (v2 §E).
const STATUS_PHRASE: Record<string, string> = {
  signed_into_law: 'signed into law',
  passed_senate: 'passed by the Senate',
  passed_house: 'passed by the House',
  in_committee: 'in committee',
  proposed: 'introduced',
  vetoed: 'vetoed',
};

// Sort keys map to the API's `sort` param. Relevance leads automatically whenever
// a keyword query is present (server-side, #573), so "Best match" is offered only
// then and defaults there. "Most tracked" is a roadmap option — inert, shown once.
type SortKey = 'best' | 'progress' | 'action';
const SORT_TO_API: Record<SortKey, 'progress' | 'latest_action'> = {
  best: 'progress',
  progress: 'progress',
  action: 'latest_action',
};

// A query shaped like a bill number ("HF 2904", "SF2904", "2904") is an exclusive
// ID lookup — mirrors the server's classifier (public.py bill_number_clause) so
// the description phrases it as "matching bill HF 2904", not a keyword.
const BILL_NUMBER_QUERY = /^\s*([A-Za-z]{2})?\s*0*\d+\s*$/;

// "a" → "a"; "a, b" → "a or b" / "a and b"; "a, b, c" → "a, b, or c" / "a, b, and c".
const joinList = (items: string[], conjunction: 'or' | 'and'): string => {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
};

const capitalizeFirst = (value: string): string =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

export function SearchBillsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { signInWithGoogle } = useAuth();
  const { isDesktop } = useResponsive();

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
  const selectedIssues =
    typeof params.issue === 'string' && params.issue
      ? params.issue
          .split(ISSUE_SEPARATOR)
          .map((issue) => issue.trim())
          .filter(Boolean)
      : [];
  const omnibusOnly = params.omnibus === '1';
  const page = Math.max(1, Number.parseInt(String(params.page ?? ''), 10) || 1);
  // Sort: an explicit choice rides the URL; absent one, default to best-match
  // when searching (relevance leads) and legislative progress otherwise. A stale
  // 'best' with no query falls back to progress.
  const hasQuery = query.trim().length > 0;
  const sortParam = typeof params.sort === 'string' ? params.sort : '';
  const sortKey: SortKey =
    sortParam === 'best' || sortParam === 'progress' || sortParam === 'action'
      ? sortParam === 'best' && !hasQuery
        ? 'progress'
        : sortParam
      : hasQuery
        ? 'best'
        : 'progress';

  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [openFilter, setOpenFilter] = useState<'status' | 'session' | 'sort' | null>(null);
  const [queryInput, setQueryInput] = useState(query);
  const [showAllIssues, setShowAllIssues] = useState(false);

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
    policyAreas: selectedIssues.length ? selectedIssues : undefined,
    omnibus: omnibusOnly ? true : undefined,
    sort: SORT_TO_API[sortKey],
  };

  // Toggle an issue in/out of the selected set and write the comma-joined result
  // back to the URL (empty → remove the param, returning to all issues).
  const issuesToParam = (issues: string[]) =>
    issues.length ? issues.join(ISSUE_SEPARATOR) : undefined;
  const toggleIssue = (value: string) => {
    const next = selectedIssues.includes(value)
      ? selectedIssues.filter((issue) => issue !== value)
      : [...selectedIssues, value];
    updateFilters({ issue: issuesToParam(next) });
  };

  const billsQuery = useBills(query || undefined, sessionSlug || undefined, filters, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  // Warm the cache for a filter the user is hovering over (web) or touching
  // down on (mobile, via the chips' onPressIn — #517). Tapping a chip keeps the
  // other active filters and resets to page 1, so prefetch the current filters
  // with just this override applied at offset 0 — an exact key match for what
  // useBills reads after the tap (#492).
  // The "prefetch likely-next filters on mount" option in #517 is intentionally
  // deferred: it risks over-fetching, so it should be driven by #516 (RUM) field
  // data before we decide whether/how aggressively to do it.
  const prefetchBills = usePrefetchBills();
  const prefetchFilter = (override: Partial<BillListFilters>) =>
    prefetchBills(
      query || undefined,
      sessionSlug || undefined,
      { ...filters, ...override },
      { limit: PAGE_SIZE, offset: 0 },
    );
  const metaQuery = useMeta();
  const policyAreasQuery = usePolicyAreas(sessionSlug || undefined);

  const bills = billsQuery.data?.data ?? [];
  const total = billsQuery.data?.page.total ?? null;
  const hasMore = billsQuery.data?.page.hasMore ?? false;
  const totalPages = total != null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : undefined;
  const resultCount = total ?? bills.length;

  const policyOptions: Array<{ value: string; label: string; count?: number }> = (
    policyAreasQuery.data ?? []
  )
    .slice(0, MAX_ISSUE_CHIPS)
    .map((area) => ({
      value: area.name,
      label: titleCaseIssue(area.name),
      count: area.billCount,
    }));
  // INLINE_ISSUE_CHIPS issue pills show inline; the rest expand under "More". A
  // selected issue that's collapsed out of view still shows as a removable chip
  // in the FILTERS row, so there's no need to force the list open.
  const issuesExpanded = showAllIssues;
  const visiblePolicyOptions = issuesExpanded
    ? policyOptions
    : policyOptions.slice(0, INLINE_ISSUE_CHIPS);
  const hiddenIssueCount = policyOptions.length - INLINE_ISSUE_CHIPS;

  const submitSearch = () => {
    updateFilters({ q: queryInput.trim() || undefined });
  };

  // Search as the user types: push the debounced draft into the URL so results
  // update without pressing Enter or the Search button (which still submit
  // immediately via submitSearch).
  useDebouncedSearchCommit(queryInput, query, (value) => updateFilters({ q: value || undefined }));

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

  const statusLabel = STATUS_OPTIONS.find((option) => option.value === status)?.label;
  const isNumberLookup = hasQuery && BILL_NUMBER_QUERY.test(query);
  const sessionIsDefault = !session || sessionSlug === currentSession?.slug;

  // Removable, facet-color-coded chips (v2 §D). Fixed order: keyword · chamber ·
  // status · session (only if non-default) · omnibus · issues (one each).
  const chips: FilterChip[] = [];
  if (query) {
    chips.push({
      key: 'keyword',
      tone: 'keyword',
      label: `Search: “${query}”`,
      removeLabel: 'Clear search',
      onRemove: () => updateFilters({ q: undefined }),
    });
  }
  if (chamber !== 'All') {
    chips.push({
      key: 'chamber',
      tone: 'chamber',
      label: `Chamber: ${chamber}`,
      removeLabel: 'Remove chamber filter',
      onRemove: () => updateFilters({ chamber: undefined }),
    });
  }
  if (status && statusLabel) {
    chips.push({
      key: 'status',
      tone: 'status',
      label: `Status: ${statusLabel}`,
      removeLabel: 'Remove status filter',
      onRemove: () => updateFilters({ status: undefined }),
    });
  }
  if (!sessionIsDefault) {
    chips.push({
      key: 'session',
      tone: 'session',
      label: `Session: ${sessionLabel.replace(' Legislative Session', '')}`,
      removeLabel: 'Reset to the current session',
      onRemove: () => updateFilters({ session: undefined }),
    });
  }
  if (omnibusOnly) {
    chips.push({
      key: 'omnibus',
      tone: 'omnibus',
      label: 'Omnibus only',
      removeLabel: 'Remove omnibus filter',
      onRemove: () => updateFilters({ omnibus: undefined }),
    });
  }
  for (const issue of selectedIssues) {
    chips.push({
      key: `issue:${issue}`,
      tone: 'issue',
      label: `Issue: ${titleCaseIssue(issue)}`,
      removeLabel: `Remove ${titleCaseIssue(issue)} issue filter`,
      onRemove: () => toggleIssue(issue),
    });
  }

  // Plain-English description of the exact intersection (v2 §E): AND across
  // facets, "either X, Y, or Z" within issues, per-status phrasing; the session
  // always closes the sentence.
  const segments: string[] = [];
  if (query) {
    segments.push(
      isNumberLookup ? `matching bill ${query.trim().toUpperCase()}` : `matching “${query}”`,
    );
  }
  if (selectedIssues.length) {
    const issueLabels = selectedIssues.map((issue) => titleCaseIssue(issue));
    segments.push(
      `tagged ${selectedIssues.length > 1 ? 'either ' : ''}${joinList(issueLabels, 'or')}`,
    );
  }
  if (chamber !== 'All') segments.push(`in the ${chamber}`);
  if (status && STATUS_PHRASE[status]) segments.push(STATUS_PHRASE[status]);
  if (omnibusOnly) segments.push('that are omnibus');
  const resultDescription = segments.length
    ? `${capitalizeFirst(joinList(segments, 'and'))}, in the ${sessionLabel}.`
    : `In the ${sessionLabel}.`;

  // Empty-state chip labels (non-removable summary inside the NoResults card).
  const activeFilters = [sessionLabel, ...chips.map((chip) => chip.label)];

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
          onHoverOption={(value) =>
            prefetchFilter({ chamber: value === 'All' ? undefined : value })
          }
        />
        <FilterDropdown
          label={statusLabel ?? 'All statuses'}
          accessibilityLabel="Filter by status"
          options={STATUS_OPTIONS}
          selectedValue={status}
          active={!!status}
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
          active={!sessionIsDefault}
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
        <FilterEyebrow label="ISSUES" />
        {visiblePolicyOptions.map((option) => {
          const selected = selectedIssues.includes(option.value);
          const nextIssues = selected
            ? selectedIssues.filter((issue) => issue !== option.value)
            : [...selectedIssues, option.value];
          return (
            <FilterPill
              key={option.value}
              label={option.label}
              count={option.count}
              active={selected}
              onPress={() => toggleIssue(option.value)}
              onHoverIn={() =>
                prefetchFilter({ policyAreas: nextIssues.length ? nextIssues : undefined })
              }
            />
          );
        })}
        {hiddenIssueCount > 0 ? (
          <MoreIssuesPill
            expanded={issuesExpanded}
            hiddenCount={hiddenIssueCount}
            onPress={() => setShowAllIssues((value) => !value)}
          />
        ) : null}
      </View>
    </>
  );

  // Sort menu: best-match leads (and is default) only while a query is present;
  // "Most tracked" is a roadmap option — inert, shown once (grounded-answers /
  // house rule: never a "coming soon" label, one clear roadmap marker).
  const sortOptions: SortOption[] = [
    ...(hasQuery ? [{ key: 'best', label: 'Best match' }] : []),
    { key: 'progress', label: 'Legislative progress' },
    { key: 'action', label: 'Latest action' },
    { key: 'tracked', label: 'Most tracked', roadmap: true },
  ];
  const sortControl = (
    <SortControl
      options={sortOptions}
      value={sortKey}
      onSelect={(key) => updateFilters({ sort: key })}
      open={openFilter === 'sort'}
      onOpenChange={(next) => setOpenFilter(next ? 'sort' : null)}
    />
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
      hero={
        <SearchHero
          title="Search bills"
          placeholder="Search by keyword or bill number (e.g. HF 2904, SF 1832)"
          query={queryInput}
          onQueryChange={setQueryInput}
          onSubmit={submitSearch}
          variant="bills"
          helper={<SearchHelperLine />}
          filters={filterRow}
        />
      }
    >
      <FilterChipRow chips={chips} onClearAll={clearFilters} />
      <ResultsHeader
        count={resultCount}
        noun="bills"
        description={resultDescription}
        dataAsOf={metaQuery.data?.dataAsOf}
        sortControl={bills.length > 0 ? sortControl : undefined}
      />

      {billsQuery.isLoading ? (
        <View style={styles.list} accessible accessibilityLabel="Loading bills">
          {SKELETON_ROWS.map((i) => (
            <Skeleton key={i} width="100%" height={148} radius={t.radii.card} />
          ))}
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
                // Track button is roadmap-only for now; hide it on the mobile-web
                // layout to keep the card's top row uncluttered (desktop keeps it).
                showTrackButton={isDesktop}
                // Bill detail now ships as the redesigned mobile screen, so the
                // card routes there (and roll-calls deep-link to its Votes
                // section).
                onPress={() => navigation.navigate('BillDetail', { billId: bill.id })}
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
