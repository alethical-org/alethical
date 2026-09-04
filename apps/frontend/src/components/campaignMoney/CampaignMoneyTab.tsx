/**
 * The Campaign money tab on a legislator's profile (#1329).
 *
 * One component for both the desktop and phone profiles, deliberately. Almost
 * everything on this tab is a sentence about what a figure does and does not mean,
 * and two copies of those sentences is how one of them gets fixed and the other
 * does not. Layout differences ride on `isDesktop`; wording never does.
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

import type { CampaignCommitteeMoney, LegislatorCampaignMoney } from '../../data/types';
import {
  LINK_UNCONFIRMED_EXPLANATION,
  type CampaignMoneyYear,
  campaignMoneyYears,
  confirmedElsewhereExplanation,
  confirmedElsewhereHeading,
  emptyStateFor,
  filingScheduleNote,
  otherOfficeNote,
  severalCommitteesNote,
} from '../../lib/legislatorCampaignMoney';
import { coveredPeriodDetail, coveredPeriodLine, stampThroughDate } from '../../lib/committeeMoney';
import { centralDateLabel } from '../../lib/moneyLanding';
import { useLegislatorOutsideSpending } from '../../hooks/useAppQueries';
import { useResponsive } from '../../hooks/useResponsive';
import { CheckedByBlock, FilingStamp, MoneyInBlock, MoneyOutBlock } from './MoneyCards';
import { outsideSpendingYears } from '../../lib/outsideSpending';
import { OutsideSpendingCard } from '../legislator/OutsideSpendingCard';
import { UnderDevelopmentNotice } from './UnderDevelopmentNotice';
import { externalLinkProps } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';

/** The Board's own page, which is where every figure on this tab comes from. */
const BOARD_URL = 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/';

type Props = {
  legislatorName: string;
  year: CampaignMoneyYear;
  onSelectYear: (year: CampaignMoneyYear) => void;
  money: LegislatorCampaignMoney | undefined;
  isLoading: boolean;
  isError: boolean;
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
  isDesktop,
  legislatorId,
  onOpenSource,
}: Props) {
  // Money others spent about this member, from #1332. Fetched here rather than by the
  // profile screens so a reader who never opens this tab never pays for the request,
  // and so both records sit on one page under one heading. It is a different record
  // from the committee's own money and is never added to it
  // (`docs/architecture/campaign-finance-system-design.md` §3).
  const outsideSpending = useLegislatorOutsideSpending(
    legislatorId,
    outsideSpendingYears(new Date()),
  );

  return (
    <View style={styles.wrap}>
      {/* This tab is the one money surface showing dollar figures, and it is
          still partially built (#1642, #1645, #1650, #1663). Boxed rather than
          full-bleed: the tab opens inside a content column, below the profile
          header and the tab row. */}
      <UnderDevelopmentNotice variant="inset" />

      <View style={styles.head}>
        <Text accessibilityRole="header" aria-level={2} style={styles.h2}>
          Campaign money
        </Text>
        <YearControl year={year} onSelect={onSelectYear} />
      </View>

      {isError ? (
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
      ) : emptyStateFor(money.linkState, money.committees.length) === 'unconfirmed' ? (
        <UnconfirmedPanel />
      ) : emptyStateFor(money.linkState, money.committees.length) === 'confirmed-elsewhere' ? (
        <View style={styles.card}>
          <Text accessibilityRole="header" aria-level={3} style={styles.h3}>
            {confirmedElsewhereHeading(year, money.committeesOutsideThisYear)}
          </Text>
          <Text style={styles.body}>
            {confirmedElsewhereExplanation(year, money.committeesOutsideThisYear)}
          </Text>
        </View>
      ) : (
        <>
          {/* Above the cards, not below: a reader who stops after the first figure
              is exactly the reader who would otherwise add the second one to it. */}
          <SeveralCommitteesNote count={money.committees.length} />
          {money.committees.map((committee) => (
            <CommitteeCard key={committee.registrationNumber} committee={committee} year={year} />
          ))}
        </>
      )}

      {money && !isLoading && !isError ? (
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
      <OutsideSpendingCard
        years={outsideSpending.data ?? []}
        isLoading={outsideSpending.isLoading}
        isError={outsideSpending.isError}
        onOpenSource={onOpenSource}
      />

      <FreshnessNote fetchedAt={money?.fetchedAt ?? null} />
    </View>
  );
}

/**
 * The year switch.
 *
 * Two values only, and each is its own web address, so a figure someone sends to
 * somebody else arrives showing the year they were looking at. Deliberately not a
 * copy of the session pill at the head of Chief-Authored Bills: that pill counts a
 * two-year legislature, and this counts a calendar year, which is the unit
 * Minnesota's own reports use.
 */
export function YearControl({
  year,
  onSelect,
  fullWidth = false,
}: {
  year: CampaignMoneyYear;
  onSelect: (year: CampaignMoneyYear) => void;
  /** Phone band: the years share the row in equal halves rather than sitting as
   *  left-packed pills, which read as a toolbar with room to spare
   *  (`Money committee.dc.html`, rules for this screen). */
  fullWidth?: boolean;
}) {
  return (
    <View
      style={[styles.years, fullWidth && styles.yearsFull]}
      role="group"
      aria-label="Choose a year"
    >
      {campaignMoneyYears().map((option) => {
        const active = option === year;
        return (
          <Pressable
            key={option}
            onPress={() => onSelect(option)}
            accessibilityRole="button"
            // aria-pressed rather than accessibilityState: the second is dropped on
            // the way to the browser, so a screen reader would hear no difference
            // between the year in view and the one beside it.
            aria-pressed={active}
            style={[
              styles.yearButton,
              fullWidth && styles.yearButtonFull,
              active && styles.yearButtonActive,
            ]}
          >
            <Text style={[styles.yearLabel, active && styles.yearLabelActive]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
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
}: {
  committee: CampaignCommitteeMoney;
  year: CampaignMoneyYear;
}) {
  // The money section has one width switch, at 768, and ignores the profile's own
  // 1100 switch: the cards read their band themselves rather than from the host.
  const { isMobile } = useResponsive();
  const name = committee.committeeName || committee.committeeNameAsReviewed;
  // The filing's period and link, once, above both cards — never inside one. The
  // tab's own freshness note at the foot carries the day we copied the files, so the
  // stamp here states the filing's coverage alone.
  const through = stampThroughDate(committee.split, committee.moneyOut);
  const periodStart = committee.moneyIn?.reportedPeriodStart ?? null;
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>
        {committee.office ? `${committee.office} · ` : ''}
        {year} · REGISTRATION {committee.registrationNumber}
      </Text>
      <Text accessibilityRole="header" aria-level={3} style={styles.h3}>
        {name}
      </Text>

      {through ? (
        <FilingStamp
          line={coveredPeriodLine(through, periodStart)}
          detail={coveredPeriodDetail(through, null, { reportedPeriodStart: periodStart })}
          showLink
          covered
          isMobile={isMobile}
        />
      ) : null}

      <MoneyInBlock
        surface="profile"
        split={committee.split}
        moneyIn={committee.moneyIn}
        isBallot={false}
        stampThrough={through}
        isMobile={isMobile}
      />
      <MoneyOutBlock
        surface="profile"
        moneyOut={committee.moneyOut}
        isBallot={false}
        stampThrough={through}
        isMobile={isMobile}
      />
      <FilingScheduleNote schedule={committee.filingSchedule} year={year} />
      {/* Who checked that this account is this member's, and what they read. At the foot
          of the card and inside it, beside the filing-schedule note and for the same
          reason: it is a statement about this one account rather than about Minnesota
          in general. */}
      <CheckedByBlock checked={committee.checked} />
    </View>
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
  const paragraphs = filingScheduleNote(schedule, year);
  if (!paragraphs.length) return null;
  return (
    <View style={styles.block}>
      {paragraphs.map((paragraph) => (
        <Text key={paragraph} style={styles.explain}>
          {paragraph}
        </Text>
      ))}
    </View>
  );
}

function SourceLink({ label, url }: { label: string; url: string }) {
  return (
    <Text style={styles.source} {...externalLinkProps(url, () => void Linking.openURL(url))}>
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
function FreshnessNote({ fetchedAt }: { fetchedAt: string | null }) {
  const day = fetchedAt ? centralDateLabel(fetchedAt) : null;
  if (!day) return null;
  return (
    <View style={styles.freshness}>
      <Text style={styles.muted}>
        We last downloaded Minnesota’s campaign finance files on {day}. That is when we checked, not
        the period this money covers.
      </Text>
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
    color: t.colors.text.primary,
  },
  h3: {
    fontFamily: t.typography.title,
    fontSize: 24,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.4,
    color: t.colors.text.primary,
  },
  eyebrow: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: t.colors.text.muted,
    marginBottom: 6,
  },
  block: { gap: 12, marginTop: 8 },
  card: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    paddingVertical: 28,
    paddingHorizontal: 28,
    gap: 16,
    ...(t.shadows.card as object),
  },
  body: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 26,
    color: t.colors.text.primary,
  },
  muted: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: t.colors.text.muted,
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
  freshness: { gap: 8 },
  years: { flexDirection: 'row', gap: 6 },
  yearsFull: { alignSelf: 'stretch', gap: 8 },
  yearButtonFull: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  yearButton: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    backgroundColor: t.colors.surfaces.base,
  },
  yearButtonActive: {
    backgroundColor: t.colors.brand.base,
    borderColor: t.colors.brand.base,
  },
  yearLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
  yearLabelActive: { color: t.colors.surfaces.base },
});
