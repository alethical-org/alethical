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
 * **The empty state is the tab, not an edge case.** Minnesota never records which
 * person a registered committee belongs to, so a person confirms every match by
 * hand, and on the day this shipped none of the 200 sitting members had been
 * confirmed. So the unconfirmed panel below gets the same care as the populated one:
 * it is what a reader actually sees.
 */
import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { CampaignCommitteeMoney, LegislatorCampaignMoney } from '../../data/types';
import {
  FILING_SCHEDULE_NOTE,
  LINK_UNCONFIRMED_EXPLANATION,
  UNNAMED_MONEY_EXPLANATION,
  type CampaignMoneyYear,
  campaignMoneyYears,
  confirmedElsewhereExplanation,
  emptyStateFor,
  formatDay,
  formatMoney,
  moneyFigure,
  otherOfficeNote,
  paymentCountLabel,
  paymentDateRangeLabel,
  reportedThroughLabel,
  statedSplitNote,
  spendingNote,
  splitExplanation,
  unnamedShareLabel,
} from '../../lib/legislatorCampaignMoney';
import { useLegislatorOutsideSpending } from '../../hooks/useAppQueries';
import { outsideSpendingYears } from '../../lib/outsideSpending';
import { OutsideSpendingCard } from '../legislator/OutsideSpendingCard';
import { UnderDevelopmentNotice } from './UnderDevelopmentNotice';
import { externalLinkProps } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';

/** The Board's own page, which is where every figure on this tab comes from. */
const BOARD_URL = 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/';
/**
 * Where a reader looks this committee's own filed reports up.
 *
 * The Board's viewer takes a search rather than an address per committee, so this is
 * the page and the registration number is printed beside the committee's name for
 * the reader to type in. Deliberately not a guessed deep link: an address that
 * quietly lands on the wrong committee is worse than one extra step.
 */
const BOARD_CANDIDATE_VIEWER =
  'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/';

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
            No committee of theirs covers {year}
          </Text>
          <Text style={styles.body}>{confirmedElsewhereExplanation(year)}</Text>
        </View>
      ) : (
        money.committees.map((committee) => (
          <CommitteeCard
            key={committee.registrationNumber}
            committee={committee}
            year={year}
            isDesktop={isDesktop}
          />
        ))
      )}

      {money && !isLoading && !isError ? (
        <OtherOfficeNote count={money.otherOfficeCommittees} />
      ) : null}

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
}: {
  year: CampaignMoneyYear;
  onSelect: (year: CampaignMoneyYear) => void;
}) {
  return (
    <View style={styles.years} role="group" aria-label="Choose a year">
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
            style={[styles.yearButton, active && styles.yearButtonActive]}
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
  isDesktop,
}: {
  committee: CampaignCommitteeMoney;
  year: CampaignMoneyYear;
  isDesktop: boolean;
}) {
  const name = committee.committeeName || committee.committeeNameAsReviewed;
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>
        {committee.office ? `${committee.office} · ` : ''}
        {year} · REGISTRATION {committee.registrationNumber}
      </Text>
      <Text accessibilityRole="header" aria-level={3} style={styles.h3}>
        {name}
      </Text>

      <MoneyIn committee={committee} isDesktop={isDesktop} />
      <MoneyOut committee={committee} isDesktop={isDesktop} />
    </View>
  );
}

function MoneyIn({
  committee,
  isDesktop,
}: {
  committee: CampaignCommitteeMoney;
  isDesktop: boolean;
}) {
  const { split, moneyIn } = committee;
  const explanation = splitExplanation(split.state);
  const named = moneyIn ? moneyFigure(moneyIn.state, split.namedTotal) : null;
  const reported = formatMoney(split.reportedTotal);
  const unnamed = formatMoney(split.unnamedTotal);
  // Only a real amount earns the goods-and-services line; a filed $0.00 of it is
  // ordinary, not a caveat.
  const inKind = Number(split.namedInKindTotal) > 0 ? formatMoney(split.namedInKindTotal) : null;
  const checkNote = statedSplitNote(split.statedSplitState);

  return (
    <View style={styles.block}>
      <Text accessibilityRole="header" aria-level={4} style={styles.h4}>
        Money in
      </Text>

      {reported ? (
        <>
          <Figure
            // "Reported to the state", never "Raised in total". The two are the
            // same only when the report covers the whole year, and on a member whose
            // report stops in March the second label would be false while the first
            // stays true beside its own coverage date.
            label="Donations this committee reported to the state"
            value={reported}
            note={reportedThroughLabel(split.reportedThrough)}
            isDesktop={isDesktop}
          />
          <SourceLink
            label="This committee’s filed reports, on the state’s own site"
            url={BOARD_CANDIDATE_VIEWER}
          />
        </>
      ) : null}

      {named ? (
        <Figure
          label="Donations with a donor’s name"
          value={named.text}
          isFigure={named.isFigure}
          note={[
            paymentCountLabel(split.namedPayments),
            paymentDateRangeLabel(split.firstPaymentOn, split.lastPaymentOn),
          ]
            .filter(Boolean)
            .join(' · ')}
          isDesktop={isDesktop}
        />
      ) : null}

      {inKind ? (
        // Its own line rather than folded into either figure. It is real money's worth
        // the committee received, and the state's reported total does not carry it, so
        // it can be neither added to that total nor quietly dropped.
        <Text style={styles.explain}>
          {inKind} of the donations above were goods and services rather than money. The state
          counts those separately from the total below.
        </Text>
      ) : null}

      {split.state === 'shown' && unnamed ? (
        <>
          <Figure
            label="Donations with nobody’s name on them"
            value={unnamed}
            note={unnamedShareLabel(split.unnamedTotal, split.reportedTotal)}
            isDesktop={isDesktop}
          />
          <Text style={styles.explain}>{UNNAMED_MONEY_EXPLANATION}</Text>
          {checkNote ? <Text style={styles.explain}>{checkNote}</Text> : null}
        </>
      ) : null}

      {explanation ? <Text style={styles.explain}>{explanation}</Text> : null}

      {moneyIn?.otherReceipts.length ? (
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

      {moneyIn?.sourceUrl ? (
        <SourceLink label="Minnesota’s list of named donations" url={moneyIn.sourceUrl} />
      ) : null}
    </View>
  );
}

function MoneyOut({
  committee,
  isDesktop,
}: {
  committee: CampaignCommitteeMoney;
  isDesktop: boolean;
}) {
  const { moneyOut } = committee;
  if (!moneyOut) return null;
  const total = moneyFigure(moneyOut.state, moneyOut.itemizedPaymentTotal);
  return (
    <View style={styles.block}>
      <Text accessibilityRole="header" aria-level={4} style={styles.h4}>
        Money out
      </Text>
      <Figure
        label="Payments we can list"
        value={total.text}
        isFigure={total.isFigure}
        note={paymentCountLabel(moneyOut.itemizedPayments)}
        isDesktop={isDesktop}
      />
      {/* Two different sentences, because "here is a figure and there is no bigger
          one" and "here is no figure" are two different things to explain. Under
          "Not reported" the first sentence would be explaining a number that is not
          on the screen, and a reader would take the absence as a spending of zero. */}
      <Text style={styles.explain}>{spendingNote(moneyOut.state)}</Text>
      {moneyOut.byType.length ? (
        <View style={styles.rows}>
          {moneyOut.byType.map((entry) => (
            <Row
              key={entry.type}
              label={entry.type}
              value={formatMoney(entry.total) ?? ''}
              note={paymentCountLabel(entry.payments)}
            />
          ))}
        </View>
      ) : null}
      {moneyOut.sourceUrl ? (
        <SourceLink label="Minnesota’s list of payments out" url={moneyOut.sourceUrl} />
      ) : null}
    </View>
  );
}

/**
 * One headline amount with its label and the sentence that dates it.
 *
 * `isFigure` is what stops "Not reported" ever being set in the size reserved for
 * money: a stand-in sentence reads as a sentence, so a reader never scans it as a
 * number they can compare.
 */
function Figure({
  label,
  value,
  note,
  isFigure = true,
  isDesktop,
}: {
  label: string;
  value: string;
  note?: string | null;
  isFigure?: boolean;
  isDesktop: boolean;
}) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text
        style={[
          isFigure ? styles.figureValue : styles.figureStandIn,
          isFigure && isDesktop && styles.figureValueDesktop,
        ]}
      >
        {value}
      </Text>
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
 * figure. The filing-schedule sentence is what stops a September reader seeing
 * "checked today" over figures that stop in July and concluding we are broken.
 */
function FreshnessNote({ fetchedAt }: { fetchedAt: string | null }) {
  const day = formatDay(fetchedAt);
  return (
    <View style={styles.freshness}>
      {day ? (
        <Text style={styles.muted}>
          We last downloaded Minnesota’s campaign finance files on {day}. That is when we checked,
          not the period this money covers.
        </Text>
      ) : null}
      <Text style={styles.muted}>{FILING_SCHEDULE_NOTE}</Text>
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
  h4: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: t.colors.text.secondary,
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
  block: { gap: 12, marginTop: 8 },
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
  figure: { gap: 2 },
  figureLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    color: t.colors.text.secondary,
  },
  figureValue: {
    fontFamily: t.typography.title,
    fontSize: 28,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.5,
    color: t.colors.text.primary,
  },
  figureValueDesktop: { fontSize: 34 },
  // A stand-in sentence, never set in the size money is set in.
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
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
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
  freshness: { gap: 8 },
  years: { flexDirection: 'row', gap: 6 },
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
