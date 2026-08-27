import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MoneyNameSearchField } from '../../components/campaignMoney/MoneyNameSearchField';
import { UnderDevelopmentNotice } from '../../components/campaignMoney/UnderDevelopmentNotice';
import { Skeleton } from '../../components/Skeleton';
import { useCampaignFinanceCommittees } from '../../hooks/useAppQueries';
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
  committeeMoreLabel,
  committeeRowMeta,
  committeeShowingLine,
  kindFilterFromParam,
  kindFilterLabel,
  registerCountLine,
  shownCountFromParam,
  type CommitteeKindFilter,
} from '../../lib/committeeList';
import { closedChipLabel, committeeSlug } from '../../lib/committeeMoney';
import { formatCount, RECORD_DOES_NOT_COVER } from '../../lib/moneyLanding';
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
 * The name box, the kind filter and how many rows are shown all ride in the
 * address, so a narrowed or scrolled list is a link somebody can send and the
 * browser's Back button returns to it after opening a committee (rule 5).
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
  const shown = shownCountFromParam(route.params?.show);

  const [queryInput, setQueryInput] = useState(query);
  // Resync the draft when the address changes from outside the field: Back,
  // Forward, a shared link, or the empty state's "search every kind" action.
  useEffect(() => {
    setQueryInput(query);
  }, [query]);

  const applyQuery = (next: string) =>
    navigation.setParams({ q: next || undefined, show: undefined });
  useDebouncedSearchCommit(queryInput, query, applyQuery);

  const list = useCampaignFinanceCommittees({
    kind: filter === 'all' ? undefined : filter,
    query: query.trim() || undefined,
    shown,
    pageSize: COMMITTEE_PAGE_SIZE,
  });

  useDocumentTitle('/money/committees', `${COMMITTEE_LIST_TITLE} — campaign money | Alethical`);

  const page = list.data ?? null;
  const rows = page?.committees ?? [];
  const served = page?.state === 'reported';

  const onSelectKind = (next: CommitteeKindFilter) =>
    navigation.setParams({ kind: next === 'all' ? undefined : next, show: undefined });

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        {/* The section is still being built (the who-got-paid page is issue
            #1780) and nothing else on the page says so at a glance. */}
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
          ) : registerCountLine(page?.registerTotal ?? null, page?.asOf ?? null) ? (
            <Text style={styles.countLine}>
              {registerCountLine(page?.registerTotal ?? null, page?.asOf ?? null)}
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
                option === 'all' ? (page?.registerTotal ?? null) : (page?.byKind?.[option] ?? null);
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
              {(['58%', '72%', '44%', '66%', '52%', '38%'] as const).map((width, index) => (
                <View key={index} style={styles.row}>
                  <View style={styles.rowText}>
                    <Skeleton width={width} height={14} />
                    <Skeleton width={200} height={11} style={{ marginTop: 8 }} />
                  </View>
                  <Skeleton width={72} height={11} />
                </View>
              ))}
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
                  {committeeShowingLine(rows.length, page?.total ?? null, filter) ?? ''}
                </Text>
                <Text style={styles.listSort}>{COMMITTEE_ORDER_LABEL}</Text>
              </View>

              <View style={styles.rows}>
                {rows.map((row) => {
                  const slug = committeeSlug(row.name, row.registrationNumber);
                  const closed = row.isClosed ? closedChipLabel(row.terminationDate) : null;
                  return (
                    <Pressable
                      key={row.registrationNumber}
                      {...linkProps(routePath.moneyCommittee(slug), () =>
                        navigation.push('CommitteeMoney', { slug }),
                      )}
                      style={styles.row}
                    >
                      <View style={styles.rowText}>
                        <View style={styles.rowNameLine}>
                          <Text style={styles.rowName}>{row.name}</Text>
                          {closed ? (
                            <Text style={styles.closedChip}>{closed.toUpperCase()}</Text>
                          ) : null}
                        </View>
                        <Text style={styles.rowMeta}>{committeeRowMeta(row)}</Text>
                      </View>
                      <Text style={styles.rowReg}>REG {row.registrationNumber}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {page?.hasMore ? (
                <View style={styles.moreRow}>
                  <Pressable
                    onPress={() =>
                      navigation.setParams({ show: String(rows.length + COMMITTEE_PAGE_SIZE) })
                    }
                    accessibilityRole="button"
                    aria-disabled={list.isFetching}
                    style={styles.capButton}
                  >
                    <Text style={styles.capButtonLabel}>
                      {list.isFetching
                        ? 'Loading…'
                        : committeeMoreLabel(rows.length, page?.total ?? null)}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              <Text style={styles.listNote}>{COMMITTEE_LIST_NOTE}</Text>
            </View>
          )}

          <View style={styles.notCoveredBox}>
            <Text style={styles.notCoveredLabel}>WHAT THIS RECORD DOES NOT COVER</Text>
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
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  listLoading: { marginTop: 26, gap: 10 },
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
  rows: { marginTop: 14, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
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
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
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
  moreRow: { marginTop: 18, flexDirection: 'row' },
  capButton: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 11,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  capButtonLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
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
