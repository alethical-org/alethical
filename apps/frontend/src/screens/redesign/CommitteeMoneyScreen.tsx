import {
  CONFIRMATION_LOADING_LINE,
  CONFIRMATION_UNAVAILABLE_LINE,
} from '../../lib/committeeConfirmation';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { SharePopover } from '../../components/billDetail/SharePopover';
import {
  CommitteeDonations,
  GroupedOutsideSpending,
} from '../../components/campaignMoney/MoneyDetailsOnDemand';
import type { MoneyDetailsPreferences } from '../../lib/campaignMoneyPreferences';
import {
  committeeMoneyPreferences,
  committeeMoneyPreferenceParams,
} from '../../lib/committeeMoneyPreferences';
import { committeeOutsideSpending } from '../../lib/committeeOutsideSpending';
import { detailsStyles } from '../../components/campaignMoney/detailsStyles';
import { YearControl } from '../../components/campaignMoney/YearControl';
import {
  BOARD_VIEWER,
  CardHeading,
  CampaignMoneyCardTheme,
  CheckedByBlock,
  Figure,
  FilingStamp,
  MoneyInBlock,
  MoneyOutBlock,
} from '../../components/campaignMoney/MoneyCards';
import { TrackCommitteeButton } from '../../components/campaignMoney/TrackCommitteeButton';
import { UnderDevelopmentNotice } from '../../components/campaignMoney/UnderDevelopmentNotice';
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
  closedChipLabel,
  closedPeriodDetail,
  closedPeriodLine,
  committeeEyebrow,
  committeeSlug,
  committeeTabFromParam,
  COMMITTEE_TAB_LABELS,
  COMMITTEE_MONEY_SECTION_LABEL,
  confirmedMemberLinkLabel,
  coveredPeriodDetail,
  coveredPeriodLine,
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
  isBallotQuestionFiler,
  IN_KIND_CHIP,
  MONEY_IN_HEADING,
  MONEY_IN_REPORTED_LABEL,
  notFoundBody,
  notFoundTitle,
  OUTSIDE_ABOUT_INTRO,
  OUTSIDE_BY_ALL_YEARS,
  OUTSIDE_NEVER_ADDED,
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
  registerKindFromEntityType,
  registrationNumberFromSlug,
  stampThroughDate,
  staleHoldNote,
  paymentFilesDownloadedLine,
  NOT_IN_REGISTER_LINE,
  uncoveredPeriodDetail,
  uncoveredPeriodLine,
  unlistedReportsLine,
  whoseCommitteeText,
  yearDisplayState,
  CONFIRMED_MEMBER_WITHHELD_LINE,
  type CommitteeTab,
  type OutsideSpendingSort,
  type OutsideSpendingTab,
} from '../../lib/committeeMoney';
import { campaignMoneyYear, formatMoney } from '../../lib/legislatorCampaignMoney';
import { centralDateLabel } from '../../lib/moneyLanding';
import { publicPageUrl, type ShareContent } from '../../lib/share';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import { screenLoaderForPath } from '../../navigation/screenPreload';
import type { RootScreenProps } from '../../navigation/types';
import { markNextWebHistoryChangeAsReplace } from '../../navigation/webHistory';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

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
 * - A ballot-question filer's page states no incoming donor-naming threshold.
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

function ForwardArrow({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden>
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
    canonicalName ? `${canonicalName} — Campaign money | Alethical` : null,
  );

  const onSelectYear = (next: number) => navigation.setParams({ year: String(next) });
  const onSelectTab = (next: CommitteeTab) =>
    navigation.setParams({ ...committeeMoneyPreferenceParams(preferences), tab: next });

  return (
    <PageBackground>
      <CommitteeScroll key={registrationNumber}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        {/* The money section is still being built — lobbying is not loaded
            (#1862), and the challenger and fuller outside-spending surfaces do
            not exist — and nothing else on the page says so at a glance.
            Deleting the element and its component file is the whole removal. */}
        <UnderDevelopmentNotice />

        {/* Every state of this page holds a screenful, so the footer below it
            starts under the fold and nothing a reader can see moves when the
            records land or the load fails (useOneScreenTall in
            components/Skeleton.tsx). */}
        <Container style={[styles.main, isMobile && styles.mainMobile, oneScreenTall]}>
          <Pressable
            {...linkProps(routePath.money(), () => navigation.navigate('MoneyLanding'))}
            style={styles.backLink}
          >
            <BackChevron />
            <Text style={styles.backLabel}>Campaign money</Text>
          </Pressable>

          {notFound && registrationNumber ? (
            <NotFoundState
              registrationNumber={registrationNumber}
              onMoney={() => navigation.navigate('MoneyLanding')}
            />
          ) : moneyQuery.isPending || !money ? (
            moneyQuery.isError ? (
              <View style={styles.card}>
                <Text accessibilityRole="alert" style={styles.body}>
                  We couldn’t load this committee’s money right now. This is a problem on our side
                  and says nothing about the committee. Please try again in a moment.
                </Text>
              </View>
            ) : (
              <LoadingState isMobile={isMobile} />
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
            />
          )}
        </Container>
        <Footer />
      </CommitteeScroll>
    </PageBackground>
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
      <Text style={styles.eyebrow}>COMMITTEES</Text>
      <Text accessibilityRole="header" aria-level={1} style={styles.h1}>
        {notFoundTitle()}
      </Text>
      <Text style={styles.body}>{notFoundBody(registrationNumber)}</Text>
      <View style={styles.buttonRow}>
        <Pressable {...linkProps(routePath.money(), onMoney)} style={styles.primaryButton}>
          <Text style={styles.primaryButtonLabel}>Open the money section</Text>
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
}: {
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
  const otherYear = year === new Date().getFullYear() ? year - 1 : year + 1;
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
      void screenLoaderForPath(routePath.legislator(nameableMember.slug, { tab: 'money' }))?.();
    }
  };

  const shareContent: ShareContent = {
    title: `${name} — Alethical`,
    subject: 'committee',
    description: `${name}’s campaign money record, from Minnesota’s own filings.`,
    url: publicPageUrl(
      routePath.moneyCommittee(committeeSlug(name, registrationNumber), {
        tab: tab === 'spent' ? 'gave' : tab,
        year: String(year),
        ...committeeMoneyPreferenceParams(preferences),
      }),
    ),
  };

  return (
    <View style={styles.bodyWrap}>
      <Text style={styles.eyebrow}>{eyebrow ? eyebrow.toUpperCase() : 'COMMITTEE'}</Text>
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

      <View style={styles.whoseCard}>
        <Text style={styles.whoseText}>
          {/* Never `whoseCommitteeText(..., null)` while withholding: that sentence
              says nobody has confirmed a member, which is a different fact and
              false here. A withheld claim gets its own words. */}
          {!confirmation
            ? confirmationPending
              ? CONFIRMATION_LOADING_LINE
              : CONFIRMATION_UNAVAILABLE_LINE
            : confirmedMemberWithheld && confirmation.confirmedFor
              ? CONFIRMED_MEMBER_WITHHELD_LINE
              : whoseCommitteeText(registerKind, money.entitySubType, nameableMember)}
        </Text>
        {/* What the person read, under the sentence saying they read it. A reader who
            arrived here rather than at a profile came asking whose committee this is,
            so the evidence belongs on this page more than on that one. The same block,
            same treatment, as the profile's card foot. */}
        <CheckedByBlock checked={nameableMember?.checked} />
        {/* Only where a person confirmed it. The reader came to a money page, so
            the crossing lands on the member's money rather than their overview. */}
        {nameableMember ? (
          <Pressable
            {...linkProps(routePath.legislator(nameableMember.slug, { tab: 'money' }), () =>
              navigation.push('LegislatorProfile', {
                legislatorId: nameableMember.slug,
                tab: 'money',
              }),
            )}
            onPressIn={warmConfirmedFor}
            onHoverIn={warmConfirmedFor}
            style={styles.seeAll}
          >
            <Text style={styles.seeAllLabel}>
              {confirmedMemberLinkLabel(nameableMember.fullName)}
            </Text>
            <ForwardArrow color={t.colors.brand.base} />
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.yearRow, isMobile && styles.yearRowMobile]}>
        <YearControl year={year} onSelect={onSelectYear} fullWidth={isMobile} />
      </View>

      <PeriodStamp
        money={money}
        state={state}
        year={year}
        isPartyUnit={isPartyUnit}
        isHoldingStale={isHoldingStale}
        isMobile={isMobile}
      />

      <PaymentsSection
        money={money}
        year={year}
        tab={tab}
        slug={committeeSlug(name, registrationNumber)}
        registrationNumber={registrationNumber}
        onSelectTab={onSelectTab}
        onRefresh={onRefresh}
        navigation={navigation}
        preferences={preferences}
        onPreferences={onPreferences}
      >
        {(withDonorBreakdown) => (
          <View style={[styles.cardsGrid, isMobile && styles.cardsGridMobile]}>
            <MoneyInCard
              money={money}
              state={state}
              year={year}
              isBallot={isBallot}
              otherYear={otherYear}
              isMobile={isMobile}
              onSelectYear={onSelectYear}
              withDonorBreakdown={withDonorBreakdown}
            />
            <MoneyOutCard money={money} isMobile={isMobile} />
          </View>
        )}
      </PaymentsSection>

      <View style={styles.coverageCard}>
        <Text style={styles.coverageHead}>{RECORD_COVERS_HEADING.toUpperCase()}</Text>
        {recordCoverageLines(isBallot).map((line) => (
          <Text key={line} style={styles.coverageLine}>
            {line}
          </Text>
        ))}
      </View>

      {checkedOn ? (
        <Text style={styles.freshness}>{paymentFilesDownloadedLine(checkedOn)}</Text>
      ) : null}
    </View>
  );
}

function PeriodStamp({
  money,
  state,
  year,
  isPartyUnit,
  isHoldingStale,
  isMobile,
}: {
  money: CommitteeMoney;
  state: 'closed-empty' | 'empty-year' | 'figures';
  year: number;
  isPartyUnit: boolean;
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
        line={line}
        detail={detail}
        notes={isHoldingStale ? [staleHoldNote(null)] : []}
        showLink={state === 'figures' && through !== null}
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
  otherYear,
  isMobile,
  onSelectYear,
  withDonorBreakdown,
}: {
  money: CommitteeMoney;
  state: 'closed-empty' | 'empty-year' | 'figures';
  year: number;
  isBallot: boolean;
  otherYear: number;
  isMobile: boolean;
  onSelectYear: (year: number) => void;
  withDonorBreakdown: boolean;
}) {
  if (state !== 'figures') {
    // The committee page's own 2 empty years, which the profile never reaches: a
    // closed committee's final report we do not hold, and a year no filing covers.
    const closed = state === 'closed-empty';
    return (
      <View style={styles.card}>
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
              {...externalLinkProps(BOARD_VIEWER, () => void Linking.openURL(BOARD_VIEWER))}
            >
              Read the final report on the Board’s site
            </Text>
          ) : null}
          <Pressable onPress={() => onSelectYear(otherYear)} accessibilityRole="button">
            <View style={styles.seeOtherYear}>
              <Text style={styles.seeOtherYearLabel}>See {otherYear}</Text>
              <ForwardArrow color={t.colors.brand.base} />
            </View>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <MoneyInBlock
        surface="committee"
        withDonorBreakdown={withDonorBreakdown}
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
  return (
    <View style={styles.card}>
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
  onSelectTab,
  onRefresh,
  navigation,
  children,
  preferences,
  onPreferences,
}: {
  money: CommitteeMoney;
  year: number;
  tab: CommitteeTab;
  slug: string;
  registrationNumber: string;
  onSelectTab: (tab: CommitteeTab) => void;
  onRefresh: () => void;
  navigation: RootScreenProps<'CommitteeMoney'>['navigation'];
  children: (withDonorBreakdown: boolean) => ReactNode;
  preferences: MoneyDetailsPreferences;
  onPreferences: (preferences: MoneyDetailsPreferences) => void;
}) {
  const { isMobile } = useResponsive();
  const [sort, setSort] = useState<OutsideSpendingSort>('newest');
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
        <View role="group" aria-label="Committee record" style={detailsStyles.horizontal}>
          {sections.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              aria-pressed={section === key}
              onPress={() => onSelectTab(key as CommitteeTab)}
              style={(state) => [
                detailsStyles.control,
                section === key && styles.tabActive,
                Boolean('focused' in state && state.focused) && detailsStyles.focus,
              ]}
            >
              <Text style={detailsStyles.controlText}>
                {key === 'gave'
                  ? COMMITTEE_MONEY_SECTION_LABEL
                  : COMMITTEE_TAB_LABELS[key as CommitteeTab]}
              </Text>
            </Pressable>
          ))}
        </View>
        {section === 'filings' ? (
          <>
            {children(false)}
            <FilingsList registrationNumber={registrationNumber} />
          </>
        ) : section === 'by' ? (
          <>
            {children(false)}
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
            <View style={styles.card}>
              <CommitteeDonations
                headingLevel={2}
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
                {(['gave', 'spent'] as const).map((tab) => (
                  <Pressable
                    key={tab}
                    style={styles.seeAll}
                    {...linkProps(
                      routePath.moneyCommitteePayments(slug, { tab, year: String(year) }),
                      () =>
                        navigation.navigate('CommitteePayments', { slug, tab, year: String(year) }),
                    )}
                  >
                    <Text style={styles.seeAllLabel}>{COMMITTEE_TAB_LABELS[tab]}</Text>
                    <ForwardArrow color={t.colors.brand.base} />
                  </Pressable>
                ))}
              </View>
            </View>
            <GroupedOutsideSpending
              surface="committee"
              year={committeeOutsideSpending(money)}
              releaseId={money.releaseId}
              onOpenSource={(url) => void Linking.openURL(url)}
            />
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
 * Sorted newest first by default, largest first on request; the sort is the page's
 * own state rather than part of the address, because it is a view over one list
 * rather than a location. Pages of 50 accumulate under "Show more payments".
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
          style={styles.seeAll}
        >
          <Text style={styles.seeAllLabel}>Show more payments</Text>
          <ForwardArrow color={t.colors.brand.base} />
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

/**
 * The Filings tab: every report the Board's catalogue records this committee as
 * having filed, newest period first ("Money committee web.dc.html", #1679).
 *
 * What the drawn design shows that this list deliberately does not:
 * - No flat "by the date filed" ordering sentence. A row carries the day the Board
 *   received it where the report's own document states one (#1670), and nothing
 *   where it does not — which is most of a committee's history, since the Board
 *   serves no readable document for most reports before 2023. So the list sorts by
 *   the filed date where there is one and the period end where there is not, an
 *   undated row prints no filed date at all rather than showing its period end
 *   under a "filed" label, and the ordering sentence names the mix.
 * - No date on the AMENDED chip — the catalogue's amendment record is version
 *   indexes only. The chip itself is never suppressed: a missing prior figure is
 *   a fact about old documents, not about whether the report was amended.
 * - No per-row OPEN link — the Board serves report documents through a form the
 *   web cannot link to directly, and not at all for most years before 2023, so a
 *   per-report link would be dead for most rows. One link under the list opens
 *   the Board's own viewer, where every report here can be pulled up.
 */
function FilingsList({ registrationNumber }: { registrationNumber: string }) {
  const query = useCommitteeFilingsList(registrationNumber);
  const pages = query.data?.pages ?? [];
  const firstPage = pages[0];
  const rows = pages.flatMap((page) => page.filings);

  if (query.isPending) {
    return (
      <View style={styles.listLoading}>
        <View role="status" aria-busy style={styles.hidden}>
          <Text>Loading filings</Text>
        </View>
        {[0, 1, 2].map((index) => (
          <View key={index} style={styles.listRow}>
            <View style={styles.listRowText}>
              <Skeleton width="45%" height={14} />
              <Skeleton width={220} height={11} style={{ marginTop: 8 }} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (!firstPage || firstPage.state !== 'reported') {
    return (
      <View style={[styles.card, styles.filingsCard]}>
        <Text style={styles.explain}>{FILINGS_UNAVAILABLE}</Text>
      </View>
    );
  }

  const unlisted = unlistedReportsLine(firstPage.cataloguedWithoutRecord);

  if (rows.length === 0) {
    return (
      <View style={[styles.card, styles.filingsCard]}>
        <Text style={styles.h3}>{FILINGS_EMPTY_TITLE}</Text>
        <Text style={styles.explain}>{FILINGS_EMPTY_WHY}</Text>
        {unlisted ? <Text style={styles.explain}>{unlisted}</Text> : null}
      </View>
    );
  }

  const ordering = filingsOrderingLine(firstPage.orderedBy);
  const countLine = filingsCountLine(rows.length, firstPage.total);

  return (
    <>
      <View style={styles.listHead}>
        <Text style={styles.filingsHead}>{FILINGS_HEADLINE}</Text>
        {ordering ? <Text style={styles.listCount}>{ordering}</Text> : null}
      </View>
      <View style={styles.listRows}>
        {rows.map((filing, index) => {
          const period = filingRowPeriodLine(filing);
          const filed = filedDateLine(filing.filedDate);
          return (
            <View
              key={`${filing.filingYear}-${filing.reportType}-${filing.periodEnd ?? 'no-end'}-${index}`}
              style={styles.listRow}
            >
              <View style={styles.listRowText}>
                <Text style={styles.listName}>{filing.reportName}</Text>
                {period ? <Text style={styles.listMeta}>{period}</Text> : null}
                {filed ? <Text style={styles.listMeta}>{filed}</Text> : null}
              </View>
              {filingIsAmended(filing.effectiveAmendmentIndex) ? (
                <Text style={styles.amendedChip}>{AMENDED_CHIP}</Text>
              ) : null}
            </View>
          );
        })}
      </View>
      {countLine ? <Text style={styles.listCountFoot}>{countLine}</Text> : null}
      {query.hasNextPage ? (
        <Pressable
          onPress={() => void query.fetchNextPage()}
          accessibilityRole="button"
          style={styles.seeAll}
        >
          <Text style={styles.seeAllLabel}>Show more reports</Text>
          <ForwardArrow color={t.colors.brand.base} />
        </Pressable>
      ) : null}
      {unlisted ? <Text style={styles.linkNote}>{unlisted}</Text> : null}
      <Text style={styles.linkNote}>{FILINGS_PERIOD_NOTE}</Text>
      <Text
        style={[styles.source, styles.filingsSource]}
        {...externalLinkProps(BOARD_VIEWER, () => void Linking.openURL(BOARD_VIEWER))}
      >
        This committee’s filed reports, on the state’s own site
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  main: { paddingTop: 28, paddingBottom: 64, gap: 0 },
  mainMobile: { paddingTop: 18 },
  bodyWrap: { marginTop: 22 },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  backLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
  eyebrow: {
    fontFamily: t.typography.body,
    fontSize: 13,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 2.4,
    color: t.colors.brand.base,
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
    color: t.colors.text.primary,
  },
  h1Mobile: { fontSize: 30, lineHeight: 36 },
  h3: {
    fontFamily: t.typography.title,
    fontSize: 19,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.2,
    color: t.colors.text.primary,
  },
  chipRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  regChip: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
    color: t.colors.text.secondary,
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
    color: t.colors.text.secondary,
  },
  closedChip: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
    color: t.colors.text.secondary,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink18,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  whoseCard: {
    marginTop: 22,
    maxWidth: 900,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    padding: 18,
    ...(t.shadows.card as object),
  },
  whoseText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 23,
    color: t.colors.text.secondary,
  },
  yearRow: { marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  // Phone band: the label sits above 2 equal halves of the row, never beside pills.
  yearRowMobile: { flexDirection: 'column', flexWrap: 'nowrap', alignItems: 'stretch', gap: 8 },
  stampWrap: { marginTop: 20 },
  // `flex-start`, never `stretch`: each card is as tall as its own data and is never
  // levelled against its neighbour. Money out holds fewer elements and looks it.
  cardsGrid: { marginTop: 24, flexDirection: 'row', gap: 22, alignItems: 'flex-start' },
  cardsGridMobile: { flexDirection: 'column' },
  card: {
    flex: 1,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    padding: 26,
    gap: 14,
    ...(t.shadows.card as object),
  },
  body: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 26,
    color: t.colors.text.primary,
    maxWidth: 760,
  },
  explain: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  source: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    color: t.colors.brand.base,
    textDecorationLine: 'underline',
  },
  inlineLinks: { gap: 12 },
  seeOtherYear: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seeOtherYearLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.base,
  },
  tabActive: { borderBottomWidth: 2, borderBottomColor: t.colors.text.primary, marginBottom: -1 },
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
    color: t.colors.text.secondary,
  },
  listSort: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
    color: t.colors.text.muted,
  },
  listSortActive: {
    color: t.colors.text.primary,
    textDecorationLine: 'underline',
  },
  sortRow: { flexDirection: 'row', gap: 16 },
  outsideIntro: { marginTop: 20, gap: 8, maxWidth: 900 },
  regLine: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
    color: t.colors.text.muted,
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
    color: t.colors.text.secondary,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink18,
  },
  paidLine: {
    marginTop: 6,
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
    color: t.colors.text.muted,
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
    color: t.colors.text.primary,
  },
  unpaidNote: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    color: t.colors.text.muted,
  },
  unpaidNoteRight: { textAlign: 'right' },
  listRowMobile: { alignItems: 'flex-start' },
  listRows: { marginTop: 12, gap: 9 },
  listLoading: { marginTop: 20, gap: 9 },
  filingsCard: { marginTop: 20 },
  filingsHead: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
    color: t.colors.text.secondary,
  },
  /** Neutral, like the in-kind chip — never amber, which is reserved for bill
   *  identity. */
  amendedChip: {
    fontFamily: t.typography.mono,
    fontSize: 10,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    color: t.colors.text.secondary,
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
    color: t.colors.text.secondary,
  },
  filingsSource: { marginTop: 12, alignSelf: 'flex-start' },
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
  listRowText: { flex: 1, minWidth: 0 },
  listNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  listName: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  inKindChip: {
    fontFamily: t.typography.mono,
    fontSize: 10,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    color: t.colors.text.secondary,
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
    fontSize: t.fontSizes.meta,
    lineHeight: 19,
    color: t.colors.text.secondary,
  },
  // Every dollar amount on this section takes the body face, the one the big totals
  // already use (ruled 1 Sep 2026, #1924). Mono stays for dates, registration numbers
  // and small labels, so the 2 faces separate 2 kinds of thing rather than 2 kinds of
  // number: a reader seeing 2 number faces asked whether the difference meant something.
  listAmount: {
    width: 104,
    textAlign: 'right',
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  seeAll: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  seeAllLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.base,
  },
  linkNote: {
    marginTop: 12,
    maxWidth: 900,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    lineHeight: 20,
    color: t.colors.text.muted,
  },
  coverageCard: {
    marginTop: 30,
    backgroundColor: t.colors.surfaces.s100,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    padding: 22,
    gap: 7,
  },
  coverageHead: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
    color: t.colors.text.secondary,
    marginBottom: 4,
  },
  coverageLine: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 23,
    color: t.colors.text.secondary,
  },
  freshness: {
    marginTop: 16,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    lineHeight: 20,
    color: t.colors.text.muted,
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
    color: t.colors.brand.base,
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
