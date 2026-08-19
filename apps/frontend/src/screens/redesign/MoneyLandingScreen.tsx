import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Skeleton } from '../../components/Skeleton';
import { UnderDevelopmentNotice } from '../../components/campaignMoney/UnderDevelopmentNotice';
import { useResponsive } from '../../hooks/useResponsive';
import { useCampaignFinanceFilings, useCampaignFinanceSummary } from '../../hooks/useAppQueries';
import {
  centralDateLabel,
  confirmationDateLine,
  confirmationLine,
  FILINGS_TIE_SENTENCE,
  filingPeriodLine,
  laneCountLine,
  legislatorsLaneSentence,
  orderingSentence,
  RECORD_DOES_NOT_COVER,
} from '../../lib/moneyLanding';
import { publishedReports, reportDatesLine } from '../../lib/moneyReports';
import { linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

/**
 * The campaign money landing at /money — public, no sign-in gate ("Campaign
 * money IA.dc.html" §01, plus Eugene's 18 Aug 2026 decision that every lane
 * card is visible: a lane whose page is not built yet shows, is plainly not
 * clickable, and says so, so a reader sees the whole shape of the section).
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

function MagnifierGlyph() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Circle cx={11} cy={11} r={6.5} stroke={t.colors.text.faint} strokeWidth={2} />
      <Path d="M16 16 L21 21" stroke={t.colors.text.faint} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** Mono chip marking a part of the section that exists on the plan but has no
 *  page yet. Neutral ink, not an alert color. */
function NotBuiltChip() {
  return (
    <View style={styles.notBuiltChip}>
      <Text style={styles.notBuiltChipText}>NOT BUILT YET</Text>
    </View>
  );
}

function LaneCard({
  title,
  body,
  countLine,
  href,
  onOpen,
  notBuiltLine,
}: {
  title: string;
  body: string;
  countLine: string | null;
  /** Present = the lane's page exists and the card is a link. */
  href?: string;
  onOpen?: () => void;
  /** Present = the page is not built yet; the card is inert and says so. */
  notBuiltLine?: string;
}) {
  const inner = (
    <>
      <View style={styles.laneTitleRow}>
        <Text style={styles.laneTitle}>{title}</Text>
        {notBuiltLine ? <NotBuiltChip /> : null}
      </View>
      <Text style={styles.laneBody}>{body}</Text>
      {notBuiltLine ? <Text style={styles.laneNotBuilt}>{notBuiltLine}</Text> : null}
      {countLine ? <Text style={styles.laneCount}>{countLine}</Text> : null}
    </>
  );
  if (href && onOpen) {
    return (
      <Pressable {...linkProps(href, onOpen)} style={[styles.laneCard, styles.laneCardLive]}>
        {inner}
      </Pressable>
    );
  }
  return <View style={[styles.laneCard, styles.laneCardInert]}>{inner}</View>;
}

export function MoneyLandingScreen({ navigation }: RootScreenProps<'MoneyLanding'>) {
  const { isMobile } = useResponsive();
  const summaryQuery = useCampaignFinanceSummary();
  const filingsQuery = useCampaignFinanceFilings(5);
  const reports = publishedReports();
  const newestReport = reports[0];

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
            Follow the money
          </Text>
          <Text style={styles.subtitle}>
            Every contribution and expenditure Minnesota publishes for state campaigns.
          </Text>

          {/* The search front door, visible before it works: the section's plan
              is search-first, and Eugene's call is to show the whole shape with
              the unbuilt parts plainly labelled. An inert box, not a field — a
              control a reader could focus and type into would be a promise. */}
          <View style={styles.searchModule}>
            <View style={styles.searchBox}>
              <MagnifierGlyph />
              <Text style={styles.searchPlaceholder}>
                Search any name — people, committees, who got paid
              </Text>
            </View>
            <Text style={styles.searchNotBuilt}>Search is not built yet.</Text>
          </View>

          {/* WHAT WE FOUND — the research lane, first in prominence. The shelf
              exists, so the card links; with nothing published it says so and
              counts 0 honestly. */}
          <Pressable
            {...linkProps(routePath.moneyReports(), () => navigation.navigate('MoneyReports'))}
            style={styles.featuredCard}
          >
            <Text style={styles.featuredEyebrow}>WHAT WE FOUND</Text>
            {newestReport ? (
              <>
                <Text style={[styles.featuredTitle, isMobile && styles.featuredTitleMobile]}>
                  {newestReport.title}
                </Text>
                <Text style={styles.featuredDek}>{newestReport.dek}</Text>
                <Text style={styles.featuredDates}>{reportDatesLine(newestReport)}</Text>
                <View style={styles.featuredCta}>
                  <Text style={styles.featuredCtaText}>Read the report</Text>
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
                  the shelf, dated and carrying the date its records run through.
                </Text>
                <Text style={styles.featuredDates}>0 REPORTS PUBLISHED</Text>
                <View style={styles.featuredCta}>
                  <Text style={styles.featuredCtaText}>See the shelf</Text>
                  <ForwardArrow color={t.colors.text.greenOnLight} />
                </View>
              </>
            )}
          </Pressable>

          {/* The lanes into the records. All visible; the unbuilt two are inert
              and say so (Eugene, 18 Aug 2026). Counts bind to the live register
              or do not appear. */}
          <View style={[styles.laneRow, isMobile && styles.laneRowMobile]}>
            <LaneCard
              title="Legislators"
              body={
                'Their money is a tab on the profile they already have.' +
                (confirmations ? ` ${legislatorsLaneSentence(confirmations)}` : '')
              }
              countLine={laneCountLine(confirmations?.total ?? null, 'members')}
              href={routePath.legislators()}
              onOpen={() => navigation.navigate('Legislators')}
            />
            <LaneCard
              title="Committees"
              body="Campaign committees, party units, and other registered funds."
              countLine={laneCountLine(register?.filerCount ?? null, 'registered filers')}
              notBuiltLine="This page is not built yet."
            />
            <LaneCard
              title="Who got paid"
              body="Payments as filed, with no page per name."
              countLine={null}
              notBuiltLine="This page is not built yet."
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
              <Text style={styles.freshnessLabel}>FILES LAST COPIED</Text>
              <Text style={styles.freshnessDate}>{centralDateLabel(filesLastCopied)}</Text>
              <Text style={styles.freshnessNote}>
                When we last copied new filings from the Board. Not the period the money covers —
                every figure carries its own period, and each one ends earlier than this date.
              </Text>
            </View>
          ) : null}

          {/* The gaps, in plain words, above anything a reader might search for:
              someone who types a name and gets nothing must not conclude the
              person gave nothing. */}
          <View style={styles.notCoveredBox}>
            <Text style={styles.notCoveredLabel}>WHAT THIS RECORD DOES NOT COVER</Text>
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

          {/* The most recent completed filing period — NOT "filings as they
              arrive": the Board serves no filed date (issue #1670), the feed
              orders by period end, and 1,200+ filers can share one period end
              with the tie broken alphabetically, so the copy says exactly what
              the rows are. Never an amount — five rows with five dollar figures
              is a ranking whether we sort it or not. */}
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
              <Text style={styles.filingsSort}>{FILINGS_TIE_SENTENCE}</Text>
              <View style={styles.filingsList}>
                {filings.map((filing, index) => (
                  <View key={index} style={styles.filingRow}>
                    <View style={styles.filingBody}>
                      <Text style={styles.filingCommittee}>{filing.filerName}</Text>
                      <Text style={styles.filingReport}>
                        {filing.reportName}
                        {filingPeriodLine(filing) ? ` · ${filingPeriodLine(filing)}` : ''}
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
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    maxWidth: 760,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 13,
    paddingVertical: 15,
    paddingHorizontal: 17,
  },
  searchPlaceholder: {
    flex: 1,
    minWidth: 0,
    color: t.colors.text.faint,
    fontFamily: t.typography.body,
    fontSize: 16.5,
  },
  searchNotBuilt: {
    marginTop: 8,
    color: t.colors.text.muted,
    fontFamily: t.typography.body,
    fontSize: 14.5,
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
  laneCardInert: {
    backgroundColor: t.colors.surfaces.s100,
    borderColor: t.colors.alpha.ink08,
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
  laneNotBuilt: {
    marginTop: 8,
    color: t.colors.text.muted,
    fontFamily: t.typography.body,
    fontSize: 14.5,
  },
  laneCount: {
    marginTop: 14,
    color: t.colors.text.muted,
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
  },
  notBuiltChip: {
    borderWidth: 1,
    borderColor: t.colors.alpha.ink18,
    borderRadius: 7,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  notBuiltChipText: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.mono,
    fontSize: 9.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
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
