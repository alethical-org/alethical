import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  MoneyListRow,
  MoneyListRows,
  RowArrow,
} from '../../components/campaignMoney/MoneyListRows';
import { MoneyNameSearchField } from '../../components/campaignMoney/MoneyNameSearchField';
import { ChevronLeft } from '../../components/icons';
import { Skeleton, useOneScreenTall } from '../../components/Skeleton';
import type { NameSearchGroup, NameSearchRow } from '../../data/types';
import { useCampaignFinanceNameSearch } from '../../hooks/useAppQueries';
import { useDebouncedSearchCommit } from '../../hooks/useDebouncedSearchCommit';
import { useResponsive } from '../../hooks/useResponsive';
import { useSearchMetric } from '../../hooks/useSearchMetric';
import { committeeRowMeta } from '../../lib/committeeList';
import { closedChipLabel, committeeSlug } from '../../lib/committeeMoneyShared';
import { MONEY_SECTION_NAME } from '../../lib/moneySectionName';
import {
  BROWSE_ALL_COMMITTEES,
  countedUpToNote,
  GROUP_EMPTY,
  GROUP_UNAVAILABLE,
  HELD_RESULTS_NOTE,
  groupCountLabel,
  groupHeading,
  lobbyingSearchMeta,
  principalWithoutSpending,
  seeAllLobbyingLabel,
  groupNote,
  hasAnyResult,
  NAME_SEARCH_EMPTY_QUERY_TITLE,
  NAME_SEARCH_EMPTY_QUERY_WHY,
  NAME_SEARCH_GROUP_ORDER,
  NAME_SEARCH_MATCHED_ON,
  NAME_SEARCH_PLACEHOLDER,
  NOT_ALL_SEARCHED_TITLE,
  NOT_ALL_SEARCHED_WHY,
  NO_MATCH_WHY,
  everyGroupWasSearched,
  nameSearchHeading,
  noMatchTitle,
  paymentNameMeta,
  personMeta,
  seeAllCommitteesLabel,
  tooShortTitle,
  tooShortWhy,
  type NameSearchGroupKind,
} from '../../lib/moneyNameSearch';
import { MONEY_LIST_COVERAGE } from '../../lib/moneyListCopy';
import { paymentNameRole } from '../../lib/paymentsUnderName';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

/**
 * One typed name, matched across the 5 kinds of record, at /money/search
 * ("Money lists web.dc.html" screen B; "Campaign money IA.dc.html" §02; issue
 * #1696).
 *
 * Three things this page does deliberately, each because the alternative is a
 * false claim rather than because it is tidier:
 *
 * - **No total across the groups.** The design drew one summary line ("5 matches
 *   across people, committees and names that got paid"); with the served answer's
 *   5 groups, any single number adds the 2 vendor groups, and those are 2
 *   separate filings whose rows overlap on 491 records. So each group prints its
 *   own count and the page says out loud that they are never added
 *   (`.claude/rules/grounded-answers.md` rule 12).
 * - **A capped count reads "more than N".** The server counts distinct names up
 *   to its own ceiling and then says "at least"; printing that ceiling as a total
 *   would be a made-up figure in the largest type on the page (rule 11).
 * - **A name row opens its payments, never a profile.** Committees and sitting
 *   members carry an identifier, so those rows open a page ABOUT them. A payment
 *   name is one spelling with no identifier at all, so its row opens every payment
 *   filed under that exact spelling and nothing more (issue #1780). Each group's
 *   note says which of the 2 its rows are, because rows that looked alike would
 *   promise a profile that cannot exist.
 *
 * What this record does not cover sits ABOVE the results, not under them
 * ("Campaign money IA.dc.html" §06): somebody who types a name, gets nothing and
 * is told nothing concludes that person gave nothing, rather than that we do not
 * hold the record.
 */
export function MoneySearchScreen({ navigation, route }: RootScreenProps<'MoneySearch'>) {
  const { isMobile, isTablet } = useResponsive();
  const oneScreenTall = useOneScreenTall();
  const query = typeof route.params?.q === 'string' ? route.params.q : '';

  const [queryInput, setQueryInput] = useState(query);
  useEffect(() => {
    setQueryInput(query);
  }, [query]);

  const applyQuery = (next: string) => navigation.setParams({ q: next || undefined });
  useDebouncedSearchCommit(queryInput, query, applyQuery);

  const search = useCampaignFinanceNameSearch(query);
  const answer = search.data ?? null;

  /**
   * True until the answer on hand is the answer to the name in the heading.
   *
   * `isPending` alone was not enough. An answer kept from the previous search is
   * not pending, so the last search's rows, counts and "no matches" card drew
   * under the new search's heading: "Results for smith" above a list of
   * education groups (issue #2020). The read no longer keeps one, and this
   * covers the page's own promise so re-introducing that setting cannot quietly
   * break it again.
   */
  const waitingForThisQuery = search.isPending || search.isPlaceholderData;

  /**
   * True when a recheck failed while the answer to the name in the heading is
   * still in hand.
   *
   * The read keeps no previous search's answer (`useCampaignFinanceNameSearch`
   * dropped `keepPreviousData` for issue #2020), so an answer present alongside
   * a failure is this query's own answer and nothing else. Holding it is the
   * whole point: replacing a correct page of results with "we couldn't search
   * these records" states something false about our own records, and a reader
   * cannot tell that message apart from "nothing is filed under this name"
   * (issue #2048; `.claude/rules/grounded-answers.md` rule 12 on missing versus
   * zero). The committee page has held its figures this way for months
   * (`CommitteeMoneyScreen.tsx`, its `isHoldingStale`).
   */
  const isHoldingStale = search.isError && answer !== null && !search.isPlaceholderData;

  useDocumentTitle(
    '/money/search',
    query.trim()
      ? `Campaign money search: ${query.trim()} | Alethical`
      : 'Search campaign money by name | Alethical',
  );

  const tooShort = answer?.state === 'unavailable' && answer.reason === 'query_too_short';
  const groups = answer?.groups ?? [];
  const anyResult = hasAnyResult(groups);
  const everySearched = everyGroupWasSearched(groups);

  useSearchMetric({
    event: 'money_search_with_results',
    query,
    context: '',
    isSuccess: search.isSuccess,
    isPlaceholderData: search.isPlaceholderData,
    isFetching: search.isFetching,
    displayedResults:
      answer?.state === 'reported' &&
      groups.some(
        (group) =>
          NAME_SEARCH_GROUP_ORDER.includes(group.kind as NameSearchGroupKind) &&
          group.state === 'reported' &&
          group.results.length > 0,
      )
        ? 1
        : 0,
  });

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <Pressable
            {...linkProps(routePath.money(), () => navigation.navigate('MoneyLanding'))}
            style={styles.backLink}
          >
            <ChevronLeft size={18} strokeWidth={2.2} color={t.colors.text.secondary} aria-hidden />
            <Text style={styles.backLabel}>{MONEY_SECTION_NAME}</Text>
          </Pressable>

          <Text style={styles.eyebrow}>SEARCH RESULTS</Text>
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.h1, isTablet && styles.h1Tablet, isMobile && styles.h1Mobile]}
          >
            {nameSearchHeading(query)}
          </Text>

          <View style={styles.findRow}>
            <MoneyNameSearchField
              value={queryInput}
              onChangeText={setQueryInput}
              onSubmit={() => applyQuery(queryInput.trim())}
              placeholder={NAME_SEARCH_PLACEHOLDER}
              label="Search these records by name"
              appearance="list"
              showSubmitButton
              fieldFontSize={16}
              stacked={isMobile}
              maxWidth={640}
            />
          </View>

          {/* Above the results on purpose (IA §06). A reader who is told nothing
              reads an empty answer as "they gave nothing". */}
          <View style={styles.notCoveredBox}>
            <Text style={styles.notCoveredLabel}>WHAT THE CAMPAIGN RECORDS DO NOT COVER</Text>
            <View style={styles.notCoveredList}>
              {MONEY_LIST_COVERAGE.map((line) => (
                <Text key={line} style={styles.notCoveredLine}>
                  {line}
                </Text>
              ))}
            </View>
          </View>

          {/* Every state holds a window's height, never the waiting one alone.
              Reserving only while waiting moves the same jump onto the states
              that release it (`useOneScreenTall`), and a reader who changes
              their search would watch the footer climb into view the moment the
              rows are replaced. */}
          <View style={oneScreenTall}>
            <View role="status" aria-live="polite" style={styles.hidden}>
              <Text>
                {!query.trim()
                  ? NAME_SEARCH_EMPTY_QUERY_TITLE
                  : waitingForThisQuery
                    ? 'Searching these records'
                    : search.isError && !answer
                      ? 'We couldn’t search these records just now'
                      : tooShort
                        ? tooShortTitle(answer?.minQueryLength ?? null)
                        : anyResult
                          ? `Results for “${query.trim()}” loaded`
                          : !everySearched
                            ? NOT_ALL_SEARCHED_TITLE
                            : noMatchTitle(query)}
              </Text>
            </View>
            {/* Above the results, for the same reason the not-covered box is: a
                reader who scrolls one row and stops must still be told. Not
                drawn over the too-short card, which is about the query rather
                than about our records. */}
            {isHoldingStale && !tooShort ? (
              <View style={styles.heldNote}>
                <Text accessibilityRole="alert" style={styles.heldNoteText}>
                  {HELD_RESULTS_NOTE}
                </Text>
                <RetrySearch onRetry={() => void search.refetch()} busy={search.isFetching} />
              </View>
            ) : null}
            {query.trim().length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.h3}>{NAME_SEARCH_EMPTY_QUERY_TITLE}</Text>
                <Text style={styles.explain}>{NAME_SEARCH_EMPTY_QUERY_WHY}</Text>
                <BrowseAllCommittees navigation={navigation} />
              </View>
            ) : waitingForThisQuery ? (
              <View style={styles.groupsLoading}>
                <Text style={styles.explain}>Searching these records</Text>
                <MoneyListRows isMobile={isMobile}>
                  {(['58%', '72%', '44%'] as const).map((width, index) => (
                    <MoneyListRow key={index} isMobile={isMobile} first={index === 0}>
                      <View style={styles.rowText}>
                        <Skeleton width={width} height={14} />
                        <Skeleton width={200} height={11} style={{ marginTop: 8 }} />
                      </View>
                    </MoneyListRow>
                  ))}
                </MoneyListRows>
              </View>
            ) : search.isError && !answer ? (
              <View style={styles.card}>
                <Text accessibilityRole="alert" style={styles.h3}>
                  We couldn’t search these records just now
                </Text>
                <Text style={styles.explain}>This is a problem on our side. Please try again.</Text>
                <RetrySearch onRetry={() => void search.refetch()} busy={search.isFetching} />
              </View>
            ) : tooShort ? (
              <View style={styles.card}>
                <Text style={styles.h3}>{tooShortTitle(answer?.minQueryLength ?? null)}</Text>
                <Text style={styles.explain}>{tooShortWhy(answer?.minQueryLength ?? null)}</Text>
              </View>
            ) : !anyResult && !everySearched ? (
              /* Nothing turned up and part of the records went unread, so the page
               may not claim nothing is filed under the name. */
              <View style={styles.card}>
                <Text style={styles.h3}>{NOT_ALL_SEARCHED_TITLE}</Text>
                <Text style={styles.explain}>{NOT_ALL_SEARCHED_WHY}</Text>
                <RetrySearch onRetry={() => void search.refetch()} busy={search.isFetching} />
              </View>
            ) : !anyResult ? (
              <View style={styles.card}>
                <Text style={styles.h3}>{noMatchTitle(query)}</Text>
                <Text style={styles.explain}>{NO_MATCH_WHY}</Text>
                <BrowseAllCommittees navigation={navigation} />
              </View>
            ) : (
              <View style={styles.groups}>
                {NAME_SEARCH_GROUP_ORDER.map((kind) => {
                  const group = groups.find((candidate) => candidate.kind === kind);
                  if (
                    !group ||
                    ((kind === 'lobbyists' || kind === 'principals') &&
                      group.state === 'not_reported')
                  )
                    return null;
                  return (
                    <ResultGroup
                      key={kind}
                      kind={kind}
                      group={group}
                      query={query}
                      isMobile={isMobile}
                      countedUpTo={answer?.countedUpTo ?? null}
                      onRetry={() => void search.refetch()}
                      retrying={search.isFetching}
                      navigation={navigation}
                    />
                  );
                })}
                {/* Under the groups, where the drawing prints the list's footnote:
                  how the names were matched, and the counting ceiling when one
                  group hit it. */}
                <Text style={styles.matchedOn}>{NAME_SEARCH_MATCHED_ON}</Text>
              </View>
            )}
          </View>
        </Container>
        <Footer />
      </ScrollView>
    </PageBackground>
  );
}

function RetrySearch({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onRetry}
      style={styles.primaryButton}
    >
      <Text style={styles.primaryButtonLabel}>{busy ? 'Trying again…' : 'Try again'}</Text>
    </Pressable>
  );
}

function BrowseAllCommittees({
  navigation,
}: {
  navigation: RootScreenProps<'MoneySearch'>['navigation'];
}) {
  return (
    <Pressable
      {...linkProps(routePath.moneyCommittees(), () => navigation.navigate('CommitteeList'))}
      style={styles.primaryButton}
    >
      <Text style={styles.primaryButtonLabel}>{BROWSE_ALL_COMMITTEES}</Text>
    </Pressable>
  );
}

/** One served group. Drawn even when it holds nothing, so a reader can never take
 *  a missing group for "nothing is filed". */
function ResultGroup({
  kind,
  group,
  query,
  isMobile,
  countedUpTo,
  onRetry,
  retrying,
  navigation,
}: {
  countedUpTo: number | null;
  onRetry: () => void;
  retrying: boolean;
  kind: NameSearchGroupKind;
  group: NameSearchGroup;
  query: string;
  isMobile: boolean;
  navigation: RootScreenProps<'MoneySearch'>['navigation'];
}) {
  const heading = groupHeading(kind);
  const count = group.state === 'unavailable' ? null : groupCountLabel(group.total, group.atLeast);
  const capNote = group.atLeast !== null ? countedUpToNote(countedUpTo) : null;
  const lobbyingKind = kind === 'lobbyists' || kind === 'principals' ? kind : null;
  const seeAll =
    lobbyingKind && group.hasMore
      ? seeAllLobbyingLabel(lobbyingKind, group.total)
      : kind === 'committees'
        ? seeAllCommitteesLabel(group.total, group.hasMore)
        : null;
  const params = { q: query.trim() || undefined };
  const moreHref =
    lobbyingKind === 'lobbyists'
      ? routePath.lobbyingLobbyists(params)
      : lobbyingKind === 'principals'
        ? routePath.lobbyingPrincipals(params)
        : routePath.moneyCommittees(params);
  const openMore = () =>
    lobbyingKind === 'lobbyists'
      ? navigation.navigate('LobbyingLobbyists', params)
      : lobbyingKind === 'principals'
        ? navigation.navigate('LobbyingPrincipals', params)
        : navigation.navigate('CommitteeList', params);

  return (
    <View style={styles.group}>
      <View style={styles.groupHead}>
        <Text accessibilityRole="header" aria-level={2} style={styles.groupHeading}>
          {heading}
        </Text>
        {count ? <Text style={styles.groupCount}>{count}</Text> : null}
      </View>
      {/* Only "we could not read it" gets the gap sentence. A group the server
          searched and found nothing in reads as nothing found — printing our gap
          over a verified nothing is the missing-versus-zero failure rule 12
          forbids. */}
      {group.state === 'unavailable' ? (
        <View role="alert" style={styles.groupUnavailable}>
          <Text style={styles.explain}>{GROUP_UNAVAILABLE}</Text>
          <RetrySearch onRetry={onRetry} busy={retrying} />
        </View>
      ) : group.results.length === 0 ? (
        <Text style={styles.groupEmpty}>{GROUP_EMPTY}</Text>
      ) : (
        <View style={styles.resultRows}>
          {group.results.map((row, index) => (
            <ResultRow
              key={`${group.kind}-${index}`}
              row={row}
              query={query}
              isMobile={isMobile}
              first={index === 0}
              navigation={navigation}
            />
          ))}
        </View>
      )}

      {group.results.length > 0 && group.state !== 'unavailable' ? (
        <>
          {capNote ? <Text style={styles.groupNote}>{capNote}</Text> : null}
          <Text style={styles.groupNote}>{groupNote(kind)}</Text>
        </>
      ) : null}
      {seeAll && group.state !== 'unavailable' ? (
        <Pressable {...linkProps(moreHref, openMore)} style={styles.seeAll}>
          <Text style={styles.seeAllLabel}>{seeAll}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ResultRow({
  row,
  query,
  isMobile,
  first,
  navigation,
}: {
  row: NameSearchRow;
  query: string;
  isMobile: boolean;
  first: boolean;
  navigation: RootScreenProps<'MoneySearch'>['navigation'];
}) {
  if (row.kind === 'person') {
    const legislatorId = row.slug || row.legislatorId;
    return (
      <SearchResultRow
        isMobile={isMobile}
        first={first}
        link={{
          href: routePath.legislator(legislatorId),
          onPress: () => navigation.push('LegislatorProfile', { legislatorId }),
        }}
      >
        <View style={styles.rowText}>
          <Text style={[styles.rowName, isMobile && styles.rowNameMobile]}>{row.fullName}</Text>
          <Text style={styles.rowMeta}>{personMeta(row)}</Text>
        </View>
        <RowArrow />
      </SearchResultRow>
    );
  }

  if (row.kind === 'committee') {
    const slug = committeeSlug(row.name, row.registrationNumber);
    const closed = row.isClosed ? closedChipLabel(row.terminationDate) : null;
    return (
      <SearchResultRow
        isMobile={isMobile}
        first={first}
        link={{
          href: routePath.moneyCommittee(slug),
          onPress: () => navigation.push('CommitteeMoney', { slug }),
        }}
      >
        <View style={styles.rowText}>
          <View style={styles.rowNameLine}>
            <Text style={[styles.rowName, isMobile && styles.rowNameMobile]}>{row.name}</Text>
            {closed ? <Text style={styles.closedChip}>{closed}</Text> : null}
          </View>
          <Text style={styles.rowMeta}>
            {committeeRowMeta({
              kind: row.filerKind,
              subType: row.subType,
              office: row.office,
              district: row.district,
            })}{' '}
            · REG {row.registrationNumber}
          </Text>
        </View>
        <RowArrow />
      </SearchResultRow>
    );
  }

  if (row.kind === 'lobbyist' || row.kind === 'principal') {
    const isLobbyist = row.kind === 'lobbyist';
    const slug = committeeSlug(
      row.name,
      String(isLobbyist ? row.registrationNumber : row.entityId),
    );
    const linkable = isLobbyist || row.linkable;
    const href = isLobbyist ? routePath.lobbyingLobbyist(slug) : routePath.lobbyingPrincipal(slug);
    return (
      <SearchResultRow
        isMobile={isMobile}
        first={first}
        link={
          linkable
            ? {
                href,
                onPress: () =>
                  isLobbyist
                    ? navigation.push('LobbyingLobbyist', { slug })
                    : navigation.push('LobbyingPrincipal', { slug }),
              }
            : null
        }
      >
        <View style={styles.rowText}>
          <Text style={[styles.rowName, isMobile && styles.rowNameMobile]}>{row.name}</Text>
          <Text style={styles.rowMeta}>{lobbyingSearchMeta(row)}</Text>
          {!isLobbyist && !row.linkable ? (
            <Text style={styles.rowMeta}>{principalWithoutSpending(row.sourceLatestYear)}</Text>
          ) : null}
        </View>
        {linkable ? <RowArrow /> : null}
      </SearchResultRow>
    );
  }

  // A payment name. It carries no registration number, so it opens the payments
  // filed under that exact spelling rather than a page about anybody (#1780). The
  // served `role` is handed straight back to that page, so the group a row came
  // from and the file its payments are read out of cannot drift apart.
  const inner = (
    <View style={styles.rowText}>
      <Text style={[styles.rowName, isMobile && styles.rowNameMobile]}>{row.name}</Text>
      <Text style={styles.rowMeta}>{paymentNameMeta(row.paymentCount)}</Text>
    </View>
  );
  const role = paymentNameRole(row.role);
  return (
    <SearchResultRow
      isMobile={isMobile}
      first={first}
      link={
        role
          ? {
              href: routePath.moneyPaymentsUnderName(row.name, role, query),
              onPress: () =>
                navigation.push('PaymentsUnderName', { name: row.name, role, q: query }),
            }
          : null
      }
    >
      {inner}
      {role ? <RowArrow /> : null}
    </SearchResultRow>
  );
}

function SearchResultRow({
  first,
  link,
  children,
}: {
  isMobile: boolean;
  first: boolean;
  link?: { href: string; onPress: () => void } | null;
  children: ReactNode;
}) {
  const style = [styles.resultRow, !first && styles.resultRowDivided];
  return link ? (
    <Pressable {...linkProps(link.href, link.onPress)} style={style}>
      {children}
    </Pressable>
  ) : (
    <View style={style}>{children}</View>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  main: { paddingTop: 28, paddingBottom: 64 },
  mainMobile: { paddingTop: 18 },
  backLink: {
    alignSelf: 'flex-start',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
  eyebrow: {
    marginTop: 22,
    fontFamily: t.typography.body,
    fontSize: 13,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 2.4,
    color: t.colors.text.greenOnLight,
  },
  h1: {
    marginTop: 12,
    maxWidth: 1000,
    fontFamily: t.typography.title,
    fontSize: 42,
    lineHeight: 48,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1,
    color: t.colors.text.primary,
  },
  h1Tablet: { fontSize: 34, lineHeight: 39, letterSpacing: -1 },
  h1Mobile: { fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  findRow: { marginTop: 22 },
  matchedOn: {
    maxWidth: 780,
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: t.colors.text.muted,
  },
  groups: { marginTop: 28, gap: 26, maxWidth: 960 },
  groupsLoading: { marginTop: 18 },
  hidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  group: { gap: 0 },
  resultRows: {
    marginTop: 10,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 12,
    paddingHorizontal: 18,
    ...(t.shadows.card as object),
  },
  resultRow: {
    minHeight: 60,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  resultRowDivided: { borderTopWidth: 1, borderTopColor: t.colors.alpha.ink08 },
  groupUnavailable: {
    marginTop: 10,
    padding: 18,
    gap: 10,
    borderRadius: 12,
    backgroundColor: '#fff7ea',
    borderWidth: 1,
    borderColor: '#f0d7a8',
  },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 14,
    flexWrap: 'wrap',
  },
  groupHeading: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.4,
    color: t.colors.text.secondary,
  },
  groupCount: {
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 10.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1,
    color: t.colors.text.muted,
  },
  groupNote: {
    marginTop: 8,
    marginLeft: t.spacing.underCardText,
    maxWidth: 780,
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: t.colors.text.muted,
  },
  groupEmpty: {
    marginTop: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.alpha.ink18,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowNameLine: { flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' },
  rowName: {
    fontFamily: t.typography.ui,
    fontSize: 16.5,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  rowNameMobile: { fontSize: 16 },
  rowMeta: {
    fontVariant: ['tabular-nums'],
    marginTop: 4,
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  closedChip: {
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 12,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    color: t.colors.text.secondary,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink18,
    borderRadius: 7,
    paddingVertical: 3,
    paddingHorizontal: 7,
    overflow: 'hidden',
  },
  seeAll: {
    marginTop: 10,
    marginLeft: t.spacing.underCardText,
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  seeAllLabel: {
    fontFamily: t.typography.ui,
    fontSize: 15.5,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.greenOnLight,
  },
  card: {
    marginTop: 26,
    maxWidth: 780,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 15,
    padding: 24,
    gap: 10,
  },
  h3: {
    fontFamily: t.typography.title,
    fontSize: 21,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.3,
    color: t.colors.text.primary,
  },
  explain: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 23,
    color: t.colors.text.secondary,
  },
  primaryButton: {
    alignSelf: 'flex-start',
    marginTop: 4,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: t.colors.text.primary,
    borderRadius: 11,
    paddingVertical: 13,
    paddingHorizontal: 19,
  },
  primaryButtonLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.surfaces.base,
  },
  notCoveredBox: {
    marginTop: 26,
    maxWidth: 960,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 15,
    padding: 18,
  },
  // The not-covered box's own panel, because this says the same kind of thing
  // about our records rather than about a search. Inside the reserved height, so
  // the container cannot change size when the note appears or goes.
  heldNote: {
    marginBottom: 26,
    maxWidth: 960,
    backgroundColor: '#fff7ea',
    gap: 10,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 15,
    padding: 22,
  },
  heldNoteText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 23,
    color: t.colors.text.secondary,
  },
  notCoveredLabel: {
    fontFamily: t.typography.mono,
    fontSize: 10.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
    color: t.colors.text.secondary,
  },
  notCoveredList: { marginTop: 12, gap: 8 },
  notCoveredLine: {
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 25,
    color: t.colors.ink,
  },
});
