/**
 * The 2 formatters every money figure and date go through, kept free of imports.
 *
 * They used to live in `legislatorCampaignMoney.ts` beside the money tab's wording,
 * so every screen that printed a single dollar figure (the 5 lobbying screens, the
 * committee page) carried all 34 KB of that module in its own download once shared
 * code stayed with each screen (13 Sep 2026). Nothing about how a figure or a date
 * prints changes here; `legislatorCampaignMoney.ts` re-exports both.
 */

/**
 * A money amount as a reader would check it against the filing.
 *
 * **Whole dollars, and the cents are CUT rather than rounded.** $178,579,449.67
 * prints as $178,579,449 and $99.99 prints as $99, so a figure on this product can
 * never read larger than the money it stands for. Rounding would break that on half
 * of all values, and reading high about a named politician's money is the direction
 * that does damage. Cents on a 6-figure total are noise a reader steps over, and the
 * filed amount to the cent is one click away on the Board's own site, which every
 * money card links to.
 *
 * The one exception is an amount above zero but under a dollar, which keeps its
 * cents: a 50-cent row printed as "$0" reads as a reported zero, and
 * `.claude/rules/grounded-answers.md` rule 12 separates a missing value from a
 * verified zero precisely so that no page invents one. Truncation is what creates
 * that hazard, so the exception belongs to the truncation rather than to taste.
 *
 * Returns `null` for a value that is absent, so a caller has to decide what absence
 * means rather than being handed a "$0" it did not ask for.
 *
 * **This is the only money formatter in the product, and that is load-bearing.** The
 * outside-spending card kept a second one until
 * [#1929](https://github.com/alethical-org/alethical/issues/1929), and the 2 drifted
 * the moment this rule changed: one card on the legislator money tab printed cents
 * while the cards above it printed whole dollars. A new caller formats money by
 * calling this, never by writing its own.
 *
 * **No carry can reach the dollars, at either end of the range.** The source columns
 * carry 4 decimal places, so a filing really can hold 1.9999, and splitting a value
 * into dollars and cents to round them separately loses the carry between the halves —
 * that is what once printed the malformed "$1.100" (#1332). Truncation cannot: one
 * `Math.floor` over the whole magnitude never carries anything upward, and the
 * under-a-dollar branch clamps at 99 cents so it cannot produce "$0.100" either. Both
 * ends and the negative case are pinned by tests.
 *
 * Ruled by Eugene on 1 Sep 2026, and applied by Design across all 21 drawings in the
 * campaign-money set ([#1924](https://github.com/alethical-org/alethical/issues/1924)).
 */
export function formatMoney(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) return null;
  const negative = amount < 0;
  const magnitude = Math.abs(amount);
  // Under a dollar and not zero: keep the cents, or the row reads as a filed zero.
  //
  // Cut to the cent rather than rounded to it, for the same reason the dollars are:
  // `toFixed(2)` turns 0.999 into "1.00", which both reads higher than the money and
  // prints a dollar figure inside the branch reserved for values under a dollar.
  //
  // Rounded to the source's own 4 decimal places BEFORE truncating, because binary
  // floating point makes 0.29 * 100 come out as 28.999999999999996 and a bare floor
  // would print $0.28 for a 29-cent payment. Clamped at 99 so a value just under a
  // dollar truncates to $0.99 rather than overflowing the branch.
  if (magnitude > 0 && magnitude < 1) {
    const cents = Math.min(99, Math.floor(Math.round(magnitude * 10000) / 100));
    return `${negative ? '-' : ''}$0.${String(cents).padStart(2, '0')}`;
  }
  // `Math.floor` on the magnitude rather than on the signed amount: flooring -0.5
  // gives -1, which is further from zero, and the rule is that no figure may read
  // larger than it is in either direction.
  const body = Math.floor(magnitude).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `${negative ? '-' : ''}$${body}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * An ISO date as "Jul 20, 2026", or `null` if it is not one.
 *
 * Month first, short month, then the day and a comma before the year: the one date
 * form for every date in the money section (ruled by Eugene, 2 Sep 2026, campaign-money
 * design copy proposal 6). An uppercased label keeps the same order ("PAID JUL 20, 2026"),
 * and a plain date never passes through a time zone; a served instant goes through
 * `centralDateLabel` in `moneyLanding.ts` instead.
 *
 * Split on the string rather than parsed through `Date`, because `new Date('2026-07-20')`
 * is UTC midnight and prints as the 19th anywhere west of Greenwich — which is
 * everywhere this product is read. A date that is off by one on a filing period is
 * the kind of wrong number nobody notices.
 */
export function formatDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return null;
  return `${month} ${Number(match[3])}, ${match[1]}`;
}
