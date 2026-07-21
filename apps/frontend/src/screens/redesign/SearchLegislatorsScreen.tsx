import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { theme as t } from '../../theme/tokens';
import { IaItem, MenuKey } from '../../navigation/ia';
import { useAuth } from '../../providers/AuthProvider';
import { useResponsive } from '../../hooks/useResponsive';
import { useLegislators, useMeta, useSessions } from '../../hooks/useAppQueries';
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
  const { signInWithGoogle } = useAuth();
  const { isDesktop } = useResponsive();

  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [openFilter, setOpenFilter] = useState<'party' | 'session' | null>(null);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [chamber, setChamber] = useState<ChamberFilter>('All');
  const [party, setParty] = useState<PartyFilter>('All');
  const [session, setSession] = useState('');
  const [page, setPage] = useState(1);

  const sessionsQuery = useSessions('legislators');
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
    { label: 'DFL', value: 'DFL' },
    { label: 'R', value: 'R' },
    ...(hasIndependent ? [{ label: 'I', value: 'I' }] : []),
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

  const resetToFirstPage = () => setPage(1);

  const submitSearch = () => {
    setQuery(queryInput.trim());
    resetToFirstPage();
  };

  const clearFilters = () => {
    setQueryInput('');
    setQuery('');
    setChamber('All');
    setParty('All');
    resetToFirstPage();
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
        onChange={(value) => {
          setChamber(value);
          resetToFirstPage();
        }}
      />
      <FilterDropdown
        label={partyLabel}
        accessibilityLabel="Filter by party"
        options={partyOptions}
        selectedValue={party}
        open={openFilter === 'party'}
        onOpenChange={(next) => setOpenFilter(next ? 'party' : null)}
        onSelect={(value) => {
          setParty(value as PartyFilter);
          resetToFirstPage();
        }}
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
        onSelect={(value) => {
          setSession(value);
          resetToFirstPage();
        }}
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
        <View style={styles.stateBox}>
          <ActivityIndicator color={t.colors.brand.base} />
          <Text style={styles.stateText}>Loading legislators…</Text>
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
                  // Legislator profile is an old-design page — cards stay
                  // visible but don't route anywhere until its new design ships.
                  onPress={() => {}}
                />
              </View>
            ))}
          </View>
          <Pagination
            page={safePage}
            totalPages={totalPages}
            hasPrev={safePage > 1}
            hasNext={safePage < totalPages}
            onPrev={() => setPage(Math.max(1, safePage - 1))}
            onNext={() => setPage(safePage + 1)}
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
