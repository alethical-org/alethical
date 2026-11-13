/**
 * The 2 formatters every money figure and date go through, kept free of imports.
 *
 * They used to live in `legislatorCampaignMoney.ts` beside the money tab's wording,
 * so every screen that printed a single dollar figure (the 5 lobbying screens, the
 * committee page) carried all 34 KB of that module in its own download once shared
 * code stayed with each screen (13 Sep 2026). Nothing about how a figure or a date
 * prints changes here; `legislatorCampaignMoney.ts` re-exports both.
 */

let siteMinusSign = false;

/**
 * Which sign this site prints on a negative figure, set once at start-up.
 * Alethical Finance calls `setNegativeSign('minus')` in its own start-up file
 * (apps/finance/src/moneySign.ts), so every figure its screens format, through
 * any shared helper, reads "−$150" as Finance's design system draws it.
 * alethical.com never calls this, so it keeps the hyphen ("-$150").
 */
export function setNegativeSign(sign: 'minus' | 'hyphen'): void {
  siteMinusSign = sign === 'minus';
}

/**
 * Whole dollars for display, with cents truncated toward zero at every magnitude.
 * Decimal source strings are split before numeric conversion so floating point
 * cannot carry fractions into the whole-dollar value. Exact source data and
 * calculation inputs remain unchanged; calculate totals before formatting them.
 * A displayed $0 does not establish zero activity. Null keeps absence distinct.
 * This shared formatter owns dollar presentation across both products.
 */
export function formatMoney(
  value: number | string | null | undefined,
  {
    minusSign = siteMinusSign,
  }: {
    /** Print a negative figure with the true minus sign (U+2212, "−$150"), as
     * Alethical Finance's design system draws it; alethical.com keeps the hyphen. */
    minusSign?: boolean;
  } = {},
): string | null {
  if (value === null || value === undefined || value === '') return null;
  const decimal = typeof value === 'string' ? /^(-?)(\d+)(?:\.\d+)?$/.exec(value) : null;
  if (decimal) {
    const negative = decimal[1] === '-' && /[1-9]/.test(value as string);
    const sign = negative ? (minusSign ? '\u2212' : '-') : '';
    const whole = decimal[2].replace(/^0+(?=\d)/, '');
    return `${sign}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  }
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) return null;
  const sign = amount < 0 ? (minusSign ? '\u2212' : '-') : '';
  const body = Math.trunc(Math.abs(amount)).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `${sign}$${body}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * An ISO date as "Jul 20, 2026", or `null` if it is not one.
 *
 * Month first, short month, then the day and a comma before the year: the one date
 * form for every date in the money section (approved 2 Sep 2026, campaign-money
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
