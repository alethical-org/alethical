import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RaceFinder } from '../../components/campaignMoney/RaceFinder';
import { Skeleton } from '../../components/Skeleton';
import { useCampaignFinanceRaces, usePrefetchCommitteeMoney } from '../../hooks/useAppQueries';
import { useResponsive } from '../../hooks/useResponsive';
import {
  closedChipLabel,
  committeeSlug,
  itemizedContributionsNote,
} from '../../lib/committeeMoneyShared';
import { campaignMoneyYear } from '../../lib/legislatorCampaignMoney';
import { MONEY_SECTION_NAME } from '../../lib/moneySectionName';
import {
  ALL_OFFICES_LABEL,
  FILES_COPIED_LABEL,
  MIXED_PERIODS_NOTE,
  MONEY_BY_RACE_DEK,
  MONEY_BY_RACE_NOTE,
  MONEY_BY_RACE_TITLE,
  MONEY_BY_RACE_UNAVAILABLE,
  RACE_COMPARISON_NOTE,
  RACE_COVERAGE,
  RACE_COVERAGE_HEADING,
  RACE_FIGURE_DEFINITIONS,
  RACE_REGISTRATION_NOTE,
  registerDateLine,
  shownCommitteeCount,
  committeeFigures,
  contestHeadingParts,
  figuresYearLine,
  noContestsTitle,
  officeFilterFromParam,
  racesCountLine,
  racesOrderingLine,
} from '../../lib/moneyByRace';
import { centralDateLabel, formatCount } from '../../lib/moneyLanding';
import { markNextWebHistoryChangeAsReplace } from '../../navigation/webHistory';
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

function jumpToAnchor(anchor: string, focus = false) {
  if (!isWeb || typeof document === 'undefined') return;
  const heading = document.getElementById(anchor);
  heading?.scrollIntoView({ behavior: 'auto', block: 'start' });
  if (focus) heading?.focus({ preventScroll: true });
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
  const { isMobile, isTablet } = useResponsive();
  const year = campaignMoneyYear(route.params?.year);
  const requestedOffice = typeof route.params?.office === 'string' ? route.params.office : '';

  // The request is narrowed by whatever the address says; the chips then label
  // themselves from the served office list, so an office the register does not
  // hold shows the whole list with no chip pressed rather than an empty page.
  const races = useCampaignFinanceRaces({ year, office: requestedOffice || undefined });
  // The hook retains the last response so office choices stay available during
  // a request. Never label those old rows/counts with the new office or year.
  const page = races.isPlaceholderData ? null : (races.data ?? null);
  const loading = races.isPending || races.isPlaceholderData;
  const served = page?.state === 'reported';
  const offices = races.data?.offices ?? [];
  const office = officeFilterFromParam(requestedOffice, offices);

  useDocumentTitle('/money/races', `${MONEY_BY_RACE_TITLE} — campaign money | Alethical`);

  const [anchor, setAnchor] = useState(() =>
    isWeb && typeof window !== 'undefined' ? window.location.hash.slice(1) : '',
  );
  useEffect(() => {
    if (!isWeb) return;
    const sync = () => setAnchor(window.location.hash.slice(1));
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);
  const anchorReady = !!anchor && !!page?.contests.some((contest) => contest.anchor === anchor);
  useEffect(() => {
    if (!anchorReady) return;
    let cancelled = false;
    const jump = () => {
      if (!cancelled) jumpToAnchor(anchor, true);
    };
    const first = setTimeout(jump, 0);
    // Fonts can change the height of every row before this group.
    if (isWeb && document.fonts?.ready) void document.fonts.ready.then(jump);
    return () => {
      cancelled = true;
      clearTimeout(first);
    };
  }, [anchorReady, anchor, page]);

  useEffect(() => {
    if (page?.state === 'reported' && requestedOffice && !office) {
      markNextWebHistoryChangeAsReplace();
      navigation.setParams({ office: undefined });
    }
  }, [page, office, requestedOffice, navigation]);

  const onSelectOffice = (next: string | null) => {
    setAnchor('');
    navigation.setParams({ office: next ?? undefined });
  };
  const onChooseGroup = (next: string) => {
    if (isWeb) {
      const url = new URL(window.location.href);
      url.hash = next;
      if (window.location.hash !== url.hash)
        window.history.pushState(window.history.state, '', url);
    }
    setAnchor(next);
    jumpToAnchor(next, true);
  };
  const contests = page?.contests ?? [];
  const countLine = page ? racesCountLine(page.contestCount, shownCommitteeCount(contests)) : null;
  const registerDate = registerDateLine(page?.asOf ?? null);
  const orderLine = page ? racesOrderingLine(page.orderedBy) : null;

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        <Container
          style={[styles.main, isTablet && styles.mainTablet, isMobile && styles.mainMobile]}
        >
          <Pressable
            {...linkProps(routePath.money(), () => navigation.navigate('MoneyLanding'))}
            style={styles.backLink}
          >
            <Text style={styles.backLabel}>{MONEY_SECTION_NAME}</Text>
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
          <View style={styles.registrationNote}>
            <Text style={styles.registrationLabel}>{RACE_REGISTRATION_NOTE}</Text>
          </View>

          {loading ? (
            <View style={styles.countRow} accessible accessibilityLabel="Loading the register">
              <Skeleton width={320} height={13} />
            </View>
          ) : countLine ? (
            <View style={[styles.countRow, isMobile && styles.countRowMobile]}>
              <Text style={styles.countLine}>{countLine}</Text>
              {registerDate ? <Text style={styles.registerDate}>{registerDate}</Text> : null}
            </View>
          ) : null}

          {/* The register's own office values, a closed set of 9 on the live
              register, as chips that wrap — no select, no "more offices" menu.
              Each chip's count is the whole register's, so a count never looks
              like the filter found fewer than exist. */}
          <View style={styles.chipRow} role="group" aria-label="Filter by office">
            <OfficeChip
              label={ALL_OFFICES_LABEL}
              count={races.data?.committeeCount ?? null}
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

          {loading ? (
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
              {contests.some((contest) => !!contest.district) ? (
                <RaceFinder
                  key={`${year}-${office ?? 'all'}`}
                  contests={contests}
                  isMobile={isMobile}
                  onChoose={onChooseGroup}
                />
              ) : null}
              <View style={styles.listHead}>
                <Text style={styles.listYear}>{figuresYearLine(year)}</Text>
                {orderLine ? <Text style={styles.listSort}>{orderLine}</Text> : null}
              </View>

              <View style={styles.comparisonNote}>
                <Text style={styles.explain}>{RACE_COMPARISON_NOTE}</Text>
                <Text style={styles.explain}>{itemizedContributionsNote(false)}</Text>
              </View>
              {contests.map((contest) => (
                <ContestBlock
                  key={contest.anchor}
                  contest={contest}
                  isMobile={isMobile}
                  isTablet={isTablet}
                  onOpen={(slug) => navigation.push('CommitteeMoney', { slug })}
                />
              ))}

              <Text style={styles.listNote}>{MONEY_BY_RACE_NOTE}</Text>

              {/* The one freshness date this page shows: the day we copied the
                  Board's download the named figures come from. Never the period
                  any money covers — each figure carries its own (rule 12, #861). */}
              {page?.fetchedAt ? (
                <Text style={styles.freshness}>
                  {FILES_COPIED_LABEL} {centralDateLabel(page.fetchedAt)}
                </Text>
              ) : null}
            </View>
          )}

          <View style={styles.notCoveredBox}>
            <Text style={styles.notCoveredLabel}>{RACE_COVERAGE_HEADING}</Text>
            <View style={styles.notCoveredList}>
              {RACE_COVERAGE.map((line) => (
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
  isTablet,
  onOpen,
}: {
  contest: RaceContest;
  isMobile: boolean;
  isTablet: boolean;
  onOpen: (slug: string) => void;
}) {
  const [seat, count] = contestHeadingParts(contest);
  const figureWidth = isTablet ? styles.figureTablet : styles.figure;
  return (
    <View style={styles.contest}>
      <Text
        nativeID={contest.anchor}
        {...(isWeb ? { tabIndex: -1 } : {})}
        accessibilityRole="header"
        aria-level={2}
        style={[
          styles.contestHeading,
          isTablet && styles.contestHeadingTablet,
          isMobile && styles.contestHeadingMobile,
          SCROLL_MARGIN as never,
        ]}
      >
        {seat}
      </Text>
      <Text style={styles.contestCount}>{count}</Text>
      {contest.periodsDiffer ? (
        <View style={styles.mixedPeriods}>
          <Text style={styles.explain}>{MIXED_PERIODS_NOTE}</Text>
        </View>
      ) : null}
      <View
        style={[
          styles.columnHead,
          isTablet && styles.tabletRow,
          isMobile && styles.columnHeadMobile,
        ]}
      >
        {!isMobile ? <View style={styles.rowText} /> : null}
        {RACE_FIGURE_DEFINITIONS.map((definition) => (
          <View key={definition.label} style={isMobile ? styles.figureMobile : figureWidth}>
            <Text style={styles.figureLabel}>{definition.label}</Text>
            <Text style={styles.figureDefinition}>{definition.text}</Text>
          </View>
        ))}
      </View>
      <View style={styles.rows}>
        {contest.committees.map((committee) => (
          <CommitteeRow
            key={committee.registrationNumber}
            committee={committee}
            isMobile={isMobile}
            isTablet={isTablet}
            onOpen={onOpen}
          />
        ))}
      </View>
    </View>
  );
}

function CommitteeRow({
  committee,
  isMobile,
  isTablet,
  onOpen,
}: {
  committee: RaceCommittee;
  isMobile: boolean;
  isTablet: boolean;
  onOpen: (slug: string) => void;
}) {
  const slug = committeeSlug(committee.name, committee.registrationNumber);
  const closed = committee.isClosed ? closedChipLabel(committee.terminationDate) : null;
  const prefetchCommitteeMoney = usePrefetchCommitteeMoney();
  const warm = () => prefetchCommitteeMoney(committee.registrationNumber, slug);
  return (
    <View style={[styles.row, isTablet && styles.tabletRow, isMobile && styles.rowMobile]}>
      <View style={[styles.rowText, isMobile && styles.rowTextMobile]}>
        <Pressable
          {...linkProps(routePath.moneyCommittee(slug), () => onOpen(slug))}
          onPressIn={warm}
          onHoverIn={warm}
          style={[styles.rowNameLink, isMobile && styles.rowNameLinkMobile]}
        >
          <Text style={styles.rowName}>{committee.name}</Text>
        </Pressable>
        <Text style={styles.rowReg}>Registration {committee.registrationNumber}</Text>
        {closed ? <Text style={styles.closedLabel}>{closed}</Text> : null}
      </View>
      {committeeFigures(committee).map((figure) => (
        <View
          key={figure.label}
          style={isMobile ? styles.figureMobile : isTablet ? styles.figureTablet : styles.figure}
        >
          <Text style={[styles.figureLabel, !isMobile && styles.hidden]}>{figure.label}</Text>
          <Text style={figure.isFigure ? styles.figureValue : styles.figureStandIn}>
            {figure.text}
          </Text>
          {figure.period ? <Text style={styles.figurePeriod}>{figure.period}</Text> : null}
          {figure.explanation ? (
            <Text style={styles.figurePeriod}>{figure.explanation}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  main: { paddingTop: 28, paddingBottom: 64 },
  mainTablet: { paddingHorizontal: 40 },
  mainMobile: { paddingTop: 18, paddingHorizontal: 20 },
  backLink: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  backLabel: {
    fontFamily: t.typography.body,
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.text.secondary,
  },
  eyebrow: {
    marginTop: 18,
    fontFamily: t.typography.body,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2.4,
    color: t.colors.brand.deep,
  },
  h1: {
    marginTop: 12,
    fontFamily: t.typography.title,
    fontSize: 42,
    lineHeight: 48,
    fontWeight: '800',
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
  registrationNote: {
    marginTop: 16,
    alignSelf: 'flex-start',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  registrationLabel: {
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: t.colors.text.primary,
  },
  countRow: {
    marginTop: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 8,
  },
  countRowMobile: { flexDirection: 'column' },
  countLine: {
    fontFamily: t.typography.body,
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '800',
    color: t.colors.text.primary,
    fontVariant: ['tabular-nums'],
  },
  registerDate: {
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '600',
    color: t.colors.text.secondary,
    fontVariant: ['tabular-nums'],
  },
  chipRow: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 15,
  },
  chipActive: { backgroundColor: t.colors.text.primary, borderColor: t.colors.text.primary },
  chipLabel: {
    fontFamily: t.typography.body,
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text.secondary,
  },
  chipLabelActive: { color: t.colors.surfaces.base },
  chipCount: {
    fontFamily: t.typography.body,
    fontSize: 13,
    fontWeight: '700',
    color: t.colors.text.secondary,
    fontVariant: ['tabular-nums'],
  },
  chipCountActive: { color: t.colors.surfaces.base },
  listLoading: { marginTop: 28, gap: 14 },
  rowLoading: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  hidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  listHead: {
    marginTop: 28,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 18,
    flexWrap: 'wrap',
  },
  listYear: {
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '700',
    color: t.colors.text.primary,
    fontVariant: ['tabular-nums'],
  },
  listSort: {
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '600',
    color: t.colors.text.secondary,
  },
  comparisonNote: {
    marginTop: 12,
    maxWidth: 920,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 15,
    padding: 20,
    gap: 10,
  },
  contest: { marginTop: 34 },
  contestHeading: {
    ...(isWeb
      ? ({ outlineColor: t.colors.purple.base, outlineOffset: 3, outlineWidth: 2 } as object)
      : {}),
    fontFamily: t.typography.body,
    fontSize: 27,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: t.colors.text.primary,
    fontVariant: ['tabular-nums'],
  },
  contestHeadingTablet: { fontSize: 24, lineHeight: 31 },
  contestHeadingMobile: { fontSize: 22, lineHeight: 29 },
  contestCount: {
    marginTop: 4,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '600',
    color: t.colors.text.secondary,
    fontVariant: ['tabular-nums'],
  },
  mixedPeriods: {
    marginTop: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  columnHead: {
    marginTop: 16,
    marginBottom: 10,
    flexDirection: 'row',
    gap: 24,
    alignItems: 'flex-start',
  },
  columnHeadMobile: {
    flexDirection: 'column',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 12,
    backgroundColor: t.colors.surfaces.base,
  },
  figureDefinition: {
    marginTop: 3,
    fontFamily: t.typography.body,
    fontSize: 13,
    lineHeight: 20,
    color: t.colors.text.muted,
  },
  rows: { borderTopWidth: 1, borderTopColor: t.colors.alpha.ink08 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    paddingVertical: 17,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink08,
  },
  tabletRow: { gap: 18 },
  rowMobile: { flexDirection: 'column', gap: 12, paddingVertical: 14 },
  rowText: { flex: 1, minWidth: 0 },
  rowTextMobile: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: '100%' },
  rowNameLink: { alignSelf: 'flex-start', maxWidth: '100%' },
  rowNameLinkMobile: { minHeight: 44, justifyContent: 'center', marginTop: -8, marginBottom: -8 },
  rowName: {
    fontFamily: t.typography.body,
    fontSize: 17.5,
    lineHeight: 25,
    fontWeight: '700',
    color: t.colors.brand.deep,
    textDecorationLine: 'underline',
    ...(isWeb ? ({ overflowWrap: 'anywhere', textUnderlineOffset: '2px' } as object) : {}),
  },
  rowReg: {
    marginTop: 3,
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600',
    color: t.colors.text.secondary,
    fontVariant: ['tabular-nums'],
  },
  closedLabel: {
    marginTop: 4,
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '700',
    color: t.colors.text.primary,
    fontVariant: ['tabular-nums'],
  },
  figure: { width: 250, flexShrink: 0, minWidth: 0 },
  figureTablet: { width: 200, flexShrink: 0, minWidth: 0 },
  figureMobile: { width: '100%' },
  figureLabel: {
    fontFamily: t.typography.body,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
    color: t.colors.text.primary,
  },
  figureValue: {
    fontFamily: t.typography.body,
    fontSize: 23,
    lineHeight: 30,
    fontWeight: '800',
    color: t.colors.text.primary,
    fontVariant: ['tabular-nums'],
  },
  figureStandIn: {
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  figurePeriod: {
    marginTop: 3,
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 22,
    color: t.colors.text.secondary,
    fontVariant: ['tabular-nums'],
  },
  listNote: {
    marginTop: 30,
    maxWidth: 920,
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 25,
    color: t.colors.text.secondary,
  },
  freshness: {
    marginTop: 12,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '600',
    color: t.colors.text.secondary,
    fontVariant: ['tabular-nums'],
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
    fontFamily: t.typography.body,
    fontSize: 19,
    fontWeight: '800',
    color: t.colors.text.primary,
  },
  explain: {
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 25,
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
    fontSize: 15,
    fontWeight: '700',
    color: t.colors.surfaces.base,
  },
  notCoveredBox: {
    marginTop: 20,
    maxWidth: 920,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 15,
    padding: 20,
  },
  notCoveredLabel: {
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '800',
    color: t.colors.text.primary,
  },
  notCoveredList: { marginTop: 8, gap: 6 },
  notCoveredLine: {
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 25,
    color: t.colors.text.secondary,
    fontVariant: ['tabular-nums'],
  },
});
