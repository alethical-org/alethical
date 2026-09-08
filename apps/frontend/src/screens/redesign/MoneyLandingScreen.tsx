import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Skeleton } from '../../components/Skeleton';
import { MoneyNameSearchField } from '../../components/campaignMoney/MoneyNameSearchField';
import { UnderDevelopmentNotice } from '../../components/campaignMoney/UnderDevelopmentNotice';
import { useResponsive } from '../../hooks/useResponsive';
import {
  useCampaignFinanceFilings,
  useCampaignFinanceSummary,
  useWarmMoneyDestinations,
} from '../../hooks/useAppQueries';
import {
  centralDateLabel,
  filedDateSentence,
  filingsTieSentence,
  filingPeriodLine,
  laneCountLine,
  legislatorsLaneBody,
  orderingSentence,
  FILES_LAST_COPIED_LABEL,
  FILES_LAST_COPIED_NOTE,
  LANE_COUNT_UNITS,
  MONEY_LANDING_HEADING,
  MONEY_LANDING_RECORD_DOES_NOT_COVER,
  MONEY_LANDING_SEARCH_NOTE,
  MONEY_LANDING_SUBTITLE,
  MONEY_LANE_BY_RACE,
  MONEY_LANE_COMMITTEES,
  MONEY_LANE_LEGISLATORS,
  MONEY_LANE_OUTSIDE_SPENDING,
  MONEY_LANE_WHO_GOT_PAID,
  RECORD_DOES_NOT_COVER_HEADING,
  RECORD_DOES_NOT_COVER_NOTE,
  RESEARCH_ROW_EMPTY,
  RESEARCH_ROW_LABEL,
  RESEARCH_ROW_LINK,
} from '../../lib/moneyLanding';
import { NAME_SEARCH_PLACEHOLDER } from '../../lib/moneyNameSearch';
import { piecesLabelledResearch, researchDatesLine } from '../../lib/research';
import { linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

/**
 * The campaign money landing at /money — public, no sign-in gate ("Campaign
 * money IA.dc.html" §01, plus Eugene's 18 Aug 2026 decision that every lane card
 * is visible, so a reader sees the whole shape of the section). Redrawn 8 Sep
 * 2026 (LIVE Money.dc.html, design package money-landing-2026-09-08): the lanes
 * come straight after the search, 4 of the 5 carry a live count, and the
 * research card became a quiet row above the filing list.
 *
 * What this page may never do (IA §04): no lane counts money, no top raisers,
 * no amount on any row that lists more than one member, and no count that is
 * not served by a live query. Counts and dates come from
 * /campaign-finance/summary and the filed reports from
 * /campaign-finance/filings; each block carries its own state, and a block that
 * is not served renders its designed absent state — never a zero. A served 0
 * (0 of 200 committees confirmed) is a verified fact and renders as a number.
 */

// The drawing's raised card (0 10px 30px rgba(17,21,15,0.08)). A web box-shadow;
// native gets the equivalent shadow props.
const laneCardShadow = Platform.select({
  web: { boxShadow: '0 10px 30px rgba(17,21,15,0.08)' },
  default: {
    shadowColor: '#11150f',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 30,
  },
}) as object;

function ForwardArrow({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M5 12 H19 M14 7 L19 12 L14 17"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function LaneCard({
  title,
  body,
  countLine,
  href,
  onOpen,
  stacked,
}: {
  title: string;
  body: string;
  /** Null draws nothing in the slot — no label, dash or placeholder. The Who got
   *  paid card is null by design (ruled 8 Sep 2026); the other 4 are null only
   *  while their count is not served. */
  countLine: string | null;
  href: string;
  onOpen: () => void;
  /** Phone: the cards stack, so each is as tall as its own words (rule D5). */
  stacked: boolean;
}) {
  return (
    <Pressable
      {...linkProps(href, onOpen)}
      style={[styles.laneCard, laneCardShadow, stacked && styles.stackedCard]}
    >
      <View style={styles.laneTitleRow}>
        <Text style={styles.laneTitle}>{title}</Text>
        <ForwardArrow color={t.colors.text.greenOnLight} />
      </View>
      <Text style={styles.laneBody}>{body}</Text>
      {countLine ? <Text style={styles.laneCount}>{countLine}</Text> : null}
    </Pressable>
  );
}

export function MoneyLandingScreen({ navigation }: RootScreenProps<'MoneyLanding'>) {
  const { isMobile } = useResponsive();
  const summaryQuery = useCampaignFinanceSummary();
  const filingsQuery = useCampaignFinanceFilings(5);
  // Once this page's own 2 reads have answered, quietly load the records behind
  // its destinations, so clicking one does not start a slow read from nothing
  // (#1966). Never before then: a guess must not compete with the page the
  // reader is looking at.
  useWarmMoneyDestinations(!summaryQuery.isPending && !filingsQuery.isPending);
  // Research only. The row's link says "Read the research", so a guide featured
  // here would be labelled as something it is not; a reader reaches guides
  // through the bar's Read item.
  const pieces = piecesLabelledResearch();
  const newestPiece = pieces[0];

  const summary = summaryQuery.data;
  const register = summary?.register.state === 'reported' ? summary.register : null;
  const confirmations =
    summary?.confirmations.state === 'reported' &&
    summary.confirmations.confirmedMemberCount !== null &&
    summary.confirmations.sittingMemberCount !== null
      ? {
          confirmed: summary.confirmations.confirmedMemberCount,
          total: summary.confirmations.sittingMemberCount,
          newestConfirmationAt: summary.confirmations.newestConfirmationAt,
        }
      : null;
  const contestCount =
    summary?.contests.state === 'reported' ? summary.contests.contestCount : null;
  const outsideSpendingRows =
    summary?.independentExpenditureRows.state === 'reported'
      ? summary.independentExpenditureRows.rowCount
      : null;
  const [searchDraft, setSearchDraft] = useState('');
  const onSearch = () => {
    const q = searchDraft.trim();
    navigation.navigate('MoneySearch', q ? { q } : {});
  };
  const filesLastCopied = summary?.freshness.downloadsFetchedAt ?? null;
  // The note's "Not" is the word the sentence turns on, so it alone is set heavy.
  // Split on the word rather than a copy of the sentence, so the string stays in one
  // place (lib/moneyLanding.ts) and a reworded note cannot leave a stale half here.
  const notAt = FILES_LAST_COPIED_NOTE.indexOf(' Not ');
  const noteBeforeNot =
    notAt === -1 ? FILES_LAST_COPIED_NOTE : FILES_LAST_COPIED_NOTE.slice(0, notAt + 1);
  const noteAfterNot = notAt === -1 ? '' : FILES_LAST_COPIED_NOTE.slice(notAt + 4);
  const feed = filingsQuery.data;
  const filings = feed?.state === 'reported' ? feed.filings : [];

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        {/* The section is partially built and nothing else on the page says so
            at a glance. Scrolls away with the top of the page; deleting the
            element and its component file is the whole removal. */}
        <UnderDevelopmentNotice />

        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.heading, isMobile && styles.headingMobile]}
          >
            {MONEY_LANDING_HEADING}
          </Text>
          <Text style={styles.subtitle}>{MONEY_LANDING_SUBTITLE}</Text>

          {/* The search front door, working since issue #1696: it commits on
              Enter or the button rather than as you type, because every search
              opens its own address and a keystroke-by-keystroke commit would
              leave a history entry per letter. A query under the index's floor is
              not held back here — the results page renders the server's own "type
              at least 3 characters" state, which is the honest answer rather than
              a field that silently refuses. */}
          <View style={styles.searchModule}>
            <MoneyNameSearchField
              value={searchDraft}
              onChangeText={setSearchDraft}
              onSubmit={onSearch}
              placeholder={NAME_SEARCH_PLACEHOLDER}
              showSubmitButton
            />
            <Text style={styles.searchNote}>{MONEY_LANDING_SEARCH_NOTE}</Text>
          </View>

          {/* The lanes into the records. All 5 open something now that the
              who-got-paid lane is settled as search-only (#1780) and the race and
              outside-spending pages are live (#1954, #1945). Counts bind to the
              live summary or do not appear. The row wraps rather than pinning 5
              columns: the section's one width switch is 768, so this layout has
              to hold at 800 as well as 1600, and 5 fixed columns at 800 would be
              about 118px each, which no card survives. At a wide screen the 5 sit
              in 1 row; at 800 they wrap into 2 rows; below 768 they stack. */}
          <View style={[styles.laneRow, isMobile && styles.laneRowMobile]}>
            <LaneCard
              title={MONEY_LANE_LEGISLATORS.title}
              body={legislatorsLaneBody(confirmations)}
              countLine={laneCountLine(confirmations?.total ?? null, LANE_COUNT_UNITS.legislators)}
              href={routePath.legislators()}
              onOpen={() => navigation.navigate('Legislators')}
              stacked={isMobile}
            />
            <LaneCard
              title={MONEY_LANE_COMMITTEES.title}
              body={MONEY_LANE_COMMITTEES.body}
              countLine={laneCountLine(register?.filerCount ?? null, LANE_COUNT_UNITS.committees)}
              href={routePath.moneyCommittees()}
              onOpen={() => navigation.navigate('CommitteeList')}
              stacked={isMobile}
            />
            {/* Search-only, and the card says so. Its count slot is empty and
                stays empty: there is no honest count of separate payees (a paid
                name carries only its spelling), and a label saying so was refused
                because "nothing to count" under "Who got paid" reads as "no
                payments", which is false about hundreds of thousands of rows. */}
            <LaneCard
              title={MONEY_LANE_WHO_GOT_PAID.title}
              body={MONEY_LANE_WHO_GOT_PAID.body}
              countLine={null}
              href={routePath.moneySearch()}
              onOpen={() => navigation.navigate('MoneySearch')}
              stacked={isMobile}
            />
            <LaneCard
              title={MONEY_LANE_BY_RACE.title}
              body={MONEY_LANE_BY_RACE.body}
              countLine={laneCountLine(contestCount, LANE_COUNT_UNITS.byRace)}
              href={routePath.moneyRaces()}
              onOpen={() => navigation.navigate('MoneyByRace')}
              stacked={isMobile}
            />
            <LaneCard
              title={MONEY_LANE_OUTSIDE_SPENDING.title}
              body={MONEY_LANE_OUTSIDE_SPENDING.body}
              countLine={laneCountLine(outsideSpendingRows, LANE_COUNT_UNITS.outsideSpending)}
              href={routePath.moneyOutsideSpending()}
              onOpen={() => navigation.navigate('OutsideSpending')}
              stacked={isMobile}
            />
          </View>

          {/* Two short blocks, side by side from 768 up and stacked below: the
              page's one freshness date, and the record's permanent gaps. */}
          <View style={[styles.infoGrid, isMobile && styles.infoGridMobile]}>
            {/* The one freshness date this page shows — when we last copied new
                filings, never the period any money covers (rule 12). Rendered
                only when served. "Not" is set heavy because it is the word the
                whole note turns on. */}
            {summaryQuery.isLoading ? (
              <View
                style={[styles.infoCard, isMobile && styles.stackedCard]}
                accessible
                accessibilityLabel="Loading the latest-copy date"
              >
                <Text style={styles.infoLabel}>{FILES_LAST_COPIED_LABEL.toUpperCase()}</Text>
                <View style={styles.freshnessSkeleton}>
                  <Skeleton width={160} height={24} />
                </View>
              </View>
            ) : filesLastCopied ? (
              <View style={[styles.infoCard, isMobile && styles.stackedCard]}>
                <Text style={styles.infoLabel}>{FILES_LAST_COPIED_LABEL.toUpperCase()}</Text>
                <Text style={styles.freshnessDate}>{centralDateLabel(filesLastCopied)}</Text>
                <Text style={styles.infoNote}>
                  {noteBeforeNot}
                  <Text style={styles.infoNoteHeavy}>Not</Text>
                  {noteAfterNot}
                </Text>
              </View>
            ) : null}

            {/* The gaps, in plain words, above anything a reader might search
                for: someone who types a name and gets nothing must not conclude
                the person gave nothing. The 4th line is the fact that left the
                Who got paid card (8 Sep 2026). The confirmed-member count is
                stated once on this page, in the Legislators lane, and not again
                here. */}
            <View style={[styles.infoCard, isMobile && styles.stackedCard]}>
              <Text style={styles.infoLabel}>{RECORD_DOES_NOT_COVER_HEADING.toUpperCase()}</Text>
              <View style={styles.notCoveredList}>
                {MONEY_LANDING_RECORD_DOES_NOT_COVER.map((line) => (
                  <Text key={line} style={styles.notCoveredLine}>
                    {line}
                  </Text>
                ))}
              </View>
              <Text style={styles.infoNote}>{RECORD_DOES_NOT_COVER_NOTE}</Text>
            </View>
          </View>

          {/* RESEARCH — a quiet row, not a card: the newest research piece with
              its standfirst and both dates, linking to the piece itself. With
              nothing published it reads its one line and nothing else — no count
              of 0, no second link out. */}
          <View style={styles.researchBlock}>
            <Text accessibilityRole="header" aria-level={2} style={styles.infoLabel}>
              {RESEARCH_ROW_LABEL}
            </Text>
            {newestPiece ? (
              <Pressable
                {...linkProps(routePath.research(newestPiece.slug), () =>
                  navigation.navigate('Research', { slug: newestPiece.slug }),
                )}
                style={[styles.researchRow, isMobile && styles.researchRowMobile]}
              >
                <View style={styles.researchText}>
                  <Text style={[styles.researchTitle, isMobile && styles.researchTitleMobile]}>
                    {newestPiece.title}
                  </Text>
                  <Text style={styles.researchDek}>{newestPiece.dek}</Text>
                  <Text style={styles.researchDates}>{researchDatesLine(newestPiece)}</Text>
                </View>
                <View style={styles.researchCta}>
                  <Text style={styles.researchCtaText}>{RESEARCH_ROW_LINK}</Text>
                  <ForwardArrow color={t.colors.text.greenOnLight} size={16} />
                </View>
              </Pressable>
            ) : (
              <Text style={styles.researchEmpty}>{RESEARCH_ROW_EMPTY}</Text>
            )}
          </View>

          {/* The most recent completed filing period. A row carries the day the
              Board received it where the report's own document states one and
              nothing where it does not (issue #1670), so the ordering sentence
              and the tie sentence both derive from the served `ordered_by` —
              1,200+ filers can share one period end, and which rows are on top
              depends entirely on how many of them are dated. Never an amount:
              five rows with five dollar figures is a ranking whether we sort it
              or not. */}
          {filingsQuery.isLoading ? (
            <View style={styles.filingsBlock} accessible accessibilityLabel="Loading filed reports">
              <Text style={styles.infoLabel}>THE MOST RECENT COMPLETED FILING PERIOD</Text>
              <View style={styles.filingsList}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={styles.filingRow}>
                    <Skeleton width="100%" height={44} radius={8} />
                  </View>
                ))}
              </View>
            </View>
          ) : filings.length > 0 ? (
            <View style={styles.filingsBlock}>
              <View style={styles.filingsHeadingRow}>
                <Text accessibilityRole="header" aria-level={2} style={styles.infoLabel}>
                  THE MOST RECENT COMPLETED FILING PERIOD
                </Text>
                {orderingSentence(feed?.orderedBy ?? '') ? (
                  <Text style={styles.filingsSort}>
                    {orderingSentence(feed?.orderedBy ?? '')} — never by amount
                  </Text>
                ) : null}
              </View>
              <Text style={styles.filingsTie}>
                {filingsTieSentence(feed?.newestPeriod?.filingCount ?? null, feed?.orderedBy ?? '')}
              </Text>
              <View style={styles.filingsList}>
                {filings.map((filing, index) => {
                  const filed = filedDateSentence(filing.filedDate);
                  return (
                    <View
                      key={index}
                      style={[styles.filingRow, isMobile && styles.filingRowMobile]}
                    >
                      <View style={styles.filingBody}>
                        <Text style={styles.filingCommittee}>{filing.filerName}</Text>
                        <Text style={styles.filingReport}>
                          {filing.reportName}
                          {filingPeriodLine(filing) ? ` · ${filingPeriodLine(filing)}` : ''}
                        </Text>
                      </View>
                      {/* The row's third fact. Beside the name on a computer, under
                          it on a phone — never dropped at width (rule D3), and never
                          substituted when the Board states no date (#1670). */}
                      {filed ? (
                        <Text style={[styles.filingFiled, isMobile && styles.filingFiledMobile]}>
                          {filed.toUpperCase()}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}
        </Container>

        <Footer
          onContact={() => navigation.navigate('ContactUs')}
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  main: { paddingTop: 44, paddingBottom: 72, flexGrow: 1 },
  mainMobile: { paddingTop: 28, paddingBottom: 52 },
  heading: {
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 46,
    lineHeight: 50,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1.4,
  },
  headingMobile: { fontSize: 30, lineHeight: 34, letterSpacing: -0.9 },
  subtitle: {
    marginTop: 14,
    maxWidth: 860,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 19,
    lineHeight: 29,
  },
  searchModule: { marginTop: 28 },
  searchNote: {
    marginTop: 12,
    maxWidth: 780,
    color: t.colors.text.muted,
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 24,
  },
  laneRow: { marginTop: 40, flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  laneRowMobile: { marginTop: 32, flexDirection: 'column', gap: 16 },
  // The basis is what decides the wrap: 5 × 208 + 4 gaps fits inside the 1,328px row a
  // 1440 screen leaves, and 3 fit across the 688px row an 800 screen leaves, so the 5
  // wrap into 2 rows there rather than crushing to 118px each.
  laneCard: {
    flex: 1,
    flexBasis: 208,
    minWidth: 0,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 18,
    paddingVertical: 26,
    paddingHorizontal: 24,
  },
  // `flex: 1` shares a ROW; in a stacked column it would share the column's height
  // instead and let a long body spill past its card, so stacked cards size to content.
  // Spelled out as the 3 properties: react-native-web drops a bare `flex: 0`.
  stackedCard: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  laneTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  laneTitle: {
    flexShrink: 1,
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.4,
  },
  laneBody: {
    marginTop: 12,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 26,
  },
  // Sits at the card foot so the counts share a baseline across the row; green,
  // one treatment with the arrow, because each card is a link.
  laneCount: {
    marginTop: 'auto',
    paddingTop: 18,
    color: t.colors.text.greenOnLight,
    fontFamily: t.typography.mono,
    fontSize: 13,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
  },
  infoGrid: { marginTop: 44, maxWidth: 1200, flexDirection: 'row', gap: 20 },
  infoGridMobile: { marginTop: 32, flexDirection: 'column', gap: 16 },
  infoCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 16,
    paddingTop: 24,
    paddingHorizontal: 26,
    paddingBottom: 26,
  },
  infoLabel: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.4,
  },
  freshnessSkeleton: { marginTop: 10 },
  freshnessDate: {
    marginTop: 10,
    color: t.colors.text.primary,
    fontFamily: t.typography.mono,
    fontSize: 24,
    fontWeight: t.fontWeights.bold,
    letterSpacing: -0.2,
  },
  infoNote: {
    marginTop: 12,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 24,
  },
  infoNoteHeavy: { color: t.colors.text.primary, fontWeight: t.fontWeights.heavy },
  notCoveredList: { marginTop: 14, gap: 8 },
  notCoveredLine: {
    color: t.colors.ink,
    fontFamily: t.typography.body,
    fontSize: 16.5,
    lineHeight: 25,
  },
  researchBlock: {
    marginTop: 44,
    paddingTop: 30,
    maxWidth: 1200,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink10,
  },
  researchRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 32,
    paddingTop: 18,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  researchRowMobile: { flexDirection: 'column', alignItems: 'flex-start', gap: 14 },
  researchText: { flex: 1, minWidth: 0 },
  researchTitle: {
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.3,
  },
  researchTitleMobile: { fontSize: 20, lineHeight: 25 },
  researchDek: {
    marginTop: 5,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 26,
  },
  researchDates: {
    marginTop: 9,
    color: t.colors.text.muted,
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
  },
  researchCta: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 9 },
  researchCtaText: {
    color: t.colors.text.greenOnLight,
    fontFamily: t.typography.ui,
    fontSize: 17,
    fontWeight: t.fontWeights.bold,
  },
  researchEmpty: {
    marginTop: 14,
    paddingTop: 20,
    paddingBottom: 22,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
    color: t.colors.text.muted,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 26,
  },
  filingsBlock: {
    marginTop: 44,
    paddingTop: 30,
    maxWidth: 1200,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink10,
  },
  filingsHeadingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    columnGap: 14,
    rowGap: 6,
  },
  filingsSort: {
    color: t.colors.text.muted,
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 24,
  },
  filingsTie: {
    marginTop: 8,
    color: t.colors.text.muted,
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
  },
  filingsList: { marginTop: 10 },
  filingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 24,
    paddingVertical: 17,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  filingRowMobile: { flexDirection: 'column', gap: 6, paddingVertical: 14 },
  filingBody: { flex: 1, minWidth: 0 },
  filingCommittee: {
    color: t.colors.text.primary,
    fontFamily: t.typography.ui,
    fontSize: 18,
    fontWeight: t.fontWeights.bold,
  },
  filingReport: {
    marginTop: 5,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 23,
  },
  filingFiled: {
    flexShrink: 0,
    color: t.colors.text.muted,
    fontFamily: t.typography.mono,
    fontSize: 12.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
  },
  filingFiledMobile: { flexShrink: 1 },
});
