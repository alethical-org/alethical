import { useEffect, useId, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Svg, { Path } from 'react-native-svg';
import { GoBackLink } from '../../components/GoBackLink';
import { PageContextLabel } from '../../components/PageContextLabel';
import { ChevronLeft } from '../../components/icons';
import { useHistoryScrollRestoration } from '../../hooks/useHistoryScrollRestoration';
import { RaceFinder } from '../../components/campaignMoney/RaceFinder';
import { ResultsHeading } from '../../components/campaignMoney/ResultsHeading';
import { Skeleton } from '../../components/Skeleton';
import { useCampaignFinanceRaces, usePrefetchCommitteeMoney } from '../../hooks/useAppQueries';
import { useResponsive } from '../../hooks/useResponsive';
import { moneyByRacePageMetadata } from '../../lib/share';
import { closedChipLabel, committeeSlug } from '../../lib/committeeMoneyShared';
import { campaignMoneyYear } from '../../lib/legislatorCampaignMoney';
import { MONEY_SECTION_NAME } from '../../lib/moneySectionName';
import { moneyByRaceShareContent } from '../../lib/moneyResultsShare';
import {
  ALL_OFFICES_LABEL,
  FILES_COPIED_LABEL,
  MIXED_PERIODS_NOTE,
  MONEY_BY_RACE_DEK,
  MONEY_BY_RACE_NOTE,
  MONEY_BY_RACE_TITLE,
  MONEY_BY_RACE_UNAVAILABLE,
  RACE_COMPARISON_NOTE,
  RACE_DONOR_EXPLANATION,
  RACE_COVERAGE,
  RACE_COVERAGE_HEADING,
  RACE_FIGURE_DEFINITIONS,
  RACE_REGISTRATION_NOTE,
  registerDateLine,
  shownCommitteeCount,
  committeeFigures,
  contestSeatLabel,
  contestCountLabel,
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

/** A compact directory opens 1 complete group at its own shareable address. */
export function MoneyByRaceScreen(props: RootScreenProps<'MoneyByRace'>) {
  // A new view needs its own scroll restoration. Typing keeps the same input.
  const { group, office, year } = props.route.params ?? {};
  return <MoneyByRaceView key={`${group ?? ''}:${office ?? ''}:${year ?? ''}`} {...props} />;
}

function MoneyByRaceView({ navigation, route }: RootScreenProps<'MoneyByRace'>) {
  const { isMobile, isTablet } = useResponsive();
  const headingId = `race-group-${useId()}`;
  const year = campaignMoneyYear(route.params?.year);
  const requestedOffice = route.params?.office ?? '';
  const group = route.params?.group;
  const query = route.params?.q ?? '';
  // Search always includes every office, even while the directory is narrowed.
  const races = useCampaignFinanceRaces({ year });
  const page = races.isPlaceholderData ? null : (races.data ?? null);
  const loading = races.isPending || races.isPlaceholderData;
  const scroll = useHistoryScrollRestoration(!loading);
  const served = page?.state === 'reported';
  const offices = races.data?.offices ?? [];
  const office = officeFilterFromParam(requestedOffice, offices);
  const allContests = page?.contests ?? [];
  const selected = group ? allContests.find((contest) => contest.anchor === group) : undefined;
  const contests = office
    ? allContests.filter((contest) => contest.office === office)
    : allContests;
  const count = selected?.committeeCount ?? shownCommitteeCount(contests);
  const countLine = served ? racesCountLine(contests.length, count) : null;
  const registerDate = registerDateLine(page?.asOf ?? null);
  const orderLine = page && contests.length > 1 ? racesOrderingLine(page.orderedBy, office) : null;
  const directoryParams = {
    year: route.params?.year,
    office: undefined,
    group: undefined,
    q: undefined,
  };
  const directoryHref = routePath.moneyRaces(directoryParams);

  useDocumentTitle(
    '/money/races',
    moneyByRacePageMetadata({ selectedLabel: selected ? contestSeatLabel(selected) : null }).title,
  );

  useEffect(() => {
    if (!isWeb) return;
    // Retain links shared before focused group views existed. Replacement keeps
    // the real previous history entry, including a previous directory search.
    const migrateHash = () => {
      if (
        window.location.pathname === '/money/races' &&
        navigation.isFocused() &&
        window.location.hash &&
        !group
      ) {
        const anchor = window.location.hash.slice(1);
        markNextWebHistoryChangeAsReplace();
        navigation.setParams({ group: anchor });
      }
    };
    migrateHash();
    window.addEventListener('hashchange', migrateHash);
    return () => window.removeEventListener('hashchange', migrateHash);
  }, [group, navigation]);

  useEffect(() => {
    if (served && requestedOffice && !office) {
      markNextWebHistoryChangeAsReplace();
      navigation.setParams({ office: undefined });
    }
  }, [served, office, requestedOffice, navigation]);

  useEffect(() => {
    if (!group || !served || !isWeb) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(headingId)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [group, served, headingId]);

  const onSelectOffice = (next: string | null) => {
    navigation.setParams({ office: next ?? undefined, group: undefined, q: undefined });
  };
  const onChooseGroup = (anchor: string) => {
    const contest = allContests.find((entry) => entry.anchor === anchor);
    if (contest)
      navigation.setParams({
        group: anchor,
        office: contest.office,
        year: String(year),
        q: undefined,
      });
  };
  const onQueryChange = (value: string) => {
    if (value === query) return;
    markNextWebHistoryChangeAsReplace();
    navigation.setParams({ q: value || undefined });
  };

  return (
    <PageBackground>
      <ScrollView {...scroll} contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <Container
          style={[styles.main, isTablet && styles.mainTablet, isMobile && styles.mainMobile]}
        >
          {group ? (
            <GoBackLink
              href={directoryHref}
              onPress={() => navigation.setParams(directoryParams)}
              mobile={isMobile}
              style={styles.goBack}
            />
          ) : (
            <Pressable
              {...linkProps(routePath.money(), () => navigation.navigate('MoneyLanding'))}
              style={styles.backLink}
            >
              <ChevronLeft
                size={18}
                strokeWidth={2.2}
                color={t.colors.text.secondary}
                aria-hidden
              />
              <Text style={styles.backLabel}>{MONEY_SECTION_NAME}</Text>
            </Pressable>
          )}
          {selected ? (
            <PageContextLabel style={styles.eyebrow}>{MONEY_BY_RACE_TITLE}</PageContextLabel>
          ) : null}
          <ResultsHeading
            isMobile={isMobile}
            content={
              served && page && (!group || selected)
                ? moneyByRaceShareContent({ ...page, office }, group ?? '', query)
                : null
            }
          >
            <Text
              nativeID={headingId}
              {...(group && isWeb ? { tabIndex: -1 } : {})}
              accessibilityRole="header"
              aria-level={1}
              style={[styles.h1, !selected && styles.h1WithoutEyebrow, isMobile && styles.h1Mobile]}
            >
              {selected ? contestSeatLabel(selected) : MONEY_BY_RACE_TITLE}
            </Text>
          </ResultsHeading>
          <Text style={styles.dek}>
            {group
              ? 'Candidate committees raise and spend money for a candidate’s campaign.'
              : MONEY_BY_RACE_DEK}
          </Text>
          <Text style={styles.registrationLabel}>{RACE_REGISTRATION_NOTE}</Text>

          {loading ? (
            <View
              style={styles.countRow}
              role="status"
              aria-busy
              accessibilityLabel="Loading committee records"
            >
              <Text style={styles.hidden}>Loading committee records</Text>
              <Skeleton width={260} height={24} />
            </View>
          ) : countLine && (!group || selected) ? (
            <View style={styles.countRow}>
              <Text style={styles.countLine}>{countLine}</Text>
              {registerDate ? <Text style={styles.registerDate}>{registerDate}</Text> : null}
            </View>
          ) : null}

          {served ? (
            <RaceFinder
              contests={allContests}
              isMobile={isMobile}
              query={query}
              onQueryChange={onQueryChange}
              onChoose={onChooseGroup}
            />
          ) : null}

          {!group ? (
            <View style={styles.officeControls}>
              <Text style={styles.figureLabel}>Candidate committees by office</Text>
              <View style={styles.chipRow} role="group" aria-label="Candidate committees by office">
                <OfficeChip
                  label={ALL_OFFICES_LABEL}
                  count={loading ? null : (page?.committeeCount ?? null)}
                  active={office === null}
                  onPress={() => onSelectOffice(null)}
                />
                {offices.map((entry) => (
                  <OfficeChip
                    key={entry.office}
                    label={entry.office}
                    count={loading ? null : entry.committeeCount}
                    active={office === entry.office}
                    onPress={() => onSelectOffice(entry.office)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.listLoading} role="status" aria-busy>
              <Text style={styles.explain}>Loading committees</Text>
              {(['58%', '72%', '44%'] as const).map((width, index) => (
                <View key={index} style={styles.rowLoading}>
                  <Skeleton width={width} height={15} />
                </View>
              ))}
            </View>
          ) : !served ? (
            <View style={styles.card} role="alert">
              <Text accessibilityRole="header" aria-level={2} style={styles.h3}>
                Committee records unavailable
              </Text>
              <Text style={styles.explain}>{MONEY_BY_RACE_UNAVAILABLE}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void races.refetch()}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : group && !selected ? (
            <View style={styles.card}>
              <Text style={styles.h3}>
                We couldn’t find this office, district or court seat in our records
              </Text>
              <Pressable
                {...linkProps(directoryHref, () => navigation.setParams(directoryParams))}
                style={styles.backLink}
              >
                <Text style={styles.backLabel}>Choose another office, district or court seat</Text>
              </Pressable>
            </View>
          ) : selected ? (
            <View>
              <View style={styles.listHead}>
                <Text
                  accessibilityRole="header"
                  aria-level={2}
                  style={[styles.listYear, styles.contributionsHeading]}
                >
                  {figuresYearLine(year)}
                </Text>
                <Text style={styles.listSort}>Committee names A–Z</Text>
              </View>
              <Text style={[styles.explain, styles.comparisonNote]}>{RACE_COMPARISON_NOTE}</Text>
              {selected.periodsDiffer ? (
                <Text style={[styles.explain, styles.mixedPeriods]}>{MIXED_PERIODS_NOTE}</Text>
              ) : null}
              <Text style={styles.listNote}>{MONEY_BY_RACE_NOTE}</Text>
              <ContestBlock
                fetchedAt={page.fetchedAt}
                contest={selected}
                year={year}
                isMobile={isMobile}
                isTablet={isTablet}
                onOpen={(slug) => navigation.push('CommitteeMoney', { slug, year: String(year) })}
              />
            </View>
          ) : contests.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.h3}>{noContestsTitle(office)}</Text>
              <Text style={styles.explain}>This does not mean there are no candidates.</Text>
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
                <Text style={styles.listYear}>
                  Choose an office, district or court seat to see its committees
                </Text>
                {orderLine ? <Text style={styles.listSort}>{orderLine}</Text> : null}
              </View>
              <View style={styles.directory}>
                {contests.map((contest, index) => (
                  <View
                    key={contest.anchor}
                    style={
                      !isMobile && !isTablet
                        ? [
                            styles.directoryHalf,
                            index % 2 === 0 ? styles.directoryLeft : styles.directoryRight,
                          ]
                        : styles.directoryFull
                    }
                  >
                    <DirectoryRow
                      contest={contest}
                      year={String(year)}
                      isMobile={isMobile}
                      onChoose={onChooseGroup}
                    />
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={styles.notCoveredBox}>
            <Text accessibilityRole="header" aria-level={2} style={styles.notCoveredLabel}>
              {RACE_COVERAGE_HEADING}
            </Text>
            <View style={styles.notCoveredList}>
              {RACE_COVERAGE.map((line) => (
                <Text key={line} style={styles.notCoveredLine}>
                  {line}
                </Text>
              ))}
              {!selected ? (
                <Text style={styles.notCoveredLine}>{RACE_DONOR_EXPLANATION}</Text>
              ) : null}
            </View>
          </View>
        </Container>
        <Footer />
      </ScrollView>
    </PageBackground>
  );
}

function DirectoryRow({
  contest,
  year,
  isMobile,
  onChoose,
}: {
  contest: RaceContest;
  year?: string;
  isMobile: boolean;
  onChoose: (anchor: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      {...linkProps(
        routePath.moneyRaces({ year, office: contest.office, group: contest.anchor }),
        () => onChoose(contest.anchor),
      )}
      accessibilityLabel={`View committees for ${contestSeatLabel(contest)}`}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.directoryRow,
        hovered && styles.directoryHover,
        isMobile && styles.directoryRowMobile,
      ]}
    >
      <View style={styles.directoryText}>
        <Text style={styles.directoryName}>{contestSeatLabel(contest)}</Text>
        <Text style={styles.contestCount}>{contestCountLabel(contest.committeeCount)}</Text>
      </View>
      <Text style={styles.directoryAction}>View committees</Text>
    </Pressable>
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
      {active ? (
        <Svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden>
          <Path
            d="M3 8 L6.5 11.5 L13 4.5"
            stroke={t.colors.surfaces.base}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ) : null}
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
      {count !== null ? (
        <Text style={[styles.chipCount, active && styles.chipCountActive]}>
          {formatCount(count)}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Every committee in the selected group, retaining the served order. */
function ContestBlock({
  fetchedAt,
  contest,
  year,
  isMobile,
  isTablet,
  onOpen,
}: {
  contest: RaceContest;
  fetchedAt: string | null;
  year: number;
  isMobile: boolean;
  isTablet: boolean;
  onOpen: (slug: string) => void;
}) {
  return (
    <View style={[styles.contest, isMobile && styles.contestMobile]}>
      <View
        style={[
          styles.columnHead,
          isTablet && styles.tabletRow,
          isMobile && styles.columnHeadMobile,
        ]}
      >
        {!isMobile ? <View style={styles.rowText} /> : null}
        {RACE_FIGURE_DEFINITIONS.map((definition) => (
          <View
            key={definition.label}
            style={isMobile ? styles.figureMobile : isTablet ? styles.figureTablet : styles.figure}
          >
            <Text style={styles.figureLabel}>{definition.label}</Text>
            <Text style={styles.figureDefinition}>{definition.text}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.donorNote}>{RACE_DONOR_EXPLANATION}</Text>
      {fetchedAt ? (
        <Text style={styles.freshness}>
          {FILES_COPIED_LABEL} {centralDateLabel(fetchedAt)}
        </Text>
      ) : null}
      <View style={styles.rows}>
        {contest.committees.map((committee) => (
          <CommitteeRow
            key={committee.registrationNumber}
            committee={committee}
            year={year}
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
  year,
  isMobile,
  isTablet,
  onOpen,
}: {
  committee: RaceCommittee;
  year: number;
  isMobile: boolean;
  isTablet: boolean;
  onOpen: (slug: string) => void;
}) {
  const slug = committeeSlug(committee.name, committee.registrationNumber);
  const closed = committee.isClosed
    ? (closedChipLabel(committee.terminationDate) ?? 'Closed')
    : null;
  const prefetchCommitteeMoney = usePrefetchCommitteeMoney();
  const warm = () => prefetchCommitteeMoney(committee.registrationNumber, slug, year);
  return (
    <View style={[styles.row, isTablet && styles.tabletRow, isMobile && styles.rowMobile]}>
      <View style={[styles.rowText, isMobile && styles.rowTextMobile]}>
        <Pressable
          {...linkProps(routePath.moneyCommittee(slug, { year: String(year) }), () => onOpen(slug))}
          onPressIn={warm}
          onHoverIn={warm}
          style={styles.rowNameLink}
        >
          <Text style={styles.rowName}>{committee.name}</Text>
        </Pressable>
        <Text style={styles.rowReg}>Registration {committee.registrationNumber}</Text>
        {closed ? <Text style={styles.closedLabel}>{closed}</Text> : null}
      </View>
      {committeeFigures(committee, year).map((figure) => (
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
  goBack: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 10,
    paddingHorizontal: 14,
    backgroundColor: t.colors.surfaces.base,
  },
  officeControls: { marginTop: 26 },
  directory: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap' },
  directoryFull: { width: '100%' },
  directoryHalf: { width: '50%' },
  directoryLeft: { paddingRight: 22 },
  directoryRight: { paddingLeft: 22 },
  directoryRow: {
    minHeight: 76,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink10,
  },
  directoryRowMobile: { flexDirection: 'column', alignItems: 'flex-start', gap: 8 },
  directoryHover: { backgroundColor: '#f1f5f2' },
  directoryText: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  directoryName: {
    fontVariant: ['tabular-nums'],
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '700',
    color: t.colors.text.primary,
  },
  directoryAction: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '700',
    color: t.colors.text.primary,
    textDecorationLine: 'underline',
  },
  donorNote: {
    maxWidth: 920,
    marginBottom: 0,
    fontVariant: ['tabular-nums'],
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 24,
    color: t.colors.text.secondary,
  },
  main: { paddingTop: 28, paddingBottom: 64 },
  mainTablet: { paddingHorizontal: 40 },
  mainMobile: { paddingTop: 18, paddingHorizontal: 20 },
  backLink: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
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
    fontVariant: ['tabular-nums'],
    marginTop: 12,
    fontFamily: t.typography.title,
    fontSize: 42,
    lineHeight: 48,
    fontWeight: '800',
    letterSpacing: -1.2,
    color: t.colors.text.primary,
  },
  h1WithoutEyebrow: { marginTop: 18 },
  h1Mobile: { fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  dek: {
    marginTop: 12,
    maxWidth: 760,
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 28,
    color: t.colors.text.secondary,
  },
  registrationLabel: {
    marginTop: 14,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: t.colors.text.primary,
  },
  countRow: { marginTop: 28, gap: 6 },
  countLine: {
    fontFamily: t.typography.body,
    fontSize: 30,
    lineHeight: 38,
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
  chipRow: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
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
  contributionsHeading: { fontSize: 24, lineHeight: 32 },
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
  comparisonNote: { marginTop: 12, maxWidth: 920 },
  contest: {
    marginTop: 20,
    paddingTop: 22,
    paddingHorizontal: 26,
    paddingBottom: 10,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 16,
    backgroundColor: t.colors.surfaces.base,
  },
  contestMobile: { paddingTop: 18, paddingHorizontal: 18 },
  contestCount: {
    marginTop: 3,
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 22,
    color: t.colors.text.secondary,
    fontVariant: ['tabular-nums'],
  },
  mixedPeriods: { marginTop: 12, maxWidth: 920 },
  columnHead: {
    marginTop: 16,
    marginBottom: 10,
    flexDirection: 'row',
    gap: 24,
    alignItems: 'flex-start',
  },
  columnHeadMobile: { flexDirection: 'column', gap: 12 },
  figureDefinition: {
    marginTop: 3,
    fontFamily: t.typography.body,
    fontSize: 13,
    lineHeight: 20,
    color: t.colors.text.muted,
  },
  rows: { marginTop: 16, borderTopWidth: 1, borderTopColor: t.colors.alpha.ink08 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    paddingVertical: 17,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink08,
  },
  tabletRow: { gap: 16 },
  rowMobile: { flexDirection: 'column', gap: 12, paddingVertical: 14 },
  rowText: { flex: 1, minWidth: 0 },
  rowTextMobile: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: '100%' },
  rowNameLink: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: -8,
    marginBottom: -8,
  },
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
  figureTablet: { width: 190, flexShrink: 0, minWidth: 0 },
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
    marginTop: 10,
    maxWidth: 920,
    fontWeight: '600',
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
    marginTop: 34,
    maxWidth: 920,
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink10,
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
