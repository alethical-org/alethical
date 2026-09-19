import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { MoneyNameSearchField } from '../../components/campaignMoney/MoneyNameSearchField';
import { LinkArrowLabel } from '../../components/LinkArrow';
import { PageContextLabel } from '../../components/PageContextLabel';
import { Pagination } from '../../components/search/searchPieces';
import { useDebouncedSearchCommit } from '../../hooks/useDebouncedSearchCommit';
import { useHistoryScrollRestoration } from '../../hooks/useHistoryScrollRestoration';
import { useLobbyingPrincipals } from '../../hooks/useLobbying';
import { useResponsive } from '../../hooks/useResponsive';
import { committeeSlug } from '../../lib/committeeMoneyShared';
import {
  directoryPageNumber,
  directoryTotalPages,
  loadedDirectoryPageIsOutOfRange,
} from '../../lib/directoryPagination';
import {
  LOBBYING_DIRECTORY_COPY as copy,
  LOBBYING_DIRECTORY_PAGE_SIZE,
  lobbyingLatestYear,
  lobbyingLobbyistDirectoryDate,
  lobbyingNoSpendingRows,
  lobbyingPrincipalDirectoryScope,
  lobbyingShowingLine,
  type LobbyingDirectoryKind,
} from '../../lib/lobbyingDirectoryCopy';
import { LOBBYING_DEFAULT_DONATION_SORT, type LobbyingListPage } from '../../lib/lobbyingTypes';
import { lobbyingPageMetadata } from '../../lib/lobbyingMetadata';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';
import { centralDateLabel } from '../../lib/moneyLanding';

type DirectoryNavigation = Pick<
  RootScreenProps<'LobbyingPrincipals'>['navigation'],
  'navigate' | 'push' | 'replace' | 'setParams'
>;
export interface LobbyingDirectoryRow {
  id: string;
  name: string;
  slug: string;
  linkable: boolean;
  meta: string | null;
  year?: string;
}

/** Shared directory behavior keeps the name filter and numbered page in the address. */
export function LobbyingDirectoryPage({
  navigation,
  kind,
  query,
  page,
  result,
  rows,
  year,
  navigationYear,
  sort,
  responseMatches = true,
  retainResults = false,
  renderResults,
}: {
  navigation: DirectoryNavigation;
  kind: LobbyingDirectoryKind;
  query: string;
  page: number;
  result: {
    data?: LobbyingListPage & { latest_reported_year?: number | null };
    isPending: boolean;
    isSuccess: boolean;
    isError: boolean;
    refetch: () => unknown;
  };
  rows: LobbyingDirectoryRow[];
  year?: string;
  navigationYear?: string;
  sort?: string;
  responseMatches?: boolean;
  /** Opt-in only for the lobbyist screen, which retains a whole successful response. */
  retainResults?: boolean;
  /** The lobbyist directory draws its own results card; principals keep this one. */
  renderResults?: (state: {
    countLine: string | null;
    total: number | null;
    pending: boolean;
    failed: boolean;
    resultsRef: RefObject<View | null>;
    emptyPage: boolean;
    firstPageHref: string;
    onFirstPage: () => void;
    onRetry: () => void;
    pagination: ReactNode;
  }) => ReactNode;
}) {
  const { width, isMobile, isTablet } = useResponsive();
  const lobbyists = kind === 'lobbyists';
  // The narrowest phones take a tighter gutter and a step down in display type.
  const narrow = isMobile && width > 0 && width < 360;
  const words = copy[kind];
  const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);
  const applyQuery = (q: string) =>
    navigation.setParams({
      q: q || undefined,
      page: undefined,
      ...(kind === 'lobbyists' && (year ?? navigationYear) ? { year: year ?? navigationYear } : {}),
    });
  useDebouncedSearchCommit(draft, query, applyQuery);
  const address = (target: number) =>
    kind === 'principals'
      ? routePath.lobbyingPrincipals({
          q: query || undefined,
          page: target > 1 ? String(target) : undefined,
        })
      : routePath.lobbyingLobbyists({
          year: year ?? navigationYear,
          sort,
          q: query || undefined,
          page: target > 1 ? String(target) : undefined,
        });
  useDocumentTitle(
    address(page).split('?')[0],
    lobbyingPageMetadata(address(page), words.title, {
      kind: 'directory',
      page,
      noindex: Boolean(query.trim() || year || (sort && sort !== LOBBYING_DEFAULT_DONATION_SORT)),
    }).title,
  );
  // A previous name/page's absence must never appear under the current name field.
  const data =
    retainResults ||
    (responseMatches &&
      result.data?.q === query.trim() &&
      result.data?.offset === (page - 1) * LOBBYING_DIRECTORY_PAGE_SIZE)
      ? result.data
      : null;
  const displayedPage = data ? Math.floor(data.offset / LOBBYING_DIRECTORY_PAGE_SIZE) + 1 : page;
  const replacing = retainResults && (!responseMatches || result.isPending || result.isError);
  const pending = !retainResults && (result.isPending || (!data && !result.isError));
  const served = data?.state === 'reported' || data?.state === 'not_reported';
  const total = served ? data.total : null;
  const totalPages =
    total == null ? null : directoryTotalPages(total, LOBBYING_DIRECTORY_PAGE_SIZE);
  const outOfRange = loadedDirectoryPageIsOutOfRange({
    isSuccess: result.isSuccess && served && responseMatches,
    isDefaultDirectory: !query.trim(),
    page,
    total,
    pageSize: LOBBYING_DIRECTORY_PAGE_SIZE,
  });
  useEffect(() => {
    if (outOfRange) navigation.replace('NotFound', { path: address(page) });
  }, [outOfRange, navigation, kind, page, query]);
  // Previous and Next sit below the last row, so the reader lands at the foot of a
  // page they have not seen. Bringing the card back means the count, the controls
  // and the first row are all on screen again, and focus follows the view so a
  // keyboard reader is not left on a control that scrolled away. Browser Back is
  // not a page change and keeps the position the browser restored; changing the
  // name, year or order does not scroll, because the reader is looking at the
  // control that did it.
  const resultsRef = useRef<View>(null);
  const selectionKey = JSON.stringify([query, page, year ?? navigationYear, sort]);
  const pagedFrom = useRef<{ key: string; trigger: Element | null } | null>(null);
  useEffect(() => {
    const requested = pagedFrom.current;
    if (!requested) return;
    if (requested.key !== selectionKey) {
      pagedFrom.current = null;
      return;
    }
    if (!lobbyists || !data || !responseMatches || result.isError) return;
    pagedFrom.current = null;
    // A reader who moved to another control while waiting keeps their focus.
    if (
      typeof document !== 'undefined' &&
      document.activeElement !== document.body &&
      document.activeElement !== requested.trigger
    )
      return;
    const node = resultsRef.current as unknown as HTMLElement | null;
    node?.scrollIntoView?.({ block: 'start' });
    node?.focus?.({ preventScroll: true });
  }, [data, lobbyists, responseMatches, result.isError, selectionKey]);
  const goToPage = (target: number) => {
    if (lobbyists)
      pagedFrom.current = {
        key: JSON.stringify([query, target, year ?? navigationYear, sort]),
        trigger: typeof document !== 'undefined' ? document.activeElement : null,
      };
    navigation.setParams({
      page: target > 1 ? String(target) : undefined,
      ...(kind === 'lobbyists' && (year ?? navigationYear) ? { year: year ?? navigationYear } : {}),
    });
  };
  const introSize = lobbyists
    ? isMobile
      ? narrow
        ? 16
        : 17
      : isTablet
        ? 18
        : 19
    : isMobile || isTablet
      ? 16
      : 17;
  const bodySize = isMobile || isTablet ? 16 : 17;
  const body = { fontSize: bodySize, lineHeight: bodySize * 1.55 };
  const intro = { fontSize: introSize, lineHeight: introSize * 1.55 };
  const titleSize = lobbyists
    ? isMobile
      ? narrow
        ? 28
        : 30
      : isTablet
        ? 36
        : 44
    : isMobile
      ? 30
      : isTablet
        ? 38
        : 46;
  const directoryContext =
    kind === 'lobbyists'
      ? lobbyingLobbyistDirectoryDate(data?.copied_at, centralDateLabel)
      : lobbyingPrincipalDirectoryScope(
          data?.latest_reported_year,
          data?.copied_at,
          centralDateLabel,
        );
  // Browser Back restores the four address values on its own; the shared
  // hook supplies the place in the list, which a nested scroller loses.
  const scrollRestoration = useHistoryScrollRestoration(!pending);
  const cardPadding = isMobile
    ? { paddingVertical: 20, paddingHorizontal: 18 }
    : isTablet
      ? { paddingTop: 26, paddingHorizontal: 26, paddingBottom: 24 }
      : { paddingTop: 30, paddingHorizontal: 32, paddingBottom: 28 };
  return (
    <PageBackground>
      <ScrollView {...(lobbyists ? scrollRestoration : {})} contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <Container
          style={[
            styles.main,
            { paddingHorizontal: isMobile ? (narrow && lobbyists ? 16 : 20) : isTablet ? 32 : 56 },
            lobbyists && styles.lobbyistColumn,
            lobbyists && { paddingBottom: isMobile ? 48 : isTablet ? 56 : 72 },
          ]}
        >
          <Pressable
            {...linkProps(routePath.lobbying(), () => navigation.navigate('LobbyingLanding'))}
            style={styles.back}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
              <Path d="M15 5 L8 12 L15 19" fill="none" stroke="#4f5651" strokeWidth={2.2} />
            </Svg>
            <Text style={styles.backText}>{copy.back}</Text>
          </Pressable>
          {kind === 'principals' ? (
            <PageContextLabel style={styles.eyebrow}>{copy.directoryLabel}</PageContextLabel>
          ) : null}
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[
              styles.h1,
              kind === 'lobbyists' && styles.h1WithoutEyebrow,
              { fontSize: titleSize, lineHeight: titleSize * 1.08 },
            ]}
          >
            {words.title}
          </Text>
          <Text
            style={[
              styles.intro,
              lobbyists ? intro : body,
              lobbyists && styles.lobbyistIntro,
              lobbyists && !isMobile && { maxWidth: isTablet ? 640 : 720 },
            ]}
          >
            {words.intro}
          </Text>
          {kind === 'principals' ? (
            <Text style={[styles.education, body]}>{copy.principals.definition}</Text>
          ) : null}
          {directoryContext ? (
            <Text style={lobbyists ? styles.registrationDate : [styles.directoryContext, body]}>
              {directoryContext}
            </Text>
          ) : null}
          <View style={styles.filter}>
            <MoneyNameSearchField
              value={draft}
              onChangeText={setDraft}
              onSubmit={() => applyQuery(draft.trim())}
              label={words.searchLabel}
              labelStyle={styles.filterLabel}
              placeholder={lobbyists ? copy.lobbyists.searchPlaceholder : copy.filter}
              maxWidth={lobbyists ? (isMobile ? width || 640 : isTablet ? 480 : 520) : 640}
              fieldHeight={lobbyists ? (isMobile ? 52 : isTablet ? 56 : 60) : 52}
              fieldFontSize={bodySize}
              showClear={lobbyists}
            />
            <Text style={styles.filterNote}>
              {lobbyists ? copy.lobbyists.searchHelp : copy.filterNote}
            </Text>
          </View>
          {renderResults ? (
            renderResults({
              // A failed read establishes no count, so the slot stays empty rather
              // than printing a figure or a zero nobody measured.
              countLine: pending
                ? words.loading
                : total != null
                  ? lobbyingShowingLine(kind, displayedPage, rows.length, total)
                  : null,
              total,
              pending,
              failed:
                !pending && (!served || (!retainResults && result.isError && rows.length === 0)),
              resultsRef,
              emptyPage: total != null && total > 0,
              firstPageHref: address(1),
              onFirstPage: () => goToPage(1),
              onRetry: () => void result.refetch(),
              pagination:
                served && !pending ? (
                  <Pagination
                    variant="lobbying"
                    page={displayedPage}
                    disabled={replacing}
                    totalPages={totalPages ?? undefined}
                    hasPrev={displayedPage > 1}
                    hasNext={
                      totalPages != null ? displayedPage < totalPages : (data?.has_more ?? false)
                    }
                    onPrev={() => goToPage(page - 1)}
                    onNext={() => goToPage(page + 1)}
                    prevHref={page > 1 ? address(page - 1) : undefined}
                    nextHref={
                      totalPages != null && page < totalPages ? address(page + 1) : undefined
                    }
                  />
                ) : null,
            })
          ) : (
            <>
              {pending ? (
                <View role="status" aria-busy style={[styles.card, cardPadding]}>
                  <Text style={[styles.body, body]}>{words.loading}</Text>
                </View>
              ) : !served || (result.isError && rows.length === 0) ? (
                <View style={[styles.card, cardPadding]}>
                  <Text accessibilityRole="alert" style={[styles.body, body]}>
                    {words.unavailable}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void result.refetch()}
                    style={styles.retry}
                  >
                    <Text style={styles.retryText}>{copy.retry}</Text>
                  </Pressable>
                </View>
              ) : (
                <View>
                  <View style={styles.listHead}>
                    {total != null ? (
                      <Text style={styles.count}>
                        {lobbyingShowingLine(kind, page, rows.length, total)}
                      </Text>
                    ) : null}
                    {rows.length > 0 ? <Text style={styles.order}>{copy.order}</Text> : null}
                  </View>
                  {rows.length === 0 ? (
                    <View role="status" style={[styles.card, styles.emptyCard, cardPadding]}>
                      <Text
                        style={[
                          styles.emptyTitle,
                          { fontSize: isMobile ? 20 : isTablet ? 22 : 24 },
                        ]}
                      >
                        {total != null && total > 0 ? copy.emptyPage : words.empty}
                      </Text>
                      {total != null && total > 0 ? (
                        <Pressable
                          {...linkProps(address(1), () => goToPage(1))}
                          style={styles.retry}
                        >
                          <Text style={styles.retryText}>{copy.firstPage}</Text>
                        </Pressable>
                      ) : (
                        <Text style={[styles.explanation, body]}>{copy.noMatchWhy}</Text>
                      )}
                    </View>
                  ) : (
                    <View role="list" style={styles.list}>
                      {rows.map((row) => {
                        const contents = (
                          <>
                            <View style={styles.rowText}>
                              {row.linkable ? (
                                <LinkArrowLabel label={row.name} style={[styles.rowName, body]} />
                              ) : (
                                <Text style={[styles.rowName, body]}>{row.name}</Text>
                              )}
                              {row.meta ? <Text style={styles.rowMeta}>{row.meta}</Text> : null}
                            </View>
                          </>
                        );
                        const href =
                          kind === 'principals'
                            ? routePath.lobbyingPrincipal(row.slug)
                            : routePath.lobbyingLobbyist(row.slug, row.year);
                        const open = () =>
                          kind === 'principals'
                            ? navigation.push('LobbyingPrincipal', { slug: row.slug })
                            : navigation.push('LobbyingLobbyist', {
                                slug: row.slug,
                                ...(row.year ? { year: row.year } : {}),
                              });
                        return (
                          <View role="listitem" key={row.id}>
                            {row.linkable ? (
                              <Pressable {...linkProps(href, open)} style={styles.row}>
                                {contents}
                              </Pressable>
                            ) : (
                              <View style={styles.row}>{contents}</View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                  <Pagination
                    variant="lobbying"
                    page={page}
                    totalPages={totalPages ?? undefined}
                    hasPrev={page > 1}
                    hasNext={totalPages != null ? page < totalPages : data.has_more}
                    onPrev={() => goToPage(page - 1)}
                    onNext={() => goToPage(page + 1)}
                    prevHref={page > 1 ? address(page - 1) : undefined}
                    nextHref={
                      totalPages != null && page < totalPages ? address(page + 1) : undefined
                    }
                  />
                </View>
              )}
            </>
          )}
        </Container>
        <Footer />
      </ScrollView>
    </PageBackground>
  );
}

export function LobbyingPrincipalsScreen({
  navigation,
  route,
}: RootScreenProps<'LobbyingPrincipals'>) {
  const query = typeof route.params?.q === 'string' ? route.params.q : '';
  const page = directoryPageNumber(route.params?.page);
  const result = useLobbyingPrincipals({ q: query.trim() || undefined, page });
  const rows = (result.data?.principals ?? []).map((row) => ({
    id: String(row.entity_id),
    name: row.name,
    slug: committeeSlug(row.name, String(row.entity_id)),
    linkable: row.linkable && row.state === 'reported',
    meta:
      row.linkable && row.state === 'reported'
        ? lobbyingLatestYear(row.latest_reported_year)
        : lobbyingNoSpendingRows(result.data?.latest_reported_year ?? null),
  }));
  return (
    <LobbyingDirectoryPage
      navigation={navigation}
      kind="principals"
      query={query}
      page={page}
      result={result}
      rows={rows}
    />
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  main: { paddingTop: 28, paddingBottom: 40, flexGrow: 1 },
  // The drawn 1000-wide computer column, kept at the left edge the shared header
  // and every other money page start from rather than centred as the drawing's own
  // imitation header allowed.
  lobbyistColumn: { maxWidth: 1112 },
  // A 2-line paragraph risks a 1-word last line; the browser balances it instead.
  lobbyistIntro: { ...({ textWrap: 'pretty' } as object) },
  // Both record dates take the same quiet treatment, each standing against the
  // records it dates. This one belongs to the list of registered lobbyists; the
  // campaign file's own date sits inside the results card.
  registrationDate: {
    marginTop: 8,
    maxWidth: 720,
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    color: '#656c66',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  back: {
    alignSelf: 'flex-start',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  backText: { fontFamily: t.typography.body, color: '#4f5651', fontSize: 16, fontWeight: '600' },
  eyebrow: {
    marginTop: 14,
    color: '#0f7a45',
    fontFamily: t.typography.body,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2.6,
  },
  h1: {
    marginTop: 12,
    color: '#11150f',
    fontFamily: t.typography.title,
    fontWeight: '800',
    letterSpacing: -1.2,
  },
  h1WithoutEyebrow: { marginTop: 14 },
  intro: { marginTop: 12, maxWidth: 860, color: '#4f5651', fontFamily: t.typography.body },
  education: { marginTop: 12, maxWidth: 860, color: '#4f5651', fontFamily: t.typography.body },
  directoryContext: {
    marginTop: 8,
    maxWidth: 920,
    color: '#4f5651',
    fontFamily: t.typography.body,
  },
  filter: { marginTop: 22, maxWidth: 640 },
  filterLabel: {
    fontFamily: t.typography.body,
    fontSize: 16,
    letterSpacing: 0,
    textTransform: 'none',
    fontWeight: '800',
    color: '#2c322c',
    marginBottom: 9,
  },
  filterNote: {
    marginTop: 9,
    color: '#656c66',
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
  body: { color: '#4f5651', fontFamily: t.typography.body },
  card: {
    marginTop: 22,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.08)',
    borderRadius: 16,
    boxShadow: '0 8px 24px rgba(17,21,15,0.05)',
  },
  emptyCard: { marginTop: 8 },
  emptyTitle: {
    color: '#11150f',
    fontFamily: t.typography.title,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  explanation: { marginTop: 9, maxWidth: 780, color: '#4f5651', fontFamily: t.typography.body },
  retry: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', marginTop: 12 },
  retryText: {
    color: t.colors.text.primary,
    fontFamily: t.typography.body,
    fontSize: 16,
    fontWeight: '700',
  },
  listHead: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  count: {
    color: '#4f5651',
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 15,
    fontWeight: '800',
  },
  order: {
    color: '#6b716b',
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.9,
  },
  list: { marginTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(17,21,15,0.12)' },
  row: {
    minHeight: 60,
    paddingVertical: 10,
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.08)',
  },
  rowText: { minWidth: 0, flex: 1, gap: 3 },
  rowName: {
    color: '#11150f',
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  rowMeta: {
    color: '#6b716b',
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 15,
    lineHeight: 21,
  },
});
