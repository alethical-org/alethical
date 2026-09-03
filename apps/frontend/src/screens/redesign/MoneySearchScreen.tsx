import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  MoneyListRow,
  MoneyListRows,
  RowArrow,
} from '../../components/campaignMoney/MoneyListRows';
import { MoneyNameSearchField } from '../../components/campaignMoney/MoneyNameSearchField';
import { UnderDevelopmentNotice } from '../../components/campaignMoney/UnderDevelopmentNotice';
import { Skeleton } from '../../components/Skeleton';
import type { NameSearchGroup, NameSearchRow } from '../../data/types';
import { useCampaignFinanceNameSearch } from '../../hooks/useAppQueries';
import { useDebouncedSearchCommit } from '../../hooks/useDebouncedSearchCommit';
import { useResponsive } from '../../hooks/useResponsive';
import { committeeRowMeta } from '../../lib/committeeList';
import { closedChipLabel, committeeSlug } from '../../lib/committeeMoney';
import {
  BROWSE_ALL_COMMITTEES,
  countedUpToNote,
  GROUP_EMPTY,
  GROUP_UNAVAILABLE,
  groupCountLabel,
  groupHeading,
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
import { RECORD_DOES_NOT_COVER } from '../../lib/moneyLanding';
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
  const { isMobile } = useResponsive();
  const query = typeof route.params?.q === 'string' ? route.params.q : '';

  const [queryInput, setQueryInput] = useState(query);
  useEffect(() => {
    setQueryInput(query);
  }, [query]);

  const applyQuery = (next: string) => navigation.setParams({ q: next || undefined });
  useDebouncedSearchCommit(queryInput, query, applyQuery);

  const search = useCampaignFinanceNameSearch(query);
  const answer = search.data ?? null;

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
  const anyCapped = groups.some((group) => group.total === null && group.atLeast !== null);

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        {/* The money section is still being built — lobbying is not loaded, and no
            sitting member's committee has been confirmed by a person yet — and
            nothing else on the page says so at a glance. */}
        <UnderDevelopmentNotice />

        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <Pressable
            {...linkProps(routePath.money(), () => navigation.navigate('MoneyLanding'))}
            style={styles.backLink}
          >
            <Text style={styles.backLabel}>Follow the money</Text>
          </Pressable>

          <Text style={styles.eyebrow}>SEARCH RESULTS</Text>
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.h1, isMobile && styles.h1Mobile]}
          >
            {nameSearchHeading(query)}
          </Text>

          <View style={styles.findRow}>
            <MoneyNameSearchField
              value={queryInput}
              onChangeText={setQueryInput}
              onSubmit={() => applyQuery(queryInput.trim())}
              placeholder={NAME_SEARCH_PLACEHOLDER}
            />
          </View>

          {/* Above the results on purpose (IA §06). A reader who is told nothing
              reads an empty answer as "they gave nothing". */}
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

          {query.trim().length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.h3}>{NAME_SEARCH_EMPTY_QUERY_TITLE}</Text>
              <Text style={styles.explain}>{NAME_SEARCH_EMPTY_QUERY_WHY}</Text>
              <BrowseAllCommittees navigation={navigation} />
            </View>
          ) : search.isPending ? (
            <View style={styles.groupsLoading}>
              <View role="status" aria-busy style={styles.hidden}>
                <Text>Searching these records</Text>
              </View>
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
          ) : search.isError ? (
            <View style={styles.card}>
              <Text accessibilityRole="alert" style={styles.explain}>
                We couldn’t search these records just now. This is a problem on our side and says
                nothing about anyone’s giving. Please try again in a moment.
              </Text>
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
              <BrowseAllCommittees navigation={navigation} />
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
                if (!group) return null;
                return (
                  <ResultGroup
                    key={kind}
                    kind={kind}
                    group={group}
                    query={query}
                    isMobile={isMobile}
                    navigation={navigation}
                  />
                );
              })}
              {/* Under the groups, where the drawing prints the list's footnote:
                  how the names were matched, and the counting ceiling when one
                  group hit it. */}
              <Text style={styles.matchedOn}>{NAME_SEARCH_MATCHED_ON}</Text>
              {anyCapped && countedUpToNote(answer?.countedUpTo ?? null) ? (
                <Text style={styles.matchedOn}>{countedUpToNote(answer?.countedUpTo ?? null)}</Text>
              ) : null}
            </View>
          )}
        </Container>
        <Footer />
      </ScrollView>
    </PageBackground>
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
  navigation,
}: {
  kind: NameSearchGroupKind;
  group: NameSearchGroup;
  query: string;
  isMobile: boolean;
  navigation: RootScreenProps<'MoneySearch'>['navigation'];
}) {
  const heading = groupHeading(kind);
  const count = groupCountLabel(group.total, group.atLeast);
  const seeAll = kind === 'committees' ? seeAllCommitteesLabel(group.total, group.hasMore) : null;

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
        <Text style={styles.groupEmpty}>{GROUP_UNAVAILABLE}</Text>
      ) : group.results.length === 0 ? (
        <Text style={styles.groupEmpty}>{GROUP_EMPTY}</Text>
      ) : (
        <MoneyListRows isMobile={isMobile}>
          {group.results.map((row, index) => (
            <ResultRow
              key={`${group.kind}-${index}`}
              row={row}
              isMobile={isMobile}
              first={index === 0}
              navigation={navigation}
            />
          ))}
        </MoneyListRows>
      )}

      {seeAll ? (
        <Pressable
          {...linkProps(routePath.moneyCommittees({ q: query.trim() || undefined }), () =>
            navigation.navigate('CommitteeList', { q: query.trim() || undefined }),
          )}
          style={styles.seeAll}
        >
          <Text style={styles.seeAllLabel}>{seeAll}</Text>
        </Pressable>
      ) : null}

      {/* The group's note comes after its rows, as drawn: what a reader has just
          seen is what the sentence explains. */}
      <Text style={styles.groupNote}>{groupNote(kind)}</Text>
    </View>
  );
}

function ResultRow({
  row,
  isMobile,
  first,
  navigation,
}: {
  row: NameSearchRow;
  isMobile: boolean;
  first: boolean;
  navigation: RootScreenProps<'MoneySearch'>['navigation'];
}) {
  if (row.kind === 'person') {
    const legislatorId = row.slug || row.legislatorId;
    return (
      <MoneyListRow
        isMobile={isMobile}
        first={first}
        link={{
          href: routePath.legislator(legislatorId),
          onPress: () => navigation.push('LegislatorProfile', { legislatorId }),
        }}
      >
        <View style={styles.rowText}>
          <Text style={styles.rowName}>{row.fullName}</Text>
          <Text style={styles.rowMeta}>{personMeta(row)}</Text>
        </View>
        {isMobile ? null : <RowArrow />}
      </MoneyListRow>
    );
  }

  if (row.kind === 'committee') {
    const slug = committeeSlug(row.name, row.registrationNumber);
    const closed = row.isClosed ? closedChipLabel(row.terminationDate) : null;
    return (
      <MoneyListRow
        isMobile={isMobile}
        first={first}
        link={{
          href: routePath.moneyCommittee(slug),
          onPress: () => navigation.push('CommitteeMoney', { slug }),
        }}
      >
        <View style={styles.rowText}>
          <View style={styles.rowNameLine}>
            <Text style={styles.rowName}>{row.name}</Text>
            {closed ? <Text style={styles.closedChip}>{closed.toUpperCase()}</Text> : null}
          </View>
          <Text style={styles.rowMeta}>
            {committeeRowMeta({
              kind: row.filerKind,
              subType: row.subType,
              office: row.office,
              district: row.district,
            })}
          </Text>
          {/* A third line on the phone rather than dropped (phone band rule D3). */}
          {isMobile ? <Text style={styles.rowRegMobile}>REG {row.registrationNumber}</Text> : null}
        </View>
        {isMobile ? null : (
          <>
            <Text style={styles.rowReg}>REG {row.registrationNumber}</Text>
            <RowArrow />
          </>
        )}
      </MoneyListRow>
    );
  }

  // A payment name. It carries no registration number, so it opens the payments
  // filed under that exact spelling rather than a page about anybody (#1780). The
  // served `role` is handed straight back to that page, so the group a row came
  // from and the file its payments are read out of cannot drift apart.
  const inner = (
    <View style={styles.rowText}>
      <Text style={styles.rowName}>{row.name}</Text>
      <Text style={styles.rowMeta}>{paymentNameMeta(row.paymentCount)}</Text>
    </View>
  );
  const role = paymentNameRole(row.role);
  return (
    <MoneyListRow
      isMobile={isMobile}
      first={first}
      link={
        role
          ? {
              href: routePath.moneyPaymentsUnderName(row.name, role),
              onPress: () => navigation.push('PaymentsUnderName', { name: row.name, role }),
            }
          : null
      }
    >
      {inner}
      {isMobile || !role ? null : <RowArrow />}
    </MoneyListRow>
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
    maxWidth: 1000,
    fontFamily: t.typography.title,
    fontSize: 38,
    lineHeight: 44,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1,
    color: t.colors.text.primary,
  },
  h1Mobile: { fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  findRow: { marginTop: 22 },
  matchedOn: {
    maxWidth: 780,
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: t.colors.text.muted,
  },
  groups: { marginTop: 30, gap: 18 },
  groupsLoading: { marginTop: 18 },
  hidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  group: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 15,
    padding: 22,
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
    fontFamily: t.typography.mono,
    fontSize: 10.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1,
    color: t.colors.text.muted,
  },
  groupNote: {
    marginTop: 14,
    maxWidth: 780,
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: t.colors.text.muted,
  },
  groupEmpty: {
    marginTop: 14,
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
  seeAll: { marginTop: 14, minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
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
    maxWidth: 760,
    backgroundColor: t.colors.surfaces.s200,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 15,
    padding: 22,
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
