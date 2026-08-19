/**
 * What the /money landing is allowed to say (campaign money IA §01;
 * `.claude/rules/grounded-answers.md` rule 12).
 *
 * Framework-free, in the style of lib/billDetail.ts: every sentence and label
 * the landing shows is decided here so tests can pin it. The rules doing the
 * most work:
 *
 * - No lane counts money, and the filings module never shows an amount: a
 *   figure here would be a total summed across members, or a ranking of
 *   filings whose periods differ by months.
 * - A count binds to a live query or does not appear. A pasted count is how a
 *   page once said 1,336 while the register held 1,603.
 * - The donor-threshold sentence is exactly the one rule 12 permits: the test
 *   is on the donor's yearly total, never on the size of one gift.
 */

import type { MoneyLandingFiling } from '../data/types';
import { reportDateLabel } from './moneyReports';

/** The three permanent gaps, shown above anything a reader might search for.
 *  The donor sentence is rule 12's exact wording. */
export const RECORD_DOES_NOT_COVER = [
  'Nothing before 2015.',
  'Unions don’t report to this board at all.',
  'Donors who gave $200 or less in total for the year are never named.',
] as const;

/** "1,603" — grouped the way the register pages print counts. */
export function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

/**
 * A lane card's count line, e.g. "1,603 REGISTERED FILERS". Null when the count
 * is not served: a lane without its live query shows no number at all, never a
 * zero and never a remembered one.
 */
export function laneCountLine(count: number | null, unit: string): string | null {
  if (count === null) return null;
  return `${formatCount(count)} ${unit.toUpperCase()}`;
}

/**
 * The period a filing covers, both ends read off the filing — never an assumed
 * January. Start unresolved → "covers through {end}". Neither end resolved →
 * null, and the row carries the report and the filing date with no period line.
 */
export function filingPeriodLine(filing: Pick<MoneyLandingFiling, 'periodStart' | 'periodEnd'>) {
  if (!filing.periodEnd) return null;
  if (!filing.periodStart) return `covers through ${reportDateLabel(filing.periodEnd)}`;
  return `covers ${reportDateLabel(filing.periodStart)} – ${reportDateLabel(filing.periodEnd)}`;
}

/** "FILED JUL 27, 2026" */
export function filingFiledLine(filing: Pick<MoneyLandingFiling, 'filedOn'>): string {
  return `FILED ${reportDateLabel(filing.filedOn).toUpperCase()}`;
}

/**
 * The confirmation item in the does-not-cover block, rendered only when the
 * confirmation log is actually served — its numbers are read live, never
 * pasted. It exists so an unconfirmed member reads as our gap rather than a
 * member with no money.
 */
export function confirmationLine(confirmation: { confirmed: number; total: number }): string {
  return (
    `All ${formatCount(confirmation.total)} sitting members have a committee registered with the ` +
    `Board. Confirmed as theirs: ${formatCount(confirmation.confirmed)} of ` +
    `${formatCount(confirmation.total)}. Confirming is a person’s job.`
  );
}

/** Dated by the newest confirmation in the log; undated while there is none. */
export function confirmationDateLine(newestConfirmationOn: string | null): string | null {
  return newestConfirmationOn
    ? `Read live from the confirmation log · newest confirmation ${reportDateLabel(newestConfirmationOn)}`
    : null;
}
