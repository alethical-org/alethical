import { contributionDetailRows, withContributionDetailRows } from '../../lib/contributionDetails';
import { CommitteeDonationCards } from './CommitteeDonationCards';
import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
/**
 * The Campaign money tab on a legislator's profile (#1329).
 *
 * One component for both the desktop and phone profiles, deliberately. Almost
 * everything on this tab is a sentence about what a figure does and does not mean,
 * and two copies of those sentences is how one of them gets fixed and the other
 * does not. Layout differences follow the shared responsive bands; wording never does.
 *
 * The imported copy helpers are where the
 * rules in `.claude/rules/grounded-answers.md` rule 12 and
 * `docs/architecture/campaign-finance-system-design.md` §7 (Display rules) are
 * turned into text a test can pin. This file chooses where things sit and nothing
 * about what they claim.
 *
 * **The empty states get the same care as the populated one**, because Minnesota never
 * records which person a registered committee belongs to and a person confirms every
 * match by hand. On the day this shipped none of the 200 sitting members had been
 * confirmed, so the unconfirmed panel was the whole tab. The 31 Aug 2026 review sitting
 * confirmed 242 accounts covering all 200, so a reader now usually meets figures; a
 * confirmation can be withdrawn (#1902) and a committee can report nothing for a year,
 * so both empty panels are still live paths rather than history.
 */
import React from 'react';
import { filingScheduleNote } from '../../lib/campaignMoneyFilingSchedule';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';

import type { CampaignCommitteeMoney, LegislatorCampaignMoney } from '../../data/types';
import {
  LINK_UNCONFIRMED_EXPLANATION,
  type CampaignMoneyYear,
  campaignMoneyHistoryYears,
  confirmedElsewhereExplanation,
  confirmedElsewhereHeading,
  emptyStateFor,
  otherOfficeNote,
  severalCommitteesNote,
  confirmedCommitteesWithheldLine,
} from '../../lib/legislatorCampaignMoney';
import {
  BOARD_DOWNLOADS_URL,
  committeeSlug,
  coveredPeriodDetail,
  coveredPeriodLine,
  staleHoldNote,
} from '../../lib/committeeMoneyShared';
import { centralDateLabel } from '../../lib/moneyLanding';
import { useLegislatorOutsideSpending } from '../../hooks/useAppQueries';
import { useCurrentClaimExpiry } from '../../hooks/useCurrentClaimExpiry';
import { useResponsive } from '../../hooks/useResponsive';
import {
  CampaignMoneyCardTheme,
  CheckedByBlock,
  CampaignDownloadsLink,
  FilingStamp,
  MoneyInBlock,
  MoneyOutBlock,
} from './MoneyCards';
import { YearControl } from './YearControl';
import {
  CommitteeMixHistory,
  CommitteeDonations,
  GroupedOutsideSpending,
  OutsideSpendingCard,
} from './MoneyDetailsOnDemand';
import { CommitteeRefundCard } from './CommitteeRefundCard';
import { useCampaignMoneyYearStates } from '../../hooks/useCampaignMoneyYearStates';
import { LinkArrowLabel } from '../LinkArrow';
import { boardRecordUrl, committeeNumberSuffix } from '../../lib/boardRecordLink';
import { paymentDateRangeLabel, splitExplanation } from '../../lib/legislatorCampaignMoney';
import { linkProps, routePath } from '../../navigation/links';
import {
  DEFAULT_MONEY_DETAILS_PREFERENCES,
  type MoneyDetailsPreferences,
} from '../../lib/campaignMoneyPreferences';
import {
  moneyDetailsPageCopy as copy,
  paymentFilesDownloadedLine,
} from '../../lib/campaignMoneyDetailsPageCopy';
import {
  committeeCardStyles,
  detailsStyles,
  numericText,
  useCampaignMoneyTypography,
  useDetailsStyles,
} from './detailsStyles';
import { externalLinkProps } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';
import { outsideSpendingLoadFailure } from '../../lib/outsideSpending';

type Props = {
  contributionDetails?: string;
  onContributionDetailsChange?: (value: string | undefined) => void;
  legislatorName: string;
  year: CampaignMoneyYear;
  onSelectYear: (year: CampaignMoneyYear) => void;
  money: LegislatorCampaignMoney | undefined;
  isLoading: boolean;
  isError: boolean;
  /** React Query's own stamp for the money read, so this tab can tell how old the
   *  confirmation behind these committees is (issue 2023). */
  moneyUpdatedAt: number | undefined;
  /** Asked again when that confirmation reaches its deadline, so a reachable
   *  service restores the committees instead of them being withheld. */
  refetchMoney: () => void;
  isDesktop: boolean;
  legislatorId: string;
  onOpenSource: (url: string) => void;
};

export function CampaignMoneyTab({
  contributionDetails,
  onContributionDetailsChange,
  legislatorName,
  year,
  onSelectYear,
  money,
  isLoading,
  isError,
  moneyUpdatedAt,
  refetchMoney,
  legislatorId,
  onOpenSource,
}: Props) {
  const type = useCampaignMoneyTypography();
  const { isMobile, isTablet } = useResponsive();
  // Keep reader choices above the loading branch: changing years temporarily
  // removes committee cards, but must not reset their chosen tab or sort.
  const [preferences, setPreferences] = React.useState<Record<string, MoneyDetailsPreferences>>({});
  const cardExpansion = (registration: string) => ({
    expandedRows: onContributionDetailsChange
      ? contributionDetailRows(contributionDetails, registration, year)
      : undefined,
    onExpandedRowsChange: onContributionDetailsChange
      ? (rows: number[]) =>
          onContributionDetailsChange(
            withContributionDetailRows(contributionDetails, registration, year, rows),
          )
      : undefined,
  });
  const cardPreferences = (registration: string) => ({
    preferences: preferences[registration] ?? DEFAULT_MONEY_DETAILS_PREFERENCES,
    onPreferences: (value: MoneyDetailsPreferences) =>
      setPreferences((previous) => ({ ...previous, [registration]: value })),
  });
  // These committees are on this person's page BECAUSE somebody confirmed they are
  // theirs, and that decision can be taken back. Past the deadline the tab stops
  // repeating it (`lib/currentClaimFreshness.ts`).
  const committeesWithheld = useCurrentClaimExpiry({
    servedAgeMs: money?.currentClaim.servedAgeMs,
    dataUpdatedAt: money ? moneyUpdatedAt : undefined,
    refetch: refetchMoney,
  });
  // Money others spent about this member, from #1332. Fetched here rather than by the
  // profile screens so a reader who never opens this tab never pays for the request,
  // and so both records sit on one page under one heading. It is a different record
  // from the committee's own money and is never added to it
  // (`docs/architecture/campaign-finance-system-design.md` §3).
  const outsideSpending = useLegislatorOutsideSpending(legislatorId, [year]);
  const selectedOutsideYear = outsideSpending.data?.find((record) => record.year === year);
  const outsideCommitteesWithheld = useCurrentClaimExpiry({
    servedAgeMs: selectedOutsideYear?.currentClaim?.servedAgeMs,
    dataUpdatedAt: selectedOutsideYear ? outsideSpending.dataUpdatedAt : undefined,
    refetch: outsideSpending.refetch,
  });

  const yearStates = useCampaignMoneyYearStates(legislatorId, campaignMoneyHistoryYears(), {
    enabled: Boolean(money && !isLoading && !committeesWithheld && money.committees.length),
  });
  const namesOnlyYears = new Set(
    (committeesWithheld ? [] : (yearStates.data ?? []))
      .filter((record) => {
        const states = Object.values(record.committees);
        return (
          states.length > 0 && states.every((state) => state.splitState === 'no_reported_total')
        );
      })
      .map((record) => record.year),
  );
  if (
    !committeesWithheld &&
    money?.committees.length &&
    money.committees.every((committee) => committee.split.state === 'no_reported_total')
  )
    namesOnlyYears.add(year);

  // Everything about one committee stays together, in the order a reader meets it:
  // the card's figures and names list, then the same donor picture drawn across years,
  // then that committee's refunds (#2186). The mix chart used to draw at the foot of
  // the tab, which put a different subject from a different source between a reader and
  // the continuation of the picture they were just looking at.
  const mixHistoryFor = (committee: CampaignCommitteeMoney) =>
    money && !isLoading && !committeesWithheld ? (
      <CommitteeMixHistory
        registrationNumber={committee.registrationNumber}
        committeeName={committee.committeeName || committee.committeeNameAsReviewed}
        year={year}
        releaseId={money.releaseId}
        onSelectYear={onSelectYear}
      />
    ) : null;
  // Said only where this year's own filing record says it, and only where it says it
  // for every committee on the page: a zero with no ballot fact beside it is silent
  // rather than guessed at (`.claude/rules/grounded-answers.md` rule 12).
  const notOnTheBallot = Boolean(
    money?.committees.length &&
    money.committees.every((committee) => committee.filingSchedule.state === 'not_on_the_ballot'),
  );

  return (
    <View
      style={[styles.wrap, { gap: isMobile ? 24 : isTablet ? 32 : 36 }]}
      role="region"
      aria-label="Campaign money"
    >
      {/* This tab is the one money surface showing dollar figures, and it is
          still partially built (#1642, #1645, #1650, #1663). Boxed rather than
          full-bleed: the tab opens inside a content column, below the profile
          header and the tab row. */}

      {/* No visible heading: the tab bar directly above carries the word "Campaign
          money" and this is the selected tab, so a heading repeating it is 1 word
          charged for twice. The region keeps the name on `styles.wrap` above, so a
          screen reader still hears what it is. */}
      {/* The year control is the tab's first row, left-aligned at the gutter rather
          than sharing a line with a heading. It draws its own visible "Year" label. */}
      <YearControl
        year={year}
        onSelect={onSelectYear}
        namesOnlyYears={namesOnlyYears}
        years={campaignMoneyHistoryYears()}
      />

      {/* A failed recheck leaves the previous answer in place, so a fault is only a
          FAILURE CARD when there is nothing to show. Gated on `isError` alone, one
          failed recheck replaced a correct current page of figures with an apology,
          and issue 2023's own recheck on returning to a tab is what made that
          reachable. The committee page already had this right (`isHoldingStale` in
          CommitteeMoneyScreen.tsx) and this is the same treatment and the same
          sentence, not a new one. */}
      {isError && !money ? (
        // Its own state, never a fall-through to "Not reported". A fault on our side
        // must not read as a named person having filed nothing.
        <View style={styles.card}>
          <Text accessibilityRole="alert" style={styles.body}>
            We couldn’t load {legislatorName}’s campaign money right now. This is a problem on our
            side and says nothing about what they raised or spent. Please try again in a moment.
          </Text>
        </View>
      ) : isLoading || !money ? (
        <View style={styles.card}>
          <Text style={styles.muted}>Loading campaign money…</Text>
        </View>
      ) : isError && !committeesWithheld ? (
        // Held figures, said plainly above them rather than below: a reader who
        // stops at the first number is the one who most needs to know it is held.
        <>
          <View style={styles.card}>
            <Text accessibilityRole="alert" style={styles.body}>
              {staleHoldNote(null)}
            </Text>
          </View>
          <SeveralCommitteesNote
            count={money.committees.length + money.committeesOutsideThisYear.length}
          />
          {money.committees.map((committee) => (
            <CommitteeCard
              key={committee.registrationNumber}
              committee={committee}
              year={year}
              releaseId={money.releaseId}
              onRefresh={refetchMoney}
              mixHistory={mixHistoryFor(committee)}
              {...cardPreferences(committee.registrationNumber)}
              {...cardExpansion(committee.registrationNumber)}
            />
          ))}
          <OutsideYearCommitteeCards committees={money.committeesOutsideThisYear} year={year} />
        </>
      ) : committeesWithheld && (money.linkState === 'confirmed' || money.committees.length > 0) ? (
        // Ahead of every empty state below, because each of those asserts something
        // about this member that we would not be able to stand behind here.
        <View style={styles.card}>
          <Text accessibilityRole="alert" style={styles.body}>
            {confirmedCommitteesWithheldLine(legislatorName)}
          </Text>
        </View>
      ) : emptyStateFor(money.linkState, money.committees.length) === 'unconfirmed' ? (
        <UnconfirmedPanel />
      ) : emptyStateFor(money.linkState, money.committees.length) === 'confirmed-elsewhere' ? (
        money.committeesOutsideThisYear.length ? (
          <OutsideYearCommitteeCards committees={money.committeesOutsideThisYear} year={year} />
        ) : (
          <View style={styles.card}>
            <Text accessibilityRole="header" aria-level={2} style={styles.h3}>
              {confirmedElsewhereHeading(year, money.committeesOutsideThisYear)}
            </Text>
            <Text style={styles.body}>
              {confirmedElsewhereExplanation(year, money.committeesOutsideThisYear)}
            </Text>
          </View>
        )
      ) : (
        <>
          {/* Above the cards, not below: a reader who stops after the first figure
              is exactly the reader who would otherwise add the second one to it. */}
          <SeveralCommitteesNote
            count={money.committees.length + money.committeesOutsideThisYear.length}
          />
          {money.committees.map((committee) => (
            <CommitteeCard
              key={committee.registrationNumber}
              committee={committee}
              year={year}
              releaseId={money.releaseId}
              onRefresh={refetchMoney}
              mixHistory={mixHistoryFor(committee)}
              {...cardPreferences(committee.registrationNumber)}
              {...cardExpansion(committee.registrationNumber)}
            />
          ))}
          <OutsideYearCommitteeCards committees={money.committeesOutsideThisYear} year={year} />
        </>
      )}

      {money && !isLoading && !committeesWithheld ? (
        <OtherOfficeNote count={money.otherOfficeCommittees} />
      ) : null}

      {/* Money others spent about this member, below the committee's own money in and
          money out and their payment lists, because it is the record a reader of those
          figures alone would miss (#1332). Drawn unconditionally rather than inside any
          of the branches above: it is a different record from the committee's own money,
          it answers a different request, and it carries its own loading, error, no-figure
          and measured-zero states. Gating it on the committee money's state is how it
          went missing for 15 days -- #1329 moved the money onto this tab, kept the
          request, and drew nothing with it (#1932). */}
      {!outsideCommitteesWithheld &&
      !outsideSpending.isLoading &&
      !outsideSpending.isError &&
      selectedOutsideYear?.state === 'reported' ? (
        <GroupedOutsideSpending
          year={selectedOutsideYear}
          onOpenSource={onOpenSource}
          notOnTheBallot={notOnTheBallot}
        />
      ) : (
        <OutsideSpendingCard
          years={
            outsideCommitteesWithheld
              ? [outsideSpendingLoadFailure(year)]
              : (outsideSpending.data ?? [])
          }
          isLoading={outsideSpending.isLoading}
          isError={outsideSpending.isError}
          onOpenSource={onOpenSource}
          showFreshness={false}
        />
      )}

      <FreshnessNote
        filingsCopiedAt={money?.filingsCopiedAt}
        fetchedAts={[
          ...(money ? [money.fetchedAt] : []),
          ...(selectedOutsideYear?.state === 'reported' ? [selectedOutsideYear.fetchedAt] : []),
        ]}
        onRefresh={() => {
          refetchMoney();
          void outsideSpending.refetch();
        }}
      />
    </View>
  );
}

/** A selected-year absence does not erase a confirmed committee's refund history. */
function OutsideYearCommitteeCards({
  committees,
  year,
}: {
  committees: LegislatorCampaignMoney['committeesOutsideThisYear'];
  year: CampaignMoneyYear;
}) {
  const { isMobile, isTablet } = useResponsive();
  const type = useCampaignMoneyTypography();
  return committees.map((committee) => (
    <React.Fragment key={committee.registrationNumber}>
      <CampaignMoneyCardTheme>
        <View style={[styles.card, isTablet && styles.cardTablet, isMobile && styles.cardMobile]}>
          <Text
            accessibilityRole="header"
            aria-level={2}
            style={[
              styles.h3,
              { fontSize: type.h3 },
              numericText(committee.committeeNameAsReviewed),
            ]}
          >
            {committee.committeeNameAsReviewed}{' '}
            <Text style={styles.numberRun}>
              {committeeNumberSuffix(committee.registrationNumber)}
            </Text>
          </Text>
          <FilingStamp
            line={String(year)}
            detail={confirmedElsewhereHeading(year, [committee])}
            notes={[confirmedElsewhereExplanation(year, [committee])]}
            ourRecord={
              <CommitteeRecordLink
                name={committee.committeeNameAsReviewed}
                registrationNumber={committee.registrationNumber}
                year={year}
              />
            }
            covered
            isMobile={isMobile}
          />
        </View>
      </CampaignMoneyCardTheme>
      <CommitteeRefundCard
        refunds={committee.refunds}
        registrationNumber={committee.registrationNumber}
      />
    </React.Fragment>
  ));
}

/**
 * What every sitting member's profile shows today.
 *
 * The wording is fixed in `lib/legislatorCampaignMoney.ts` and says three things a
 * shorter sentence gets wrong: that their committees do exist on file, that the
 * unfinished work is ours, and nothing at all about the other 199 members.
 */
function UnconfirmedPanel() {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" aria-level={2} style={styles.h3}>
        We have not matched this member to their committee yet
      </Text>
      <Text style={styles.body}>{LINK_UNCONFIRMED_EXPLANATION}</Text>
      <SourceLink
        label="Minnesota Campaign Finance Board — campaign finance downloads"
        url={BOARD_DOWNLOADS_URL}
      />
    </View>
  );
}

function CommitteeRecordLink({
  name,
  registrationNumber,
  year,
}: {
  name: string;
  registrationNumber: string;
  year: CampaignMoneyYear;
}) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const type = useCampaignMoneyTypography();
  const recordParams = {
    slug: committeeSlug(name, registrationNumber),
    tab: 'filings',
    year: String(year),
  };
  return (
    <Pressable
      style={(state) => [
        styles.recordLink,
        Boolean('focused' in state && state.focused) && detailsStyles.focus,
      ]}
      {...linkProps(
        routePath.moneyCommittee(recordParams.slug, {
          tab: recordParams.tab,
          year: recordParams.year,
        }),
        () => navigation.navigate('CommitteeMoney', recordParams),
      )}
    >
      <LinkArrowLabel
        label={copy.fullRecord}
        style={[styles.recordLinkLabel, { fontSize: type.small }]}
      />
    </Pressable>
  );
}

function CommitteeCard({
  committee,
  year,
  releaseId,
  onRefresh,
  mixHistory,
  preferences,
  onPreferences,
  expandedRows,
  onExpandedRowsChange,
}: {
  expandedRows?: readonly number[];
  onExpandedRowsChange?: (rows: number[]) => void;
  committee: CampaignCommitteeMoney;
  year: CampaignMoneyYear;
  releaseId?: string;
  onRefresh: () => void;
  /** This committee's own year-by-year donor chart, drawn between its figures and its
   *  refunds so one committee's block is never split by another subject. */
  mixHistory: React.ReactNode;
  preferences: MoneyDetailsPreferences;
  onPreferences: (preferences: MoneyDetailsPreferences) => void;
}) {
  const { isMobile, isTablet } = useResponsive();
  const type = useCampaignMoneyTypography();
  const name = committee.committeeName || committee.committeeNameAsReviewed;
  // The filing's period and link, once, above both cards — never inside one. The
  // tab's own freshness note at the foot carries the day we copied the files, so the
  // stamp here states the filing's coverage alone.
  const through = committee.split.reportedThrough;
  const periodStart = committee.moneyIn?.reportedPeriodStart ?? null;
  const recordAndSchedule = (
    <View style={styles.recordAndSchedule}>
      <CommitteeRecordLink
        name={name}
        registrationNumber={committee.registrationNumber}
        year={year}
      />
      <FilingScheduleNote schedule={committee.filingSchedule} year={year} />
    </View>
  );
  return (
    <CampaignMoneyCardTheme>
      <View style={{ gap: 12 }}>
        <View style={[styles.card, isTablet && styles.cardTablet, isMobile && styles.cardMobile]}>
          {/* The registration number rides on the name line, in the state's own
              listing format. The eyebrow that used to sit above carried 3 facts and
              2 of them were already on the page: the chamber is in the profile's own
              h1 and the line under it, and the year is set by the control directly
              above this card. */}
          <Text
            accessibilityRole="header"
            aria-level={2}
            style={[styles.h3, { fontSize: type.h3 }, numericText(name)]}
          >
            {name}{' '}
            <Text style={styles.numberRun}>
              {committeeNumberSuffix(committee.registrationNumber)}
            </Text>
          </Text>

          {through ? (
            <FilingStamp
              line={coveredPeriodLine(through, periodStart)}
              detail={coveredPeriodDetail(through, null, { reportedPeriodStart: periodStart })}
              boardRecordUrl={boardRecordUrl(
                committee.registerKind,
                committee.registrationNumber,
                year,
              )}
              ourRecord={recordAndSchedule}
              covered
              isMobile={isMobile}
            />
          ) : (
            <FilingStamp
              line={
                paymentDateRangeLabel(
                  committee.split.firstPaymentOn,
                  committee.split.lastPaymentOn,
                ) ?? String(year)
              }
              detail={
                committee.split.state === 'no_reported_total'
                  ? (splitExplanation(committee.split.state) ?? '')
                  : ''
              }
              ourRecord={recordAndSchedule}
              covered
              isMobile={isMobile}
            />
          )}
          <CommitteeDonations
            committee={committee}
            year={year}
            releaseId={releaseId}
            onRefresh={onRefresh}
            preferences={preferences}
            onPreferences={onPreferences}
          >
            <View style={styles.figures}>
              <View style={styles.figureColumn}>
                <MoneyInBlock
                  surface="profile"
                  withDonorBreakdown
                  showSource={false}
                  split={committee.split}
                  moneyIn={committee.moneyIn}
                  isBallot={false}
                  stampThrough={through}
                  isMobile={isMobile}
                />
              </View>
              <View style={styles.figureColumn}>
                <MoneyOutBlock
                  surface="profile"
                  moneyOut={committee.moneyOut}
                  stampThrough={through}
                  isMobile={isMobile}
                />
              </View>
            </View>
          </CommitteeDonations>
          {/* The stored check belongs to this committee, at the foot of its card. */}
          <View style={styles.cardFoot}>
            <CheckedByBlock checked={committee.checked} />
            <CampaignDownloadsLink sourceUrl={committee.moneyIn?.sourceUrl} />
          </View>
        </View>
      </View>
      <CommitteeDonationCards
        committee={committee}
        year={year}
        registerKind={committee.registerKind}
        releaseId={releaseId}
        expandedRows={expandedRows}
        onExpandedRowsChange={onExpandedRowsChange}
      />
      {mixHistory}
      <CommitteeRefundCard
        refunds={committee.refunds}
        registrationNumber={committee.registrationNumber}
      />
    </CampaignMoneyCardTheme>
  );
}

/**
 * Why this committee has what it has for this year, in its own words.
 *
 * Below the record-link row and above the chart, because it describes how current
 * this committee's figures are rather than qualifying the names list alone.
 *
 * Every sentence and every date comes from `lib/campaignMoneyFilingSchedule.ts`. One
 * paragraph per element, so a printed exemption sits under the date it qualifies
 * instead of trailing it inside one block of text.
 */
function FilingScheduleNote({
  schedule,
  year,
}: {
  schedule: CampaignCommitteeMoney['filingSchedule'];
  year: CampaignMoneyYear;
}) {
  const paragraphs = filingScheduleNote(schedule, year);
  if (!paragraphs.length) return null;
  return (
    <View style={styles.schedule}>
      {paragraphs.map((paragraph) => (
        <Text key={paragraph} style={styles.scheduleText}>
          {paragraph}
        </Text>
      ))}
    </View>
  );
}

function SourceLink({ label, url }: { label: string; url: string }) {
  const [focused, setFocused] = React.useState(false);
  const type = useCampaignMoneyTypography();
  return (
    <Text
      style={[styles.source, { fontSize: type.body }, focused && detailsStyles.focus]}
      {...{ onFocus: () => setFocused(true), onBlur: () => setFocused(false) }}
      {...externalLinkProps(url, () => void Linking.openURL(url))}
    >
      {label}
    </Text>
  );
}

/**
 * What we hold and are deliberately not showing.
 *
 * Sits outside the committee cards on purpose. It is a statement about which
 * committees are on this page rather than a figure about any one of them, and putting
 * it inside a card would read as a caveat on that card's numbers.
 */
/**
 * Why a member with 2 committees gets 2 sets of figures and no combined one (#1663).
 *
 * A card of its own rather than a footnote, and above the committee cards rather than
 * below them, because the reader most at risk of adding the 2 figures is the one who
 * reads least. The wording lives in `lib/legislatorCampaignMoney.ts` with the
 * measurement behind it.
 */
function SeveralCommitteesNote({ count }: { count: number }) {
  const note = severalCommitteesNote(count);
  if (!note) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.explain}>{note}</Text>
    </View>
  );
}

function OtherOfficeNote({ count }: { count: number }) {
  const note = otherOfficeNote(count);
  if (!note) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.explain}>{note}</Text>
    </View>
  );
}

/**
 * One freshness date for the tab, plus what it does and does not mean.
 *
 * The date is the day we downloaded Minnesota's files. It is never the period the
 * money covers — that is per committee, always earlier, and stated beside each
 * figure.
 *
 * What stops a September reader seeing "checked today" over figures that stop in July
 * and concluding we are broken is now the schedule note inside each committee card,
 * which says when that committee's next report is due. It used to be a fixed
 * paragraph here describing Minnesota's calendar in general (#1642).
 */
function FreshnessNote({
  filingsCopiedAt,
  fetchedAts,
  onRefresh,
}: {
  filingsCopiedAt?: string | null;
  fetchedAts: (string | null)[];
  onRefresh: () => void;
}) {
  const text = useDetailsStyles();
  if (!fetchedAts.length) return null;
  const days = fetchedAts.map((date) => (date ? centralDateLabel(date) : null));
  const day = days[0];
  if (!day || days.some((value) => value !== day))
    return (
      <View style={styles.freshness}>
        <Text style={text.small}>{copy.freshnessMismatch}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRefresh}
          style={(state) => [
            detailsStyles.control,
            Boolean('focused' in state && state.focused) && detailsStyles.focus,
          ]}
        >
          <Text style={detailsStyles.controlText}>{copy.refreshRecords}</Text>
        </Pressable>
      </View>
    );
  return (
    <View style={styles.freshness}>
      {/* The ordinary body weight, not the heavy one: this is the least important line
          on the tab and it was the only bold one, and the only one under the 15px the
          notes inside the cards above it use. Tabular figures stay, for the date. */}
      <Text style={[text.small, styles.freshnessLine]}>
        {paymentFilesDownloadedLine(
          day,
          filingsCopiedAt ? centralDateLabel(filingsCopiedAt) : null,
        )}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 24 },
  h3: {
    fontFamily: t.typography.title,
    fontSize: 24,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.4,
    color: c.text,
  },
  eyebrow: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: c.muted,
    marginBottom: 6,
  },
  recordAndSchedule: { gap: 10 },
  schedule: { gap: 12 },
  scheduleText: {
    fontFamily: t.typography.body,
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22.5,
    color: c.secondary,
    fontVariant: ['tabular-nums'],
    ...({ textWrap: 'pretty' } as object),
  },
  card: committeeCardStyles.card,
  body: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 26,
    color: c.text,
  },
  muted: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: c.muted,
  },
  explain: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: c.secondary,
  },
  source: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    color: c.link,
    textDecorationLine: 'underline',
    minHeight: 44,
    paddingVertical: 12,
  },
  // A row link, not a link inside a sentence: its position and its trailing arrow
  // say where it goes, so it carries no underline. The 44px target lives on the
  // pressable around it.
  recordLinkLabel: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.bold,
    color: c.link,
  },
  // Same reason as `LinkArrowLabel`: a hyphen is a place a browser may break a line, so
  // without this the card ends a line on a dangling `-` and strands the number.
  numberRun: { ...({ whiteSpace: 'nowrap' } as object) },
  freshness: { gap: 8 },
  freshnessLine: {
    fontVariant: ['tabular-nums'],
    color: c.secondary,
    fontSize: 15,
    lineHeight: 22.5,
    fontWeight: '400',
  },
  cardMobile: committeeCardStyles.mobile,
  cardTablet: committeeCardStyles.tablet,
  // Two cards rather than 2 bare columns divided by a rule (#2182). They wrap on their
  // own at 270px, so the phone band needs no separate direction: the same row becomes a
  // stack when only one card fits.
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'stretch' },
  cardFoot: { marginTop: 14, gap: 14 },
  figureColumn: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 270,
    minWidth: 0,
    backgroundColor: c.tile,
    borderWidth: 1,
    borderColor: c.shadow,
    borderRadius: 14,
    paddingTop: 18,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  recordLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
