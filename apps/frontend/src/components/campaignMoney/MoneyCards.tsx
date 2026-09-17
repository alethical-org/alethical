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
 * Every word here comes from `lib/committeeMoneyShared.ts` or `lib/legislatorCampaignMoney.ts`;
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
 *   e. The unnamed figure with its threshold sentence — when the split is shown. Beside
 *      the chart the sentence moves into the chart's dek, which is then the one place
 *      both contribution labels are explained (#2182); the figure itself stays here.
 *   f. That state's own withheld sentence in (e)'s position — when it is not.
 *   g. "Not a contribution" rows — only when the filing carries other receipt kinds, and
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
 * Beside the shared donor chart, `withDonorBreakdown` lets the chart own the percentage,
 * goods-and-services, withheld-split and contribution-label explanations once. The amount
 * rows stay here.
 * The shared theme supplies the palette and type sizes on profile and committee pages.
 */
import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextProps,
  type TextStyle,
} from 'react-native';

import { BOARD_RECORD_LINK_LABEL, BOARD_RECORD_SENTENCE_TAIL } from '../../lib/boardRecordLink';
import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import {
  inKindDonationsNote,
  NOT_A_DONATION_HEADING,
  unnamedFigureDraws,
} from '../../lib/contributionFigures';

import {
  downloadsPageUrl,
  itemizedContributionsNote,
  MONEY_IN_HEADING,
  MONEY_IN_NAMED_LABEL,
  MONEY_IN_REPORTED_LABEL,
  MONEY_IN_UNNAMED_LABEL,
  MONEY_OUT_HEADING,
  moneyOutSummary,
  NAMED_DONATIONS_LINK_LABEL,
  reportedThroughNote,
  shownReceiptRows,
  unnamedMoneyExplanation,
  ZERO_REPORTED_NOTE,
} from '../../lib/committeeMoneyShared';
import {
  formatDay,
  formatMoney,
  isAmountAboveZero,
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
import { LinkArrow } from '../LinkArrow';
import { theme as t } from '../../theme/tokens';
import { useCampaignMoneyTypography } from './detailsStyles';
import { useResponsive } from '../../hooks/useResponsive';

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

/** Apply the shared palette and responsive type on either money surface. */
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
  };
  return <ProfileCardTheme.Provider value={styles}>{children}</ProfileCardTheme.Provider>;
}

function useCardStyles() {
  return useContext(ProfileCardTheme) ?? defaultStyles;
}

/** Numeric emphasis is a caller's choice, never inferred from digits in prose. */
function CardText({
  children,
  style,
  numeric = false,
  period = false,
  ...props
}: TextProps & {
  numeric?: boolean;
  period?: boolean;
  // Native Text's types omit the web anchor's focus events.
  onFocus?: () => void;
  onBlur?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const profile = useContext(ProfileCardTheme);
  return (
    <Text
      {...props}
      style={[
        { fontVariant: ['tabular-nums'] },
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
 * sentence saying where those dates came from, and the way out to the Board's own
 * record for this committee.
 *
 * `boardRecordUrl` is the address of that committee's own page on the Board's site,
 * and passing null draws no second sentence: the link is inside the sentence, so a
 * state with nothing to link has nothing to say either (design handoff of
 * 13 Sep 2026, items 4 and 5).
 *
 * `ourRecord` is the legislator profile's own row out to everything we hold on the
 * committee, drawn as the panel's last row. The committee page passes none, because
 * that page is what the row points at.
 */
export function FilingStamp({
  surface = 'profile',
  line,
  detail,
  notes = [],
  boardRecordUrl = null,
  ourRecord = null,
  covered,
  isMobile,
}: {
  surface?: MoneyCardSurface;
  line: string | null;
  detail: string;
  notes?: string[];
  boardRecordUrl?: string | null;
  ourRecord?: ReactNode;
  covered: boolean;
} & Band) {
  const styles = useCardStyles();
  const { isTablet } = useResponsive();
  return (
    <View
      testID="campaign-money-period"
      style={[
        styles.stamp,
        isMobile && styles.stampMobile,
        surface === 'committee' && committeeStyles.stamp,
        surface === 'committee' && isTablet && committeeStyles.stampTablet,
        surface === 'committee' && isMobile && committeeStyles.stampMobile,
      ]}
    >
      {line ? (
        <CardText period={covered} style={covered ? styles.stampPeriod : styles.stampPeriodMuted}>
          {line}
        </CardText>
      ) : null}
      {/* 2 sentences, 1 block. The second starts on its own line so the link that
          opens it sits in a fixed place at every width instead of wherever the first
          sentence happens to end, and the 5px is what separates a new sentence from a
          wrap of the old one on a phone. They keep both terminal periods because they
          are prose in one block rather than a stack of standalone lines.
          `numeric` is off: the auto-detector sets weight 800 on any string carrying a
          digit, and the appended download date was making this whole sentence bold. */}
      {detail || boardRecordUrl ? (
        <View style={styles.stampSentences}>
          {detail ? (
            <CardText numeric={false} style={styles.stampDetail}>
              {detail}
            </CardText>
          ) : null}
          {boardRecordUrl ? (
            <CardText numeric={false} style={styles.stampDetail}>
              <InlineBoardRecordLink url={boardRecordUrl} surface={surface} />
              {BOARD_RECORD_SENTENCE_TAIL}
            </CardText>
          ) : null}
        </View>
      ) : null}
      {notes.map((note) => (
        <CardText
          key={note}
          numeric={false}
          style={[styles.stampDetail, { fontWeight: '400', fontVariant: ['tabular-nums'] }]}
        >
          {note}
        </CardText>
      ))}
      {ourRecord}
    </View>
  );
}

/** A sentence link, never padded as a standalone control. Profile links keep their
 * underline; committee links reveal it on hover or keyboard focus. */
function InlineBoardRecordLink({ url, surface }: { url: string; surface: MoneyCardSurface }) {
  const styles = useCardStyles();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <CardText
      numeric={false}
      style={[
        styles.stampDetail,
        styles.inlineLink,
        surface === 'committee' && {
          color: c.link,
          textDecorationLine: hovered || focused ? 'underline' : 'none',
        },
        focused && styles.sourceFocused,
      ]}
      {...externalLinkProps(url, () => void Linking.openURL(url))}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {BOARD_RECORD_LINK_LABEL}
    </CardText>
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
  showSource = true,
}: {
  surface: MoneyCardSurface;
  /** The shared chart already states the split and goods-and-services explanation. */
  withDonorBreakdown?: boolean;
  showSource?: boolean;
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
  const unnamed = unnamedFigureDraws(split) ? formatMoney(split.unnamedTotal) : null;
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
    <View style={[styles.block, surface === 'committee' && isMobile && committeeStyles.phoneBlock]}>
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

      {/* What the itemized figure is, and the naming rule behind it. Drawn only where no
          chart accompanies the card: beside the chart, its dek is the one place both
          contribution labels are explained, and repeating them here would state the same
          rule twice on one screen (#2182). Absent too where the figure itself gives way
          to the filed zero. */}
      {reportedZero || withDonorBreakdown ? null : (
        <CardText style={styles.explain}>{itemizedContributionsNote(isBallot)}</CardText>
      )}

      {inKind && !withDonorBreakdown ? (
        <CardText style={styles.explain}>{inKindDonationsNote(inKind)}</CardText>
      ) : null}

      {unnamed !== null ? (
        <>
          <View
            style={
              surface === 'committee' && isMobile ? committeeStyles.figureExplanation : styles.block
            }
          >
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
            {withDonorBreakdown ? null : (
              <CardText style={styles.explain}>{unnamedMoneyExplanation(isBallot)}</CardText>
            )}
          </View>
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

      {showSource && moneyIn?.sourceUrl ? (
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
    <View style={[styles.block, surface === 'committee' && isMobile && committeeStyles.phoneBlock]}>
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
 * card on both surfaces: the dated check followed by its stored evidence.
 *
 * Renders nothing when the decision carries no stored basis. An absent record is not a
 * weaker record to describe loosely; it is nothing to say.
 */
export function CheckedByBlock({
  checked,
  checkerNamedAbove = false,
  collapsibleEvidence = false,
  evidenceOpen,
  onEvidenceOpenChange,
  children,
}: {
  checked: CommitteeMatchCheck | null | undefined;
  checkerNamedAbove?: boolean;
  collapsibleEvidence?: boolean;
  evidenceOpen?: boolean;
  onEvidenceOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  const styles = useCardStyles();
  const [locallyExpanded, setExpanded] = useState(false);
  const expanded = evidenceOpen ?? locallyExpanded;
  const [focused, setFocused] = useState(false);
  const evidenceId = useId();
  const sentences = matchCheckSentences(checked);
  if (!sentences.length) return children ?? null;
  const [heading, ...evidence] = sentences;
  const evidenceList = evidence.length ? (
    <View role="list" style={styles.checkedItems}>
      {evidence.map((sentence) => (
        <CardText role="listitem" numeric={false} key={sentence} style={styles.checkedSentence}>
          {sentence}
        </CardText>
      ))}
    </View>
  ) : null;
  return (
    <View style={[styles.checked, checkerNamedAbove && { marginTop: 18 }]}>
      <CardText style={styles.checkedHeading}>
        {checkerNamedAbove && checked
          ? `Checked ${formatDay(checked.checkedOn) ?? checked.checkedOn}`
          : heading}
      </CardText>
      {collapsibleEvidence ? children : evidenceList}
      {collapsibleEvidence && evidenceList ? (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={evidenceId}
            onClick={() => {
              setExpanded(!expanded);
              onEvidenceOpenChange?.(!expanded);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minHeight: 44,
              padding: '10px 0',
              border: 0,
              background: 'transparent',
              textAlign: 'left',
              cursor: 'pointer',
              color: c.secondary,
              fontFamily: t.typography.body,
              fontSize: 15,
              fontWeight: 700,
              borderRadius: 8,
              outline: focused ? `2px solid ${c.focus}` : undefined,
              outlineOffset: 2,
            }}
          >
            How Alethical confirmed this
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              style={{ flex: 'none', transform: expanded ? 'rotate(180deg)' : undefined }}
            >
              <path
                d="M6 9 L12 15 L18 9"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div id={evidenceId} hidden={!expanded}>
            {evidenceList}
          </div>
        </>
      ) : null}
      {collapsibleEvidence ? null : children}
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
      aria-level={surface === 'committee' ? 2 : 3}
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
      {/* Label left, figure right, on one baseline (#2182). Stacking them doubled both
          columns' height and lost the alignment down the right edge of the card. */}
      <View style={styles.figureLine}>
        <CardText style={[styles.figureLabel, isMobile && styles.figureLabelMobile]}>
          {label}
        </CardText>
        <CardText
          numeric={isFigure}
          style={
            isFigure
              ? [styles.figureValue, isMobile && styles.figureValueMobile]
              : styles.figureStandIn
          }
        >
          {value}
        </CardText>
      </View>
      {note ? (
        <CardText numeric style={styles.figureNote}>
          {note}
        </CardText>
      ) : null}
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
      <CardText numeric style={styles.rowValue}>
        {value}
      </CardText>
    </View>
  );
}

/** A download source belongs outside the human identity-check evidence. */
export function CampaignDownloadsLink({ sourceUrl }: { sourceUrl: string | null | undefined }) {
  const styles = useCardStyles();
  if (!sourceUrl) return null;
  const url = downloadsPageUrl(sourceUrl);
  return (
    <Pressable
      {...externalLinkProps(url, () => void Linking.openURL(url))}
      style={(state) => [
        styles.downloadLink,
        Boolean('focused' in state && state.focused) && styles.sourceFocused,
      ]}
    >
      <CardText numeric={false} style={styles.downloadLabel}>
        {NAMED_DONATIONS_LINK_LABEL}
        <Text style={{ fontWeight: '400' }}>
          {'\u00a0'}
          <LinkArrow color={c.link} />
        </Text>
      </CardText>
    </Pressable>
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
  figureLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  // A reader-sentence label takes sentence case at 14px computer / 13px phone, weight
  // 600. These stopped being field names when they became sentences, and a tracked
  // mono uppercase version wrapped to 2 lines in a phone column and shouted.
  figureLabel: {
    fontFamily: t.typography.body,
    fontSize: 14,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
    flexShrink: 1,
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
  downloadLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  downloadLabel: { fontFamily: t.typography.body, fontSize: 15, fontWeight: '700', color: c.link },
  stamp: {
    backgroundColor: t.colors.surfaces.s100,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    padding: 18,
    gap: 8,
  },
  stampMobile: { padding: 16 },
  // 5px, against the 8px the stamp's own gap puts between this block and the dated
  // heading above it: enough to read as a new sentence, too little to read as a new
  // paragraph.
  stampSentences: { gap: 5 },
  inlineLink: {
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.base,
    textDecorationLine: 'underline',
    // Web-only, and absent from React Native's style types, so it takes the same
    // cast the shared card shadow does.
    ...({ textUnderlineOffset: 3 } as object),
  },
  stampPeriod: {
    fontFamily: t.typography.body,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    color: c.text,
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
    maxWidth: 680,
  },
  checked: {
    marginTop: 16,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
    gap: 4,
  },
  checkedHeading: {
    fontFamily: t.typography.body,
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    lineHeight: 22.5,
    color: t.colors.text.primary,
  },
  checkedItems: { gap: 4, paddingLeft: 0, ...({ listStyle: 'none' } as object) },
  checkedSentence: {
    fontFamily: t.typography.body,
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22.5,
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
  inlineLink: { ...defaultStyles.inlineLink, color: c.link },
  checked: {
    ...defaultStyles.checked,
    // The committee foot owns the space after the names and before the source link.
    marginTop: 0,
    borderTopColor: t.colors.alpha.ink08,
  },
  checkedHeading: { ...defaultStyles.checkedHeading, color: c.text },
  checkedSentence: { ...defaultStyles.checkedSentence, color: c.secondary },
});

const committeeStyles = StyleSheet.create({
  stamp: {
    backgroundColor: '#f7f8fa',
    paddingVertical: 18,
    paddingHorizontal: 32,
    borderRadius: 14,
  },
  stampTablet: { paddingHorizontal: 26 },
  stampMobile: { paddingHorizontal: 18 },
  phoneBlock: { gap: 20 },
  figureExplanation: { gap: 8 },
});
