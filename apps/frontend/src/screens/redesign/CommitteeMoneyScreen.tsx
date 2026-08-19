import { useEffect } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { SharePopover } from '../../components/billDetail/SharePopover';
import { YearControl } from '../../components/campaignMoney/CampaignMoneyTab';
import { UnderDevelopmentNotice } from '../../components/campaignMoney/UnderDevelopmentNotice';
import { Skeleton } from '../../components/Skeleton';
import type { CommitteeMoney } from '../../data/types';
import {
  useCommitteeMoney,
  useCommitteePaymentsMade,
  useCommitteePaymentsReceived,
} from '../../hooks/useAppQueries';
import { useResponsive } from '../../hooks/useResponsive';
import {
  CLOSED_EMPTY_VALUE,
  CLOSED_MONEY_IN_WHY,
  CLOSED_MONEY_OUT_WHY,
  closedChipLabel,
  closedPeriodDetail,
  closedPeriodLine,
  committeeEyebrow,
  committeeSlug,
  coveredPeriodDetail,
  coveredPeriodLine,
  EMPTY_YEAR_VALUE,
  emptyListTitle,
  emptyListWhy,
  emptyYearMoneyInWhy,
  EMPTY_YEAR_MONEY_OUT_WHY,
  isBallotQuestionFiler,
  isInKind,
  IN_KIND_CHIP,
  listLinkNote,
  madeRowMeta,
  MONEY_OUT_FIGURE_LABEL,
  moneyOutKindLabel,
  moneyOutNote,
  notFoundBody,
  notFoundTitle,
  PAYMENTS_TAB_LABELS,
  paymentsTabFromParam,
  receivedRowMeta,
  recordCoverageLines,
  registeredForLine,
  registerKindFromEntityType,
  registrationNumberFromSlug,
  showingLine,
  staleHoldNote,
  NOT_IN_REGISTER_LINE,
  uncoveredPeriodDetail,
  uncoveredPeriodLine,
  unnamedMoneyExplanation,
  whoseCommitteeText,
  ZERO_REPORTED_NOTE,
  type PaymentsTab,
} from '../../lib/committeeMoney';
import {
  campaignMoneyYear,
  formatDay,
  formatMoney,
  moneyFigure,
  paymentCountLabel,
  reportedThroughLabel,
  splitExplanation,
  statedSplitNote,
} from '../../lib/legislatorCampaignMoney';
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

/** The Board's own lookup page. A search, not a per-committee address — a guessed
 *  deep link that lands on the wrong committee is worse than one extra step. */
const BOARD_VIEWER = 'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/';
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

/** Which display state the whole year is in, decided once so the stamp, the two
 *  cards and the lists cannot disagree about it. */
export function yearDisplayState(money: CommitteeMoney): 'closed-empty' | 'empty-year' | 'figures' {
  const hasFigures =
    money.split.reportedTotal !== null ||
    money.moneyIn.state === 'reported' ||
    money.moneyOut.state === 'reported' ||
    money.moneyIn.otherReceipts.length > 0 ||
    money.moneyOut.byType.length > 0;
  if (hasFigures) return 'figures';
  return money.register.terminationDate ? 'closed-empty' : 'empty-year';
}

export function CommitteeMoneyScreen({ navigation, route }: RootScreenProps<'CommitteeMoney'>) {
  const { isMobile } = useResponsive();
  const slug = route.params?.slug ?? '';
  const registrationNumber = registrationNumberFromSlug(slug);
  const year = campaignMoneyYear(route.params?.year);
  const tab = paymentsTabFromParam(route.params?.tab);

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
  const onSelectTab = (next: PaymentsTab) => navigation.setParams({ tab: next });

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        {/* The section is partially built (lists and search are phase 3) and
            nothing else on the page says so at a glance. Deleting the element
            and its component file is the whole removal. */}
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
              <LoadingState />
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

function LoadingState() {
  return (
    <View style={styles.loadingWrap}>
      <View role="status" aria-busy style={styles.hidden}>
        <Text>Loading figures</Text>
      </View>
      <Skeleton width={180} height={13} />
      <Skeleton width={420} height={38} style={{ marginTop: 14 }} />
      <Skeleton width={260} height={16} style={{ marginTop: 12 }} />
      <View style={styles.loadingCards}>
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
  tab: PaymentsTab;
  slug: string;
  registrationNumber: string;
  isMobile: boolean;
  isHoldingStale: boolean;
  onSelectYear: (year: number) => void;
  onSelectTab: (tab: PaymentsTab) => void;
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
        <SharePopover content={shareContent} />
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
          {whoseCommitteeText(registerKind, money.entitySubType)}
        </Text>
      </View>

      <View style={styles.yearRow}>
        <Text style={styles.yearLabel}>FILING YEAR</Text>
        <YearControl year={year} onSelect={onSelectYear} />
      </View>

      <PeriodStamp
        money={money}
        state={state}
        year={year}
        checkedOn={checkedOn}
        isPartyUnit={isPartyUnit}
        isHoldingStale={isHoldingStale}
      />

      <View style={[styles.cardsGrid, isMobile && styles.cardsGridMobile]}>
        <MoneyInCard
          money={money}
          state={state}
          year={year}
          isBallot={isBallot}
          otherYear={otherYear}
          onSelectYear={onSelectYear}
        />
        <MoneyOutCard money={money} state={state} isBallot={isBallot} />
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
        <Text style={styles.coverageHead}>WHAT THIS RECORD COVERS</Text>
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
}: {
  money: CommitteeMoney;
  state: 'closed-empty' | 'empty-year' | 'figures';
  year: number;
  checkedOn: string | null;
  isPartyUnit: boolean;
  isHoldingStale: boolean;
}) {
  let line: string | null;
  let detail: string;
  if (state === 'closed-empty') {
    line = closedPeriodLine(money.register.terminationDate);
    detail = closedPeriodDetail(money.register.terminationDate, checkedOn);
  } else if (state === 'empty-year') {
    line = uncoveredPeriodLine(year);
    detail = uncoveredPeriodDetail(year, checkedOn);
  } else {
    line = coveredPeriodLine(money.split.reportedThrough);
    detail = coveredPeriodDetail(money.split.reportedThrough, checkedOn, { isPartyUnit });
  }
  const covered = state === 'figures' && line !== null;
  return (
    <View style={styles.stampCard}>
      {line ? (
        <Text style={covered ? styles.stampPeriod : styles.stampPeriodMuted}>{line}</Text>
      ) : null}
      <Text style={styles.stampDetail}>{detail}</Text>
      {isHoldingStale ? <Text style={styles.stampDetail}>{staleHoldNote(checkedOn)}</Text> : null}
    </View>
  );
}

function MoneyInCard({
  money,
  state,
  year,
  isBallot,
  otherYear,
  onSelectYear,
}: {
  money: CommitteeMoney;
  state: 'closed-empty' | 'empty-year' | 'figures';
  year: number;
  isBallot: boolean;
  otherYear: number;
  onSelectYear: (year: number) => void;
}) {
  const { split, moneyIn } = money;
  if (state !== 'figures') {
    const closed = state === 'closed-empty';
    return (
      <View style={styles.card}>
        <Text accessibilityRole="header" aria-level={2} style={styles.h2}>
          Money in
        </Text>
        <Figure
          label="Donations this committee reported to the state"
          value={closed ? CLOSED_EMPTY_VALUE : EMPTY_YEAR_VALUE}
          isFigure={false}
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

  const reported = formatMoney(split.reportedTotal);
  const named = moneyFigure(moneyIn.state, split.namedTotal);
  const unnamed = split.state === 'shown' ? formatMoney(split.unnamedTotal) : null;
  // Only a real amount earns the goods-and-services line; a filed $0.00 of it is
  // ordinary, not a caveat.
  const inKind = Number(split.namedInKindTotal) > 0 ? formatMoney(split.namedInKindTotal) : null;
  // A reported zero is a verified zero: the total draws as $0.00 and its own
  // sentence carries the story, with no named/unnamed division of nothing.
  const reportedZero =
    split.state === 'shown' && Number(split.reportedTotal) === 0 && split.namedTotal === null;
  const explanation = splitExplanation(split.state);
  const checkNote = statedSplitNote(split.statedSplitState);

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" aria-level={2} style={styles.h2}>
        Money in
      </Text>

      {reported ? (
        <>
          <Figure
            label="Donations this committee reported to the state"
            value={reported}
            note={reportedThroughLabel(split.reportedThrough)}
          />
          <Text
            style={styles.source}
            {...externalLinkProps(BOARD_VIEWER, () => void Linking.openURL(BOARD_VIEWER))}
          >
            This committee’s filed reports, on the state’s own site
          </Text>
        </>
      ) : (
        <Figure
          label="Donations this committee reported to the state"
          value="Not reported"
          isFigure={false}
        />
      )}

      {reportedZero ? (
        <Text style={styles.explain}>{ZERO_REPORTED_NOTE}</Text>
      ) : (
        <Figure
          label="Donations with a donor’s name"
          value={named.text}
          isFigure={named.isFigure}
          note={paymentCountLabel(split.namedPayments)}
        />
      )}

      {inKind ? (
        <Text style={styles.explain}>
          {inKind} of the donations above were goods and services rather than money (
          {IN_KIND_CHIP.toLowerCase()}). The state counts those separately from the reported total.
        </Text>
      ) : null}

      {split.state === 'shown' && unnamed !== null && !reportedZero ? (
        <>
          <View style={styles.splitBar} aria-hidden>
            <View
              style={[
                styles.splitBarFill,
                {
                  width: `${Math.min(
                    100,
                    Math.max(
                      0,
                      Math.round(
                        (Number(split.namedCashTotal ?? 0) / Number(split.reportedTotal ?? 1)) *
                          100,
                      ),
                    ),
                  )}%`,
                },
              ]}
            />
          </View>
          <Figure label="Donations with nobody’s name on them" value={unnamed} />
          <Text style={styles.explain}>{unnamedMoneyExplanation(isBallot)}</Text>
          {checkNote ? <Text style={styles.explain}>{checkNote}</Text> : null}
        </>
      ) : null}

      {explanation ? <Text style={styles.explain}>{explanation}</Text> : null}

      {moneyIn.otherReceipts.length ? (
        <View style={styles.rows}>
          <Text style={styles.rowsHead}>
            Money in that is not a donation, reported on its own line
          </Text>
          {moneyIn.otherReceipts.map((receipt) => (
            <Row
              key={receipt.receiptType}
              label={receipt.receiptType}
              value={formatMoney(receipt.total) ?? ''}
              note={paymentCountLabel(receipt.payments)}
            />
          ))}
        </View>
      ) : null}

      {moneyIn.sourceUrl ? (
        <Text
          style={styles.source}
          {...externalLinkProps(moneyIn.sourceUrl, () => void Linking.openURL(moneyIn.sourceUrl!))}
        >
          Minnesota’s list of named donations
        </Text>
      ) : null}
    </View>
  );
}

function MoneyOutCard({
  money,
  state,
  isBallot,
}: {
  money: CommitteeMoney;
  state: 'closed-empty' | 'empty-year' | 'figures';
  isBallot: boolean;
}) {
  const { moneyOut } = money;
  if (state !== 'figures') {
    const closed = state === 'closed-empty';
    return (
      <View style={styles.card}>
        <Text accessibilityRole="header" aria-level={2} style={styles.h2}>
          Money out
        </Text>
        <Figure
          label={MONEY_OUT_FIGURE_LABEL}
          value={closed ? CLOSED_EMPTY_VALUE : EMPTY_YEAR_VALUE}
          isFigure={false}
        />
        <Text style={styles.explain}>
          {closed ? CLOSED_MONEY_OUT_WHY : EMPTY_YEAR_MONEY_OUT_WHY}
        </Text>
      </View>
    );
  }
  const total = moneyFigure(moneyOut.state, moneyOut.itemizedPaymentTotal);
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" aria-level={2} style={styles.h2}>
        Money out
      </Text>
      <Figure
        label={MONEY_OUT_FIGURE_LABEL}
        value={total.text}
        isFigure={total.isFigure}
        note={paymentCountLabel(moneyOut.itemizedPayments)}
      />
      <Text style={styles.explain}>{moneyOutNote(moneyOut.state, isBallot)}</Text>
      {moneyOut.byType.length ? (
        <View style={styles.rows}>
          {moneyOut.byType.map((entry) => (
            <Row
              key={entry.type}
              label={moneyOutKindLabel(entry.type)}
              value={formatMoney(entry.total) ?? ''}
              note={paymentCountLabel(entry.payments)}
            />
          ))}
        </View>
      ) : null}
      {moneyOut.sourceUrl ? (
        <Text
          style={styles.source}
          {...externalLinkProps(
            moneyOut.sourceUrl,
            () => void Linking.openURL(moneyOut.sourceUrl!),
          )}
        >
          Minnesota’s list of payments out
        </Text>
      ) : null}
    </View>
  );
}

function PaymentsSection({
  money,
  year,
  tab,
  slug,
  registrationNumber,
  isBallot,
  onSelectTab,
  navigation,
}: {
  money: CommitteeMoney;
  year: number;
  tab: PaymentsTab;
  slug: string;
  registrationNumber: string;
  isBallot: boolean;
  onSelectTab: (tab: PaymentsTab) => void;
  navigation: RootScreenProps<'CommitteeMoney'>['navigation'];
}) {
  const { isMobile } = useResponsive();
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

  return (
    <View style={styles.listSection}>
      <View style={styles.tabsRow} role="tablist">
        {(Object.keys(PAYMENTS_TAB_LABELS) as PaymentsTab[]).map((key) => {
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
                {PAYMENTS_TAB_LABELS[key]}
              </Text>
            </Pressable>
          );
        })}
      </View>

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
                return (
                  <Pressable
                    key={row.key}
                    {...linkProps(href, () =>
                      navigation.push('CommitteeMoney', {
                        slug: committeeSlug(row.linkName, row.linkNumber!),
                      }),
                    )}
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

function Figure({
  label,
  value,
  note,
  isFigure = true,
}: {
  label: string;
  value: string;
  note?: string | null;
  isFigure?: boolean;
}) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={isFigure ? styles.figureValue : styles.figureStandIn}>{value}</Text>
      {note ? <Text style={styles.figureNote}>{note}</Text> : null}
    </View>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>
        {label}
        {note ? <Text style={styles.rowNote}> · {note}</Text> : null}
      </Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
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
  h2: {
    fontFamily: t.typography.title,
    fontSize: 21,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.2,
    color: t.colors.text.primary,
  },
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
  yearLabel: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
    color: t.colors.text.muted,
  },
  stampCard: {
    marginTop: 20,
    backgroundColor: t.colors.surfaces.s100,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    padding: 18,
    gap: 8,
  },
  stampPeriod: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
    color: t.colors.brand.base,
  },
  stampPeriodMuted: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
  stampDetail: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: t.colors.text.secondary,
    maxWidth: 1000,
  },
  cardsGrid: { marginTop: 24, flexDirection: 'row', gap: 22, alignItems: 'stretch' },
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
  figure: { gap: 2 },
  figureLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    color: t.colors.text.secondary,
  },
  figureValue: {
    fontFamily: t.typography.title,
    fontSize: 30,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.5,
    color: t.colors.text.primary,
  },
  figureStandIn: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    color: t.colors.text.muted,
  },
  figureNote: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    color: t.colors.text.muted,
    lineHeight: 18,
  },
  rows: { gap: 8, marginTop: 4 },
  rowsHead: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    color: t.colors.text.muted,
  },
  splitBar: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e6e9e7',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  splitBarFill: { height: '100%', backgroundColor: t.colors.brand.graphics },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  rowLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  rowNote: { color: t.colors.text.muted, fontSize: t.fontSizes.meta },
  rowValue: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
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
  tabsRow: {
    flexDirection: 'row',
    gap: 30,
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
  listRows: { marginTop: 12, gap: 9 },
  listLoading: { marginTop: 20, gap: 9 },
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
  listAmount: {
    width: 104,
    textAlign: 'right',
    fontFamily: t.typography.mono,
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
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: 'hidden',
  },
});
