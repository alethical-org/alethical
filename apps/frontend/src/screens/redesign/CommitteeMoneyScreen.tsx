import {
  CONFIRMATION_LOADING_LINE,
  CONFIRMATION_UNAVAILABLE_LINE,
} from '../../lib/committeeConfirmation';
import { useEffect, type ReactNode } from 'react';
import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { contributionDetailRows, withContributionDetailRows } from '../../lib/contributionDetails';
import { SharePopover } from '../../components/billDetail/SharePopover';
import { LinkArrowLabel, linkArrowRow } from '../../components/LinkArrow';
import { PageContextLabel } from '../../components/PageContextLabel';
import {
  CommitteeDonations,
  GroupedOutsideSpending,
  preloadMoneyDetails,
} from '../../components/campaignMoney/MoneyDetailsOnDemand';
import type { MoneyDetailsPreferences } from '../../lib/campaignMoneyPreferences';
import {
  committeeMoneyPreferences,
  committeeMoneyPreferenceParams,
} from '../../lib/committeeMoneyPreferences';
import { committeeOutsideSpending } from '../../lib/committeeOutsideSpending';
import { MONEY_SECTION_NAME } from '../../lib/moneySectionName';
import { committeeCardStyles, detailsStyles } from '../../components/campaignMoney/detailsStyles';
import { YearControl } from '../../components/campaignMoney/YearControl';
import {
  CardHeading,
  CampaignMoneyCardTheme,
  CheckedByBlock,
  Figure,
  FilingStamp,
  MoneyInBlock,
  MoneyOutBlock,
} from '../../components/campaignMoney/MoneyCards';
import { CommitteeDonationCards } from '../../components/campaignMoney/CommitteeDonationCards';
import { TrackCommitteeButton } from '../../components/campaignMoney/TrackCommitteeButton';
import { BOARD_RECORD_LINK_LABEL, boardRecordUrl } from '../../lib/boardRecordLink';
import { Skeleton, useOneScreenTall } from '../../components/Skeleton';
import type { CommitteeConfirmation, CommitteeMoney } from '../../data/types';
import {
  useCommitteeFilingsList,
  useCommitteeMoney,
  useCommitteeConfirmation,
  useOutsideSpending,
  usePrefetchCommitteeMoney,
  usePrefetchLegislator,
} from '../../hooks/useAppQueries';
import { useCurrentClaimExpiry } from '../../hooks/useCurrentClaimExpiry';
import { useResponsive } from '../../hooks/useResponsive';
import { useHistoryScrollRestoration } from '../../hooks/useHistoryScrollRestoration';
import {
  AMENDED_CHIP,
  CLOSED_EMPTY_VALUE,
  CLOSED_MONEY_IN_WHY,
  closedPeriodDetail,
  closedPeriodLine,
  committeeTabFromParam,
  committeeAlternativeYear,
  COMMITTEE_TAB_LABELS,
  COMMITTEE_MONEY_SECTION_LABEL,
  confirmedMemberLinkLabel,
  EMPTY_YEAR_VALUE,
  emptyYearMoneyInWhy,
  filingIsAmended,
  filedDateLine,
  filingRowPeriodLine,
  filingsCountLine,
  filingsOrderingLine,
  FILINGS_EMPTY_TITLE,
  FILINGS_EMPTY_WHY,
  FILINGS_HEADLINE,
  FILINGS_PERIOD_NOTE,
  FILINGS_UNAVAILABLE,
  OUTSIDE_BY_ALL_YEARS,
  OUTSIDE_SORT_LABELS,
  outsideCountLine,
  outsideCounterparty,
  outsidePaidLine,
  outsideRegistrationLine,
  outsideRowMeta,
  outsideStanceLabel,
  outsideUnpaidNote,
  RECORD_COVERS_HEADING,
  recordCoverageLines,
  registeredForLine,
  stampThroughDate,
  NOT_IN_REGISTER_LINE,
  unlistedReportsLine,
  whoseCommitteeText,
  yearDisplayState,
  CONFIRMED_MEMBER_WITHHELD_LINE,
  type CommitteeTab,
  type OutsideSpendingSort,
  type OutsideSpendingTab,
} from '../../lib/committeeMoney';
import {
  closedChipLabel,
  committeeEyebrow,
  committeeSlug,
  coveredPeriodDetail,
  coveredPeriodLine,
  isBallotQuestionFiler,
  IN_KIND_CHIP,
  MONEY_IN_HEADING,
  MONEY_IN_REPORTED_LABEL,
  notFoundBody,
  notFoundTitle,
  OUTSIDE_ABOUT_INTRO,
  OUTSIDE_NEVER_ADDED,
  registerKindFromEntityType,
  registrationNumberFromSlug,
  staleHoldNote,
  uncoveredPeriodDetail,
  uncoveredPeriodLine,
} from '../../lib/committeeMoneyShared';
import { COMMITTEE_PAYMENTS_LINK_LABEL } from '../../lib/committeeMoneyShared';
import { paymentFilesDownloadedLine } from '../../lib/campaignMoneyDetailsPageCopy';
import {
  campaignMoneyYear,
  campaignMoneyHistoryYears,
  formatDay,
  formatMoney,
} from '../../lib/legislatorCampaignMoney';
import { centralDateLabel } from '../../lib/moneyLanding';
import { publicPageUrl, type ShareContent, committeeMoneyPageMetadata } from '../../lib/share';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import { screenLoaderForPath } from '../../navigation/screenPreload';
import type { RootScreenProps } from '../../navigation/types';
import { markNextWebHistoryChangeAsReplace } from '../../navigation/webHistory';
import { Container, Footer, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';
import { contentTabStyle } from '../../theme/contentTabs';

/**
 * One committee's money at /money/committees/{name}-{registration number}
 * (campaign money phase 2; "Money committee web.dc.html"). The trailing number is
 * the identity and the only thing that resolves — committee names collide,
 * registration numbers do not — so an old or misspelled name part still lands
 * here, and the address then forwards to the current spelling in place.
 *
 * The display rules this screen keeps, each one a way a page could show a
 * confident wrong number (grounded-answers.md rule 12; design doc §7):
 * - Money in is 2 numbers, both correct: the total the committee reported to the
 *   state AND the donations we can list with a donor's name. The named/unnamed
 *   division arrives DECIDED by the server (`split.state`); this page never
 *   subtracts, and in each of the 4 withheld states it prints the state's own plain
 *   sentence instead.
 * - A verified zero is "0"; a closed committee keeps the register's own date.
 * - Money out shows the official "Expenditures" total when held. Otherwise no amount
 *   is printed; the card names the missing official total in our records.
 * - A ballot-question filer's page uses the $500 yearly donor-naming threshold.
 * - When our own service does not answer, the page holds the figures it already
 *   had, dated, until it answers — never expiring on a timer.
 */

const isWeb = Platform.OS === 'web';

const BOARD_REGISTER =
  'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/';

function BackChevron() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M15 5 L8 12 L15 19"
        stroke={t.colors.text.secondary}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// Year selection and revealing payments retain their original action arrow.
function ActionArrow() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M5 12 H19 M14 7 L19 12 L14 17"
        stroke={c.text}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Everything this screen's first frame needs, downloaded together with the screen.
 *
 * The chart, the payment lists and the reads behind them arrive in their own pieces
 * (`MoneyDetailsBundle`, `data/campaignMoneyDetails`). Fetched after the screen
 * mounted, the committee card drew twice: its figures under "Loading the
 * contribution breakdown…", then the same figures under the chart about 90 ms
 * later, which read as an old page being replaced by a new one (measured live
 * 17 Sep 2026). `screenChunks.CommitteeMoney` waits for this before the screen
 * draws, the same way the legislator profile's money tab does
 * (`CampaignMoneyTabOnDemand`). Neither optional piece can hold the screen back: a
 * failure there reaches the card's own fallback, exactly as before.
 */
export function committeeMoneyScreenPieces(): Promise<void> {
  return Promise.all([
    preloadMoneyDetails().catch(() => undefined),
    import('../../data/campaignMoneyDetails').catch(() => undefined),
  ]).then(() => undefined);
}

export function CommitteeMoneyScreen({ navigation, route }: RootScreenProps<'CommitteeMoney'>) {
  const { isMobile } = useResponsive();
  const oneScreenTall = useOneScreenTall();
  const slug = route.params?.slug ?? '';
  const registrationNumber = registrationNumberFromSlug(slug);
  const year = campaignMoneyYear(route.params?.year);
  const tab = committeeTabFromParam(route.params?.tab);
  const preferences = committeeMoneyPreferences(route.params ?? {});
  const onPreferences = (next: MoneyDetailsPreferences) => {
    if (next.tab === preferences.tab && next.sort === preferences.sort) return;
    // Keep these choices on the same visit, alongside its saved scroll position.
    markNextWebHistoryChangeAsReplace();
    navigation.setParams({
      ...committeeMoneyPreferenceParams(next),
      ...(tab === 'spent' ? { tab: 'gave' } : {}),
    });
  };

  const moneyQuery = useCommitteeMoney(registrationNumber, year);
  const money = moneyQuery.data ?? null;
  const confirmationQuery = useCommitteeConfirmation(registrationNumber);
  const confirmation = confirmationQuery.data;
  const notFound = moneyQuery.data === null && !moneyQuery.isPending && !moneyQuery.isError;

  // Whose committee this is can be taken back after it was confirmed, so it is the
  // one thing on this page that expires. Past the deadline the sentence naming the
  // member is withheld and every dated figure stays exactly as it is
  // (`lib/currentClaimFreshness.ts`, issue 2023). `dataUpdatedAt` is 0 before any
  // answer, which would read as 1970 and withhold on a page that has nothing to
  // withhold, so it is only passed once there is data.
  const confirmedMemberWithheld = useCurrentClaimExpiry({
    servedAgeMs: confirmation?.currentClaim.servedAgeMs,
    dataUpdatedAt: confirmation ? confirmationQuery.dataUpdatedAt : undefined,
    refetch: confirmationQuery.refetch,
  });

  // The canonical forward: an old or misspelled name part lands here by the
  // number, then the address is rewritten in place to the current spelling —
  // never pushed, so the Back button is not trapped between the two.
  const canonicalName = money ? (money.register.name ?? money.committeeName) : null;
  useEffect(() => {
    if (!isWeb || !money || !registrationNumber || !canonicalName) return;
    const canonical = committeeSlug(canonicalName, registrationNumber);
    if (canonical !== slug) {
      markNextWebHistoryChangeAsReplace();
      navigation.setParams({ slug: canonical });
    }
  }, [canonicalName, money, navigation, registrationNumber, slug]);

  useDocumentTitle(
    registrationNumber ? `/money/committees/${slug}` : null,
    canonicalName
      ? committeeMoneyPageMetadata(slug, 'page', { name: canonicalName, canonicalSlug: slug }).title
      : null,
  );

  const onSelectYear = (next: number) =>
    navigation.setParams({
      year: String(next),
      contributionDetails: undefined,
      earlierYears: undefined,
    });
  const onSelectTab = (next: CommitteeTab) =>
    navigation.setParams({ ...committeeMoneyPreferenceParams(preferences), tab: next });

  return (
    <View style={styles.background}>
      <CommitteeScroll key={registrationNumber}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        {/* Every state of this page holds a screenful, so the footer below it
            starts under the fold and nothing a reader can see moves when the
            records land or the load fails (useOneScreenTall in
            components/Skeleton.tsx). */}
        <View style={[styles.main, isMobile && styles.mainMobile, oneScreenTall]}>
          <Container>
            <Pressable
              {...linkProps(routePath.money(), () => navigation.navigate('MoneyLanding'))}
              style={styles.backLink}
            >
              <BackChevron />
              <Text style={styles.backLabel}>{MONEY_SECTION_NAME}</Text>
            </Pressable>
          </Container>
          {notFound && registrationNumber ? (
            <Container>
              <NotFoundState
                registrationNumber={registrationNumber}
                onMoney={() => navigation.navigate('MoneyLanding')}
              />
            </Container>
          ) : moneyQuery.isPending || !money ? (
            moneyQuery.isError ? (
              <Container>
                <View style={styles.card}>
                  <Text accessibilityRole="alert" style={styles.body}>
                    We couldn’t load this committee’s money right now. This is a problem on our side
                    and says nothing about the committee. Please try again in a moment.
                  </Text>
                </View>
              </Container>
            ) : (
              <Container>
                <LoadingState isMobile={isMobile} />
              </Container>
            )
          ) : (
            <CommitteeBody
              key={registrationNumber}
              money={money}
              year={year}
              tab={tab}
              slug={slug}
              registrationNumber={registrationNumber ?? money.registrationNumber}
              isMobile={isMobile}
              isHoldingStale={moneyQuery.isError}
              confirmedMemberWithheld={confirmedMemberWithheld}
              confirmation={confirmation}
              confirmationPending={confirmationQuery.isPending}
              onSelectYear={onSelectYear}
              onSelectTab={onSelectTab}
              navigation={navigation}
              onRefresh={() => void moneyQuery.refetch()}
              preferences={preferences}
              onPreferences={onPreferences}
              contributionDetails={route.params?.contributionDetails}
              evidenceOpen={route.params?.evidence === '1'}
              spendingSort={route.params?.spendingSort}
            />
          )}
        </View>
        <Footer />
      </CommitteeScroll>
    </View>
  );
}

// A same-screen link changes the committee without replacing the navigation
// route. Give each committee its own inner scroller and browser Back position;
// changing the year or a list control keeps the current scroller.
function CommitteeScroll({ children }: { children: ReactNode }) {
  const scrollRestoration = useHistoryScrollRestoration();
  return (
    <ScrollView
      {...scrollRestoration}
      testID="committee-money-scroll"
      contentContainerStyle={styles.page}
    >
      {children}
    </ScrollView>
  );
}

function LoadingState({ isMobile }: { isMobile: boolean }) {
  return (
    <View style={styles.loadingWrap}>
      <View role="status" aria-busy style={styles.hidden}>
        <Text>Loading figures</Text>
      </View>
      <Skeleton width={180} height={13} />
      <Skeleton width={420} height={38} style={{ marginTop: 14 }} />
      <Skeleton width={260} height={16} style={{ marginTop: 12 }} />
      <View style={[styles.loadingCards, isMobile && styles.loadingCardsMobile]}>
        <View style={styles.card}>
          <Skeleton width={180} height={13} />
          <Skeleton width={240} height={34} />
          <Skeleton width="100%" height={10} />
        </View>
        <View style={styles.card}>
          <Skeleton width={180} height={13} />
          <Skeleton width={240} height={34} />
          <Skeleton width="100%" height={10} />
        </View>
      </View>
    </View>
  );
}

function NotFoundState({
  registrationNumber,
  onMoney,
}: {
  registrationNumber: string;
  onMoney: () => void;
}) {
  return (
    <View style={styles.notFoundWrap}>
      <PageContextLabel style={styles.eyebrow}>Committees</PageContextLabel>
      <Text accessibilityRole="header" aria-level={1} style={styles.h1}>
        {notFoundTitle()}
      </Text>
      <Text style={styles.body}>{notFoundBody(registrationNumber)}</Text>
      <View style={styles.buttonRow}>
        <Pressable {...linkProps(routePath.money(), onMoney)} style={styles.primaryButton}>
          <Text style={styles.primaryButtonLabel}>{MONEY_SECTION_NAME}</Text>
        </Pressable>
        <Text
          style={styles.secondaryButton}
          {...externalLinkProps(BOARD_REGISTER, () => void Linking.openURL(BOARD_REGISTER))}
        >
          Check the Board’s register
        </Text>
      </View>
    </View>
  );
}

function CommitteeBody({
  money,
  year,
  tab,
  slug,
  registrationNumber,
  isMobile,
  isHoldingStale,
  confirmedMemberWithheld,
  confirmation,
  confirmationPending,
  onSelectYear,
  onSelectTab,
  navigation,
  onRefresh,
  preferences,
  onPreferences,
  contributionDetails,
  evidenceOpen,
  spendingSort,
}: {
  contributionDetails?: string;
  evidenceOpen: boolean;
  spendingSort?: string;
  money: CommitteeMoney;
  year: number;
  tab: CommitteeTab;
  slug: string;
  registrationNumber: string;
  isMobile: boolean;
  isHoldingStale: boolean;
  confirmedMemberWithheld: boolean;
  confirmation: CommitteeConfirmation | undefined;
  confirmationPending: boolean;
  onSelectYear: (year: number) => void;
  onSelectTab: (tab: CommitteeTab) => void;
  navigation: RootScreenProps<'CommitteeMoney'>['navigation'];
  onRefresh: () => void;
  preferences: MoneyDetailsPreferences;
  onPreferences: (preferences: MoneyDetailsPreferences) => void;
}) {
  const registerKind =
    money.register.state === 'reported'
      ? money.register.kind
      : registerKindFromEntityType(money.entityType);
  const isBallot = isBallotQuestionFiler(money.entitySubType);
  const isPartyUnit = registerKind === 'party_unit';
  // This filer's own record on the Board's site, keyed by the number the page
  // already prints. One address for all 3 kinds sent a party unit and a political
  // fund to the candidate name search, which cannot contain either (#2179).
  const boardUrl = boardRecordUrl(registerKind, registrationNumber, year);
  const name = money.register.name ?? money.committeeName ?? `Committee ${registrationNumber}`;
  const eyebrow = committeeEyebrow(registerKind, money.entitySubType);
  const registeredFor = registeredForLine({
    kind: registerKind,
    office: money.register.office,
    district: money.register.district,
  });
  const closedChip = closedChipLabel(money.register.terminationDate);
  const state = yearDisplayState(money);
  const checkedOn = money.fetchedAt ? centralDateLabel(money.fetchedAt) : null;
  const otherYear = committeeAlternativeYear(year);
  const prefetchLegislator = usePrefetchLegislator();
  // Warm the member's profile data AND its screen file on navigation intent,
  // matching the bill and legislator lists (usePrefetchBill /
  // usePrefetchLegislator, #1966) plus the route-splitting piece the profile
  // screen now downloads on its own (screenLoaderForPath, #1970/#1975).
  // The member this page may name RIGHT NOW, which is not the same as the member
  // the answer carried. Withholding is only ever about naming somebody: where the
  // answer already names nobody there is nothing to withhold, and an out-of-date
  // "nobody has confirmed one" can at worst under-claim, never misname a person.
  const nameableMember = confirmedMemberWithheld ? null : (confirmation?.confirmedFor ?? null);
  const warmConfirmedFor = () => {
    if (nameableMember) {
      prefetchLegislator(nameableMember.slug);
      void screenLoaderForPath(
        routePath.legislator(nameableMember.slug, { tab: 'money', year: String(year) }),
      )?.();
    }
  };

  const ownershipText = !confirmation
    ? confirmationPending
      ? CONFIRMATION_LOADING_LINE
      : CONFIRMATION_UNAVAILABLE_LINE
    : confirmedMemberWithheld && confirmation.confirmedFor
      ? CONFIRMED_MEMBER_WITHHELD_LINE
      : whoseCommitteeText(registerKind, money.entitySubType, nameableMember);

  const { isTablet } = useResponsive();
  const shareContent: ShareContent = {
    title: name,
    subject: 'committee',
    description: 'Campaign money from Minnesota’s official filings',
    url: publicPageUrl(
      routePath.moneyCommittee(committeeSlug(name, registrationNumber), {
        tab: tab === 'spent' ? 'gave' : tab,
        year: String(year),
        ...committeeMoneyPreferenceParams(preferences),
        contributionDetails,
        evidence: evidenceOpen ? '1' : undefined,
        spendingSort,
      }),
    ),
  };

  return (
    <View style={styles.bodyWrap}>
      <Container style={styles.heroContent}>
        <PageContextLabel style={styles.eyebrow}>{eyebrow ?? 'Committee'}</PageContextLabel>
        <View style={styles.headRow}>
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.h1, isMobile && styles.h1Mobile]}
          >
            {name}
          </Text>
          <TrackCommitteeButton
            registrationNumber={registrationNumber}
            beside={<SharePopover content={shareContent} />}
            onOpenTracked={() => navigation.navigate('Tabs', { screen: 'Tracked' })}
          />
        </View>
        <View style={styles.chipRow}>
          <Text style={styles.regChip}>REG {registrationNumber}</Text>
          {registeredFor ? <Text style={styles.registeredFor}>{registeredFor}</Text> : null}
          {money.register.state === 'not_registered' ? (
            <Text style={styles.registeredFor}>{NOT_IN_REGISTER_LINE}</Text>
          ) : null}
          {closedChip ? <Text style={styles.closedChip}>{closedChip.toUpperCase()}</Text> : null}
        </View>

        {ownershipText || nameableMember ? (
          <View
            style={[
              styles.whoseCard,
              isTablet && styles.panelTablet,
              isMobile && styles.panelMobile,
            ]}
          >
            <Text style={styles.whoseText}>
              {/* Never `whoseCommitteeText(..., null)` while withholding: that sentence
              says nobody has confirmed a member, which is a different fact and
              false here. A withheld claim gets its own words. */}
              {ownershipText}
            </Text>
            {/* The confirmation's date, stored evidence and destination belong together.
            Failed and expired checks never enter this block. */}
            <CheckedByBlock
              checked={nameableMember?.checked}
              checkerNamedAbove
              collapsibleEvidence
              evidenceOpen={evidenceOpen}
              onEvidenceOpenChange={(open) =>
                navigation.setParams({ evidence: open ? '1' : undefined })
              }
            >
              {nameableMember ? (
                <Pressable
                  {...linkProps(
                    routePath.legislator(nameableMember.slug, { tab: 'money', year: String(year) }),
                    () =>
                      navigation.push('LegislatorProfile', {
                        legislatorId: nameableMember.slug,
                        tab: 'money',
                        year: String(year),
                      }),
                  )}
                  onPressIn={warmConfirmedFor}
                  onHoverIn={warmConfirmedFor}
                  style={[styles.seeAll, styles.confirmedLink]}
                >
                  <LinkArrowLabel
                    label={confirmedMemberLinkLabel(nameableMember.fullName)}
                    style={[styles.seeAllLabel, styles.confirmedLinkLabel]}
                  />
                </Pressable>
              ) : null}
            </CheckedByBlock>
          </View>
        ) : null}
      </Container>
      <View style={styles.recordsBackground}>
        <Container style={styles.recordsContent}>
          <PaymentsSection
            money={money}
            year={year}
            tab={tab}
            slug={committeeSlug(name, registrationNumber)}
            registrationNumber={registrationNumber}
            boardUrl={boardUrl}
            onSelectTab={onSelectTab}
            onRefresh={onRefresh}
            navigation={navigation}
            preferences={preferences}
            onPreferences={onPreferences}
            contributionDetails={contributionDetails}
            spendingSort={spendingSort}
            moneyControls={
              <>
                <View style={[styles.yearRow, isMobile && styles.yearRowMobile]}>
                  <YearControl
                    year={year}
                    years={campaignMoneyHistoryYears()}
                    onSelect={onSelectYear}
                    surface="committee"
                  />
                </View>

                <PeriodStamp
                  money={money}
                  state={state}
                  year={year}
                  isPartyUnit={isPartyUnit}
                  boardUrl={boardUrl}
                  isHoldingStale={isHoldingStale}
                  isMobile={isMobile}
                />
              </>
            }
            moneyFooter={
              <>
                <View
                  style={[
                    styles.coverageCard,
                    isTablet && styles.panelTablet,
                    isMobile && styles.panelMobile,
                  ]}
                >
                  <Text style={styles.coverageHead}>{RECORD_COVERS_HEADING.toUpperCase()}</Text>
                  {recordCoverageLines(isBallot).map((line) => (
                    <Text key={line} style={styles.coverageLine}>
                      {line}
                    </Text>
                  ))}
                </View>

                {checkedOn ? (
                  <Text style={styles.freshness}>
                    {paymentFilesDownloadedLine(
                      checkedOn,
                      money.filingsCopiedAt ? centralDateLabel(money.filingsCopiedAt) : null,
                    )}
                  </Text>
                ) : null}
              </>
            }
          >
            {(withDonorBreakdown) => (
              <View style={[styles.cardsGrid, isMobile && styles.cardsGridMobile]}>
                <MoneyInCard
                  money={money}
                  state={state}
                  year={year}
                  isBallot={isBallot}
                  boardUrl={boardUrl}
                  otherYear={otherYear}
                  isMobile={isMobile}
                  onSelectYear={onSelectYear}
                  withDonorBreakdown={withDonorBreakdown}
                />
                <MoneyOutCard money={money} isMobile={isMobile} />
              </View>
            )}
          </PaymentsSection>
        </Container>
      </View>
    </View>
  );
}

function PeriodStamp({
  money,
  state,
  year,
  isPartyUnit,
  boardUrl,
  isHoldingStale,
  isMobile,
}: {
  money: CommitteeMoney;
  state: 'closed-empty' | 'empty-year' | 'figures';
  year: number;
  isPartyUnit: boolean;
  boardUrl: string;
  isHoldingStale: boolean;
  isMobile: boolean;
}) {
  // The filing's period, identity and link live here, once, above both cards: one
  // filing produces both, so stating any of it per card states one fact twice.
  const through = stampThroughDate(money.split, money.moneyOut);
  let line: string | null;
  let detail: string;
  if (state === 'closed-empty') {
    line = closedPeriodLine(money.register.terminationDate);
    detail = closedPeriodDetail(money.register.terminationDate, null);
  } else if (state === 'empty-year') {
    line = uncoveredPeriodLine(year);
    detail = uncoveredPeriodDetail(year, null);
  } else {
    line = coveredPeriodLine(through, money.moneyIn.reportedPeriodStart);
    detail = coveredPeriodDetail(through, null, {
      isPartyUnit,
      reportedPeriodStart: money.moneyIn.reportedPeriodStart,
    });
  }
  const covered = state === 'figures' && line !== null;
  return (
    <View style={styles.stampWrap}>
      <FilingStamp
        surface="committee"
        line={line}
        detail={detail}
        notes={isHoldingStale ? [staleHoldNote(null)] : []}
        boardRecordUrl={state === 'figures' && through !== null ? boardUrl : null}
        covered={covered}
        isMobile={isMobile}
      />
    </View>
  );
}

function MoneyInCard({
  money,
  state,
  year,
  isBallot,
  boardUrl,
  otherYear,
  isMobile,
  onSelectYear,
  withDonorBreakdown,
}: {
  money: CommitteeMoney;
  state: 'closed-empty' | 'empty-year' | 'figures';
  year: number;
  isBallot: boolean;
  boardUrl: string;
  otherYear: number;
  isMobile: boolean;
  onSelectYear: (year: number) => void;
  withDonorBreakdown: boolean;
}) {
  const { isTablet } = useResponsive();
  if (state !== 'figures') {
    // The committee page's own 2 empty years, which the profile never reaches: a
    // closed committee's final report we do not hold, and a year no filing covers.
    const closed = state === 'closed-empty';
    return (
      <View
        style={[
          styles.card,
          styles.summaryCard,
          isTablet && committeeCardStyles.tablet,
          isMobile && styles.cardMobile,
        ]}
      >
        <CardHeading surface="committee">{MONEY_IN_HEADING}</CardHeading>
        <Figure
          label={MONEY_IN_REPORTED_LABEL}
          value={closed ? CLOSED_EMPTY_VALUE : EMPTY_YEAR_VALUE}
          isFigure={false}
          isMobile={isMobile}
        />
        <Text style={styles.explain}>
          {closed ? CLOSED_MONEY_IN_WHY : emptyYearMoneyInWhy(year)}
        </Text>
        <View style={styles.inlineLinks}>
          {closed ? (
            <Text
              style={styles.source}
              {...externalLinkProps(boardUrl, () => void Linking.openURL(boardUrl))}
            >
              {BOARD_RECORD_LINK_LABEL}
            </Text>
          ) : null}
          <Pressable onPress={() => onSelectYear(otherYear)} accessibilityRole="button">
            <View style={styles.seeOtherYear}>
              <Text style={styles.seeOtherYearLabel}>See {otherYear}</Text>
              <ActionArrow />
            </View>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View
      style={[
        styles.card,
        styles.summaryCard,
        isTablet && committeeCardStyles.tablet,
        isMobile && styles.cardMobile,
      ]}
    >
      <MoneyInBlock
        surface="committee"
        withDonorBreakdown={withDonorBreakdown}
        showSource={false}
        split={money.split}
        moneyIn={money.moneyIn}
        isBallot={isBallot}
        stampThrough={stampThroughDate(money.split, money.moneyOut)}
        isMobile={isMobile}
      />
    </View>
  );
}

function MoneyOutCard({ money, isMobile }: { money: CommitteeMoney; isMobile: boolean }) {
  const { isTablet } = useResponsive();
  return (
    <View
      style={[
        styles.card,
        styles.summaryCard,
        isTablet && committeeCardStyles.tablet,
        isMobile && styles.cardMobile,
      ]}
    >
      <MoneyOutBlock
        surface="committee"
        moneyOut={money.moneyOut}
        stampThrough={stampThroughDate(money.split, money.moneyOut)}
        isMobile={isMobile}
      />
    </View>
  );
}

function PaymentsSection({
  money,
  year,
  tab: addressedTab,
  slug,
  registrationNumber,
  boardUrl,
  onSelectTab,
  onRefresh,
  navigation,
  children,
  preferences,
  onPreferences,
  moneyControls,
  moneyFooter,
  contributionDetails,
  spendingSort,
}: {
  contributionDetails?: string;
  spendingSort?: string;
  money: CommitteeMoney;
  year: number;
  tab: CommitteeTab;
  slug: string;
  registrationNumber: string;
  boardUrl: string;
  onSelectTab: (tab: CommitteeTab) => void;
  onRefresh: () => void;
  navigation: RootScreenProps<'CommitteeMoney'>['navigation'];
  children: (withDonorBreakdown: boolean) => ReactNode;
  moneyControls: ReactNode;
  moneyFooter: ReactNode;
  preferences: MoneyDetailsPreferences;
  onPreferences: (preferences: MoneyDetailsPreferences) => void;
}) {
  const { isMobile, isTablet } = useResponsive();
  const sort: OutsideSpendingSort = spendingSort === 'largest' ? 'largest' : 'newest';
  const setSort = (next: OutsideSpendingSort) =>
    navigation.setParams({ spendingSort: next === 'largest' ? next : undefined });
  const spentBy = useOutsideSpending({ spender: registrationNumber }, sort);
  const first = spentBy.data?.pages[0];
  const hasByRows = first?.state === 'reported' && (first.totalRows ?? 0) > 0;
  const byAbsent = !spentBy.isPending && !spentBy.isError && first?.state === 'not_reported';
  const section =
    addressedTab === 'filings' ? 'filings' : addressedTab === 'by' && !byAbsent ? 'by' : 'gave';
  const sections = ['gave', 'filings', ...(hasByRows || section === 'by' ? ['by'] : [])] as const;
  return (
    <CampaignMoneyCardTheme>
      <View style={detailsStyles.section}>
        <View role="group" aria-label="Committee record" style={styles.sectionTabs}>
          {sections.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              aria-pressed={section === key}
              onPress={() => onSelectTab(key as CommitteeTab)}
              style={contentTabStyle(styles.sectionTab, section === key)}
            >
              <Text
                style={[styles.sectionTabLabel, section === key && styles.sectionTabLabelActive]}
              >
                {key === 'gave'
                  ? COMMITTEE_MONEY_SECTION_LABEL
                  : COMMITTEE_TAB_LABELS[key as CommitteeTab]}
              </Text>
            </Pressable>
          ))}
        </View>
        {section === 'filings' ? (
          <>
            <FilingsList registrationNumber={registrationNumber} boardUrl={boardUrl} />
          </>
        ) : section === 'by' ? (
          <>
            <OutsideSpendingPanel
              tab="by"
              query={spentBy}
              sort={sort}
              onSelectSort={setSort}
              isMobile={isMobile}
              navigation={navigation}
            />
          </>
        ) : (
          <>
            {moneyControls}
            <View
              style={[
                styles.card,
                isTablet && committeeCardStyles.tablet,
                isMobile && styles.cardMobile,
              ]}
            >
              <CommitteeDonations
                headingLevel={2}
                isBallot={isBallotQuestionFiler(money.entitySubType)}
                committee={money}
                year={year}
                releaseId={money.releaseId}
                onRefresh={onRefresh}
                preferences={preferences}
                onPreferences={onPreferences}
              >
                {children(true)}
              </CommitteeDonations>
              <View style={detailsStyles.horizontal}>
                <Pressable
                  style={styles.seeAll}
                  {...linkProps(
                    routePath.moneyCommitteePayments(slug, { tab: 'gave', year: String(year) }),
                    () =>
                      navigation.navigate('CommitteePayments', {
                        slug,
                        tab: 'gave',
                        year: String(year),
                      }),
                  )}
                >
                  <LinkArrowLabel
                    label={COMMITTEE_PAYMENTS_LINK_LABEL}
                    style={styles.seeAllLabel}
                  />
                </Pressable>
              </View>
            </View>
            <CommitteeDonationCards
              expandedRows={contributionDetailRows(contributionDetails, registrationNumber, year)}
              onExpandedRowsChange={(rows) =>
                navigation.setParams({
                  contributionDetails: withContributionDetailRows(
                    contributionDetails,
                    registrationNumber,
                    year,
                    rows,
                  ),
                })
              }
              committee={money}
              year={year}
              registerKind={
                money.register.state === 'reported'
                  ? money.register.kind
                  : registerKindFromEntityType(money.entityType)
              }
              releaseId={money.releaseId}
            />
            <GroupedOutsideSpending
              surface="committee"
              year={committeeOutsideSpending(money)}
              releaseId={money.releaseId}
              onOpenSource={(url) => void Linking.openURL(url)}
            />
            {moneyFooter}
          </>
        )}
      </View>
    </CampaignMoneyCardTheme>
  );
}

/**
 * The 2 outside-spending tabs: what other groups spent about this committee ("Spent
 * about them"), and what this filer spent about others ("Spent by them"), each row
 * one served payment from Minnesota's independent-expenditures file
 * (`Money committee.dc.html`, rules for this screen; #1947).
 *
 * Every row prints its own facts and nothing is summed across rows: the other side
 * with its registration number (a link only where this release holds a page for it,
 * and the register line in the number's place where our copy of the register lacks
 * it), the filing's own For or Against, its purpose and vendor each with a designed
 * empty state, its type, its own date, its amount and any unpaid part under it. The
 * never-added sentence sits above the rows on both tabs, because this file is never
 * added to the ordinary expenditures file.
 *
 * Sorted newest first by default, largest first on request. The address preserves
 * spendingSort separately from donor sorting. Pages of 50 accumulate under
 * "Show more payments".
 */
function OutsideSpendingPanel({
  tab,
  query,
  sort,
  onSelectSort,
  isMobile,
  navigation,
}: {
  tab: OutsideSpendingTab;
  query: ReturnType<typeof useOutsideSpending>;
  sort: OutsideSpendingSort;
  onSelectSort: (sort: OutsideSpendingSort) => void;
  isMobile: boolean;
  navigation: RootScreenProps<'CommitteeMoney'>['navigation'];
}) {
  const pages = query.data?.pages ?? [];
  const first = pages[0];
  const rows = pages.flatMap((page) => page?.rows ?? []);
  const prefetchCommitteeMoney = usePrefetchCommitteeMoney();

  if (query.isPending) {
    return (
      <View style={styles.listLoading}>
        <View role="status" aria-busy style={styles.hidden}>
          <Text>Loading payments</Text>
        </View>
        {[0, 1, 2].map((index) => (
          <View key={index} style={styles.listRow}>
            <View style={styles.listRowText}>
              <Skeleton width="55%" height={14} />
              <Skeleton width={220} height={11} style={{ marginTop: 8 }} />
            </View>
            <Skeleton width={96} height={12} />
          </View>
        ))}
      </View>
    );
  }

  // The tab is drawn only for a subject with rows, so anything but a reported first
  // page here is our own service failing to answer, and says so.
  if (!first || first.state !== 'reported') {
    return (
      <View style={[styles.card, styles.filingsCard]}>
        <Text style={styles.explain}>
          We could not read this committee’s outside spending out of our copy of Minnesota’s file.
          This is a gap on our side, not a statement about the committee.
        </Text>
      </View>
    );
  }

  const distinct = tab === 'about' ? first.spenderCount : first.committeeCount;
  const countLine = outsideCountLine(tab, rows.length, first.totalRows, distinct);

  return (
    <>
      <View style={styles.outsideIntro}>
        {tab === 'about' ? <Text style={styles.explain}>{OUTSIDE_ABOUT_INTRO}</Text> : null}
        {tab === 'by' ? <Text style={styles.explain}>{OUTSIDE_BY_ALL_YEARS}</Text> : null}
        <Text style={styles.explain}>{OUTSIDE_NEVER_ADDED}</Text>
      </View>
      <View style={styles.listHead}>
        <Text style={styles.listCount}>{countLine ?? ''}</Text>
        <View style={styles.sortRow} role="group" aria-label="Sort payments">
          {(Object.keys(OUTSIDE_SORT_LABELS) as OutsideSpendingSort[]).map((option) => {
            const active = option === sort;
            return (
              <Pressable
                key={option}
                onPress={() => onSelectSort(option)}
                accessibilityRole="button"
                aria-pressed={active}
                style={(state) => [
                  { minHeight: 44, justifyContent: 'center' },
                  Boolean('focused' in state && state.focused) && detailsStyles.focus,
                ]}
              >
                <Text style={[styles.listSort, active && styles.listSortActive]}>
                  {OUTSIDE_SORT_LABELS[option].toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.listRows}>
        {rows.map((row) => {
          const party = outsideCounterparty(tab, row);
          const stance = outsideStanceLabel(row.direction);
          const paid = outsidePaidLine(row.paidOn);
          const unpaid = outsideUnpaidNote(row.unpaidAmount);
          const amount = formatMoney(row.amount);
          const chips = (
            <>
              <Text
                style={[
                  styles.stanceChip,
                  row.direction === 'For' ? styles.stanceSupporting : styles.stanceOpposing,
                ]}
              >
                {stance.toUpperCase()}
              </Text>
              <Text style={styles.regLine}>{outsideRegistrationLine(party)}</Text>
              {row.inKind ? (
                <Text style={styles.inKindChip}>{IN_KIND_CHIP.toUpperCase()}</Text>
              ) : null}
            </>
          );
          const inner = (
            <>
              <View style={styles.listRowText}>
                {/* Computer: name, number and chip share one line. Phone: the name
                    alone, then the chips, then the amount left-aligned under them, then
                    every remaining field as further lines, so no field is dropped at
                    375. The unpaid part stays directly under its amount at both widths,
                    because it qualifies the figure and distance from it is misreading
                    distance. */}
                <View style={styles.listNameRow}>
                  <Text style={styles.listName}>{party.name}</Text>
                  {isMobile ? null : chips}
                </View>
                {isMobile ? <View style={styles.chipsMobile}>{chips}</View> : null}
                {isMobile ? (
                  <View style={styles.amountMobile}>
                    <Text style={styles.listAmountLeft}>{amount ?? ''}</Text>
                    {unpaid ? <Text style={styles.unpaidNote}>{unpaid}</Text> : null}
                  </View>
                ) : null}
                <Text style={styles.listMeta}>{outsideRowMeta(row)}</Text>
                {paid ? <Text style={styles.paidLine}>{paid.toUpperCase()}</Text> : null}
              </View>
              {isMobile ? null : (
                <View style={styles.amountColumn}>
                  <Text style={styles.listAmount}>{amount ?? ''}</Text>
                  {unpaid ? (
                    <Text style={[styles.unpaidNote, styles.unpaidNoteRight]}>{unpaid}</Text>
                  ) : null}
                </View>
              )}
            </>
          );
          const key = `${row.recordNumber}-${row.paidOn}-${row.amount}`;
          if (party.linkable && party.registrationNumber) {
            const slug = committeeSlug(party.name, party.registrationNumber);
            const registrationNumber = party.registrationNumber;
            const warm = () => prefetchCommitteeMoney(registrationNumber, slug);
            return (
              <Pressable
                key={key}
                {...linkProps(routePath.moneyCommittee(slug), () =>
                  navigation.push('CommitteeMoney', { slug }),
                )}
                onPressIn={warm}
                onHoverIn={warm}
                style={[styles.listRow, styles.listRowLink, isMobile && styles.listRowMobile]}
              >
                {inner}
              </Pressable>
            );
          }
          return (
            <View key={key} style={[styles.listRow, isMobile && styles.listRowMobile]}>
              {inner}
            </View>
          );
        })}
      </View>
      {query.hasNextPage ? (
        <Pressable
          onPress={() => void query.fetchNextPage()}
          accessibilityRole="button"
          style={[styles.seeAll, styles.actionRow]}
        >
          <Text style={[styles.seeAllLabel, styles.actionLabel]}>Show more payments</Text>
          <ActionArrow />
        </Pressable>
      ) : null}
      {first.sourceUrl ? (
        <Text
          style={[styles.source, styles.filingsSource]}
          {...externalLinkProps(first.sourceUrl, () => void Linking.openURL(first.sourceUrl!))}
        >
          Minnesota’s list of independent expenditures
        </Text>
      ) : null}
    </>
  );
}

/** Catalogue rows have no directly addressable report document. Keep the Board viewer
 * available before and throughout loading, empty and failure states. */
export function FilingsList({
  registrationNumber,
  boardUrl,
}: {
  registrationNumber: string;
  boardUrl: string;
}) {
  const query = useCommitteeFilingsList(registrationNumber);
  const { isMobile } = useResponsive();
  const pages = query.data?.pages ?? [];
  const firstPage = pages[0];
  const reported = firstPage?.state === 'reported';
  const rows = pages.flatMap((page) => page.filings);
  const unlisted = reported ? unlistedReportsLine(firstPage.cataloguedWithoutRecord) : null;
  const countLine = reported ? filingsCountLine(rows.length, firstPage.total) : null;
  const ordering = reported ? filingsOrderingLine(firstPage.orderedBy) : null;
  const copiedOn = formatDay(firstPage?.asOf);
  const retry = (more = false) => {
    if (query.isFetching) return;
    void (more ? query.fetchNextPage() : query.refetch());
  };
  return (
    <View style={styles.filingsSection}>
      <View style={styles.filingsOpening}>
        <Text accessibilityRole="header" aria-level={2} style={styles.filingsHead}>
          {FILINGS_HEADLINE}
        </Text>
        <Text style={styles.explain}>All years in our copy</Text>
        {countLine ? <Text style={styles.listCount}>{countLine}</Text> : null}
        <Text
          style={[styles.source, styles.filingsSource]}
          {...externalLinkProps(boardUrl, () => void Linking.openURL(boardUrl))}
        >
          {BOARD_RECORD_LINK_LABEL}
        </Text>
      </View>
      {ordering && rows.length ? <Text style={styles.linkNote}>{ordering}</Text> : null}
      {query.isPending ? (
        <View role="status" aria-busy style={styles.listLoading}>
          <Text style={styles.explain}>Loading reports</Text>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} width="70%" height={20} />
          ))}
        </View>
      ) : !reported ? (
        <View style={styles.filingsCard}>
          <Text accessibilityRole="alert" style={styles.explain}>
            {FILINGS_UNAVAILABLE}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={query.isFetching}
            aria-busy={query.isFetching}
            onPress={() => retry()}
            style={(state) => [
              styles.seeAll,
              Boolean('focused' in state && state.focused) && detailsStyles.focus,
            ]}
          >
            <Text style={[styles.seeAllLabel, styles.actionLabel]}>Try again</Text>
          </Pressable>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.filingsCard}>
          <Text accessibilityRole="header" aria-level={3} style={styles.h3}>
            {FILINGS_EMPTY_TITLE}
          </Text>
          <Text style={styles.explain}>{FILINGS_EMPTY_WHY}</Text>
        </View>
      ) : (
        <View style={styles.filingRows}>
          {rows.map((filing, index) => {
            const period = filingRowPeriodLine(filing);
            const filed = filedDateLine(filing.filedDate);
            return (
              <View
                key={`${filing.filingYear}-${filing.reportType}-${filing.periodEnd ?? 'no-end'}-${index}`}
                style={[styles.filingRow, isMobile && styles.filingRowMobile]}
              >
                <View style={styles.listRowText}>
                  <Text style={styles.listName}>{filing.reportName}</Text>
                  {period ? <Text style={styles.filingPeriod}>{period}</Text> : null}
                </View>
                {filed || filingIsAmended(filing.effectiveAmendmentIndex) ? (
                  <View style={[styles.filingStatus, isMobile && styles.filingStatusMobile]}>
                    {filed ? <Text style={styles.filedDate}>{filed.toUpperCase()}</Text> : null}
                    {filingIsAmended(filing.effectiveAmendmentIndex) ? (
                      <Text style={styles.amendedChip}>{AMENDED_CHIP}</Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
      {reported && query.isFetchNextPageError ? (
        <View>
          <Text accessibilityRole="alert" style={styles.explain}>
            We couldn’t load more reports. The reports already shown are still available.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={query.isFetching}
            aria-busy={query.isFetching}
            onPress={() => retry(true)}
            style={(state) => [
              styles.seeAll,
              Boolean('focused' in state && state.focused) && detailsStyles.focus,
            ]}
          >
            <Text style={[styles.seeAllLabel, styles.actionLabel]}>Try again</Text>
          </Pressable>
        </View>
      ) : reported && query.hasNextPage ? (
        <Pressable
          accessibilityRole="button"
          disabled={query.isFetching}
          aria-busy={query.isFetchingNextPage}
          onPress={() => retry(true)}
          style={(state) => [
            styles.seeAll,
            Boolean('focused' in state && state.focused) && detailsStyles.focus,
          ]}
        >
          <Text style={[styles.seeAllLabel, styles.actionLabel]}>
            {query.isFetchingNextPage ? 'Loading more reports' : 'Show more reports'}
          </Text>
        </Pressable>
      ) : null}
      {query.isFetchingNextPage ? (
        <Text role="status" style={styles.hidden}>
          Loading more reports
        </Text>
      ) : null}
      {unlisted ? <Text style={styles.linkNote}>{unlisted}</Text> : null}
      {rows.length ? (
        <View style={styles.filingNotes}>
          {rows.some((row) => filingIsAmended(row.effectiveAmendmentIndex)) ? (
            <Text style={styles.linkNote}>Amended means the committee filed a revised version</Text>
          ) : null}
          {rows.some((row) => !row.filedDate) ? (
            <Text style={styles.linkNote}>
              Filing dates appear only where our records include them
            </Text>
          ) : null}
          <Text style={styles.linkNote}>{FILINGS_PERIOD_NOTE}</Text>
        </View>
      ) : null}
      {copiedOn ? (
        <Text style={styles.freshness}>Minnesota’s report catalogue copied {copiedOn}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: c.background },
  summaryCard: { backgroundColor: c.tile },
  page: { flexGrow: 1 },
  main: { paddingTop: 28, gap: 0 },
  heroContent: { paddingBottom: 18 },
  recordsBackground: { backgroundColor: c.background },
  recordsContent: { paddingTop: 34, paddingBottom: 64 },
  mainMobile: { paddingTop: 18 },
  bodyWrap: { marginTop: 22 },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  backLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: c.secondary,
  },
  eyebrow: {
    fontFamily: t.typography.body,
    fontSize: 13,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 2.4,
    color: c.link,
  },
  headRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 16,
  },
  h1: {
    flex: 1,
    minWidth: 240,
    fontFamily: t.typography.title,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1,
    color: c.text,
  },
  h1Mobile: { fontSize: 30, lineHeight: 36 },
  h3: {
    fontFamily: t.typography.title,
    fontSize: 19,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.2,
    color: c.text,
  },
  chipRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  regChip: {
    fontFamily: t.typography.body,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.15,
    fontVariant: ['tabular-nums'],
    lineHeight: 22.5,
    color: c.secondary,
    backgroundColor: t.colors.surfaces.s100,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 11,
    overflow: 'hidden',
  },
  registeredFor: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    color: c.secondary,
  },
  closedChip: {
    fontFamily: t.typography.body,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.15,
    fontVariant: ['tabular-nums'],
    lineHeight: 22.5,
    color: c.secondary,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink18,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  whoseCard: {
    marginTop: 22,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    paddingVertical: 18,
    paddingHorizontal: 32,
    ...(t.shadows.card as object),
  },
  panelTablet: { paddingHorizontal: 26 },
  panelMobile: { paddingHorizontal: 18 },
  whoseText: {
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 26.35,
    color: c.secondary,
  },
  yearRow: { marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  // Phone band: the label sits above equal-width year buttons, never beside pills.
  yearRowMobile: { flexDirection: 'column', flexWrap: 'nowrap', alignItems: 'stretch', gap: 8 },
  stampWrap: { marginTop: 20 },
  cardsGrid: { marginTop: 24, flexDirection: 'row', gap: 22, alignItems: 'stretch' },
  cardsGridMobile: { flexDirection: 'column' },
  cardMobile: {
    ...committeeCardStyles.mobile,
    paddingTop: 20,
    paddingBottom: 20,
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    width: '100%',
    gap: 20,
  },
  card: {
    flex: 1,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    paddingTop: 30,
    paddingHorizontal: 32,
    paddingBottom: 28,
    gap: 14,
    ...(t.shadows.card as object),
  },
  body: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 26,
    color: c.text,
    maxWidth: 760,
  },
  explain: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: c.secondary,
  },
  source: {
    fontFamily: t.typography.body,
    fontSize: 15,
    color: c.link,
    textDecorationLine: 'underline',
  },
  inlineLinks: { gap: 12 },
  seeOtherYear: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionRow: { gap: 8 },
  actionLabel: { color: c.text },
  seeOtherYearLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: c.text,
  },
  sectionTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 34,
    rowGap: 8,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink10,
  },
  sectionTab: {
    minHeight: 44,
    justifyContent: 'center',
    paddingBottom: 12,
    marginBottom: -1,
  },
  sectionTabLabel: {
    fontFamily: t.typography.body,
    fontSize: 17,
    fontWeight: '600',
    color: c.secondary,
  },
  sectionTabLabelActive: { fontWeight: '700', color: c.text },
  listHead: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  listCount: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    color: c.secondary,
  },
  listSort: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
    color: c.muted,
  },
  listSortActive: {
    color: c.text,
    textDecorationLine: 'underline',
  },
  sortRow: { flexDirection: 'row', gap: 16 },
  outsideIntro: { marginTop: 20, gap: 8, maxWidth: 900 },
  regLine: {
    fontFamily: t.typography.body,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.15,
    fontVariant: ['tabular-nums'],
    lineHeight: 22.5,
    color: c.secondary,
  },
  // The outside-spending page's own 2 chips for the filing's For and Against, so one
  // filed value has one vocabulary across the section.
  stanceChip: {
    fontFamily: t.typography.mono,
    fontSize: 10,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    borderRadius: 7,
    paddingVertical: 2,
    paddingHorizontal: 7,
    overflow: 'hidden',
  },
  stanceSupporting: { color: t.colors.text.greenOnLight, backgroundColor: t.colors.tint.t150 },
  stanceOpposing: {
    color: c.secondary,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink18,
  },
  paidLine: {
    marginTop: 6,
    fontFamily: t.typography.body,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.15,
    fontVariant: ['tabular-nums'],
    lineHeight: 22.5,
    color: c.secondary,
  },
  amountColumn: { alignItems: 'flex-end', gap: 2 },
  amountMobile: { marginTop: 8, gap: 2 },
  chipsMobile: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  listAmountLeft: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: c.text,
  },
  unpaidNote: {
    fontFamily: t.typography.body,
    fontSize: 15,
    color: c.muted,
  },
  unpaidNoteRight: { textAlign: 'right' },
  listRowMobile: { alignItems: 'flex-start' },
  listRows: { marginTop: 12, gap: 9 },
  listLoading: { marginTop: 20, gap: 9 },
  filingsCard: { marginTop: 20 },
  filingsSection: { gap: 16 },
  filingsOpening: { gap: 8 },
  filingsHead: {
    fontFamily: t.typography.title,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '800',
    color: c.text,
  },
  filingRows: { borderTopWidth: 1, borderTopColor: c.border },
  filingNotes: { gap: 8 },
  filingStatus: { alignItems: 'flex-end', gap: 8, maxWidth: '45%' },
  filingStatusMobile: { alignItems: 'flex-start', maxWidth: '100%' },
  filingRowMobile: { flexDirection: 'column', gap: 10 },
  /** Neutral, like the in-kind chip — never amber, which is reserved for bill
   *  identity. */
  amendedChip: {
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    color: c.secondary,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink18,
    borderRadius: 7,
    paddingVertical: 3,
    paddingHorizontal: 8,
    overflow: 'hidden',
    flexShrink: 0,
  },
  listCountFoot: {
    marginTop: 14,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    color: c.secondary,
  },
  filingsSource: {
    marginTop: 12,
    minHeight: 44,
    paddingVertical: 11,
    alignSelf: 'flex-start',
    fontSize: 17,
    lineHeight: 25.5,
    fontWeight: '700',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.md,
    paddingVertical: 15,
    paddingHorizontal: 17,
    ...(t.shadows.card as object),
  },
  listRowLink: {},
  filingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  filingPeriod: {
    marginTop: 4,
    fontFamily: t.typography.body,
    fontSize: 15.5,
    lineHeight: 23.25,
    fontVariant: ['tabular-nums'],
    color: c.text,
  },
  filedDate: {
    marginTop: 6,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22.5,
    fontWeight: '800',
    letterSpacing: 0.15,
    fontVariant: ['tabular-nums'],
    color: c.secondary,
  },
  confirmedLink: { minHeight: 44, marginTop: 8, flexShrink: 1 },
  confirmedLinkLabel: { fontSize: 17, lineHeight: 25.5, flexShrink: 1, color: c.link },
  listRowText: { flex: 1, minWidth: 0 },
  listNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  listName: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: c.text,
    flexShrink: 1,
  },
  inKindChip: {
    fontFamily: t.typography.mono,
    fontSize: 10,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    color: c.secondary,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink18,
    borderRadius: 7,
    paddingVertical: 2,
    paddingHorizontal: 7,
    overflow: 'hidden',
  },
  listMeta: {
    marginTop: 4,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22.5,
    color: c.secondary,
  },
  // Every dollar amount on this section takes the body face, the one the big totals
  // already use. Dates, registration numbers and counts use that face too;
  // the monospaced face remains only on short lettered labels.
  listAmount: {
    width: 104,
    textAlign: 'right',
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: c.text,
  },
  seeAll: {
    ...linkArrowRow,
    minHeight: 44,
    marginTop: 14,
    alignSelf: 'flex-start',
  },
  seeAllLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: c.link,
  },
  linkNote: {
    marginTop: 12,
    maxWidth: 900,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 23.25,
    color: c.muted,
  },
  coverageCard: {
    marginTop: 30,
    backgroundColor: t.colors.surfaces.s100,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    paddingTop: 30,
    paddingHorizontal: 32,
    paddingBottom: 28,
    gap: 7,
  },
  coverageHead: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
    color: c.secondary,
    marginBottom: 4,
  },
  coverageLine: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 23,
    color: c.secondary,
  },
  freshness: {
    marginTop: 16,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22.5,
    fontWeight: '400',
    color: c.secondary,
  },
  buttonRow: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
  },
  primaryButton: {
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
  secondaryButton: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: c.link,
    textDecorationLine: 'underline',
  },
  notFoundWrap: { marginTop: 22, maxWidth: 760 },
  loadingWrap: { marginTop: 22 },
  loadingCards: { marginTop: 24, flexDirection: 'row', gap: 22 },
  loadingCardsMobile: { flexDirection: 'column' },
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: 'hidden',
  },
});
