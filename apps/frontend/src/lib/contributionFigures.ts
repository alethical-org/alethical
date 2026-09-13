/**
 * The 1 rule saying whether a committee-year's Non-itemized contributions figure exists.
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
