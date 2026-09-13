/**
 * The Money in card's contribution rules and the 2 sentences only that card and the chart
 * print.
 *
 * Its own file, and small on purpose. `lib/legislatorCampaignMoney.ts` and
 * `lib/committeeMoneyShared.ts` are both inside the program every reader downloads before
 * anything draws, and nothing that reads this rule is: the money cards, the chart, the
 * on-demand wrapper and the text served without JavaScript all arrive later. Putting it
 * here keeps ~200 bytes off every first page load, including every reader who never opens
 * a money page (`apps/frontend/scripts/check-first-load-budget.mjs`).
 */
/**
 * Whether the Non-itemized contributions figure draws at all.
 *
 * One rule, read by the Money in card, by the chart's dek and by the text served without
 * JavaScript, because those 3 must agree: `.claude/rules/grounded-answers.md` rule 12
 * requires a page carrying both contribution figures to say what the difference between
 * them is, and the sentence saying so now lives in the dek. A page that drew the figure
 * from one condition and its explanation from another could show one without the other.
 *
 * A reported zero is its own state with its own sentence, and no split of nothing.
 */
export function unnamedFigureDraws(split: {
  state: string;
  reportedTotal: string | null;
  namedTotal?: string | null;
  unnamedTotal: string | null;
}): boolean {
  if (split.state !== 'shown' || split.unnamedTotal === null) return false;
  const reportedZero = Number(split.reportedTotal) === 0 && (split.namedTotal ?? null) === null;
  return !reportedZero;
}

/** The heading over the receipt rows that are not contributions — a loan, a public
 *  subsidy, interest. Short because the card heading 2 elements above already says
 *  "Money in", and the rows themselves show that each is reported on its own line
 *  (ruled by Eugene, 2 Sep 2026, in the campaign-money design's copy proposals).
 *
 *  "Contribution", not "donation" (#2182). A donated good or service **is** a donation,
 *  and it sits inside the Itemized contributions figure above rather than under this
 *  heading, so a reader who meets the chart's "not counting donated goods and services"
 *  and then this heading was invited to look for those goods here, where they never are.
 *  Nothing under this heading is a contribution at all: a loan is repaid, a public
 *  subsidy comes from the state, interest comes from a bank. It also matches the 3 rows
 *  above it, every one labelled a contribution, so the reader matches 1 word not 2. */
export const NOT_A_DONATION_HEADING = 'Not a contribution';

/**
 * The one sentence naming how much came as goods and services rather than money.
 *
 * One function, drawn identically wherever it appears, because 3 renderers once wrote it
 * 2 different ways and one of the 2 pointed at a figure that was not there. The wording
 * names what the money is rather than where another figure sits, which is what keeps it
 * correct on the chart, on either money card and in the text served without JavaScript,
 * however any of them is laid out later.
 *
 * `more` is doing real work: this money sits outside the reported contributions figure
 * rather than inside it, so a reader must not add it to anything above (#2182).
 */
export function inKindDonationsNote(amount: string): string {
  return (
    `${amount} more came as goods and services rather than money, which Minnesota ` +
    'counts separately.'
  );
}
