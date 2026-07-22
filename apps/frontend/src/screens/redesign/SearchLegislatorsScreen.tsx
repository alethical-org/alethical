import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { theme as t } from '../../theme/tokens';
import { IaItem, MenuKey } from '../../navigation/ia';
import { useAuth } from '../../providers/AuthProvider';
import { useResponsive } from '../../hooks/useResponsive';
import { useLegislators, useMeta, useSessions } from '../../hooks/useAppQueries';
import { useDebouncedSearchCommit } from '../../hooks/useDebouncedSearchCommit';
import { LegislatorResultCard } from '../../components/search/LegislatorResultCard';
import {
  ChamberFilter,
  ChamberSegmented,
  FilterDropdown,
  NoResults,
  Pagination,
  ResultsHeader,
  SearchHero,
  SearchPageShell,
  SESSION_LABEL_FALLBACK,
  formatSessionLabel,
} from '../../components/search/searchPieces';
import { Skeleton } from '../../components/Skeleton';

// Placeholder cards shown while the first page of legislators loads.
const SKELETON_CARDS = [0, 1, 2, 3, 4, 5];

// Search Legislators (docs/mockups/search-legislators). Name / district / party
// search over the current session with chamber + party + session filters and a
// browsable 2-column card grid. No follow/track, no sign-in modal, no toast.

const PAGE_SIZE = 12;

type PartyFilter = 'All' | 'DFL' | 'R' | 'I';

function matchesParty(filter: PartyFilter, stored: string): boolean {
  return filter === 'All' || stored === filter;
}

export function SearchLegislatorsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { signInWithGoogle } = useAuth();
  const { isDesktop } = useResponsive();

  // URL-addressable filter state, mirroring Search Bills: filters live in the
  // /legislators query string so a filtered roster is shareable, reload-safe,
  // and survives the browser Back button after visiting a legislator profile.
  // The route params are the single source of truth; only the search-box draft
  // and open-menu/dropdown state are local.
  const params: Record<string, unknown> = route.params ?? {};
  const query = typeof params.q === 'string' ? params.q : '';
  const chamber: ChamberFilter =
    params.chamber === 'House' || params.chamber === 'Senate' ? params.chamber : 'All';
  const party: PartyFilter =
    params.party === 'DFL' || params.party === 'R' || params.party === 'I' ? params.party : 'All';
  const session = typeof params.session === 'string' ? params.session : '';
  const page = Math.max(1, Number.parseInt(String(params.page ?? ''), 10) || 1);

  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [openFilter, setOpenFilter] = useState<'party' | 'session' | null>(null);
  const [queryInput, setQueryInput] = useState(query);

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

  // The list API serves the full roster (no server pagination); chamber + party
  // filtering and paging happen client-side.
  const legislatorsQuery = useLegislators(query || undefined, sessionSlug || undefined, {});
  const metaQuery = useMeta();

  const allLegislators = legislatorsQuery.data ?? [];
  const hasIndependent = allLegislators.some((legislator) => legislator.party === 'I');
  const partyOptions = [
    { label: 'All parties', value: 'All' },
    { label: 'Democratic-Farmer-Labor', value: 'DFL' },
    { label: 'Republican', value: 'R' },
    ...(hasIndependent ? [{ label: 'Independent', value: 'I' }] : []),
  ];
  const partyLabel = partyOptions.find((option) => option.value === party)?.label ?? 'All parties';

  const filtered = allLegislators
    .filter(
      (legislator) =>
        (chamber === 'All' || legislator.chamber === chamber) &&
        matchesParty(party, legislator.party),
    )
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const submitSearch = () => {
    updateFilters({ q: queryInput.trim() || undefined });
  };

  // Search as the user types: push the debounced draft into the URL so results
  // update without pressing Enter or the Search button (which still submit
  // immediately via submitSearch).
  useDebouncedSearchCommit(queryInput, query, (value) => updateFilters({ q: value || undefined }));

  // Mirror the prior Clear: reset keyword/chamber/party/page but keep the
  // chosen session (matches Search Bills clearFilters).
  const clearFilters = () => {
    updateFilters({ q: undefined, chamber: undefined, party: undefined });
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
    <View style={styles.filterRow}>
      <ChamberSegmented
        value={chamber}
        onChange={(value) => updateFilters({ chamber: value === 'All' ? undefined : value })}
      />
      <FilterDropdown
        label={partyLabel}
        accessibilityLabel="Filter by party"
        options={partyOptions}
        selectedValue={party}
        open={openFilter === 'party'}
        onOpenChange={(next) => setOpenFilter(next ? 'party' : null)}
        onSelect={(value) => updateFilters({ party: value === 'All' ? undefined : value })}
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
    </View>
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
          title="Search legislators"
          placeholder="Search by name, district, or party"
          query={queryInput}
          onQueryChange={setQueryInput}
          onSubmit={submitSearch}
          variant="legislators"
          // Find My Legislator is on the roadmap — the link stays visible but
          // doesn't route anywhere yet.
          onFindByAddress={() => {}}
          filters={filterRow}
        />
      }
    >
      <ResultsHeader
        count={filtered.length}
        noun="legislators"
        sortLabel="Sorted by name (A–Z)"
        dataAsOf={metaQuery.data?.dataAsOf}
      />

      {legislatorsQuery.isLoading ? (
        <View style={styles.grid} accessible accessibilityLabel="Loading legislators">
          {SKELETON_CARDS.map((i) => (
            <View key={i} style={isDesktop ? styles.gridItem : styles.gridItemMobile}>
              <Skeleton width="100%" height={132} radius={t.radii.card} />
            </View>
          ))}
        </View>
      ) : legislatorsQuery.isError ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>
            We couldn’t load legislators right now. Please try again in a moment.
          </Text>
        </View>
      ) : filtered.length === 0 ? (
        <NoResults variant="legislators" total={allLegislators.length} onClear={clearFilters} />
      ) : (
        <>
          <View style={styles.grid}>
            {paged.map((legislator) => (
              <View key={legislator.id} style={isDesktop ? styles.gridItem : styles.gridItemMobile}>
                <LegislatorResultCard
                  legislator={legislator}
                  onPress={() =>
                    navigation.navigate('LegislatorProfile', {
                      legislatorId: legislator.id,
                    })
                  }
                />
              </View>
            ))}
          </View>
          <Pagination
            page={safePage}
            totalPages={totalPages}
            hasPrev={safePage > 1}
            hasNext={safePage < totalPages}
            onPrev={() =>
              navigation.setParams({ page: safePage > 2 ? String(safePage - 1) : undefined })
            }
            onNext={() => navigation.setParams({ page: String(safePage + 1) })}
          />
        </>
      )}
    </SearchPageShell>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  grid: { marginTop: 22, flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  gridItem: { flexBasis: '48%', flexGrow: 1, minWidth: 0 },
  gridItemMobile: { flexBasis: '100%', width: '100%' },
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
