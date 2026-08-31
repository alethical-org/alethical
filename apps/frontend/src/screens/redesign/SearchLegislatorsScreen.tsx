import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { theme as t } from '../../theme/tokens';
import { IaItem, MenuKey } from '../../navigation/ia';
import { recordSiteMetricEvent } from '../../lib/siteMetricEvents';
import { useAuth } from '../../providers/AuthProvider';
import { useResponsive } from '../../hooks/useResponsive';
import { usePaginatedListScroll } from '../../hooks/usePaginatedListScroll';
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
} from '../../components/search/searchPieces';
import { formatSessionLabel, SESSION_LABEL_FALLBACK } from '../../lib/sessionLabel';
import { sessionFilterForApi } from '../../lib/sessionFilterForApi';
import {
  LEGISLATOR_SEARCH_LABEL,
  LEGISLATOR_PAGE_SIZE,
  clearAllLegislatorSearchParams,
  clearLegislatorFilterParams,
  clearLegislatorSearchParams,
  deriveLegislatorEmptyState,
  filterLegislatorsByName,
  isLegislatorPortraitEager,
  paginateLegislatorResults,
} from '../../lib/legislatorSearch';
import {
  deriveLegislatorRosterHeader,
  type LegislatorPartyFilter,
} from '../../lib/legislatorRosterHeader';
import { Skeleton } from '../../components/Skeleton';
import { linkProps, routePath } from '../../navigation/links';
import {
  compareLegislatorNames,
  directoryJumpPages,
  directoryPageNumber,
  directoryPagePath,
  LEGISLATOR_DIRECTORY_HEADING,
  loadedDirectoryPageIsOutOfRange,
} from '../../lib/directoryPagination';

// Placeholder cards shown while the first page of legislators loads.
const SKELETON_CARDS = [0, 1, 2, 3, 4, 5];

function FindMyLegislatorLink({ mobile, onPress }: { mobile?: boolean; onPress: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      {...linkProps(routePath.findMyLegislator(), onPress)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.addressLink, mobile && styles.addressLinkMobile]}
    >
      <Text style={[styles.addressLinkText, hovered && styles.addressLinkTextHover]}>
        Find your legislator by address
      </Text>
      <Text aria-hidden style={styles.addressLinkArrow}>
        →
      </Text>
    </Pressable>
  );
}

// Search Legislators (docs/architecture/frontend-screen-system-design.md §7). Name search over the
// current session with chamber + party + session filters and a
// browsable 2-column card grid. No follow/track, no sign-in modal, no toast.

export function SearchLegislatorsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { isDesktop, isMobile } = useResponsive();
  const { scrollAnchorProps, onPageChange } = usePaginatedListScroll();

  // URL-addressable filter state, mirroring Search Bills: filters live in the
  // /legislators query string so a filtered roster is shareable, reload-safe,
  // and survives the browser Back button after visiting a legislator profile.
  // The route params are the single source of truth; only the search-box draft
  // and open-menu/dropdown state are local.
  const params: Record<string, unknown> = route.params ?? {};
  const query = typeof params.q === 'string' ? params.q : '';
  const chamber: ChamberFilter =
    params.chamber === 'House' || params.chamber === 'Senate' ? params.chamber : 'All';
  const party: LegislatorPartyFilter =
    params.party === 'DFL' || params.party === 'R' || params.party === 'I' ? params.party : 'All';
  const session = typeof params.session === 'string' ? params.session : '';
  const page = directoryPageNumber(params.page == null ? undefined : String(params.page));
  const defaultDirectory =
    query.trim().length === 0 && chamber === 'All' && party === 'All' && session.length === 0;

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
  const currentSession = sessionsQuery.data?.find((item) => item.isCurrent);
  const defaultSession = currentSession ?? sessionsQuery.data?.[0];
  const sessionSlug = session || defaultSession?.slug || '';
  const apiSession = sessionFilterForApi(session);
  const selectedSession = sessionsQuery.data?.find((item) => item.slug === sessionSlug);
  const sessionLabel = selectedSession
    ? formatSessionLabel(selectedSession)
    : SESSION_LABEL_FALLBACK;

  // The complete selected-session roster is read once. Name, chamber, party, and
  // paging choices then update from the saved roster without another request.
  const rosterQuery = useLegislators(undefined, apiSession, {});
  const metaQuery = useMeta();

  const allLegislators = rosterQuery.data ?? [];
  const matchingLegislators = filterLegislatorsByName(allLegislators, query);
  const hasIndependent = matchingLegislators.some((legislator) => legislator.party === 'I');
  const partyOptions = [
    { label: 'All parties', value: 'All' },
    { label: 'Democratic-Farmer-Labor', value: 'DFL' },
    { label: 'Republican', value: 'R' },
    ...(hasIndependent ? [{ label: 'Independent', value: 'I' }] : []),
  ];
  const partyLabel = partyOptions.find((option) => option.value === party)?.label ?? 'All parties';

  const rosterHeader = deriveLegislatorRosterHeader(matchingLegislators, {
    chamber,
    party,
    query,
    queryInput,
    sessionSlug,
    currentSessionSlug: currentSession?.slug,
    rosterLoaded: rosterQuery.isSuccess,
  });
  const filtered = rosterHeader.displayedOfficeholders.slice().sort(compareLegislatorNames);
  const recordedSearches = useRef(new Set<string>());

  useEffect(() => {
    const value = query.trim();
    const key = `${apiSession ?? 'current'}:${value.toLocaleLowerCase('en-US')}`;
    if (
      !value ||
      page !== 1 ||
      !rosterQuery.isSuccess ||
      matchingLegislators.length < 1 ||
      recordedSearches.current.has(key)
    ) {
      return;
    }
    recordedSearches.current.add(key);
    recordSiteMetricEvent('legislator_search_with_results');
  }, [apiSession, matchingLegislators.length, page, query, rosterQuery.isSuccess]);

  const pagination = paginateLegislatorResults(filtered, page);

  // Match the real 404 in the first response. The old client-side clamp quietly
  // changed a missing page into the last roster page after the app loaded.
  useEffect(() => {
    if (
      loadedDirectoryPageIsOutOfRange({
        isSuccess: rosterQuery.isSuccess,
        isDefaultDirectory: defaultDirectory,
        page,
        total: filtered.length,
        pageSize: LEGISLATOR_PAGE_SIZE,
      })
    ) {
      navigation.replace('NotFound', { path: directoryPagePath('/legislators', page) });
    }
  }, [defaultDirectory, filtered.length, navigation, page, rosterQuery.isSuccess]);

  const submitSearch = () => {
    updateFilters({ q: queryInput.trim() || undefined });
  };

  // Search as the user types: push the debounced draft into the URL so results
  // update without pressing Enter or the Search button (which still submit
  // immediately via submitSearch).
  useDebouncedSearchCommit(queryInput, query, (value) => updateFilters({ q: value || undefined }));

  const clearSearch = () => {
    setQueryInput('');
    updateFilters(clearLegislatorSearchParams());
  };

  // Clear only narrowing filters and keep the chosen session.
  const clearFilters = () => {
    updateFilters(clearLegislatorFilterParams());
  };

  const clearAll = () => {
    updateFilters(clearAllLegislatorSearchParams());
  };

  const emptyState = deriveLegislatorEmptyState({
    query,
    chamber,
    party,
    hasSessionData: (rosterQuery.data?.length ?? 0) > 0,
  });
  const clearEmptyState =
    emptyState?.action === 'Clear search'
      ? clearSearch
      : emptyState?.action === 'Clear all'
        ? clearAll
        : clearFilters;

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

  const addressLink = (
    <FindMyLegislatorLink
      mobile={isMobile}
      onPress={() => navigation.navigate('FindMyLegislator')}
    />
  );

  const filterRow = (
    <View style={styles.filterRow}>
      <ChamberSegmented
        value={chamber}
        counts={rosterHeader.chamberCounts}
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
          label: formatSessionLabel(item),
          value: item.slug,
        }))}
        selectedValue={sessionSlug}
        open={openFilter === 'session'}
        onOpenChange={(next) => setOpenFilter(next ? 'session' : null)}
        onSelect={(value) => updateFilters({ session: value || undefined })}
      />
      {!isMobile ? addressLink : null}
    </View>
  );

  return (
    <SearchPageShell
      openMenu={openMenu}
      onOpenMenuChange={setOpenMenu}
      onNavigate={handleNavigate}
      onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
      onPrivacy={() => navigation.navigate('Privacy')}
      onTerms={() => navigation.navigate('Terms')}
      hero={
        <SearchHero
          title={LEGISLATOR_DIRECTORY_HEADING}
          placeholder={LEGISLATOR_SEARCH_LABEL}
          query={queryInput}
          onQueryChange={setQueryInput}
          onClear={clearSearch}
          onSubmit={submitSearch}
          variant="legislators"
          helper={isMobile ? addressLink : undefined}
          filters={filterRow}
        />
      }
    >
      <ResultsHeader
        {...scrollAnchorProps}
        count={filtered.length}
        // Singular; ResultsHeader pluralizes it, so one result reads "1 legislator".
        noun="legislator"
        sortLabel="Sorted by name (A–Z)"
        dataAsOf={metaQuery.data?.dataAsOf}
        uniformDetails
        showRosterNote={rosterHeader.unnarrowed}
      />

      {rosterQuery.isLoading ? (
        <View style={styles.grid} accessible accessibilityLabel="Loading legislators">
          {SKELETON_CARDS.map((i) => (
            <View key={i} style={isDesktop ? styles.gridItem : styles.gridItemMobile}>
              <Skeleton width="100%" height={132} radius={t.radii.card} />
            </View>
          ))}
        </View>
      ) : rosterQuery.isError ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>
            We couldn’t load legislators right now. Please try again in a moment.
          </Text>
        </View>
      ) : filtered.length === 0 && !emptyState ? (
        <View style={styles.stateBox} accessibilityLiveRegion="polite">
          <Text style={styles.stateText}>No legislator data is available for this session.</Text>
        </View>
      ) : filtered.length === 0 ? (
        <NoResults
          variant="legislators"
          legislatorState={emptyState ?? undefined}
          onClear={clearEmptyState}
        />
      ) : (
        <>
          <View style={styles.grid}>
            {pagination.items.map((legislator, cardIndex) => (
              <View key={legislator.id} style={isDesktop ? styles.gridItem : styles.gridItemMobile}>
                <LegislatorResultCard
                  legislator={legislator}
                  portraitEager={isLegislatorPortraitEager(cardIndex, isDesktop)}
                  onPress={() =>
                    navigation.navigate('LegislatorProfile', {
                      legislatorId: legislator.slug ?? legislator.id,
                    })
                  }
                />
              </View>
            ))}
          </View>
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            hasPrev={pagination.page > 1}
            hasNext={pagination.page < pagination.totalPages}
            onPrev={() =>
              navigation.setParams({
                page: pagination.page > 2 ? String(pagination.page - 1) : undefined,
              })
            }
            onNext={() => navigation.setParams({ page: String(pagination.page + 1) })}
            onPageChange={onPageChange}
            prevHref={
              defaultDirectory && pagination.page > 1
                ? directoryPagePath('/legislators', pagination.page - 1)
                : undefined
            }
            nextHref={
              defaultDirectory && pagination.page < pagination.totalPages
                ? directoryPagePath('/legislators', pagination.page + 1)
                : undefined
            }
            jumpPages={
              defaultDirectory
                ? directoryJumpPages(pagination.page, pagination.totalPages)
                : undefined
            }
            pageHref={(target) => directoryPagePath('/legislators', target)}
            onPageSelect={(target) =>
              navigation.setParams({ page: target > 1 ? String(target) : undefined })
            }
          />
        </>
      )}
    </SearchPageShell>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  addressLink: {
    minHeight: 44,
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  addressLinkMobile: { marginLeft: 0, alignSelf: 'flex-start' },
  addressLinkText: {
    fontFamily: t.typography.body,
    fontSize: 14,
    fontWeight: t.fontWeights.bold,
    color: '#0f7a45',
  },
  addressLinkTextHover: { textDecorationLine: 'underline' },
  addressLinkArrow: {
    fontFamily: t.typography.body,
    fontSize: 14,
    fontWeight: t.fontWeights.regular,
    color: '#0f7a45',
  },
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
