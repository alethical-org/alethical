import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { UnderDevelopmentNotice } from '../../components/campaignMoney/UnderDevelopmentNotice';
import { Skeleton } from '../../components/Skeleton';
import { useCampaignFinanceRaces } from '../../hooks/useAppQueries';
import { useResponsive } from '../../hooks/useResponsive';
import { closedChipLabel, committeeSlug } from '../../lib/committeeMoney';
import { campaignMoneyYear } from '../../lib/legislatorCampaignMoney';
import {
  ALL_OFFICES_LABEL,
  FILES_COPIED_LABEL,
  MIXED_PERIODS_NOTE,
  MONEY_BY_RACE_DEK,
  MONEY_BY_RACE_NOTE,
  MONEY_BY_RACE_TITLE,
  MONEY_BY_RACE_UNAVAILABLE,
  committeeFigures,
  contestHeadingParts,
  figuresYearLine,
  noContestsTitle,
  officeFilterFromParam,
  racesCountLine,
  racesOrderingLine,
} from '../../lib/moneyByRace';
import {
  centralDateLabel,
  formatCount,
  RECORD_DOES_NOT_COVER,
  RECORD_DOES_NOT_COVER_HEADING,
} from '../../lib/moneyLanding';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';
import type { RaceCommittee, RaceContest } from '../../data/types';

const isWeb = Platform.OS === 'web';

// Room above a contest heading when the page jumps to its #anchor, so the heading
// does not land flush against the top edge.
const SCROLL_MARGIN = { scrollMarginTop: 24 } as object;

function jumpToAnchor(anchor: string) {
  if (!isWeb || typeof document === 'undefined') return;
  document.getElementById(anchor)?.scrollIntoView({ behavior: 'auto', block: 'start' });
}

/**
 * Money by race at /money/races ("Money by race.dc.html", 3 Sep 2026 campaign-money
 * package; issue #1954): every candidate committee, grouped by the office and
 * district it registered for.
 *
 * Three constraints are the whole design, and each is enforced by a test on the
 * read behind the page (`alethical/tests/test_campaign_finance_races.py`) as well
 * as drawn here:
 *
 * - **No per-contest total, ever.** A heading carries a count of committees.
 *   Nothing on this page adds 2 committees' figures: a person can hold 2
 *   committees at once and money moved between them is reported by both (#1663).
 * - **Never ordered by amount.** The list arrives ordered by office, district as a
 *   person reads it, then filed name, and the page prints that order beside the
 *   count. The page never re-sorts what it is served.
 * - **Every figure carries its own dates.** Each row prints its 2 figures with the
 *   period each covers, and a contest whose reported totals cover different periods
 *   says so above its rows.
 *
 * The office chip rides in the address, so a narrowed list is a link somebody can
 * send (grounded-answers rule 5). Every contest has an anchor (`#house-12a`) for
 * the same reason. Every row opens its committee by registration number, so a
 * committee that changes its name keeps its address.
 */
export function MoneyByRaceScreen({ navigation, route }: RootScreenProps<'MoneyByRace'>) {
  const { isMobile } = useResponsive();
  const year = campaignMoneyYear(route.params?.year);
  const requestedOffice = typeof route.params?.office === 'string' ? route.params.office : '';

  // The request is narrowed by whatever the address says; the chips then label
  // themselves from the served office list, so an office the register does not
  // hold shows the whole list with no chip pressed rather than an empty page.
  const races = useCampaignFinanceRaces({ year, office: requestedOffice || undefined });
  const page = races.data ?? null;
  const served = page?.state === 'reported';
  const offices = page?.offices ?? [];
  const office = officeFilterFromParam(requestedOffice, offices);

  useDocumentTitle('/money/races', `${MONEY_BY_RACE_TITLE} — campaign money | Alethical`);

  // A page opened at /money/races#house-12a has to jump itself: the list is drawn
  // by JavaScript, so when the browser looks for the fragment's target on load
  // there is nothing there yet. Read once, then asserted after the rows render.
  const [openingAnchor] = useState(() =>
    isWeb && typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '',
  );
  const anchors = page?.contests.map((contest) => contest.anchor) ?? [];
  const anchorReady = openingAnchor !== '' && anchors.includes(openingAnchor);
  useEffect(() => {
    if (!anchorReady) return;
    const jump = () => jumpToAnchor(openingAnchor);
    const first = setTimeout(jump, 0);
    const settled = setTimeout(jump, 250);
    return () => {
      clearTimeout(first);
      clearTimeout(settled);
    };
  }, [anchorReady, openingAnchor]);

  const onSelectOffice = (next: string | null) =>
    navigation.setParams({ office: next ?? undefined });

  const countLine = racesCountLine(
    page?.contestCount ?? null,
    page?.committeeCount ?? null,
    page?.asOf ?? null,
  );
  const orderLine = page ? racesOrderingLine(page.orderedBy) : null;
  const contests = page?.contests ?? [];

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

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
            {MONEY_BY_RACE_TITLE}
          </Text>
          <Text style={styles.dek}>{MONEY_BY_RACE_DEK}</Text>

          {races.isPending ? (
            <View style={styles.countRow} accessible accessibilityLabel="Loading the register">
              <Skeleton width={320} height={13} />
            </View>
          ) : countLine ? (
            <Text style={styles.countLine}>{countLine}</Text>
          ) : null}

          {/* The register's own office values, a closed set of 9 on the live
              register, as chips that wrap — no select, no "more offices" menu.
              Each chip's count is the whole register's, so a count never looks
              like the filter found fewer than exist. */}
          <View style={styles.chipRow} role="group" aria-label="Filter by office">
            <OfficeChip
              label={ALL_OFFICES_LABEL}
              count={page?.committeeCount ?? null}
              active={office === null}
              onPress={() => onSelectOffice(null)}
            />
            {offices.map((entry) => (
              <OfficeChip
                key={entry.office}
                label={entry.office}
                count={entry.committeeCount}
                active={office === entry.office}
                onPress={() => onSelectOffice(entry.office)}
              />
            ))}
          </View>

          {races.isPending ? (
            <View style={styles.listLoading}>
              <View role="status" aria-busy style={styles.hidden}>
                <Text>Loading contests</Text>
              </View>
              <Skeleton width={260} height={11} />
              {(['58%', '72%', '44%'] as const).map((width, index) => (
                <View key={index} style={styles.rowLoading}>
                  <Skeleton width={width} height={15} />
                  <Skeleton width={120} height={15} />
                </View>
              ))}
            </View>
          ) : races.isError && !page ? (
            <View style={styles.card}>
              <Text accessibilityRole="alert" style={styles.explain}>
                We couldn’t load the register just now. This is a problem on our side and says
                nothing about who is running. Please try again in a moment.
              </Text>
            </View>
          ) : !served ? (
            <View style={styles.card}>
              <Text style={styles.h3}>{noContestsTitle(office)}</Text>
              <Text style={styles.explain}>{MONEY_BY_RACE_UNAVAILABLE}</Text>
            </View>
          ) : contests.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.h3}>{noContestsTitle(office)}</Text>
              {office ? (
                <Pressable
                  onPress={() => onSelectOffice(null)}
                  accessibilityRole="button"
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonLabel}>Show all offices</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View>
              <View style={styles.listHead}>
                <Text style={styles.listYear}>{figuresYearLine(year)}</Text>
                {orderLine ? <Text style={styles.listSort}>{orderLine}</Text> : null}
              </View>

              {contests.map((contest) => (
                <ContestBlock
                  key={contest.anchor}
                  contest={contest}
                  isMobile={isMobile}
                  onOpen={(slug) => navigation.push('CommitteeMoney', { slug })}
                />
              ))}

              <Text style={styles.listNote}>{MONEY_BY_RACE_NOTE}</Text>

              {/* The one freshness date this page shows: the day we copied the
                  Board's download the named figures come from. Never the period
                  any money covers — each figure carries its own (rule 12, #861). */}
              {page?.fetchedAt ? (
                <Text style={styles.freshness}>
                  {FILES_COPIED_LABEL.toUpperCase()} ·{' '}
                  {centralDateLabel(page.fetchedAt).toUpperCase()}
                </Text>
              ) : null}
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

function OfficeChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number | null;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      aria-pressed={active}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
      {count !== null ? (
        <Text style={[styles.chipCount, active && styles.chipCountActive]}>
          {formatCount(count)}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * One contest: its heading with a count, the mixed-period line when it applies,
 * then every committee — all of them, in the order served. No collapse and no
 * "show more": a contest partially shown is a contest misread, and the Governor's
 * 28 is the largest this ever draws.
 */
function ContestBlock({
  contest,
  isMobile,
  onOpen,
}: {
  contest: RaceContest;
  isMobile: boolean;
  onOpen: (slug: string) => void;
}) {
  const [seat, count] = contestHeadingParts(contest);
  return (
    <View nativeID={contest.anchor} style={[styles.contest, SCROLL_MARGIN as never]}>
      {isMobile ? (
        <Text accessibilityRole="header" aria-level={2} style={styles.contestHeading}>
          {seat.toUpperCase()}
          {'\n'}
          {count.toUpperCase()}
        </Text>
      ) : (
        <Text accessibilityRole="header" aria-level={2} style={styles.contestHeading}>
          {seat.toUpperCase()} · {count.toUpperCase()}
        </Text>
      )}
      {contest.periodsDiffer ? (
        <View style={styles.mixedPeriods}>
          <Text style={styles.mixedPeriodsText}>{MIXED_PERIODS_NOTE}</Text>
        </View>
      ) : null}
      <View style={styles.rows}>
        {contest.committees.map((committee) => (
          <CommitteeRow
            key={committee.registrationNumber}
            committee={committee}
            isMobile={isMobile}
            onOpen={onOpen}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * One committee: its filed name and registration number, then its 2 figures with
 * their own dates. On a computer the figures sit to the right; on a phone they
 * move under the name and left-align, and the period line breaks at the fact
 * boundary. Every field the computer row carries is here at both bands.
 */
function CommitteeRow({
  committee,
  isMobile,
  onOpen,
}: {
  committee: RaceCommittee;
  isMobile: boolean;
  onOpen: (slug: string) => void;
}) {
  const slug = committeeSlug(committee.name, committee.registrationNumber);
  const closed = committee.isClosed ? closedChipLabel(committee.terminationDate) : null;
  const figures = committeeFigures(committee);
  return (
    <View style={[styles.row, isMobile && styles.rowMobile]}>
      <View style={styles.rowText}>
        <View style={styles.rowNameLine}>
          <Pressable
            {...linkProps(routePath.moneyCommittee(slug), () => onOpen(slug))}
            style={styles.rowNameLink}
          >
            <Text style={styles.rowName}>{committee.name}</Text>
          </Pressable>
          <Text style={styles.rowReg}>REG {committee.registrationNumber}</Text>
          {closed ? <Text style={styles.closedChip}>{closed.toUpperCase()}</Text> : null}
        </View>
      </View>
      <View style={[styles.figures, isMobile && styles.figuresMobile]}>
        {figures.map((figure) => (
          <View key={figure.label} style={[styles.figure, isMobile && styles.figureMobile]}>
            <Text style={styles.figureLabel}>{figure.label}</Text>
            <Text style={figure.isFigure ? styles.figureValue : styles.figureStandIn}>
              {figure.text}
            </Text>
            {figure.period ? <Text style={styles.figurePeriod}>{figure.period}</Text> : null}
          </View>
        ))}
      </View>
    </View>
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
  chipRow: { marginTop: 22, flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 15,
  },
  chipActive: {
    backgroundColor: t.colors.text.primary,
    borderColor: t.colors.text.primary,
  },
  chipLabel: {
    fontFamily: t.typography.ui,
    fontSize: 15,
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
  listLoading: { marginTop: 28, gap: 14 },
  rowLoading: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  hidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  listHead: {
    marginTop: 28,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  listYear: {
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
  contest: { marginTop: 26 },
  contestHeading: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
    color: t.colors.text.secondary,
  },
  mixedPeriods: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#fdfaf4',
    borderWidth: 1,
    borderColor: '#e3c17f',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  mixedPeriodsText: {
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  rows: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 24,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink08,
  },
  rowMobile: { flexDirection: 'column', gap: 10, paddingVertical: 13 },
  rowText: { flex: 1, minWidth: 0 },
  rowNameLine: { flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' },
  rowNameLink: { alignSelf: 'flex-start' },
  rowName: {
    fontFamily: t.typography.ui,
    fontSize: 17.5,
    lineHeight: 23,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  rowReg: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.medium,
    letterSpacing: 0.4,
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
  figures: { flexDirection: 'row', gap: 28, flexShrink: 0 },
  figuresMobile: { flexDirection: 'column', gap: 10, alignSelf: 'stretch' },
  figure: { alignItems: 'flex-end', minWidth: 150 },
  figureMobile: { alignItems: 'flex-start' },
  figureLabel: {
    fontFamily: t.typography.mono,
    fontSize: 10,
    fontWeight: t.fontWeights.medium,
    letterSpacing: 0.4,
    color: t.colors.text.muted,
  },
  figureValue: {
    marginTop: 3,
    fontFamily: t.typography.title,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
    fontVariant: ['tabular-nums'],
  },
  figureStandIn: {
    marginTop: 3,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  figurePeriod: {
    marginTop: 3,
    fontFamily: t.typography.mono,
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: t.fontWeights.medium,
    letterSpacing: 0.4,
    color: t.colors.text.muted,
  },
  listNote: {
    marginTop: 24,
    maxWidth: 780,
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: t.colors.text.muted,
  },
  freshness: {
    marginTop: 14,
    fontFamily: t.typography.mono,
    fontSize: 10.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.2,
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
