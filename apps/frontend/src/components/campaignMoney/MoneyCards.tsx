/**
 * The 2 money cards — money in, money out — drawn on both surfaces from 1 component.
 *
 * A committee's own page (`/money/committees/<name>-<number>`) and the Campaign money
 * tab on a confirmed legislator's profile show the same filing's money, and until this
 * file each drew its own copy of the cards. The copies drifted: one printed "Not
 * reported" in the reported-total slot the design leaves empty, one could leave the
 * named figure off entirely, and each labelled money out's category rows differently.
 * One component means a fix to a sentence lands on both pages at once.
 *
 * Every word here comes from `lib/committeeMoney.ts` or `lib/legislatorCampaignMoney.ts`;
 * this file chooses where things sit and nothing about what they claim. The 8-element
 * inventory it draws (campaign-money design, master prompt of 1 Sep 2026, PART 1 item 2;
 * `.claude/rules/grounded-answers.md` rule 12):
 *
 *   a. Heading — always.
 *   b. The filing's own reported total — only when the filing's total exists. Never a
 *      "Not reported" stand-in in its slot: the withheld sentence below already says so.
 *   c. The named figure — ALWAYS present: a real amount, or the words "Not reported"
 *      set as words and never in the amount face. Never blank.
 *   d. The goods-and-services line — only when named payments include some above zero.
 *   e. The unnamed figure with its threshold sentence — when the split is shown.
 *   f. That state's own withheld sentence in (e)'s position — when it is not.
 *   g. "Not a donation" rows — only when the filing carries other receipt kinds.
 *   h. The source link to the state's own list — whenever served.
 *
 * Money out is 2 figures plus the filing's own category rows. No third figure and no
 * bar: an unnamed money-out figure would be the subtraction the card's own sentence says
 * we never perform, and a bar measured against the reported total performs it in a
 * picture.
 *
 * The filing's period, identity and link live once in a stamp above both cards, never
 * inside one — one filing produces both cards, so stating any of it per card states one
 * fact twice. A figure's own period note returns only where its coverage date differs
 * from the stamp's (`reportedThroughNote`).
 *
 * The 2 surfaces differ in exactly 3 deliberate ways, each carried by `surface`:
 * the percentage note under the unnamed figure is profile-only (it is an annotation on a
 * named person's money, and the committee page is about the committee); the
 * goods-and-services line names the row marker on the committee page, where the rows
 * below carry it, and not on the profile, where they do not; and money out's explaining
 * sentence is each surface's own (`moneyOutNote` / `spendingNote`), because the committee
 * page knows a ballot-question filer and the profile never draws one.
 */
import { Linking, StyleSheet, Text, View } from 'react-native';

import {
  FILED_REPORTS_LINK_LABEL,
  inKindDonationsNote,
  inKindOutNote,
  listedExceedsReported,
  MONEY_IN_HEADING,
  MONEY_IN_NAMED_LABEL,
  MONEY_IN_REPORTED_LABEL,
  MONEY_IN_UNNAMED_LABEL,
  MONEY_OUT_FIGURE_LABEL,
  MONEY_OUT_HEADING,
  MONEY_OUT_REPORTED_LABEL,
  moneyOutKindLabel,
  moneyOutNote,
  NAMED_DONATIONS_LINK_LABEL,
  NOT_A_DONATION_HEADING,
  PAYMENTS_OUT_LINK_LABEL,
  reportedThroughNote,
  statedSpendingNote,
  unnamedMoneyExplanation,
  ZERO_REPORTED_NOTE,
} from '../../lib/committeeMoney';
import {
  formatMoney,
  isAmountAboveZero,
  MATCH_CHECK_LABEL,
  matchCheckSentences,
  moneyFigure,
  paymentCountLabel,
  paymentDateRangeLabel,
  spendingNote,
  splitExplanation,
  statedSplitNote,
  UNNAMED_MONEY_EXPLANATION,
  unnamedShareLabel,
  type CommitteeMatchCheck,
  type MoneyBlockState,
  type SplitState,
} from '../../lib/legislatorCampaignMoney';
import { externalLinkProps } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';

/** The Board's own lookup page. A search, not a per-committee address — a guessed
 *  deep link that lands on the wrong committee is worse than one extra step. */
export const BOARD_VIEWER =
  'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/';

export type MoneyCardSurface = 'committee' | 'profile';

/** The parts of a served money-in block the cards read. Structural, so the committee
 *  route's block and the profile route's block both fit without a mapping. */
export interface MoneyInLike {
  state: MoneyBlockState;
  otherReceipts: readonly { receiptType: string; total: string; payments: number }[];
  sourceUrl: string | null;
}

export interface MoneyOutLike {
  state: MoneyBlockState;
  itemizedPaymentTotal: string | null;
  inKindTotal: string | null;
  reportedTotal: string | null;
  reportedThrough: string | null;
  statedSpendingState: string;
  byType: readonly { type: string; total: string; payments: number }[];
  sourceUrl: string | null;
}

export interface SplitLike {
  state: SplitState;
  reportedTotal: string | null;
  reportedThrough: string | null;
  namedTotal: string | null;
  namedInKindTotal: string | null;
  unnamedTotal: string | null;
  statedSplitState: string;
  firstPaymentOn: string | null;
  lastPaymentOn: string | null;
}

type Band = { isMobile: boolean };

/**
 * The filing's facts, once, above both cards: the period its figures cover, the
 * sentence saying how that period was read, and the link to the filing on the Board's
 * own site. `link` is drawn only when a filing exists to open; the committee page's
 * empty and closed years pass none.
 */
export function FilingStamp({
  line,
  detail,
  notes = [],
  showLink,
  covered,
  isMobile,
}: {
  line: string | null;
  detail: string;
  notes?: string[];
  showLink: boolean;
  covered: boolean;
} & Band) {
  return (
    <View style={[styles.stamp, isMobile && styles.stampMobile]}>
      {line ? (
        <Text style={covered ? styles.stampPeriod : styles.stampPeriodMuted}>{line}</Text>
      ) : null}
      <Text style={styles.stampDetail}>{detail}</Text>
      {notes.map((note) => (
        <Text key={note} style={styles.stampDetail}>
          {note}
        </Text>
      ))}
      {showLink ? <SourceLink label={FILED_REPORTS_LINK_LABEL} url={BOARD_VIEWER} /> : null}
    </View>
  );
}

export function MoneyInBlock({
  surface,
  split,
  moneyIn,
  isBallot,
  stampThrough,
  isMobile,
}: {
  surface: MoneyCardSurface;
  split: SplitLike;
  moneyIn: MoneyInLike | null;
  isBallot: boolean;
  /** The coverage date the stamp above the cards already states, so a figure's own
   *  note draws only where its date differs. */
  stampThrough: string | null;
} & Band) {
  const reported = formatMoney(split.reportedTotal);
  // (c) draws whatever the block's state: a null block on the profile is a committee
  // the downloads hold no row for, and "Not reported" is what that reads as.
  const named = moneyFigure(moneyIn?.state ?? 'not_reported', split.namedTotal);
  const unnamed = split.state === 'shown' ? formatMoney(split.unnamedTotal) : null;
  // Only a real amount earns the goods-and-services line; a filed $0.00 of it is
  // ordinary, not a caveat. Read through the shared helper rather than `Number()`:
  // turning a committee's amount into a number is the first step of the combined
  // figure #1663 forbids, so it happens in one place the whole app can be checked
  // against.
  const inKind = isAmountAboveZero(split.namedInKindTotal)
    ? formatMoney(split.namedInKindTotal)
    : null;
  // A reported zero is a verified zero: the total draws as $0 and its own sentence
  // carries the story, with no named/unnamed division of nothing.
  const reportedZero =
    split.state === 'shown' && Number(split.reportedTotal) === 0 && split.namedTotal === null;
  const explanation = splitExplanation(split.state);
  const checkNote = statedSplitNote(split.statedSplitState);

  return (
    <View style={styles.block}>
      <CardHeading surface={surface}>{MONEY_IN_HEADING}</CardHeading>

      {reported ? (
        <Figure
          label={MONEY_IN_REPORTED_LABEL}
          value={reported}
          note={reportedThroughNote(split.reportedThrough, stampThrough)}
          isMobile={isMobile}
        />
      ) : null}

      {reportedZero ? (
        <Text style={styles.explain}>{ZERO_REPORTED_NOTE}</Text>
      ) : (
        <Figure
          label={MONEY_IN_NAMED_LABEL}
          value={named.text}
          isFigure={named.isFigure}
          note={
            surface === 'profile'
              ? paymentDateRangeLabel(split.firstPaymentOn, split.lastPaymentOn)
              : null
          }
          isMobile={isMobile}
        />
      )}

      {inKind ? (
        <Text style={styles.explain}>{inKindDonationsNote(inKind, surface === 'committee')}</Text>
      ) : null}

      {split.state === 'shown' && unnamed !== null && !reportedZero ? (
        <>
          <Figure
            label={MONEY_IN_UNNAMED_LABEL}
            value={unnamed}
            note={
              surface === 'profile'
                ? unnamedShareLabel(split.unnamedTotal, split.reportedTotal)
                : null
            }
            isMobile={isMobile}
          />
          <Text style={styles.explain}>
            {surface === 'committee'
              ? unnamedMoneyExplanation(isBallot)
              : UNNAMED_MONEY_EXPLANATION}
          </Text>
          {checkNote ? <Text style={styles.explain}>{checkNote}</Text> : null}
        </>
      ) : null}

      {explanation ? <Text style={styles.explain}>{explanation}</Text> : null}

      {moneyIn?.otherReceipts.length ? (
        <View style={styles.rows}>
          <Text style={styles.rowsHead}>{NOT_A_DONATION_HEADING}</Text>
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
        <SourceLink label={NAMED_DONATIONS_LINK_LABEL} url={moneyIn.sourceUrl} />
      ) : null}
    </View>
  );
}

export function MoneyOutBlock({
  surface,
  moneyOut,
  isBallot,
  stampThrough,
  isMobile,
}: {
  surface: MoneyCardSurface;
  moneyOut: MoneyOutLike | null;
  isBallot: boolean;
  stampThrough: string | null;
} & Band) {
  const state: MoneyBlockState = moneyOut?.state ?? 'not_reported';
  const total = moneyFigure(state, moneyOut?.itemizedPaymentTotal ?? null);
  const reportedOut = formatMoney(moneyOut?.reportedTotal ?? null);
  const inKindOut = inKindOutNote(moneyOut?.inKindTotal ?? null);
  const spendingCheck = moneyOut ? statedSpendingNote(moneyOut.statedSpendingState) : null;
  // Each surface's own explaining sentence. The committee page's knows a
  // ballot-question filer and whether our list is the larger figure; the profile's
  // is the set written for a legislator's committee, which is never a ballot one.
  const note =
    surface === 'committee'
      ? moneyOutNote(
          state,
          isBallot,
          reportedOut !== null,
          Number(moneyOut?.reportedTotal) === 0,
          listedExceedsReported(moneyOut?.reportedTotal, moneyOut?.itemizedPaymentTotal),
        )
      : spendingNote(state, reportedOut !== null);

  return (
    <View style={styles.block}>
      <CardHeading surface={surface}>{MONEY_OUT_HEADING}</CardHeading>
      {reportedOut ? (
        <Figure
          label={MONEY_OUT_REPORTED_LABEL}
          value={reportedOut}
          note={reportedThroughNote(moneyOut?.reportedThrough, stampThrough)}
          isMobile={isMobile}
        />
      ) : null}
      <Figure
        label={MONEY_OUT_FIGURE_LABEL}
        value={total.text}
        isFigure={total.isFigure}
        isMobile={isMobile}
      />
      {/* Directly under the figure it qualifies, the same place money in draws its
          own goods-and-services line, because a reader shown a payments total reads
          all of it as cash the committee spent (#1894). Absent whenever the amount is
          not above zero. */}
      {inKindOut ? <Text style={styles.explain}>{inKindOut}</Text> : null}
      <Text style={styles.explain}>{note}</Text>
      {/* After the note it qualifies: the note says what the 2 figures are, and this
          says whether anybody checked them against the committee's own filing. Null on
          `agrees`, so a checked committee-year draws plainly (#1650). */}
      {spendingCheck ? <Text style={styles.explain}>{spendingCheck}</Text> : null}
      {/* The filing's own category rows, with the plain label for money given to
          another campaign. Real categories from the filing, never arithmetic of ours,
          so they draw in every state that has them. */}
      {moneyOut?.byType.length ? (
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
      {moneyOut?.sourceUrl ? (
        <SourceLink label={PAYMENTS_OUT_LINK_LABEL} url={moneyOut.sourceUrl} />
      ) : null}
    </View>
  );
}

/**
 * What a person read before attaching this account to a member, at the foot of the
 * card on both surfaces (rule D6 of the campaign-money phone-band sheet: a hairline
 * above, a mono label, 16px of space, and the sentences a step under body size).
 *
 * Renders nothing when the decision carries no stored basis. An absent record is not a
 * weaker record to describe loosely; it is nothing to say.
 */
export function CheckedByBlock({ checked }: { checked: CommitteeMatchCheck | null | undefined }) {
  const sentences = matchCheckSentences(checked);
  if (!sentences.length) return null;
  return (
    <View style={styles.checked}>
      <Text style={styles.checkedLabel}>{MATCH_CHECK_LABEL.toUpperCase()}</Text>
      {sentences.map((sentence) => (
        <Text key={sentence} style={styles.checkedSentence}>
          {sentence}
        </Text>
      ))}
    </View>
  );
}

export function CardHeading({
  surface,
  children,
}: {
  surface: MoneyCardSurface;
  children: string;
}) {
  return (
    <Text
      accessibilityRole="header"
      aria-level={surface === 'committee' ? 2 : 4}
      style={surface === 'committee' ? styles.headingCommittee : styles.headingProfile}
    >
      {children}
    </Text>
  );
}

/**
 * One headline amount with its label and, rarely, the sentence that dates it.
 *
 * `isFigure` is what stops "Not reported" ever being set in the size reserved for
 * money: a stand-in reads as words, so a reader never scans it as a number they can
 * compare.
 */
export function Figure({
  label,
  value,
  note,
  isFigure = true,
  isMobile,
}: {
  label: string;
  value: string;
  note?: string | null;
  isFigure?: boolean;
} & Band) {
  return (
    <View style={styles.figure}>
      <Text style={[styles.figureLabel, isMobile && styles.figureLabelMobile]}>{label}</Text>
      <Text
        style={
          isFigure
            ? [styles.figureValue, isMobile && styles.figureValueMobile]
            : styles.figureStandIn
        }
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

const styles = StyleSheet.create({
  block: { gap: 14 },
  headingCommittee: {
    fontFamily: t.typography.title,
    fontSize: 21,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.2,
    color: t.colors.text.primary,
  },
  headingProfile: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: t.colors.text.secondary,
  },
  explain: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  figure: { gap: 2 },
  // A reader-sentence label takes sentence case at 14px computer / 13px phone, weight
  // 600. These stopped being field names when they became sentences, and a tracked
  // mono uppercase version wrapped to 2 lines in a phone column and shouted.
  figureLabel: {
    fontFamily: t.typography.body,
    fontSize: 14,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  figureLabelMobile: { fontSize: 13 },
  // Every dollar figure shares one face: the big-total font, never the mono that
  // stays for dates, registration numbers and labels (ruled 1 Sep 2026, #1924).
  figureValue: {
    fontFamily: t.typography.title,
    fontSize: 32,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.5,
    color: t.colors.text.primary,
  },
  figureValueMobile: { fontSize: 28 },
  // A stand-in sentence, never set in the size money is set in.
  figureStandIn: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
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
    alignSelf: 'flex-start',
  },
  stamp: {
    backgroundColor: t.colors.surfaces.s100,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    padding: 18,
    gap: 8,
  },
  stampMobile: { padding: 16 },
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
  // Rule D6: a hairline above, a mono label, 16px of real space, and the sentences a
  // step under body size so the reader meets them as provenance rather than argument.
  checked: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
    gap: 4,
  },
  checkedLabel: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
    color: t.colors.text.secondary,
    marginBottom: 4,
  },
  checkedSentence: {
    fontFamily: t.typography.body,
    fontSize: 15.5,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
});
