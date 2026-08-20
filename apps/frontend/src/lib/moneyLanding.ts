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

import type { MoneyFilingRow } from '../data/types';
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
 * null, and the row carries the report name with no period line.
 */
export function filingPeriodLine(filing: Pick<MoneyFilingRow, 'periodStart' | 'periodEnd'>) {
  if (!filing.periodEnd) return null;
  if (!filing.periodStart) return `covers through ${reportDateLabel(filing.periodEnd)}`;
  return `covers ${reportDateLabel(filing.periodStart)} – ${reportDateLabel(filing.periodEnd)}`;
}

/**
 * The printed ordering sentence, derived from the feed's own `ordered_by`
 * through this one mapping so the words and the order can never drift apart.
 * There is deliberately no filed date anywhere: the Board's catalogue serves
 * none (issue #1670), so the drawn "newest first, by the date filed" sentence
 * would be false and does not ship. An `ordered_by` this mapping does not know
 * prints no sentence rather than a guess.
 */
export function orderingSentence(orderedBy: string): string | null {
  if (orderedBy === 'period_end') return 'Newest first, by the period each report covers';
  return null;
}

/**
 * Why the listed rows are these rows: over a thousand filers can share one
 * period end (1,203 share 20 Jul 2026), and the tie breaks alphabetically. Said
 * plainly so a reader never takes the first rows for the newest or the largest.
 *
 * The count says REPORTS, not committees, and that wording is load-bearing. The
 * served figure is `newest_period.filing_count`, and a committee that corrects a
 * filing files a second report for the same period — 367 of 1,005 catalogued
 * reports carry at least one amendment (#1661), so filings exceed committees by
 * however many corrected. Printing this number beside the word "committees"
 * would overstate how many filers the period covers, which is why the previous
 * version of this sentence could not carry a count at all.
 *
 * The period comes from the same served block as the count, never from anywhere
 * else, so a count can never appear beside a period it does not describe
 * (grounded-answers rule 12: every total states the period it covers).
 */
export function filingsTieSentence(filingCount: number | null): string {
  if (filingCount === null) {
    return 'Every committee that filed for this period is listed alphabetically — the rows shown are the first by name, not the newest and not the largest.';
  }
  return `${filingCount.toLocaleString('en-US')} reports cover this period, listed alphabetically by filer — the rows shown are the first by name, not the newest and not the largest.`;
}

/** Retained for callers that render the feed before a count is served. */
export const FILINGS_TIE_SENTENCE = filingsTieSentence(null);

/**
 * One place that turns a served instant into the day a Minnesotan reads
 * ("Aug 11, 2026"): the reader and the Board are both in Minnesota, so every
 * timestamp on these pages prints in Central time (ruled 19 Aug 2026 — the
 * served 2026-08-12T02:54:22Z is 21:54 on Aug 11 in Central, and Aug 11 is the
 * honest day). Plain dates (a filing period's ends) carry no time and never
 * pass through here.
 */
export function centralDateLabel(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return isoTimestamp;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

/**
 * The Legislators lane's own sentence — the lane is where the promise is made,
 * so it carries the confirmed state in its own words, with both numbers served
 * live (campaign money IA §01).
 */
export function legislatorsLaneSentence(confirmation: {
  confirmed: number;
  total: number;
}): string {
  return (
    `Confirmed for ${formatCount(confirmation.confirmed)} of Minnesota's ` +
    `${formatCount(confirmation.total)} sitting legislators — for the rest, no figures show ` +
    `on a profile.`
  );
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

/** Dated by the newest confirmation in the log (a served instant, printed in
 *  Central time); undated while there is none. */
export function confirmationDateLine(newestConfirmationAt: string | null): string | null {
  return newestConfirmationAt
    ? `Read live from the confirmation log · newest confirmation ${centralDateLabel(newestConfirmationAt)}`
    : null;
}
