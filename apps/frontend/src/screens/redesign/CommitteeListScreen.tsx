import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  MoneyListRow,
  MoneyListRows,
  RowArrow,
} from '../../components/campaignMoney/MoneyListRows';
import { MoneyNameSearchField } from '../../components/campaignMoney/MoneyNameSearchField';
import { Pagination } from '../../components/search/searchPieces';
import { UnderDevelopmentNotice } from '../../components/campaignMoney/UnderDevelopmentNotice';
import { Skeleton } from '../../components/Skeleton';
import { useCampaignFinanceCommittees, usePrefetchCommitteeMoney } from '../../hooks/useAppQueries';
import { useDebouncedSearchCommit } from '../../hooks/useDebouncedSearchCommit';
import { useResponsive } from '../../hooks/useResponsive';
import {
  COMMITTEE_FIND_LABEL,
  COMMITTEE_FIND_PLACEHOLDER,
  COMMITTEE_LIST_DEK,
  COMMITTEE_LIST_NOTE,
  COMMITTEE_LIST_TITLE,
  COMMITTEE_LIST_UNAVAILABLE,
  COMMITTEE_ORDER_LABEL,
  COMMITTEE_PAGE_SIZE,
  COMMITTEE_KIND_FILTERS,
  committeeEmptyTitle,
  committeeEmptyWhy,
  committeeRowMeta,
  committeeShowingLine,
  kindFilterFromParam,
  kindFilterLabel,
  registerCountLine,
  type CommitteeKindFilter,
} from '../../lib/committeeList';
import { closedChipLabel, committeeSlug } from '../../lib/committeeMoney';
import {
  directoryJumpPages,
  directoryPageNumber,
  directoryPagePath,
  directoryTotalPages,
  loadedDirectoryPageIsOutOfRange,
} from '../../lib/directoryPagination';
import {
  formatCount,
  RECORD_DOES_NOT_COVER,
  RECORD_DOES_NOT_COVER_HEADING,
} from '../../lib/moneyLanding';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

/**
 * The register of filers at /money/committees ("Money lists web.dc.html" screen
 * A; issue #1696).
 *
 * **No row carries an amount and nothing here sorts by one.** These filers file
 * to different calendars, so 2 dollar figures side by side would set one period
 * against another rather than compare money, and a list ordered by amount would
 * rank who is on the ballot rather than who raised more
 * (`.claude/rules/grounded-answers.md` rule 12; "Campaign money IA.dc.html" §04,
 * the cut homepage module). The order is the filed name, A to Z, printed on the
 * page so it is never inferred.
 *
 * The name box, the kind filter and the numbered page all ride in the address,
 * so a narrowed or paged list is a link somebody can send and the browser's Back
 * button returns to it after opening a committee (rule 5). Numbered pages rather
 * than a "Show more" button: Google states it does not press buttons, so behind
 * one the other 1,553 filers had no ordinary link anywhere on the site
 * (`docs/architecture/page-metadata-for-search-and-sharing-decisions.md` §20.5).
 *
 * Every row opens by its registration number, not its name: 178 register names
 * sit a single character apart from another register name and every one of those
 * pairs is a different organisation, so a committee that changes its name keeps
 * its address (#1661).
 */
export function CommitteeListScreen({ navigation, route }: RootScreenProps<'CommitteeList'>) {
  const { isMobile } = useResponsive();
  const query = typeof route.params?.q === 'string' ? route.params.q : '';
  const filter = kindFilterFromParam(route.params?.kind);
  const page = directoryPageNumber(route.params?.page);

  const [queryInput, setQueryInput] = useState(query);
  // Resync the draft when the address changes from outside the field: Back,
  // Forward, a shared link, or the empty state's "search every kind" action.
  useEffect(() => {
    setQueryInput(query);
  }, [query]);

  const applyQuery = (next: string) =>
    navigation.setParams({ q: next || undefined, page: undefined });
  useDebouncedSearchCommit(queryInput, query, applyQuery);

  const list = useCampaignFinanceCommittees({
    kind: filter === 'all' ? undefined : filter,
    query: query.trim() || undefined,
    page,
    pageSize: COMMITTEE_PAGE_SIZE,
  });
  const prefetchCommitteeMoney = usePrefetchCommitteeMoney();

  useDocumentTitle(
    directoryPagePath('/money/committees', page),
    `${COMMITTEE_LIST_TITLE}${page > 1 ? ` — page ${page}` : ''} — campaign money | Alethical`,
  );

  const register = list.data ?? null;
  // Only the plain register pages by a numbered address a search engine may list.
  // A typed name or a kind chip is one of unlimited query-string combinations, so
  // its pages get working controls and no shareable page addresses (§18).
  const unfiltered = !query.trim() && filter === 'all';
  const rows = register?.committees ?? [];
  const served = register?.state === 'reported';
  const totalPages =
    register?.total != null ? directoryTotalPages(register.total, COMMITTEE_PAGE_SIZE) : null;
  const goToPage = (target: number) =>
    navigation.setParams({ page: target > 1 ? String(target) : undefined });

  const onSelectKind = (next: CommitteeKindFilter) =>
    navigation.setParams({ kind: next === 'all' ? undefined : next, page: undefined });

  // A numbered page past the real last one is a page that does not exist, exactly
  // as it is on /bills and /legislators — never clamped to the last real page,
  // which would answer 200 for an address with nothing behind it.
  const outOfRange = loadedDirectoryPageIsOutOfRange({
    isSuccess: list.isSuccess && served,
    isDefaultDirectory: unfiltered,
    page,
    total: register?.total,
    pageSize: COMMITTEE_PAGE_SIZE,
  });
  useEffect(() => {
    if (outOfRange) {
      navigation.replace('NotFound', { path: directoryPagePath('/money/committees', page) });
    }
  }, [navigation, outOfRange, page]);

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        {/* The money section is still being built — lobbying is not loaded, and no
            sitting member's committee has been confirmed by a person yet — and
            nothing else on the page says so at a glance. Deleting the element and
            its component file is the whole removal. */}
        <UnderDevelopmentNotice />

        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <Pressable
            {...linkProps(routePath.money(), () => navigation.navigate('MoneyLanding'))}
            style={styles.backLink}
          >
            <Text style={styles.backLabel}>Follow the money</Text>
          </Pressable>

          <Text style={styles.eyebrow}>CAMPAIGN MONEY</Text>
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.h1, isMobile && styles.h1Mobile]}
          >
            {COMMITTEE_LIST_TITLE}
          </Text>
          <Text style={styles.dek}>{COMMITTEE_LIST_DEK}</Text>

          {/* The register's own size, counted live. A count of what we hold
              carries no freshness date under rule 12; the register's own date
              rides along anyway because it answers "how old is this list". */}
          {list.isPending ? (
            <View style={styles.countRow} accessible accessibilityLabel="Loading the register">
              <Skeleton width={300} height={13} />
            </View>
          ) : registerCountLine(register?.registerTotal ?? null, register?.asOf ?? null) ? (
            <Text style={styles.countLine}>
              {registerCountLine(register?.registerTotal ?? null, register?.asOf ?? null)}
            </Text>
          ) : null}

          <View style={styles.findRow}>
            <MoneyNameSearchField
              value={queryInput}
              onChangeText={setQueryInput}
              onSubmit={() => applyQuery(queryInput.trim())}
              label={COMMITTEE_FIND_LABEL}
              placeholder={COMMITTEE_FIND_PLACEHOLDER}
              maxWidth={560}
            />
          </View>

          {/* The register's own 3 kinds and nothing finer: the finer sub-type is
              null for 33 registered filers, so a "ballot question" or "caucus"
              chip would present "we cannot tell" as "not one of these" (#1661).
              Each chip's count is the unfiltered one, so a count never looks
              like the filter found fewer of a kind than exist. */}
          <View style={styles.chipRow} role="group" aria-label="Filter by kind">
            {COMMITTEE_KIND_FILTERS.map((option) => {
              const active = option === filter;
              const count =
                option === 'all'
                  ? (register?.registerTotal ?? null)
                  : (register?.byKind?.[option] ?? null);
              return (
                <Pressable
                  key={option}
                  onPress={() => onSelectKind(option)}
                  accessibilityRole="button"
                  aria-pressed={active}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                    {kindFilterLabel(option)}
                  </Text>
                  {count !== null ? (
                    <Text style={[styles.chipCount, active && styles.chipCountActive]}>
                      {formatCount(count)}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          {list.isPending ? (
            <View style={styles.listLoading}>
              <View role="status" aria-busy style={styles.hidden}>
                <Text>Loading committees</Text>
              </View>
              <MoneyListRows isMobile={isMobile}>
                {(['58%', '72%', '44%', '66%', '52%', '38%'] as const).map((width, index) => (
                  <MoneyListRow key={index} isMobile={isMobile} first={index === 0}>
                    <View style={styles.rowText}>
                      <Skeleton width={width} height={14} />
                      <Skeleton width={200} height={11} style={{ marginTop: 8 }} />
                    </View>
                    {isMobile ? null : <Skeleton width={72} height={11} />}
                  </MoneyListRow>
                ))}
              </MoneyListRows>
            </View>
          ) : list.isError && rows.length === 0 ? (
            <View style={styles.card}>
              <Text accessibilityRole="alert" style={styles.explain}>
                We couldn’t load the register just now. This is a problem on our side and says
                nothing about who is registered. Please try again in a moment.
              </Text>
            </View>
          ) : !served ? (
            <View style={styles.card}>
              <Text style={styles.h3}>{committeeEmptyTitle('', filter)}</Text>
              <Text style={styles.explain}>{COMMITTEE_LIST_UNAVAILABLE}</Text>
            </View>
          ) : rows.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.h3}>{committeeEmptyTitle(query, filter)}</Text>
              <Text style={styles.explain}>{committeeEmptyWhy(filter)}</Text>
              {filter !== 'all' ? (
                <Pressable
                  onPress={() => onSelectKind('all')}
                  accessibilityRole="button"
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonLabel}>Show all kinds</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View>
              <View style={styles.listHead}>
                <Text style={styles.listCount}>
                  {committeeShowingLine(page, rows.length, register?.total ?? null, filter) ?? ''}
                </Text>
                <Text style={styles.listSort}>{COMMITTEE_ORDER_LABEL}</Text>
              </View>

              {/* Card rows at computer width, hairline rows inside one card on the
                  phone (MoneyListRows). The registration number is a third line on
                  the phone rather than dropped: it is how a reader tells 2
                  near-identical filed names apart, which is exactly the situation
                  this register creates (phone band rule D3). */}
              <MoneyListRows isMobile={isMobile}>
                {rows.map((row, index) => {
                  const slug = committeeSlug(row.name, row.registrationNumber);
                  const closed = row.isClosed ? closedChipLabel(row.terminationDate) : null;
                  return (
                    <MoneyListRow
                      key={row.registrationNumber}
                      isMobile={isMobile}
                      first={index === 0}
                      link={{
                        href: routePath.moneyCommittee(slug),
                        onPress: () => navigation.push('CommitteeMoney', { slug }),
                        onWarm: () => prefetchCommitteeMoney(row.registrationNumber, slug),
                      }}
                    >
                      <View style={styles.rowText}>
                        <View style={styles.rowNameLine}>
                          <Text style={styles.rowName}>{row.name}</Text>
                          {closed ? (
                            <Text style={styles.closedChip}>{closed.toUpperCase()}</Text>
                          ) : null}
                        </View>
                        <Text style={styles.rowMeta}>{committeeRowMeta(row)}</Text>
                        {isMobile ? (
                          <Text style={styles.rowRegMobile}>REG {row.registrationNumber}</Text>
                        ) : null}
                      </View>
                      {isMobile ? null : (
                        <>
                          <Text style={styles.rowReg}>REG {row.registrationNumber}</Text>
                          <RowArrow />
                        </>
                      )}
                    </MoneyListRow>
                  );
                })}
              </MoneyListRows>

              {/* Numbered pages, each with its own address, and the same control
                  the bills and legislators directories use. The Previous/Next and
                  jump links are real anchors, so the whole register is walkable
                  without a script (§20.5 rule 2). */}
              <Pagination
                page={page}
                totalPages={totalPages ?? undefined}
                hasPrev={page > 1}
                hasNext={totalPages != null ? page < totalPages : (register?.hasMore ?? false)}
                onPrev={() => goToPage(page - 1)}
                onNext={() => goToPage(page + 1)}
                prevHref={
                  unfiltered && page > 1
                    ? directoryPagePath('/money/committees', page - 1)
                    : undefined
                }
                nextHref={
                  unfiltered && totalPages != null && page < totalPages
                    ? directoryPagePath('/money/committees', page + 1)
                    : undefined
                }
                jumpPages={
                  unfiltered && totalPages != null
                    ? directoryJumpPages(page, totalPages)
                    : undefined
                }
                pageHref={(target) => directoryPagePath('/money/committees', target)}
                onPageSelect={goToPage}
              />

              <Text style={styles.listNote}>{COMMITTEE_LIST_NOTE}</Text>
            </View>
          )}

          <View style={styles.notCoveredBox}>
            <Text style={styles.notCoveredLabel}>
              {RECORD_DOES_NOT_COVER_HEADING.toUpperCase()}
            </Text>
            <View style={styles.notCoveredList}>
              {RECORD_DOES_NOT_COVER.map((line) => (
                <Text key={line} style={styles.notCoveredLine}>
                  {line}
                </Text>
              ))}
            </View>
          </View>
        </Container>
        <Footer />
      </ScrollView>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  main: { paddingTop: 28, paddingBottom: 64 },
  mainMobile: { paddingTop: 18 },
  backLink: { alignSelf: 'flex-start' },
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
    color: t.colors.brand.base,
  },
  h1: {
    marginTop: 12,
    fontFamily: t.typography.title,
    fontSize: 42,
    lineHeight: 48,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1.2,
    color: t.colors.text.primary,
  },
  h1Mobile: { fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  dek: {
    marginTop: 12,
    maxWidth: 760,
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 28,
    color: t.colors.text.secondary,
  },
  countRow: { marginTop: 14 },
  countLine: {
    marginTop: 14,
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
    color: t.colors.text.muted,
  },
  findRow: { marginTop: 26 },
  chipRow: { marginTop: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  // 44px on the chip's own box at every width (phone band rule F1).
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 15,
  },
  chipActive: {
    backgroundColor: t.colors.text.primary,
    borderColor: t.colors.text.primary,
  },
  chipLabel: {
    fontFamily: t.typography.ui,
    fontSize: 14.5,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  chipLabelActive: { color: t.colors.surfaces.base },
  chipCount: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.6,
    color: t.colors.text.muted,
  },
  chipCountActive: { color: t.colors.surfaces.s300 },
  listLoading: { marginTop: 12 },
  hidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  listHead: {
    marginTop: 28,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  listCount: {
    fontFamily: t.typography.body,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
  listSort: {
    fontFamily: t.typography.mono,
    fontSize: 10.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.2,
    color: t.colors.text.muted,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowNameLine: { flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' },
  rowName: {
    fontFamily: t.typography.ui,
    fontSize: 16.5,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  rowMeta: {
    marginTop: 4,
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  rowReg: {
    width: 96,
    textAlign: 'right',
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.5,
    color: t.colors.text.muted,
  },
  rowRegMobile: {
    marginTop: 5,
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: t.fontWeights.medium,
    color: t.colors.text.muted,
  },
  closedChip: {
    fontFamily: t.typography.mono,
    fontSize: 9.5,
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
  listNote: {
    marginTop: 20,
    maxWidth: 780,
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: t.colors.text.muted,
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
    fontSize: 19,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.2,
    color: t.colors.text.primary,
  },
  explain: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
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
    marginTop: 40,
    maxWidth: 760,
    backgroundColor: t.colors.surfaces.s200,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 15,
    padding: 24,
  },
  notCoveredLabel: {
    fontFamily: t.typography.mono,
    fontSize: 10.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
    color: t.colors.text.secondary,
  },
  notCoveredList: { marginTop: 14, gap: 9 },
  notCoveredLine: {
    fontFamily: t.typography.body,
    fontSize: 16.5,
    lineHeight: 26,
    color: t.colors.ink,
  },
});
