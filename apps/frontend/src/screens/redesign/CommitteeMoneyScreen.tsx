import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { SharePopover } from '../../components/billDetail/SharePopover';
import { YearControl } from '../../components/campaignMoney/CampaignMoneyTab';
import {
  BOARD_VIEWER,
  CardHeading,
  CheckedByBlock,
  Figure,
  FilingStamp,
  MoneyInBlock,
  MoneyOutBlock,
} from '../../components/campaignMoney/MoneyCards';
import { TrackCommitteeButton } from '../../components/campaignMoney/TrackCommitteeButton';
import { UnderDevelopmentNotice } from '../../components/campaignMoney/UnderDevelopmentNotice';
import { Skeleton } from '../../components/Skeleton';
import type { CommitteeMoney } from '../../data/types';
import {
  useCommitteeFilingsList,
  useCommitteeMoney,
  useCommitteePaymentsMade,
  useCommitteePaymentsReceived,
  useOutsideSpending,
  usePrefetchCommitteeMoney,
  usePrefetchLegislator,
} from '../../hooks/useAppQueries';
import { useResponsive } from '../../hooks/useResponsive';
import {
  AMENDED_CHIP,
  CLOSED_EMPTY_VALUE,
  CLOSED_MONEY_IN_WHY,
  CLOSED_MONEY_OUT_WHY,
  closedChipLabel,
  closedPeriodDetail,
  closedPeriodLine,
  committeeEyebrow,
  committeeSlug,
  committeeTabFromParam,
  committeeTabs,
  COMMITTEE_TAB_LABELS,
  confirmedMemberLinkLabel,
  coveredPeriodDetail,
  coveredPeriodLine,
  EMPTY_YEAR_VALUE,
  emptyListTitle,
  emptyListWhy,
  emptyYearMoneyInWhy,
  EMPTY_YEAR_MONEY_OUT_WHY,
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
  isInKind,
  IN_KIND_CHIP,
  listLinkNote,
  madeRowMeta,
  MONEY_IN_HEADING,
  MONEY_IN_REPORTED_LABEL,
  MONEY_OUT_FIGURE_LABEL,
  MONEY_OUT_HEADING,
  notFoundBody,
  notFoundTitle,
  OUTSIDE_ABOUT_INTRO,
  OUTSIDE_NEVER_ADDED,
  OUTSIDE_SORT_LABELS,
  outsideCountLine,
  outsideCounterparty,
  outsidePaidLine,
  outsideRegistrationLine,
  outsideRowMeta,
  outsideStanceLabel,
  outsideUnpaidNote,
  receivedRowMeta,
  RECORD_COVERS_HEADING,
  recordCoverageLines,
  registeredForLine,
  registerKindFromEntityType,
  registrationNumberFromSlug,
  showingLine,
  stampThroughDate,
  staleHoldNote,
  NOT_IN_REGISTER_LINE,
  uncoveredPeriodDetail,
  uncoveredPeriodLine,
  unlistedReportsLine,
  whoseCommitteeText,
  yearDisplayState,
  type CommitteeTab,
  type OutsideSpendingSort,
  type OutsideSpendingTab,
} from '../../lib/committeeMoney';
import { campaignMoneyYear, formatMoney } from '../../lib/legislatorCampaignMoney';
import { centralDateLabel } from '../../lib/moneyLanding';
import { publicPageUrl, type ShareContent } from '../../lib/share';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
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
 * - Two numbers, both correct: the total the committee reported to the state AND
 *   the payments we can list. The named/unnamed division arrives DECIDED by the
 *   server (`split.state`); this page never subtracts, and in each of the 4
 *   withheld states it prints the state's own plain sentence instead.
 * - Missing is "Not reported"; a verified zero is "0"; a closed committee is its
 *   own state with the register's own date.
 * - Money out is never "spent": statewide, 38% of it is money given to other
 *   committees, so the figure is "Payments we can list" and transfers get their
 *   own plain label.
 * - A ballot-question filer's page states no donor-naming threshold anywhere.
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
  const slug = route.params?.slug ?? '';
  const registrationNumber = registrationNumberFromSlug(slug);
  const year = campaignMoneyYear(route.params?.year);
  const tab = committeeTabFromParam(route.params?.tab);

  const moneyQuery = useCommitteeMoney(registrationNumber, year);
  const money = moneyQuery.data ?? null;
  const notFound = moneyQuery.data === null && !moneyQuery.isPending && !moneyQuery.isError;

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
  const onSelectTab = (next: CommitteeTab) => navigation.setParams({ tab: next });

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        {/* The money section is still being built — lobbying is not loaded
            (#1862), and the challenger and fuller outside-spending surfaces do
            not exist — and nothing else on the page says so at a glance.
            Deleting the element and its component file is the whole removal. */}
        <UnderDevelopmentNotice />

        <Container style={[styles.main, isMobile && styles.mainMobile]}>
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
              money={money}
              year={year}
              tab={tab}
              slug={slug}
              registrationNumber={registrationNumber ?? money.registrationNumber}
              isMobile={isMobile}
              isHoldingStale={moneyQuery.isError}
              onSelectYear={onSelectYear}
              onSelectTab={onSelectTab}
              navigation={navigation}
            />
          )}
        </Container>
        <Footer />
      </ScrollView>
    </PageBackground>
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
  onSelectYear,
  onSelectTab,
  navigation,
}: {
  money: CommitteeMoney;
  year: number;
  tab: CommitteeTab;
  slug: string;
  registrationNumber: string;
  isMobile: boolean;
  isHoldingStale: boolean;
  onSelectYear: (year: number) => void;
  onSelectTab: (tab: CommitteeTab) => void;
  navigation: RootScreenProps<'CommitteeMoney'>['navigation'];
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
  // Warm the member's profile on navigation intent, matching the bill and
  // legislator lists (usePrefetchBill / usePrefetchLegislator, #1966).
  const warmConfirmedFor = () => {
    if (money.confirmedFor) {
      prefetchLegislator(money.confirmedFor.slug);
    }
  };

  const shareContent: ShareContent = {
    title: `${name} — Alethical`,
    subject: 'committee',
    description: `${name}’s campaign money record, from Minnesota’s own filings.`,
    url: publicPageUrl(
      `/money/committees/${committeeSlug(name, registrationNumber)}?tab=${tab}&year=${year}`,
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
          {whoseCommitteeText(registerKind, money.entitySubType, money.confirmedFor)}
        </Text>
        {/* What the person read, under the sentence saying they read it. A reader who
            arrived here rather than at a profile came asking whose committee this is,
            so the evidence belongs on this page more than on that one. The same block,
            same treatment, as the profile's card foot. */}
        <CheckedByBlock checked={money.confirmedFor?.checked} />
        {/* Only where a person confirmed it. The reader came to a money page, so
            the crossing lands on the member's money rather than their overview. */}
        {money.confirmedFor ? (
          <Pressable
            {...linkProps(routePath.legislator(money.confirmedFor.slug, { tab: 'money' }), () =>
              navigation.push('LegislatorProfile', {
                legislatorId: money.confirmedFor!.slug,
                tab: 'money',
              }),
            )}
            onPressIn={warmConfirmedFor}
            onHoverIn={warmConfirmedFor}
            style={styles.seeAll}
          >
            <Text style={styles.seeAllLabel}>
              {confirmedMemberLinkLabel(money.confirmedFor.fullName)}
            </Text>
            <ForwardArrow color={t.colors.brand.base} />
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.yearRow, isMobile && styles.yearRowMobile]}>
        <Text style={styles.yearLabel}>FILING YEAR</Text>
        <YearControl year={year} onSelect={onSelectYear} fullWidth={isMobile} />
      </View>

      <PeriodStamp
        money={money}
        state={state}
        year={year}
        checkedOn={checkedOn}
        isPartyUnit={isPartyUnit}
        isHoldingStale={isHoldingStale}
        isMobile={isMobile}
      />

      <View style={[styles.cardsGrid, isMobile && styles.cardsGridMobile]}>
        <MoneyInCard
          money={money}
          state={state}
          year={year}
          isBallot={isBallot}
          otherYear={otherYear}
          isMobile={isMobile}
          onSelectYear={onSelectYear}
        />
        <MoneyOutCard money={money} state={state} isBallot={isBallot} isMobile={isMobile} />
      </View>

      <PaymentsSection
        money={money}
        year={year}
        tab={tab}
        slug={committeeSlug(name, registrationNumber)}
        registrationNumber={registrationNumber}
        isBallot={isBallot}
        onSelectTab={onSelectTab}
        navigation={navigation}
      />

      <View style={styles.coverageCard}>
        <Text style={styles.coverageHead}>{RECORD_COVERS_HEADING.toUpperCase()}</Text>
        {recordCoverageLines(isBallot).map((line) => (
          <Text key={line} style={styles.coverageLine}>
            {line}
          </Text>
        ))}
      </View>

      {checkedOn ? (
        <Text style={styles.freshness}>
          We last copied Minnesota’s campaign finance files on {checkedOn}. That is when we checked,
          not the period this money covers.
        </Text>
      ) : null}
    </View>
  );
}

function PeriodStamp({
  money,
  state,
  year,
  checkedOn,
  isPartyUnit,
  isHoldingStale,
  isMobile,
}: {
  money: CommitteeMoney;
  state: 'closed-empty' | 'empty-year' | 'figures';
  year: number;
  checkedOn: string | null;
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
    detail = closedPeriodDetail(money.register.terminationDate, checkedOn);
  } else if (state === 'empty-year') {
    line = uncoveredPeriodLine(year);
    detail = uncoveredPeriodDetail(year, checkedOn);
  } else {
    line = coveredPeriodLine(through, money.moneyIn.reportedPeriodStart);
    detail = coveredPeriodDetail(through, checkedOn, {
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
        notes={isHoldingStale ? [staleHoldNote(checkedOn)] : []}
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
}: {
  money: CommitteeMoney;
  state: 'closed-empty' | 'empty-year' | 'figures';
  year: number;
  isBallot: boolean;
  otherYear: number;
  isMobile: boolean;
  onSelectYear: (year: number) => void;
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
        split={money.split}
        moneyIn={money.moneyIn}
        isBallot={isBallot}
        stampThrough={stampThroughDate(money.split, money.moneyOut)}
        isMobile={isMobile}
      />
    </View>
  );
}

function MoneyOutCard({
  money,
  state,
  isBallot,
  isMobile,
}: {
  money: CommitteeMoney;
  state: 'closed-empty' | 'empty-year' | 'figures';
  isBallot: boolean;
  isMobile: boolean;
}) {
  if (state !== 'figures') {
    const closed = state === 'closed-empty';
    return (
      <View style={styles.card}>
        <CardHeading surface="committee">{MONEY_OUT_HEADING}</CardHeading>
        <Figure
          label={MONEY_OUT_FIGURE_LABEL}
          value={closed ? CLOSED_EMPTY_VALUE : EMPTY_YEAR_VALUE}
          isFigure={false}
          isMobile={isMobile}
        />
        <Text style={styles.explain}>
          {closed ? CLOSED_MONEY_OUT_WHY : EMPTY_YEAR_MONEY_OUT_WHY}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <MoneyOutBlock
        surface="committee"
        moneyOut={money.moneyOut}
        isBallot={isBallot}
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
  isBallot,
  onSelectTab,
  navigation,
}: {
  money: CommitteeMoney;
  year: number;
  tab: CommitteeTab;
  slug: string;
  registrationNumber: string;
  isBallot: boolean;
  onSelectTab: (tab: CommitteeTab) => void;
  navigation: RootScreenProps<'CommitteeMoney'>['navigation'];
}) {
  const { isMobile } = useResponsive();
  const prefetchCommitteeMoney = usePrefetchCommitteeMoney();
  // Whether this filer has rows in the outside-spending file, in each direction.
  // The first page of each doubles as the tab's own first page once it is opened, and
  // a subject with no rows gets no tab: "spent nothing" and "we hold nothing" cannot be
  // told apart, so there is nothing honest to draw in its place.
  const [sort, setSort] = useState<OutsideSpendingSort>('newest');
  const spentAbout = useOutsideSpending(
    { about: registrationNumber },
    addressedTab === 'about' ? sort : 'newest',
  );
  const spentBy = useOutsideSpending(
    { spender: registrationNumber },
    addressedTab === 'by' ? sort : 'newest',
  );
  const hasRows = (query: typeof spentAbout) => {
    const first = query.data?.pages[0];
    return Boolean(first && first.state === 'reported' && (first.totalRows ?? 0) > 0);
  };
  // An address naming an outside-spending tab this filer has no rows for opens the
  // first tab instead, once the presence check has settled: the strip never carries a
  // tab with nothing behind it. Our own failure to answer (an error, or a release the
  // file does not reach) keeps the tab and says so inside it, because that is a gap on
  // our side rather than an absence of rows.
  const addressed = addressedTab === 'about' ? spentAbout : addressedTab === 'by' ? spentBy : null;
  const addressedMissing =
    addressed !== null &&
    !addressed.isPending &&
    !addressed.isError &&
    addressed.data?.pages[0]?.state !== 'unavailable' &&
    !hasRows(addressed);
  const tab: CommitteeTab = addressedMissing ? 'gave' : addressedTab;
  const tabs = committeeTabs({
    // A tab the reader is already on stays in the strip while its rows load or
    // reload, so the strip cannot flicker under the active underline.
    spentAbout: hasRows(spentAbout) || tab === 'about',
    spentBy: hasRows(spentBy) || tab === 'by',
  });

  const received = useCommitteePaymentsReceived(registrationNumber, year, {
    limit: 6,
    enabled: tab === 'gave',
  });
  const made = useCommitteePaymentsMade(registrationNumber, year, {
    limit: 6,
    enabled: tab === 'spent',
  });
  const page = tab === 'gave' ? received.data : made.data;
  const isLoading = tab === 'gave' ? received.isPending : made.isPending;

  const linkable = new Set(page?.linkableRegistrationNumbers ?? []);
  const rows =
    tab === 'gave'
      ? (page && 'payments' in page ? page.payments : []).map((payment) => {
          const row = payment as import('../../data/types').CommitteeReceivedPayment;
          return {
            key: `${row.contributor}-${row.receivedOn}-${row.amount}`,
            name: row.contributor ?? 'Name not given in the filing',
            meta: receivedRowMeta({
              contributorType: row.contributorType,
              receiptType: row.receiptType,
              inKind: row.inKind,
            }),
            amount: formatMoney(row.amount),
            inKind: isInKind(row.inKind),
            linkNumber:
              row.contributorRegistrationNumber && linkable.has(row.contributorRegistrationNumber)
                ? row.contributorRegistrationNumber
                : null,
            linkName: row.contributor,
          };
        })
      : (page && 'payments' in page ? page.payments : []).map((payment) => {
          const row = payment as import('../../data/types').CommitteeMadePayment;
          const isTransfer = row.expenditureType === 'Contribution';
          const displayName =
            (isTransfer ? (row.affectedCommitteeName ?? row.vendorName) : row.vendorName) ??
            'Name not given in the filing';
          return {
            key: `${displayName}-${row.paidOn}-${row.amount}`,
            name: displayName,
            meta: madeRowMeta({
              expenditureType: row.expenditureType,
              purpose: row.purpose,
              vendorCity: row.vendorCity,
              vendorState: row.vendorState,
              inKind: row.inKind,
            }),
            amount: formatMoney(row.amount),
            inKind: isInKind(row.inKind),
            linkNumber:
              row.affectedCommitteeRegistrationNumber &&
              linkable.has(row.affectedCommitteeRegistrationNumber)
                ? row.affectedCommitteeRegistrationNumber
                : null,
            linkName: row.affectedCommitteeName,
          };
        });
  const largest = rows.reduce((top, row) => {
    const amount = Number(row.amount?.replace(/[$,]/g, '') ?? 0);
    return Number.isFinite(amount) && amount > top ? amount : top;
  }, 0);

  const tabsRow = (
    <View style={styles.tabsRow} role="tablist">
      {tabs.map((key) => {
        const active = key === tab;
        return (
          <Pressable
            key={key}
            onPress={() => onSelectTab(key)}
            accessibilityRole="tab"
            aria-selected={active}
            style={[styles.tab, active && styles.tabActive]}
          >
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
              {COMMITTEE_TAB_LABELS[key]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (tab === 'filings') {
    return (
      <View style={styles.listSection}>
        {tabsRow}
        <FilingsList registrationNumber={registrationNumber} />
      </View>
    );
  }

  if (tab === 'about' || tab === 'by') {
    return (
      <View style={styles.listSection}>
        {tabsRow}
        <OutsideSpendingPanel
          tab={tab}
          query={tab === 'about' ? spentAbout : spentBy}
          sort={sort}
          onSelectSort={setSort}
          isMobile={isMobile}
          navigation={navigation}
        />
      </View>
    );
  }

  return (
    <View style={styles.listSection}>
      {tabsRow}

      {isLoading ? (
        <View style={styles.listLoading}>
          <View role="status" aria-busy style={styles.hidden}>
            <Text>Loading figures</Text>
          </View>
          {[0, 1, 2].map((index) => (
            <View key={index} style={styles.listRow}>
              <View style={styles.listRowText}>
                <Skeleton width="55%" height={14} />
                <Skeleton width={200} height={11} style={{ marginTop: 8 }} />
              </View>
              <Skeleton width={96} height={12} />
            </View>
          ))}
        </View>
      ) : !page || page.state !== 'reported' ? (
        <View style={styles.card}>
          <Text style={styles.h3}>{emptyListTitle(tab, year)}</Text>
          <Text style={styles.explain}>
            {page?.state === 'unavailable'
              ? 'We could not read this committee’s payments out of our copy of Minnesota’s files. This is a gap on our side, not a statement about the committee.'
              : emptyListWhy(year)}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.listHead}>
            <Text style={styles.listCount}>
              {showingLine(rows.length, page.totalPayments) ?? ''}
            </Text>
            <Text style={styles.listSort}>LARGEST FIRST</Text>
          </View>
          <View style={styles.listRows}>
            {rows.map((row) => {
              const inner = (
                <>
                  <View style={styles.listRowText}>
                    <View style={styles.listNameRow}>
                      <Text style={styles.listName}>{row.name}</Text>
                      {row.inKind ? (
                        <Text style={styles.inKindChip}>{IN_KIND_CHIP.toUpperCase()}</Text>
                      ) : null}
                    </View>
                    {row.meta ? <Text style={styles.listMeta}>{row.meta}</Text> : null}
                  </View>
                  {isMobile ? null : (
                    <View style={styles.listBar}>
                      <View
                        style={[
                          styles.listBarFill,
                          {
                            width: `${
                              largest > 0
                                ? Math.round(
                                    (Number(row.amount?.replace(/[$,]/g, '') ?? 0) / largest) * 100,
                                  )
                                : 0
                            }%`,
                          },
                        ]}
                      />
                    </View>
                  )}
                  <Text style={[styles.listAmount, isMobile && styles.listAmountMobile]}>
                    {row.amount ?? ''}
                  </Text>
                </>
              );
              if (row.linkNumber) {
                const href = routePath.moneyCommittee(committeeSlug(row.linkName, row.linkNumber));
                const linkNumber = row.linkNumber;
                const warm = () => prefetchCommitteeMoney(linkNumber);
                return (
                  <Pressable
                    key={row.key}
                    {...linkProps(href, () =>
                      navigation.push('CommitteeMoney', {
                        slug: committeeSlug(row.linkName, linkNumber),
                      }),
                    )}
                    onPressIn={warm}
                    onHoverIn={warm}
                    style={[styles.listRow, styles.listRowLink]}
                  >
                    {inner}
                  </Pressable>
                );
              }
              return (
                <View key={row.key} style={styles.listRow}>
                  {inner}
                </View>
              );
            })}
          </View>
          {page.totalPayments !== null && page.totalPayments > rows.length ? (
            <Pressable
              {...linkProps(
                routePath.moneyCommitteePayments(slug, { tab, year: String(year) }),
                () => navigation.navigate('CommitteePayments', { slug, tab, year: String(year) }),
              )}
              style={styles.seeAll}
            >
              <Text style={styles.seeAllLabel}>
                See all {page.totalPayments.toLocaleString('en-US')} payments
              </Text>
              <ForwardArrow color={t.colors.brand.base} />
            </Pressable>
          ) : null}
          <Text style={styles.linkNote}>{listLinkNote(tab, isBallot)}</Text>
        </>
      )}
    </View>
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
            const warm = () => prefetchCommitteeMoney(registrationNumber);
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
  yearLabel: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
    color: t.colors.text.muted,
  },
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
  listSection: { marginTop: 30 },
  // Wraps rather than scrolling sideways: 5 tabs take 2 lines at 375, and the active
  // one keeps its underline on whichever line it lands.
  tabsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 30,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink08,
  },
  tab: { paddingBottom: 12 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: t.colors.text.primary, marginBottom: -1 },
  tabLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  tabLabelActive: { color: t.colors.text.primary, fontWeight: t.fontWeights.bold },
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
  listBar: {
    width: 160,
    height: 8,
    borderRadius: 999,
    backgroundColor: t.colors.surfaces.s100,
    overflow: 'hidden',
    display: 'flex',
  },
  listBarFill: { height: '100%', backgroundColor: t.colors.brand.bright },
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
  listAmountMobile: { width: undefined, flexShrink: 0 },
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
