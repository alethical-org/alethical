import { useCallback, useId, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Skeleton } from '../../components/Skeleton';
import { LinkArrow, LinkArrowLabel, linkArrowRow } from '../../components/LinkArrow';
import { MoneyNameSearchField } from '../../components/campaignMoney/MoneyNameSearchField';
import { useLobbyingSummary } from '../../hooks/useLobbying';
import { MONEY_LANE_LOBBYING, moneyLandingLobbyistCount } from '../../lib/lobbyingDirectoryCopy';
import { useResponsive } from '../../hooks/useResponsive';
import {
  useCampaignFinanceFilings,
  useCampaignFinanceSummary,
  useWarmMoneyDestinations,
} from '../../hooks/useAppQueries';
import {
  centralDateLabel,
  filedDateSentence,
  newestPeriodSentence,
  filingPeriodLine,
  laneCountLine,
  legislatorsLaneBody,
  orderingSentence,
  LANE_COUNT_UNITS,
  MONEY_LANDING_HEADING,
  MONEY_LANDING_COVERAGE_HEADING,
  MONEY_LANDING_RECORD_DOES_NOT_COVER,
  MONEY_LANDING_SEARCH_NOTE,
  MONEY_LANDING_SEARCH_PLACEHOLDER,
  RECENT_FILINGS_HEADING,
  MONEY_LANDING_SUBTITLE,
  MONEY_LANE_BY_RACE,
  MONEY_LANE_COMMITTEES,
  MONEY_LANE_LEGISLATORS,
  MONEY_LANE_OUTSIDE_SPENDING,
  MONEY_LANE_WHO_GOT_PAID,
  RESEARCH_ROW_EMPTY,
  RESEARCH_ROW_LABEL,
  RESEARCH_ROW_LINK,
} from '../../lib/moneyLanding';
import { committeeSlug } from '../../lib/committeeMoneyShared';
import { piecesLabelledResearch, isoDateCapsLabel } from '../../lib/research';
import {
  MONEY_SOURCE_GROUPS,
  MONEY_SOURCES_HEADING,
  MONEY_SOURCES_ATTRIBUTION,
  MONEY_SOURCES_PERIOD_NOTE,
} from '../../lib/moneyLandingSources';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

/**
 * The campaign money landing at /money — public, no sign-in gate ("Campaign
 * money IA.dc.html" §01, plus Eugene's 18 Aug 2026 decision that every lane card
 * is visible, so a reader sees the whole shape of the section). Redrawn 8 Sep
 * 2026 and refined 17 Sep: 6 lanes follow the search, then research, sources
 * and copy dates with an optional disclosure, record limits, and filed reports.
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

function LaneCard({
  title,
  body,
  countLine,
  href,
  onOpen,
  stacked,
  tablet,
  wide,
  cardWidth,
}: {
  title: string;
  body: string;
  /** Null draws nothing in the slot — no label, dash or placeholder. The Who got
   *  paid card is null by design (ruled 8 Sep 2026); the other 5 are null only
   *  while their count is not served. */
  countLine: string | null;
  href: string;
  onOpen: () => void;
  /** Phone: the cards stack, so each is as tall as its own words (rule D5). */
  stacked: boolean;
  tablet: boolean;
  wide: boolean;
  cardWidth: number;
}) {
  return (
    <Pressable
      {...linkProps(href, onOpen)}
      style={[
        styles.laneCard,
        laneCardShadow,
        { width: cardWidth },
        tablet && styles.laneCardTablet,
        stacked && styles.laneCardMobile,
      ]}
    >
      <View
        style={[styles.laneTitleRow, { minHeight: stacked ? 0 : tablet ? 30 : wide ? 50 : 32 }]}
      >
        <Text
          style={[
            styles.laneTitle,
            tablet && styles.laneTitleTablet,
            stacked && styles.laneTitleMobile,
          ]}
        >
          {title}
        </Text>
        <LinkArrow color={t.colors.text.greenOnLight} style={{ width: 18, height: 18 }} />
      </View>
      <Text style={[styles.laneBody, (tablet || stacked) && styles.laneBodyNarrow]}>{body}</Text>
      {countLine ? (
        <Text style={[styles.laneCount, stacked && styles.laneCountMobile]}>{countLine}</Text>
      ) : null}
    </Pressable>
  );
}

export function MoneyLandingScreen({ navigation }: RootScreenProps<'MoneyLanding'>) {
  const { isMobile, isTablet, width } = useResponsive();
  const narrow = isMobile || isTablet;
  const wide = width >= 1440;
  const columns = isMobile ? 1 : isTablet ? 2 : wide ? 6 : 3;
  const gap = isMobile ? 12 : isTablet ? 14 : 16;
  const gutter = isMobile ? 20 : isTablet ? 32 : 56;
  const cardWidth = (width - 2 * gutter - gap * (columns - 1)) / columns;
  const laneLayout = { stacked: isMobile, tablet: isTablet, wide, cardWidth };
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sourceControlFocused, setSourceControlFocused] = useState(false);
  const sourceGroupsId = useId();
  useFocusEffect(
    useCallback(() => {
      setSourcesOpen(false);
    }, []),
  );
  const summaryQuery = useCampaignFinanceSummary();
  const lobbyingQuery = useLobbyingSummary();
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
  const registerLastCopied = summary?.freshness.registerFetchedAt ?? null;
  const lobbyingLastCopied = lobbyingQuery.data?.copied_at ?? null;
  const feed = filingsQuery.data;
  const filings = feed?.state === 'reported' ? feed.filings : [];

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        <Container
          style={[styles.main, isTablet && styles.mainTablet, isMobile && styles.mainMobile]}
        >
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[
              styles.heading,
              isTablet && styles.headingTablet,
              isMobile && styles.headingMobile,
            ]}
          >
            {MONEY_LANDING_HEADING}
          </Text>
          <Text
            style={[
              styles.subtitle,
              isTablet && styles.subtitleTablet,
              isMobile && styles.subtitleMobile,
            ]}
          >
            {MONEY_LANDING_SUBTITLE}
          </Text>

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
              placeholder={MONEY_LANDING_SEARCH_PLACEHOLDER}
              showSubmitButton
              stacked={isMobile}
              controlGap={isMobile ? 10 : undefined}
              fieldHeight={isMobile ? 52 : isTablet ? 54 : undefined}
            />
            <Text style={styles.searchNote}>{MONEY_LANDING_SEARCH_NOTE}</Text>
          </View>

          {/* All 6 destinations remain visible. Each live count belongs to its
              own source; cards wrap at tablet widths and stack on the phone. */}
          <View
            testID="money-lanes"
            style={[styles.laneRow, { gap }, isMobile && styles.laneRowMobile]}
          >
            <LaneCard
              title={MONEY_LANE_LEGISLATORS.title}
              body={legislatorsLaneBody(confirmations)}
              countLine={laneCountLine(confirmations?.total ?? null, LANE_COUNT_UNITS.legislators)}
              href={routePath.legislators({ tab: 'money' })}
              onOpen={() => navigation.navigate('Legislators', { tab: 'money' })}
              {...laneLayout}
            />
            <LaneCard
              title={MONEY_LANE_COMMITTEES.title}
              body={MONEY_LANE_COMMITTEES.body}
              countLine={laneCountLine(register?.filerCount ?? null, LANE_COUNT_UNITS.committees)}
              href={routePath.moneyCommittees()}
              onOpen={() => navigation.navigate('CommitteeList')}
              {...laneLayout}
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
              {...laneLayout}
            />
            <LaneCard
              title={MONEY_LANE_BY_RACE.title}
              body={MONEY_LANE_BY_RACE.body}
              countLine={laneCountLine(contestCount, LANE_COUNT_UNITS.byRace)}
              href={routePath.moneyRaces()}
              onOpen={() => navigation.navigate('MoneyByRace')}
              {...laneLayout}
            />
            <LaneCard
              title={MONEY_LANE_OUTSIDE_SPENDING.title}
              body={MONEY_LANE_OUTSIDE_SPENDING.body}
              countLine={laneCountLine(outsideSpendingRows, LANE_COUNT_UNITS.outsideSpending)}
              href={routePath.moneyOutsideSpending()}
              onOpen={() => navigation.navigate('OutsideSpending')}
              {...laneLayout}
            />
            <LaneCard
              title={MONEY_LANE_LOBBYING.title}
              body={MONEY_LANE_LOBBYING.body}
              countLine={moneyLandingLobbyistCount(
                lobbyingQuery.data?.state === 'reported'
                  ? lobbyingQuery.data.registered_lobbyists
                  : null,
              )}
              href={routePath.lobbying()}
              onOpen={() => navigation.navigate('LobbyingLanding')}
              {...laneLayout}
            />
          </View>

          {/* Research has its own boundary, separate from the records below it. */}
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
                <View style={[styles.researchText, isMobile && styles.stackedCard]}>
                  <Text style={[styles.researchTitle, isMobile && styles.researchTitleMobile]}>
                    {newestPiece.title}
                  </Text>
                  <Text style={styles.researchDek}>{newestPiece.dek}</Text>
                  <Text style={styles.researchDates}>
                    PUBLISHED {isoDateCapsLabel(newestPiece.publishedOn)}
                  </Text>
                </View>
                <View style={[styles.researchCta, isMobile && styles.researchCtaMobile]}>
                  <LinkArrowLabel label={RESEARCH_ROW_LINK} style={styles.researchCtaText} />
                </View>
              </Pressable>
            ) : (
              <View style={[styles.researchRow, isMobile && styles.researchRowMobile]}>
                <Text style={styles.researchEmpty}>{RESEARCH_ROW_EMPTY}</Text>
              </View>
            )}
          </View>

          <View style={[styles.infoGrid, narrow && styles.infoGridNarrow]}>
            <View
              testID="money-sources"
              style={[
                styles.infoCard,
                styles.sourceCard,
                narrow && styles.stackedCard,
                isMobile && styles.infoCardMobile,
              ]}
            >
              <Text
                accessibilityRole="header"
                aria-level={2}
                style={[styles.infoLabel, isMobile && styles.infoLabelMobile]}
              >
                {MONEY_SOURCES_HEADING.toUpperCase()}
              </Text>
              <Text style={styles.infoNote}>{MONEY_SOURCES_ATTRIBUTION}</Text>
              <View style={styles.copyDates}>
                <Text style={styles.infoBody}>
                  Campaign payment files last copied:{' '}
                  <Text style={styles.freshnessDate}>
                    {filesLastCopied
                      ? centralDateLabel(filesLastCopied)
                      : summaryQuery.isLoading
                        ? 'Loading…'
                        : 'Copy date unavailable'}
                  </Text>
                </Text>
                <Text style={styles.infoBody}>
                  Committee register and report totals last copied:{' '}
                  <Text style={styles.freshnessDate}>
                    {registerLastCopied
                      ? centralDateLabel(registerLastCopied)
                      : summaryQuery.isLoading
                        ? 'Loading…'
                        : 'Copy date unavailable'}
                  </Text>
                </Text>
                <Text style={styles.infoBody}>
                  Lobbying files last copied:{' '}
                  <Text style={styles.freshnessDate}>
                    {lobbyingLastCopied
                      ? centralDateLabel(lobbyingLastCopied)
                      : lobbyingQuery.isLoading
                        ? 'Loading…'
                        : 'Copy date unavailable'}
                  </Text>
                </Text>
              </View>
              <Text style={styles.infoNote}>{MONEY_SOURCES_PERIOD_NOTE}</Text>
              <Pressable
                accessibilityRole="button"
                aria-expanded={sourcesOpen}
                aria-controls={sourcesOpen ? sourceGroupsId : undefined}
                onPress={() => setSourcesOpen((open) => !open)}
                onFocus={() => setSourceControlFocused(true)}
                onBlur={() => setSourceControlFocused(false)}
                style={[styles.sourceControl, sourceControlFocused && styles.sourceControlFocus]}
              >
                <Text style={styles.sourceControlText}>
                  {sourcesOpen ? 'Hide source links' : 'View source links'}
                </Text>
                <Svg
                  width={18}
                  height={18}
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                  style={{ flexShrink: 0 }}
                >
                  <Path
                    d={sourcesOpen ? 'M6 15 L12 9 L18 15' : 'M6 9 L12 15 L18 9'}
                    stroke={t.colors.text.primary}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </Pressable>
              {sourcesOpen ? (
                <View nativeID={sourceGroupsId}>
                  {MONEY_SOURCE_GROUPS.map((group) => (
                    <View key={group.title} style={styles.sourceGroup}>
                      <Text
                        accessibilityRole="header"
                        aria-level={3}
                        style={[styles.sourceGroupTitle, narrow && styles.sourceGroupTitleNarrow]}
                      >
                        {group.title}
                      </Text>
                      {group.paragraphs.map((paragraph, index) => (
                        <Text
                          key={index}
                          style={[styles.sourceParagraph, isMobile && styles.sourceParagraphMobile]}
                        >
                          {paragraph.map((part, partIndex) =>
                            part.href ? (
                              <Text
                                key={partIndex}
                                {...externalLinkProps(
                                  part.href,
                                  () => void Linking.openURL(part.href!),
                                )}
                                style={[styles.sourceLink, isMobile && styles.sourceLinkMobile]}
                              >
                                {part.text}
                              </Text>
                            ) : (
                              part.text
                            ),
                          )}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
            <View
              style={[
                styles.infoCard,
                narrow && styles.stackedCard,
                isMobile && styles.infoCardMobile,
              ]}
            >
              <Text
                accessibilityRole="header"
                aria-level={2}
                style={[styles.infoLabel, isMobile && styles.infoLabelMobile]}
              >
                {MONEY_LANDING_COVERAGE_HEADING.toUpperCase()}
              </Text>
              <View style={styles.notCoveredList}>
                {MONEY_LANDING_RECORD_DOES_NOT_COVER.map((line) => (
                  <View key={line} style={styles.notCoveredItem}>
                    <Text aria-hidden style={styles.notCoveredBullet}>
                      •
                    </Text>
                    <Text style={styles.notCoveredLine}>{line}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* Recent reports can cover different periods. The separate count
              names its own cutoff; rows retain their own dates and no amounts. */}
          {filingsQuery.isLoading ? (
            <View style={styles.filingsBlock} accessible accessibilityLabel="Loading filed reports">
              <Text style={styles.infoLabel}>{RECENT_FILINGS_HEADING.toUpperCase()}</Text>
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
              <View style={[styles.filingsHeadingRow, narrow && styles.filingsHeadingRowNarrow]}>
                <View style={[styles.filingsHeadingText, narrow && styles.stackedCard]}>
                  <Text accessibilityRole="header" aria-level={2} style={styles.infoLabel}>
                    {RECENT_FILINGS_HEADING.toUpperCase()}
                  </Text>
                  {newestPeriodSentence(feed?.newestPeriod ?? null) ? (
                    <Text
                      style={[
                        styles.filingsTie,
                        narrow && styles.filingsTieNarrow,
                        isMobile && styles.filingsTieMobile,
                      ]}
                    >
                      {newestPeriodSentence(feed?.newestPeriod ?? null)}
                    </Text>
                  ) : null}
                </View>
                {orderingSentence(feed?.orderedBy ?? '') ? (
                  <Text style={[styles.filingsSort, narrow && styles.filingsSortNarrow]}>
                    {orderingSentence(feed?.orderedBy ?? '')}
                  </Text>
                ) : null}
              </View>
              <View style={styles.filingsList}>
                {filings.map((filing, index) => {
                  const filed = filedDateSentence(filing.filedDate);
                  const slug = filing.registrationNumber
                    ? committeeSlug(filing.filerName, filing.registrationNumber)
                    : null;
                  const Row = slug ? Pressable : View;
                  return (
                    <Row
                      key={index}
                      {...(slug
                        ? linkProps(routePath.moneyCommittee(slug), () =>
                            navigation.navigate('CommitteeMoney', { slug }),
                          )
                        : {})}
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
                          {filed}
                        </Text>
                      ) : null}
                    </Row>
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
  mainTablet: { paddingHorizontal: 32 },
  mainMobile: { paddingTop: 28, paddingBottom: 52, paddingHorizontal: 20 },
  heading: {
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 46,
    lineHeight: 50,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1.4,
  },
  headingMobile: { fontSize: 30, lineHeight: 34, letterSpacing: -0.9 },
  headingTablet: { fontSize: 40, lineHeight: 46 },
  subtitle: {
    marginTop: 14,
    maxWidth: 860,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 19,
    lineHeight: 29,
  },
  subtitleTablet: { fontSize: 20, lineHeight: 30 },
  subtitleMobile: { fontSize: 17, lineHeight: 26 },
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
  laneRowMobile: { marginTop: 32, flexDirection: 'column' },
  // Six readable cards share a wide row; narrower rows wrap before text is cramped.
  laneCard: {
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 0,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 18,
    paddingVertical: 24,
    paddingHorizontal: 22,
  },
  laneCardTablet: { paddingVertical: 22, paddingHorizontal: 20 },
  laneCardMobile: { padding: 18, paddingHorizontal: 18, paddingVertical: 18, borderRadius: 16 },
  laneTitleTablet: { fontSize: 21, lineHeight: 26 },
  laneTitleMobile: { fontSize: 20, lineHeight: 25 },
  laneBodyNarrow: { fontSize: 16.5, lineHeight: 25 },
  laneCountMobile: { fontSize: 12 },
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
    lineHeight: 25,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.4,
  },
  laneBody: {
    marginTop: 12,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 17,
    lineHeight: 26,
  },
  // Sits at the card foot so the counts share a baseline across the row; green,
  // one treatment with the arrow, because each card is a link.
  laneCount: {
    marginTop: 'auto',
    paddingTop: 18,
    color: t.colors.text.greenOnLight,
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 13,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
  },
  infoGrid: {
    marginTop: 44,
    paddingTop: 30,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.12)',
    maxWidth: 1200,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 20,
  },
  infoGridNarrow: { flexDirection: 'column', alignItems: 'stretch', gap: 16 },
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
  sourceCard: { flex: 1.45 },
  infoCardMobile: { padding: 20, paddingTop: 20, paddingHorizontal: 20, paddingBottom: 20 },
  infoLabel: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.4,
  },
  infoLabelMobile: { fontSize: 11.5 },
  copyDates: { marginTop: 18, gap: 8 },
  infoBody: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 16.5,
    lineHeight: 25,
  },
  sourceLink: {
    color: t.colors.text.greenOnLight,
    fontWeight: t.fontWeights.semibold,
    textDecorationLine: 'underline',
    paddingVertical: 3,
    ...(Platform.OS === 'web'
      ? ({ display: 'inline-block', textUnderlineOffset: 3 } as object)
      : {}),
  },
  sourceLinkMobile: { paddingVertical: 5 },
  freshnessDate: {
    color: t.colors.text.primary,
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 16.5,
    fontWeight: t.fontWeights.heavy,
    ...(Platform.OS === 'web' ? ({ display: 'inline-block', whiteSpace: 'nowrap' } as object) : {}),
  },
  infoNote: {
    marginTop: 12,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 24,
  },
  sourceControl: {
    alignSelf: 'flex-start',
    minHeight: 44,
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 2,
  },
  sourceControlFocus: Platform.select({
    web: { outlineStyle: 'solid', outlineWidth: 2, outlineColor: '#7c5cff', outlineOffset: 2 },
    default: { borderWidth: 2, borderColor: '#7c5cff' },
  }) as object,
  sourceControlText: {
    fontFamily: t.typography.body,
    fontSize: 16.5,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
    textDecorationLine: 'underline',
    ...(Platform.OS === 'web' ? ({ textUnderlineOffset: 3 } as object) : {}),
  },
  sourceGroup: {
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink10,
    paddingTop: 16,
    marginTop: 16,
  },
  sourceGroupTitle: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.bold,
    fontSize: 14,
    lineHeight: 21,
    color: t.colors.text.primary,
  },
  sourceGroupTitleNarrow: { fontSize: 14.5 },
  sourceParagraph: {
    marginTop: 8,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 16.5,
    lineHeight: 27,
  },
  sourceParagraphMobile: { lineHeight: 29 },
  notCoveredList: { marginTop: 14, gap: 12 },
  notCoveredItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  notCoveredBullet: { color: t.colors.ink, fontSize: 16.5, lineHeight: 25 },
  notCoveredLine: {
    flex: 1,
    color: t.colors.ink,
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 16.5,
    lineHeight: 25,
  },
  researchBlock: {
    marginTop: 44,
    paddingTop: 30,
    maxWidth: 1200,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.12)',
  },
  researchRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 32,
    padding: 28,
    borderWidth: 1,
    borderColor: '#bfe3ce',
    borderRadius: 18,
    backgroundColor: '#eaf6ef',
  },
  researchRowMobile: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 14,
    padding: 20,
    borderRadius: 16,
  },
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
    color: '#41493f',
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 17,
    lineHeight: 26,
  },
  researchDates: {
    marginTop: 9,
    color: '#5f6763',
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 12,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
  },
  researchCta: {
    ...linkArrowRow,
    flexShrink: 0,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#bfe3ce',
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  researchCtaMobile: { width: '100%' },
  researchCtaText: {
    color: t.colors.text.greenOnLight,
    fontFamily: t.typography.ui,
    fontSize: 17,
    fontWeight: t.fontWeights.bold,
  },
  researchEmpty: {
    color: '#41493f',
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 26,
  },
  filingsBlock: {
    marginTop: 44,
    paddingTop: 30,
    maxWidth: 1200,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.12)',
  },
  filingsHeadingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 30,
  },
  filingsHeadingRowNarrow: { flexDirection: 'column', gap: 12 },
  filingsHeadingText: { flex: 1.26, minWidth: 0 },
  filingsSort: {
    flex: 0.74,
    paddingTop: 30,
    textAlign: 'right',
    color: t.colors.text.muted,
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
  },
  filingsSortNarrow: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    paddingTop: 0,
    textAlign: 'left',
  },
  filingsTie: {
    marginTop: 23,
    color: t.colors.text.primary,
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 19,
    fontWeight: t.fontWeights.semibold,
    lineHeight: 28,
  },
  filingsTieNarrow: { marginTop: 14 },
  filingsTieMobile: { fontSize: 18, lineHeight: 26 },
  filingsList: { marginTop: 10 },
  filingRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 24,
    paddingVertical: 17,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  filingRowMobile: { flexDirection: 'column', gap: 6, paddingVertical: 14, minHeight: 60 },
  filingBody: { flex: 1, minWidth: 0 },
  filingCommittee: {
    color: t.colors.text.primary,
    fontFamily: t.typography.ui,
    fontVariant: ['tabular-nums'],
    fontSize: 18,
    fontWeight: t.fontWeights.bold,
  },
  filingReport: {
    marginTop: 5,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 16,
    lineHeight: 23,
  },
  filingFiled: {
    flexShrink: 0,
    color: t.colors.text.muted,
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 15,
    fontWeight: t.fontWeights.semibold,
  },
  filingFiledMobile: { flexShrink: 1 },
});
