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
 *   g. "Not a donation" rows — only when the filing carries other receipt kinds, and
 *      never a `Miscellaneous` row (ruled by Eugene, 11 Sep 2026); the heading goes with
 *      the last row.
 *   h. The source link to the Board's downloads page — whenever a download address is
 *      served, derived from it (`downloadsPageUrl`).
 *
 * Money out shows the filing's own Expenditures figure when held, including zero.
 * Without it, the card shows no amount and says the official total is missing
 * from our records. Calculated payment sums belong beside their rows.
 *
 * The filing's period, identity and link live once in a stamp above both cards, never
 * inside one — one filing produces both cards, so stating any of it per card states one
 * fact twice. A figure's own period note returns only where its coverage date differs
 * from the stamp's (`reportedThroughNote`).
 *
 * On the redesigned profile, `withDonorBreakdown` lets the chart own the percentage,
 * goods-and-services and withheld-split explanation once. The amount rows stay here.
 * The profile theme supplies its palette and type sizes; the committee page keeps its
 * existing styles and full explanation inventory.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Linking, StyleSheet, Text, View, type TextProps, type TextStyle } from 'react-native';

import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';

import {
  downloadsPageUrl,
  FILED_REPORTS_LINK_LABEL,
  inKindDonationsNote,
  itemizedContributionsNote,
  MONEY_IN_HEADING,
  MONEY_IN_NAMED_LABEL,
  MONEY_IN_REPORTED_LABEL,
  MONEY_IN_UNNAMED_LABEL,
  MONEY_OUT_HEADING,
  moneyOutSummary,
  NAMED_DONATIONS_LINK_LABEL,
  NOT_A_DONATION_HEADING,
  reportedThroughNote,
  shownReceiptRows,
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
  splitExplanation,
  statedSplitNote,
  unnamedShareLabel,
  type CommitteeMatchCheck,
  type MoneyBlockState,
  type SplitState,
} from '../../lib/legislatorCampaignMoney';
import { externalLinkProps } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';
import { useCampaignMoneyTypography } from './detailsStyles';

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

/** The served official and named figures are separate claims. */
export interface MoneyOutLike {
  state: MoneyBlockState;
  itemizedPaymentTotal: string | null;
  reportedTotal: string | null;
  reportedThrough: string | null;
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

type CardStyles = { [Key in keyof typeof defaultStyles]: TextStyle };
const ProfileCardTheme = createContext<CardStyles | null>(null);

/** Opt in the profile's shared cards without changing the committee page's styling. */
export function CampaignMoneyCardTheme({ children }: { children: ReactNode }) {
  const type = useCampaignMoneyTypography();
  const small = { fontSize: type.small, lineHeight: type.small * 1.5 };
  const body = { fontSize: type.body, lineHeight: type.body * 1.55 };
  const styles = {
    ...profileStyles,
    headingCommittee: { ...profileStyles.headingCommittee, fontSize: type.h3 },
    headingProfile: { ...profileStyles.headingProfile, ...body },
    explain: { ...profileStyles.explain, ...small },
    figureLabel: { ...profileStyles.figureLabel, ...body },
    figureLabelMobile: { fontSize: type.body },
    // The drawing's compact Money in/out amounts use body size; outside-spending
    // headline totals own the separate 36/32/28px figure scale.
    figureValue: { ...profileStyles.figureValue, ...body },
    figureValueMobile: { fontSize: type.body },
    figureStandIn: { ...profileStyles.figureStandIn, ...small },
    figureNote: { ...profileStyles.figureNote, ...small },
    rowsHead: { ...profileStyles.rowsHead, ...body },
    rowLabel: { ...profileStyles.rowLabel, ...body },
    rowNote: { ...profileStyles.rowNote, ...small },
    rowValue: { ...profileStyles.rowValue, ...body },
    source: { ...profileStyles.source, fontSize: type.small },
    stampPeriodMuted: { ...profileStyles.stampPeriodMuted, ...body },
    stampDetail: { ...profileStyles.stampDetail, ...small },
    checkedSentence: { ...profileStyles.checkedSentence, ...small },
  };
  return <ProfileCardTheme.Provider value={styles}>{children}</ProfileCardTheme.Provider>;
}

function useCardStyles() {
  return useContext(ProfileCardTheme) ?? defaultStyles;
}

/** The profile's date/count lines use the amount face; the period is weight 700. */
function CardText({
  children,
  style,
  numeric = typeof children === 'string' && /\d/.test(children),
  period = false,
  ...props
}: TextProps & {
  numeric?: boolean;
  period?: boolean;
  // Native Text's types omit the web anchor's focus events.
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const profile = useContext(ProfileCardTheme);
  return (
    <Text
      {...props}
      style={[
        style,
        profile && numeric && numericStyles.number,
        profile && period && numericStyles.period,
      ]}
    >
      {children}
    </Text>
  );
}

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
  const styles = useCardStyles();
  return (
    <View style={[styles.stamp, isMobile && styles.stampMobile]}>
      {line ? (
        <CardText period={covered} style={covered ? styles.stampPeriod : styles.stampPeriodMuted}>
          {line}
        </CardText>
      ) : null}
      <CardText style={styles.stampDetail}>{detail}</CardText>
      {notes.map((note) => (
        <CardText key={note} style={styles.stampDetail}>
          {note}
        </CardText>
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
  withDonorBreakdown = false,
}: {
  surface: MoneyCardSurface;
  /** The profile chart already states the split and goods-and-services explanation. */
  withDonorBreakdown?: boolean;
  split: SplitLike;
  moneyIn: MoneyInLike | null;
  isBallot: boolean;
  /** The coverage date the stamp above the cards already states, so a figure's own
   *  note draws only where its date differs. */
  stampThrough: string | null;
} & Band) {
  const styles = useCardStyles();
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
  // (g) without the hidden kind. Filtered here and not in the route mapping, so the
  // served field stays what Minnesota sent and `yearDisplayState` still knows the year
  // holds a filing.
  const receipts = shownReceiptRows(moneyIn?.otherReceipts, (receipt) => receipt.receiptType);

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
        <CardText style={styles.explain}>{ZERO_REPORTED_NOTE}</CardText>
      ) : (
        <Figure
          label={MONEY_IN_NAMED_LABEL}
          value={named.text}
          isFigure={named.isFigure}
          note={
            surface === 'profile' && !withDonorBreakdown
              ? paymentDateRangeLabel(split.firstPaymentOn, split.lastPaymentOn)
              : null
          }
          isMobile={isMobile}
        />
      )}

      {/* What the itemized figure is, directly under it and before the goods-and-services
          line: the one place on the card that states the naming rule (ruled by Eugene,
          11 Sep 2026). Absent only where the figure itself gives way to the filed zero. */}
      {reportedZero ? null : (
        <CardText style={styles.explain}>{itemizedContributionsNote(isBallot)}</CardText>
      )}

      {inKind && !withDonorBreakdown ? (
        <CardText style={styles.explain}>
          {inKindDonationsNote(inKind, surface === 'committee')}
        </CardText>
      ) : null}

      {split.state === 'shown' && unnamed !== null && !reportedZero ? (
        <>
          <Figure
            label={MONEY_IN_UNNAMED_LABEL}
            value={unnamed}
            note={
              surface === 'profile' && !withDonorBreakdown
                ? unnamedShareLabel(split.unnamedTotal, split.reportedTotal)
                : null
            }
            isMobile={isMobile}
          />
          <CardText style={styles.explain}>{unnamedMoneyExplanation(isBallot)}</CardText>
          {checkNote ? <CardText style={styles.explain}>{checkNote}</CardText> : null}
        </>
      ) : null}

      {explanation && !withDonorBreakdown ? (
        <CardText style={styles.explain}>{explanation}</CardText>
      ) : null}

      {receipts.length ? (
        <View style={styles.rows}>
          <CardText style={styles.rowsHead}>{NOT_A_DONATION_HEADING}</CardText>
          {receipts.map((receipt) => (
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
        <SourceLink label={NAMED_DONATIONS_LINK_LABEL} url={downloadsPageUrl(moneyIn.sourceUrl)} />
      ) : null}
    </View>
  );
}

export function MoneyOutBlock({
  surface,
  moneyOut,
  stampThrough,
  isMobile,
}: {
  surface: MoneyCardSurface;
  moneyOut: MoneyOutLike | null;
  stampThrough: string | null;
} & Band) {
  const styles = useCardStyles();
  const summary = moneyOutSummary(moneyOut);

  return (
    <View style={styles.block}>
      <CardHeading surface={surface}>{MONEY_OUT_HEADING}</CardHeading>
      {summary.label && summary.amount !== null ? (
        <Figure
          label={summary.label}
          value={summary.amount}
          isFigure
          note={
            summary.isOfficial ? reportedThroughNote(moneyOut?.reportedThrough, stampThrough) : null
          }
          isMobile={isMobile}
        />
      ) : null}
      {summary.notes.map((note) => (
        <CardText key={note} style={styles.explain}>
          {note}
        </CardText>
      ))}
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
  const styles = useCardStyles();
  const sentences = matchCheckSentences(checked);
  if (!sentences.length) return null;
  return (
    <View style={styles.checked}>
      <CardText style={styles.checkedLabel}>{MATCH_CHECK_LABEL.toUpperCase()}</CardText>
      {sentences.map((sentence) => (
        <CardText key={sentence} style={styles.checkedSentence}>
          {sentence}
        </CardText>
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
  const styles = useCardStyles();
  return (
    <CardText
      accessibilityRole="header"
      aria-level={surface === 'committee' ? 2 : 4}
      style={surface === 'committee' ? styles.headingCommittee : styles.headingProfile}
    >
      {children}
    </CardText>
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
  const styles = useCardStyles();
  return (
    <View style={styles.figure}>
      <CardText style={[styles.figureLabel, isMobile && styles.figureLabelMobile]}>
        {label}
      </CardText>
      <CardText
        style={
          isFigure
            ? [styles.figureValue, isMobile && styles.figureValueMobile]
            : styles.figureStandIn
        }
      >
        {value}
      </CardText>
      {note ? <CardText style={styles.figureNote}>{note}</CardText> : null}
    </View>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string | null }) {
  const styles = useCardStyles();
  return (
    <View style={styles.row}>
      <CardText numeric={/\d/.test(`${label}${note ?? ''}`)} style={styles.rowLabel}>
        {label}
        {note ? (
          <CardText numeric={/\d/.test(note)} style={styles.rowNote}>
            {' '}
            · {note}
          </CardText>
        ) : null}
      </CardText>
      <CardText style={styles.rowValue}>{value}</CardText>
    </View>
  );
}

function SourceLink({ label, url }: { label: string; url: string }) {
  const styles = useCardStyles();
  const [focused, setFocused] = useState(false);
  return (
    <CardText
      style={[styles.source, focused && styles.sourceFocused]}
      {...externalLinkProps(url, () => void Linking.openURL(url))}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {label}
    </CardText>
  );
}

const defaultStyles = StyleSheet.create({
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
  sourceFocused: {},
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

const numericStyles = StyleSheet.create({
  number: { fontFamily: t.typography.body, fontWeight: '800', fontVariant: ['tabular-nums'] },
  period: { fontFamily: t.typography.body, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

// Keep the default shared styles intact: this palette applies only inside the
// profile wrapper, including nested figures, sources and the checked-by footer.
const profileStyles = StyleSheet.create({
  ...defaultStyles,
  headingCommittee: { ...defaultStyles.headingCommittee, color: c.text },
  headingProfile: {
    ...defaultStyles.headingProfile,
    color: c.text,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'none',
  },
  explain: { ...defaultStyles.explain, color: c.secondary },
  figureLabel: { ...defaultStyles.figureLabel, color: c.secondary },
  figureValue: { ...defaultStyles.figureValue, ...numericStyles.number, color: c.text },
  figureStandIn: { ...defaultStyles.figureStandIn, color: c.muted },
  figureNote: { ...defaultStyles.figureNote, color: c.muted },
  rowsHead: { ...defaultStyles.rowsHead, color: c.text, fontWeight: '800' },
  rowLabel: { ...defaultStyles.rowLabel, color: c.text },
  rowNote: { ...defaultStyles.rowNote, color: c.muted },
  rowValue: { ...defaultStyles.rowValue, ...numericStyles.number, color: c.text },
  source: {
    ...defaultStyles.source,
    color: c.link,
    minHeight: 44,
    lineHeight: 22,
    paddingVertical: 11,
  },
  sourceFocused: {
    outlineColor: c.focus,
    outlineWidth: 2,
    outlineStyle: 'solid',
    outlineOffset: 2,
  },
  stamp: { ...defaultStyles.stamp, backgroundColor: c.tile, borderColor: c.border },
  stampPeriod: {
    ...defaultStyles.stampPeriod,
    ...numericStyles.period,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.2,
    color: c.text,
  },
  stampPeriodMuted: { ...defaultStyles.stampPeriodMuted, color: c.secondary },
  stampDetail: { ...defaultStyles.stampDetail, color: c.secondary },
  checked: { ...defaultStyles.checked, borderTopColor: c.border },
  checkedLabel: { ...defaultStyles.checkedLabel, color: c.muted },
  checkedSentence: { ...defaultStyles.checkedSentence, color: c.secondary },
});
