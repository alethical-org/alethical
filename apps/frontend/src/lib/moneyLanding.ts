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
import { isoDateLabel } from './research';

/** The three permanent gaps, shown above anything a reader might search for.
 *  The donor sentence is rule 12's exact wording. It says a small donor NEED NOT
 *  be named, never that they are not: the $200 test is a floor on who a committee
 *  must name, and nothing stops one naming a smaller donor (#1755).
 *
 *  No terminal full stop on any of the 3 (ruled 1 Sep 2026, #1924): each stands on
 *  its own line, and the same block on a committee page is worded identically. */
export const RECORD_DOES_NOT_COVER = [
  'Nothing before 2015',
  'Unions don’t report to this board at all',
  'Donors who gave $200 or less in total for the year need not be named',
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
  if (!filing.periodStart) return `covers through ${isoDateLabel(filing.periodEnd)}`;
  return `covers ${isoDateLabel(filing.periodStart)} – ${isoDateLabel(filing.periodEnd)}`;
}

/**
 * The printed ordering sentence, derived from the feed's own `ordered_by`
 * through this one mapping so the words and the order can never drift apart.
 *
 * The drawn "newest first, by the date filed" sentence still does not ship even
 * now that filing dates are held (issue #1670): the Board serves no readable
 * report document for most reports before 2023, so the feed is normally a mix,
 * and a flat "by the date filed" would be false about every undated row. The
 * mixed sentence says which rows are which. An `ordered_by` this mapping does
 * not know prints no sentence rather than a guess.
 */
export function orderingSentence(orderedBy: string): string | null {
  if (orderedBy === 'period_end') return 'Newest first, by the period each report covers';
  if (orderedBy === 'filed_date_then_period_end') {
    return (
      'Newest first — by the day the Board received a report where its filing says so, ' +
      'and by the period it covers where it does not'
    );
  }
  return null;
}

/**
 * Why the listed rows are these rows, which depends on the order the feed served.
 *
 * **The alphabetical wording is only true while no row carries a filing date.**
 * Over a thousand filers share one period end (1,203 share 20 Jul 2026), so with
 * nothing else to sort by the tie breaks on the name and the first rows are simply
 * the first by name. Once filing dates are held (#1670) the dated rows genuinely
 * are the ones that arrived most recently, and calling them "the first by name,
 * not the newest" would be false about exactly the rows a reader is looking at. So
 * `orderedBy` picks the sentence, from the same served value the ordering sentence
 * derives from.
 *
 * **"Not the largest" survives both wordings and is the load-bearing half.** No row
 * carries an amount and nothing here ever sorts by one; 5 rows with 5 dollar
 * figures would read as a ranking whether anyone sorted them or not.
 *
 * The count says REPORTS, not committees, and that wording is load-bearing too. The
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
export function filingsTieSentence(filingCount: number | null, orderedBy = ''): string {
  if (orderedBy === 'filed_date_then_period_end') {
    // A full stop rather than a second "and". Joined with one, the live sentence read
    // "...cover this period, and the rows shown are..., and a report it states no date
    // for...", which is 2 "and" clauses in a row and hard to follow on one read. "the
    // Board" rather than "it", because the nearest noun to that pronoun was the period.
    const arrival =
      'The rows shown are the ones the Board received most recently, and a report the ' +
      'Board states no date for sits by the period it covers instead — never the largest.';
    if (filingCount === null) {
      return `Every committee that filed for this period is listed. ${arrival}`;
    }
    return `${filingCount.toLocaleString('en-US')} reports cover this period. ${arrival}`;
  }
  if (filingCount === null) {
    return 'Every committee that filed for this period is listed alphabetically — the rows shown are the first by name, not the newest and not the largest.';
  }
  return `${filingCount.toLocaleString('en-US')} reports cover this period, listed alphabetically by filer — the rows shown are the first by name, not the newest and not the largest.`;
}

/**
 * "filed Jul 24, 2026", or null on a row the Board states no filing date for.
 *
 * Null prints nothing at all. The tempting alternative — falling back to the period
 * end — is the fabricated fact #1670 exists to prevent, and the row still shows its
 * period, so nothing is hidden except the one claim we cannot make.
 */
export function filedDateSentence(filedDate: string | null | undefined): string | null {
  if (!filedDate) return null;
  return `filed ${isoDateLabel(filedDate)}`;
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
 * live (campaign money IA §01). It is the LAST sentence of a card description, so
 * it ends bare (copy rule C, 1 Sep 2026); `legislatorsLaneBody` supplies the full
 * stop that separates it from the sentence before it.
 *
 * This is the one place the landing states the confirmed count. The does-not-cover
 * block used to state it a second time, with its own dated footnote; that copy came
 * out under copy rule A (a fact once per surface).
 */
export function legislatorsLaneSentence(confirmation: {
  confirmed: number;
  total: number;
}): string {
  return (
    `Confirmed for ${formatCount(confirmation.confirmed)} of Minnesota's ` +
    `${formatCount(confirmation.total)} sitting legislators — for the rest, no figures show ` +
    `on a profile`
  );
}

// --- The landing's own fixed wording ----------------------------------------

/**
 * The heading, the sentence under it, and the 2 lane cards that lead somewhere.
 *
 * These lived as literals inside `screens/redesign/MoneyLandingScreen.tsx` until
 * the first server response started carrying the landing's own text (#1812). They
 * are here now for the same reason the /reading page's wording moved into
 * `lib/research.ts`: the served page and the drawn page must be the same words,
 * and 2 copies of a sentence is how one gets fixed and the other does not.
 *
 * All 3 lane cards live here now. The "Who got paid" card was inert until #1780,
 * because the design set draws no browse-all-payees list and its card promised
 * one; it now opens the name search, which is the only honest way in — see
 * MONEY_LANE_WHO_GOT_PAID below.
 */
export const MONEY_LANDING_HEADING = 'Follow the money';

/**
 * The subtitle and all 3 lane bodies end without a full stop (ruled 1 Sep 2026, #1924).
 * The subtitle stands alone under the heading, and the 3 bodies are a column of card
 * descriptions, so the rule reaches each of them. A body carrying 2 sentences keeps the
 * full stop BETWEEN them and loses only the final one — see MONEY_LANE_WHO_GOT_PAID.
 */
/**
 * "donation and payment", not the filing system's "contribution and expenditure" (ruled
 * 2 Sep 2026, copy proposal 3): "expenditure" is the one word every other string in this
 * section avoids for money out, and this is the first sentence a reader meets.
 */
export const MONEY_LANDING_SUBTITLE =
  'Every donation and payment Minnesota publishes for state campaigns, searchable by ' +
  'the name it was filed under';

export const MONEY_LANE_LEGISLATORS = {
  title: 'Legislators',
  body: 'Their money is a tab on the profile they already have',
} as const;

/**
 * The Legislators lane's body as the card actually draws it.
 *
 * **The one lane whose body gains a second sentence at render time**, and therefore the
 * one place a full stop after `MONEY_LANE_LEGISLATORS.body` is INTERNAL rather than
 * terminal. The card joins the body and the confirmation sentence into a single run of
 * text, so with the second sentence attached the 2 need separating; with no confirmation
 * served the body stands alone and takes no closing mark, exactly like the other 2 lanes
 * and like the standalone copy the first server response serves as a link's detail.
 *
 * It lives here rather than in the screen because this module's rule is that every
 * sentence the landing shows is decided in one place a test can pin. Composed in the
 * screen, it was not pinned, and dropping the full stop unconditionally shipped the
 * run-on "…the profile they already have Confirmed for 200 of Minnesota's 200 sitting
 * legislators" to the live landing (#1924).
 */
export function legislatorsLaneBody(
  confirmation: { confirmed: number; total: number } | null | undefined,
): string {
  if (!confirmation) return MONEY_LANE_LEGISLATORS.body;
  return `${MONEY_LANE_LEGISLATORS.body}. ${legislatorsLaneSentence(confirmation)}`;
}

export const MONEY_LANE_COMMITTEES = {
  title: 'Committees',
  body: 'Campaign committees, party units, and other registered funds',
} as const;

/**
 * The 3rd lane, and the one whose wording had to be settled rather than drawn
 * (issue #1780).
 *
 * **This lane is a search, not a list, and the card says so.** A payee carries no
 * identifier in Minnesota's data — the printed spelling is the whole of the key —
 * so a browse-all-payees list could only be ordered 4 ways, and 3 of them are
 * forbidden and the 4th is useless: by amount, by number of records, or by most
 * recent payment are all rankings across filers on different filing calendars,
 * which `.claude/rules/grounded-answers.md` rule 12 forbids outright; and
 * alphabetical is honest and useless across hundreds of thousands of spellings.
 * There is no honest ordering, so the lane opens the search field, and one name
 * opens every payment filed under that exact spelling.
 */
export const MONEY_LANE_WHO_GOT_PAID = {
  title: 'Who got paid',
  body:
    'Search a name to see every payment filed under that exact spelling. There is no list of ' +
    'every payee: these names carry no identifier, so any order across committees on different ' +
    'filing calendars would set one period against another',
} as const;

/** The one freshness date the landing shows, worded as the screen words it: the
 *  day we copied the files, never the period any money covers (rule 12). */
export const FILES_LAST_COPIED_LABEL = 'Files last copied';

export const FILES_LAST_COPIED_NOTE =
  'When we last copied new filings from the Board. Not the period the money covers — every ' +
  'figure carries its own period, and each one ends earlier than this date.';

/** The heading over the permanent gaps, on the landing and on the committees list. */
export const RECORD_DOES_NOT_COVER_HEADING = 'What this record does not cover';

/**
 * The landing's closing line under the 3 gaps, standalone in the card and so bare
 * (copy rule C). It says what kind of absence these are — the record's own — now that
 * the block no longer carries our confirmation count beside them, which was a
 * different kind of absence: ours to close.
 */
export const RECORD_DOES_NOT_COVER_NOTE =
  'These are properties of the record itself, not gaps we can close';
