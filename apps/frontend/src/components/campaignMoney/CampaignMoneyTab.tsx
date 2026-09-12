import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
/**
 * The Campaign money tab on a legislator's profile (#1329).
 *
 * One component for both the desktop and phone profiles, deliberately. Almost
 * everything on this tab is a sentence about what a figure does and does not mean,
 * and two copies of those sentences is how one of them gets fixed and the other
 * does not. Layout differences follow the shared responsive bands; wording never does.
 *
 * Every string here comes from `lib/legislatorCampaignMoney.ts`, which is where the
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
  filingScheduleNote,
  otherOfficeNote,
  severalCommitteesNote,
  confirmedCommitteesWithheldLine,
} from '../../lib/legislatorCampaignMoney';
import {
  coveredPeriodDetail,
  coveredPeriodLine,
  paymentFilesDownloadedLine,
  staleHoldNote,
} from '../../lib/committeeMoney';
import { centralDateLabel } from '../../lib/moneyLanding';
import { useLegislatorOutsideSpending } from '../../hooks/useAppQueries';
import { useCurrentClaimExpiry } from '../../hooks/useCurrentClaimExpiry';
import { useResponsive } from '../../hooks/useResponsive';
import {
  CampaignMoneyCardTheme,
  CheckedByBlock,
  FilingStamp,
  MoneyInBlock,
  MoneyOutBlock,
} from './MoneyCards';
import { YearControl } from './YearControl';
import { CommitteeMixHistory } from './CommitteeMixHistory';
import { CommitteeRefundCard } from './CommitteeRefundCard';
import { useCampaignMoneyYearStates } from '../../hooks/useCampaignMoneyDetails';
import { CommitteeDonations } from './CommitteeDonations';
import { GroupedOutsideSpending } from './GroupedOutsideSpending';
import { LinkArrow } from '../LinkArrow';
import { committeeSlug, FILED_REPORTS_LINK_LABEL } from '../../lib/committeeMoney';
import { paymentDateRangeLabel, splitExplanation } from '../../lib/legislatorCampaignMoney';
import { BOARD_VIEWER } from './MoneyCards';
import { linkProps, routePath } from '../../navigation/links';
import {
  DEFAULT_MONEY_DETAILS_PREFERENCES,
  type MoneyDetailsPreferences,
} from '../../lib/campaignMoneyDetails';
import { moneyDetailsCopy as copy } from '../../lib/campaignMoneyDetailsCopy';
import {
  committeeCardStyles,
  detailsStyles,
  numericText,
  useCampaignMoneyTypography,
  useDetailsStyles,
} from './detailsStyles';
import { OutsideSpendingCard } from '../legislator/OutsideSpendingCard';
import { UnderDevelopmentNotice } from './UnderDevelopmentNotice';
import { externalLinkProps } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';
import { outsideSpendingLoadFailure } from '../../lib/outsideSpending';

/** The Board's own page, which is where every figure on this tab comes from. */
const BOARD_URL = 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/';

type Props = {
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
  // Keep reader choices above the loading branch: changing years temporarily
  // removes committee cards, but must not reset their chosen tab or sort.
  const [preferences, setPreferences] = React.useState<Record<string, MoneyDetailsPreferences>>({});
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

  return (
    <View style={styles.wrap}>
      {/* This tab is the one money surface showing dollar figures, and it is
          still partially built (#1642, #1645, #1650, #1663). Boxed rather than
          full-bleed: the tab opens inside a content column, below the profile
          header and the tab row. */}
      <UnderDevelopmentNotice variant="inset" />

      <View style={styles.head}>
        <Text accessibilityRole="header" aria-level={2} style={[styles.h2, { fontSize: type.h2 }]}>
          Campaign money
        </Text>
        <YearControl
          year={year}
          onSelect={onSelectYear}
          namesOnlyYears={namesOnlyYears}
          years={campaignMoneyHistoryYears()}
        />
      </View>

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
              {...cardPreferences(committee.registrationNumber)}
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
            <Text accessibilityRole="header" aria-level={3} style={styles.h3}>
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
              {...cardPreferences(committee.registrationNumber)}
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
        <GroupedOutsideSpending year={selectedOutsideYear} onOpenSource={onOpenSource} />
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

      {money && !isLoading && !committeesWithheld
        ? money.committees.map((committee) => (
            <CommitteeMixHistory
              key={committee.registrationNumber}
              registrationNumber={committee.registrationNumber}
              committeeName={committee.committeeName || committee.committeeNameAsReviewed}
              year={year}
              releaseId={money.releaseId}
              onSelectYear={onSelectYear}
            />
          ))
        : null}
      <FreshnessNote
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
    <View key={committee.registrationNumber} style={{ gap: 24 }}>
      <View style={[styles.card, isTablet && styles.cardTablet, isMobile && styles.cardMobile]}>
        <Text style={styles.eyebrow}>
          {year} · REGISTRATION {committee.registrationNumber}
        </Text>
        <Text accessibilityRole="header" aria-level={3} style={[styles.h3, { fontSize: type.h3 }]}>
          {committee.committeeNameAsReviewed}
        </Text>
        <Text accessibilityRole="header" aria-level={4} style={styles.explain}>
          {confirmedElsewhereHeading(year, [committee])}
        </Text>
        <Text style={[styles.body, { fontSize: type.body }]}>
          {confirmedElsewhereExplanation(year, [committee])}
        </Text>
      </View>
      <CommitteeRefundCard
        refunds={committee.refunds}
        registrationNumber={committee.registrationNumber}
      />
    </View>
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
      <Text accessibilityRole="header" aria-level={3} style={styles.h3}>
        We have not matched this member to their committee yet
      </Text>
      <Text style={styles.body}>{LINK_UNCONFIRMED_EXPLANATION}</Text>
      <SourceLink
        label="Minnesota Campaign Finance Board — campaign finance downloads"
        url={BOARD_URL}
      />
    </View>
  );
}

function CommitteeCard({
  committee,
  year,
  releaseId,
  onRefresh,
  preferences,
  onPreferences,
}: {
  committee: CampaignCommitteeMoney;
  year: CampaignMoneyYear;
  releaseId?: string;
  onRefresh: () => void;
  preferences: MoneyDetailsPreferences;
  onPreferences: (preferences: MoneyDetailsPreferences) => void;
}) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { isMobile, isTablet } = useResponsive();
  const type = useCampaignMoneyTypography();
  const text = useDetailsStyles();
  const name = committee.committeeName || committee.committeeNameAsReviewed;
  // The filing's period and link, once, above both cards — never inside one. The
  // tab's own freshness note at the foot carries the day we copied the files, so the
  // stamp here states the filing's coverage alone.
  const through = committee.split.reportedThrough;
  const periodStart = committee.moneyIn?.reportedPeriodStart ?? null;
  const recordParams = {
    slug: committeeSlug(name, committee.registrationNumber),
    year: String(year),
  };
  return (
    <CampaignMoneyCardTheme>
      <View style={{ gap: 12 }}>
        {committee.split.state === 'no_reported_total' ? (
          <Text style={text.body}>{splitExplanation(committee.split.state)}</Text>
        ) : null}
        <View style={[styles.card, isTablet && styles.cardTablet, isMobile && styles.cardMobile]}>
          <Text style={styles.eyebrow}>
            {committee.office ? `${committee.office} · ` : ''}
            {year} · REGISTRATION {committee.registrationNumber}
          </Text>
          <Text
            accessibilityRole="header"
            aria-level={3}
            style={[styles.h3, { fontSize: type.h3 }, numericText(name)]}
          >
            {name}
          </Text>

          {through ? (
            <FilingStamp
              line={coveredPeriodLine(through, periodStart)}
              detail={coveredPeriodDetail(through, null, { reportedPeriodStart: periodStart })}
              showLink={false}
              covered
              isMobile={isMobile}
            />
          ) : paymentDateRangeLabel(
              committee.split.firstPaymentOn,
              committee.split.lastPaymentOn,
            ) ? (
            <Text style={[text.body, text.numeric]}>
              {paymentDateRangeLabel(committee.split.firstPaymentOn, committee.split.lastPaymentOn)}
            </Text>
          ) : null}
          <View style={styles.recordLinks}>
            <SourceLink label={FILED_REPORTS_LINK_LABEL} url={BOARD_VIEWER} />
            <Pressable
              style={(state) => [
                styles.recordLink,
                Boolean('focused' in state && state.focused) && detailsStyles.focus,
              ]}
              {...linkProps(
                routePath.moneyCommittee(recordParams.slug, { year: recordParams.year }),
                () => navigation.navigate('CommitteeMoney', recordParams),
              )}
            >
              <Text style={[styles.source, { fontSize: type.body }]}>{copy.fullRecord}</Text>
              <LinkArrow color={c.link} />
            </Pressable>
          </View>
          <CommitteeDonations
            committee={committee}
            year={year}
            releaseId={releaseId}
            onRefresh={onRefresh}
            preferences={preferences}
            onPreferences={onPreferences}
          >
            <View style={[styles.figures, isMobile && styles.figuresMobile]}>
              <View style={isMobile ? styles.figureColumnMobile : styles.figureColumn}>
                <MoneyInBlock
                  surface="profile"
                  withDonorBreakdown
                  split={committee.split}
                  moneyIn={committee.moneyIn}
                  isBallot={false}
                  stampThrough={through}
                  isMobile={isMobile}
                />
              </View>
              <View style={isMobile ? styles.figureColumnMobile : styles.figureColumn}>
                <MoneyOutBlock
                  surface="profile"
                  moneyOut={committee.moneyOut}
                  stampThrough={through}
                  isMobile={isMobile}
                />
              </View>
            </View>
          </CommitteeDonations>
          <FilingScheduleNote schedule={committee.filingSchedule} year={year} />
          {/* Who checked that this account is this member's, and what they read. At the foot
          of the card and inside it, beside the filing-schedule note and for the same
          reason: it is a statement about this one account rather than about Minnesota
          in general. */}
          <CheckedByBlock checked={committee.checked} />
        </View>
      </View>
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
 * Inside the card and at its foot, because it is a statement about this committee's
 * own reporting duty rather than about Minnesota in general. The fixed paragraph it
 * replaces sat once at the bottom of the tab and recited the state's calendar, so a
 * reader had to work out which half of it applied to the member on screen (#1642).
 *
 * Every sentence and every date comes from `lib/legislatorCampaignMoney.ts`. One
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
  const text = useDetailsStyles();
  const paragraphs = filingScheduleNote(schedule, year);
  if (!paragraphs.length) return null;
  return (
    <View style={styles.block}>
      {paragraphs.map((paragraph) => (
        <Text key={paragraph} style={[text.body, numericText(paragraph)]}>
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
  fetchedAts,
  onRefresh,
}: {
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
      <Text style={[text.small, text.numeric]}>{paymentFilesDownloadedLine(day)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 24 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  h2: {
    fontFamily: t.typography.title,
    fontSize: 30,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.6,
    color: c.text,
  },
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
  block: { gap: 12, marginTop: 8 },
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
  freshness: { gap: 8 },
  cardMobile: committeeCardStyles.mobile,
  cardTablet: committeeCardStyles.tablet,
  figures: {
    flexDirection: 'row',
    gap: 28,
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingTop: 24,
  },
  figuresMobile: { flexDirection: 'column' },
  figureColumn: { flex: 1, minWidth: 0 },
  figureColumnMobile: { minWidth: 0 },
  recordLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  recordLink: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
});
