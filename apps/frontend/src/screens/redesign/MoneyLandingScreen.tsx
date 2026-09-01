import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Skeleton } from '../../components/Skeleton';
import { MoneyNameSearchField } from '../../components/campaignMoney/MoneyNameSearchField';
import { UnderDevelopmentNotice } from '../../components/campaignMoney/UnderDevelopmentNotice';
import { useResponsive } from '../../hooks/useResponsive';
import { useCampaignFinanceFilings, useCampaignFinanceSummary } from '../../hooks/useAppQueries';
import {
  centralDateLabel,
  confirmationDateLine,
  confirmationLine,
  filedDateSentence,
  filingsTieSentence,
  filingPeriodLine,
  laneCountLine,
  legislatorsLaneSentence,
  orderingSentence,
  FILES_LAST_COPIED_LABEL,
  FILES_LAST_COPIED_NOTE,
  MONEY_LANDING_HEADING,
  MONEY_LANDING_SUBTITLE,
  MONEY_LANE_COMMITTEES,
  MONEY_LANE_LEGISLATORS,
  MONEY_LANE_WHO_GOT_PAID,
  RECORD_DOES_NOT_COVER,
  RECORD_DOES_NOT_COVER_HEADING,
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
 * is visible, so a reader sees the whole shape of the section). All 3 lanes open
 * something since #1780 settled the who-got-paid lane as search-only, so no card
 * is inert any more.
 *
 * What this page may never do (IA §04): no lane counts money, no top raisers,
 * no amount on any row that lists more than one member, and no count that is
 * not served by a live query. Counts and dates come from
 * /campaign-finance/summary and the filed reports from
 * /campaign-finance/filings; each block carries its own state, and a block that
 * is not served renders its designed absent state — never a zero. A served 0
 * (0 of 200 committees confirmed) is a verified fact and renders as a number.
 */

function ForwardArrow({ color }: { color: string }) {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" aria-hidden>
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
}: {
  title: string;
  body: string;
  countLine: string | null;
  href: string;
  onOpen: () => void;
}) {
  return (
    <Pressable {...linkProps(href, onOpen)} style={[styles.laneCard, styles.laneCardLive]}>
      <View style={styles.laneTitleRow}>
        <Text style={styles.laneTitle}>{title}</Text>
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
  // Research only. This card says "Read the research", so a guide featured here
  // would be labelled as something it is not; a reader reaches guides through the
  // /read page this card links to, and through the bar's Read item.
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
  const [searchDraft, setSearchDraft] = useState('');
  const onSearch = () => {
    const q = searchDraft.trim();
    navigation.navigate('MoneySearch', q ? { q } : {});
  };
  const filesLastCopied = summary?.freshness.downloadsFetchedAt ?? null;
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
          {/* The design's own sentence, restored now that the field below works
              and the committees list exists: until then the clause was dropped,
              because copy may only claim what the shipped surfaces deliver
              (grounded-answers.md rules 2 and 6). */}
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
            <Text style={styles.searchNote}>
              Matched on the name as it was filed, exactly as typed. We offer no nearest match:
              names here differ from each other by a single character often enough that a guess
              would put you on the wrong organisation.
            </Text>
          </View>

          {/* WHAT WE FOUND — the research lane, first in prominence. The
              /read page exists, so the card links; with no research published
              it says so and counts 0 honestly. It features the newest RESEARCH
              piece, never a guide. */}
          <Pressable
            {...linkProps(routePath.read(), () => navigation.navigate('Read'))}
            style={styles.featuredCard}
          >
            <Text style={styles.featuredEyebrow}>WHAT WE FOUND</Text>
            {newestPiece ? (
              <>
                <Text style={[styles.featuredTitle, isMobile && styles.featuredTitleMobile]}>
                  {newestPiece.title}
                </Text>
                <Text style={styles.featuredDek}>{newestPiece.dek}</Text>
                <Text style={styles.featuredDates}>{researchDatesLine(newestPiece)}</Text>
                <View style={styles.featuredCta}>
                  <Text style={styles.featuredCtaText}>Read the research</Text>
                  <ForwardArrow color={t.colors.text.greenOnLight} />
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.featuredTitle, isMobile && styles.featuredTitleMobile]}>
                  Our own research on these records
                </Text>
                <Text style={styles.featuredDek}>
                  Nothing is published yet. When we publish research on these records, it appears on
                  our research page, dated and carrying the date its records run through.
                </Text>
                <Text style={styles.featuredDates}>0 RESEARCH PIECES PUBLISHED</Text>
                <View style={styles.featuredCta}>
                  <Text style={styles.featuredCtaText}>See our research</Text>
                  <ForwardArrow color={t.colors.text.greenOnLight} />
                </View>
              </>
            )}
          </Pressable>

          {/* The lanes into the records. All 3 open something now that the
              who-got-paid lane is settled as search-only (#1780). Counts bind to
              the live register or do not appear. */}
          <View style={[styles.laneRow, isMobile && styles.laneRowMobile]}>
            <LaneCard
              title={MONEY_LANE_LEGISLATORS.title}
              body={
                MONEY_LANE_LEGISLATORS.body +
                (confirmations ? ` ${legislatorsLaneSentence(confirmations)}` : '')
              }
              countLine={laneCountLine(confirmations?.total ?? null, 'members')}
              href={routePath.legislators()}
              onOpen={() => navigation.navigate('Legislators')}
            />
            <LaneCard
              title={MONEY_LANE_COMMITTEES.title}
              body={MONEY_LANE_COMMITTEES.body}
              countLine={laneCountLine(register?.filerCount ?? null, 'registered filers')}
              href={routePath.moneyCommittees()}
              onOpen={() => navigation.navigate('CommitteeList')}
            />
            {/* Search-only, and the card says so rather than promising a list the
                design set does not draw. There is no honest ordering for a
                browse-all-payees list, so the lane opens the name search and one
                name opens every payment filed under that spelling (#1780). */}
            <LaneCard
              title={MONEY_LANE_WHO_GOT_PAID.title}
              body={MONEY_LANE_WHO_GOT_PAID.body}
              countLine={null}
              href={routePath.moneySearch()}
              onOpen={() => navigation.navigate('MoneySearch')}
            />
          </View>

          {/* The one freshness date this page shows — when we last copied new
              filings, never the period any money covers (rule 12). Rendered
              only when served. */}
          {summaryQuery.isLoading ? (
            <View
              style={styles.freshnessBox}
              accessible
              accessibilityLabel="Loading the latest-copy date"
            >
              <Skeleton width={220} height={16} />
            </View>
          ) : filesLastCopied ? (
            <View style={styles.freshnessBox}>
              <Text style={styles.freshnessLabel}>{FILES_LAST_COPIED_LABEL.toUpperCase()}</Text>
              <Text style={styles.freshnessDate}>{centralDateLabel(filesLastCopied)}</Text>
              <Text style={styles.freshnessNote}>{FILES_LAST_COPIED_NOTE}</Text>
            </View>
          ) : null}

          {/* The gaps, in plain words, above anything a reader might search for:
              someone who types a name and gets nothing must not conclude the
              person gave nothing. */}
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
              {confirmations ? (
                <>
                  <Text style={styles.notCoveredLine}>{confirmationLine(confirmations)}</Text>
                  {confirmationDateLine(confirmations.newestConfirmationAt) ? (
                    <Text style={styles.notCoveredFootnote}>
                      {confirmationDateLine(confirmations.newestConfirmationAt)}
                    </Text>
                  ) : null}
                </>
              ) : null}
            </View>
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
              <Text style={styles.notCoveredLabel}>THE MOST RECENT COMPLETED FILING PERIOD</Text>
              <View style={styles.filingsList}>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} width="100%" height={56} radius={12} />
                ))}
              </View>
            </View>
          ) : filings.length > 0 ? (
            <View style={styles.filingsBlock}>
              <Text style={styles.notCoveredLabel}>THE MOST RECENT COMPLETED FILING PERIOD</Text>
              {orderingSentence(feed?.orderedBy ?? '') ? (
                <Text style={styles.filingsSort}>
                  {orderingSentence(feed?.orderedBy ?? '')} — never by amount
                </Text>
              ) : null}
              <Text style={styles.filingsSort}>
                {filingsTieSentence(feed?.newestPeriod?.filingCount ?? null, feed?.orderedBy ?? '')}
              </Text>
              <View style={styles.filingsList}>
                {filings.map((filing, index) => (
                  <View key={index} style={styles.filingRow}>
                    <View style={styles.filingBody}>
                      <Text style={styles.filingCommittee}>{filing.filerName}</Text>
                      <Text style={styles.filingReport}>
                        {filing.reportName}
                        {filingPeriodLine(filing) ? ` · ${filingPeriodLine(filing)}` : ''}
                        {filedDateSentence(filing.filedDate)
                          ? ` · ${filedDateSentence(filing.filedDate)}`
                          : ''}
                      </Text>
                    </View>
                  </View>
                ))}
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
  headingMobile: { fontSize: 34, lineHeight: 38, letterSpacing: -1 },
  subtitle: {
    marginTop: 14,
    maxWidth: 760,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 19,
    lineHeight: 29,
  },
  searchModule: { marginTop: 28 },
  searchNote: {
    marginTop: 10,
    maxWidth: 760,
    color: t.colors.text.muted,
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
  },
  featuredCard: {
    marginTop: 32,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: 16,
    padding: 28,
  },
  featuredEyebrow: {
    color: t.colors.text.greenOnLight,
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.4,
  },
  featuredTitle: {
    marginTop: 12,
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.6,
  },
  featuredTitleMobile: { fontSize: 23, lineHeight: 28 },
  featuredDek: {
    marginTop: 10,
    maxWidth: 760,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 26,
  },
  featuredDates: {
    marginTop: 14,
    color: t.colors.text.muted,
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
  },
  featuredCta: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  featuredCtaText: {
    color: t.colors.text.greenOnLight,
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.bold,
  },
  laneRow: { marginTop: 16, flexDirection: 'row', gap: 16 },
  laneRowMobile: { flexDirection: 'column' },
  laneCard: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 16,
    padding: 22,
  },
  laneCardLive: {
    backgroundColor: t.colors.surfaces.base,
    borderColor: t.colors.alpha.ink10,
  },
  laneTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  laneTitle: {
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 21,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.3,
  },
  laneBody: {
    marginTop: 8,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 15.5,
    lineHeight: 24,
  },
  laneCount: {
    marginTop: 14,
    color: t.colors.text.muted,
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
  },
  freshnessBox: {
    marginTop: 32,
    maxWidth: 760,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink10,
    paddingTop: 24,
  },
  freshnessLabel: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.mono,
    fontSize: 10.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
  },
  freshnessDate: {
    marginTop: 8,
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 24,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.4,
  },
  freshnessNote: {
    marginTop: 8,
    color: t.colors.text.muted,
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
  },
  notCoveredBox: {
    marginTop: 32,
    maxWidth: 760,
    backgroundColor: t.colors.surfaces.s200,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 15,
    padding: 24,
  },
  notCoveredLabel: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.mono,
    fontSize: 10.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
  },
  notCoveredList: { marginTop: 14, gap: 9 },
  notCoveredLine: {
    color: t.colors.ink,
    fontFamily: t.typography.body,
    fontSize: 16.5,
    lineHeight: 26,
  },
  notCoveredFootnote: {
    color: t.colors.text.muted,
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 21,
  },
  filingsBlock: { marginTop: 32, maxWidth: 760 },
  filingsSort: {
    marginTop: 8,
    color: t.colors.text.muted,
    fontFamily: t.typography.body,
    fontSize: 14.5,
  },
  filingsList: { marginTop: 14, gap: 10 },
  filingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  filingBody: { flex: 1, minWidth: 0 },
  filingCommittee: {
    color: t.colors.text.primary,
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.bold,
  },
  filingReport: {
    marginTop: 4,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
  },
});
