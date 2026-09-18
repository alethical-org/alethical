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

import type { MoneyFilingRow, MoneyFilingsFeed } from '../data/types';
import { formatDay } from './moneyFormat';
import { UNION_FINANCES_NOTE } from './committeeMoneyShared';
import { MONEY_SECTION_NAME } from './moneySectionName';

export {
  campaignFinanceFilingsFromPayload,
  campaignFinanceFilingsQueryKey,
  campaignFinanceSummaryQueryKey,
} from './moneyLandingReads';
export type { ApiCampaignFinanceFilingsPayload } from './moneyLandingReads';

/** A filing's plain date in the section's one form ("Jul 24, 2026"), or the raw
 *  value where it is not a date, so a row is never silently emptied. */
function dayLabel(isoDate: string): string {
  return formatDay(isoDate) ?? isoDate;
}

/** The 3 shared campaign-record limits used outside the landing.
 *  The donor sentence is rule 12's exact wording. It says a small donor NEED NOT
 *  be named, never that they are not: the $200 test is a floor on who a committee
 *  must name, and nothing stops one naming a smaller donor (#1755).
 *
 *  No terminal full stop on any of the 3 (ruled 1 Sep 2026, #1924): each stands on
 *  its own line, and the same block on a committee page is worded identically. */
export const RECORD_DOES_NOT_COVER = [
  'No campaign payments held before 2015',
  UNION_FINANCES_NOTE,
  'Donors who gave $200 or less in total for the year need not be named',
] as const;

/** The landing has its own 4-item limits block; sibling pages keep the shared block. */
export const MONEY_LANDING_COVERAGE_HEADING = 'Limits of the campaign records';

export const MONEY_LANDING_RECORD_DOES_NOT_COVER = [
  'Payment records start in 2015',
  'Donors who gave $200 or less in total for the year need not be named',
  'There is no complete directory of payment recipients. Names are shown as filed, and different spellings may refer to the same person or business.',
  UNION_FINANCES_NOTE,
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
 * Units for the 4 counted campaign lanes. Lobbying's count lives in lobbyingDirectoryCopy.
 * Who got paid carries no count: its slot is empty,
 * with no label, dash or placeholder (ruled 8 Sep 2026). A grey "NOTHING TO COUNT" was
 * proposed for it and withdrawn: false, because we hold hundreds of thousands of payment
 * rows and that card searches them, and colour was its only signal.
 *
 * "payments" on the Outside spending lane is a count of the rows in the
 * independent-expenditures file, never a sum of them.
 */
export const LANE_COUNT_UNITS = {
  legislators: 'members',
  committees: 'registered filers',
  byRace: 'contests',
  outsideSpending: 'payments',
} as const;

/**
 * The period a filing covers, both ends read off the filing — never an assumed
 * January. Start unresolved → "covers through {end}". Neither end resolved →
 * null, and the row carries the report name with no period line.
 */
export function filingPeriodLine(filing: Pick<MoneyFilingRow, 'periodStart' | 'periodEnd'>) {
  if (!filing.periodEnd) return null;
  if (!filing.periodStart) return `covers through ${dayLabel(filing.periodEnd)}`;
  return `covers ${dayLabel(filing.periodStart)} – ${dayLabel(filing.periodEnd)}`;
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
  if (orderedBy === 'period_end') return 'Latest reporting periods first, then by filer name';
  if (orderedBy === 'filed_date_then_period_end') {
    return 'Newest first by received date.\nIf missing, we use the reporting period’s end.';
  }
  return null;
}

/** Count and cutoff come from one served block, independently of the mixed-period list.
 * Missing either means no claim, never an invented date or zero. */
export function newestPeriodSentence(period: MoneyFilingsFeed['newestPeriod']): string | null {
  if (!period?.periodEnd) return null;
  const noun = period.filingCount === 1 ? 'report covers' : 'reports cover';
  return `Latest completed period: ${formatCount(period.filingCount)} ${noun} through ${dayLabel(period.periodEnd)}`;
}

/**
 * "Filed Jul 24, 2026", or null on a row the Board states no filing date for.
 *
 * Null prints nothing at all. The tempting alternative — falling back to the period
 * end — is the fabricated fact #1670 exists to prevent, and the row still shows its
 * period, so nothing is hidden except the one claim we cannot make.
 */
export function filedDateSentence(filedDate: string | null | undefined): string | null {
  if (!filedDate) return null;
  return `Filed ${dayLabel(filedDate)}`;
}

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
 * The Legislators lane's confirmation sentence uses both served counts (campaign money
 * IA §01). `legislatorsLaneBody` appends it for partial confirmation and uses a compact
 * single sentence when all sitting members are confirmed.
 *
 * **Once every sitting member is confirmed the sentence says so and stops.** The
 * counted wording ends "for the rest, no figures show on a profile", and with the 2
 * served numbers equal that clause describes nobody (accepted 8 Sep 2026, proposed
 * by Design). While any member is unconfirmed the counted wording stands, word for
 * word, so a reader can see how far the confirming has got.
 *
 * This is the one place the landing states the confirmed count. The does-not-cover
 * block used to state it a second time, with its own dated footnote; that copy came
 * out under copy rule A (a fact once per surface).
 */
export function legislatorsLaneSentence(confirmation: {
  confirmed: number;
  total: number;
}): string {
  if (confirmation.total > 0 && confirmation.confirmed === confirmation.total) {
    return 'Campaign committee matches confirmed for every sitting legislator';
  }
  return (
    `Campaign committee matches confirmed for ${formatCount(confirmation.confirmed)} of Minnesota's ` +
    `${formatCount(confirmation.total)} sitting legislators — for the rest, no figures show ` +
    `on a profile`
  );
}

// --- The landing's own fixed wording ----------------------------------------

/**
 * The heading, subtitle, and 5 campaign lane cards. The 6th card's wording lives in
 * `lobbyingDirectoryCopy.ts`.
 *
 * These lived as literals inside `screens/redesign/MoneyLandingScreen.tsx` until
 * the first server response started carrying the landing's own text (#1812). They
 * are here now for the same reason the /reading page's wording moved into
 * `lib/research.ts`: the served page and the drawn page must be the same words,
 * and 2 copies of a sentence is how one gets fixed and the other does not.
 *
 * The "Who got paid" card was inert until #1780,
 * because the design set draws no browse-all-payees list and its card promised
 * one; it now opens the name search, which is the only honest way in — see
 * MONEY_LANE_WHO_GOT_PAID below.
 */
export const MONEY_LANDING_HEADING = MONEY_SECTION_NAME;

/**
 * The subtitle and stored lane bodies each contain 1 standalone sentence and end bare.
 * `legislatorsLaneBody` preserves the separator before a partial confirmation sentence.
 */
/**
 * "donation and payment", not the filing system's "contribution and expenditure" (ruled
 * 2 Sep 2026, copy proposal 3): "expenditure" is the one word every other string in this
 * section avoids for money out, and this is the first sentence a reader meets.
 */
export const MONEY_LANDING_SUBTITLE =
  'Search Minnesota’s published campaign donations, payments, and lobbying records';

/** Search guidance stays brief here. Spelling limits are explained with no-match results. */
export const MONEY_LANDING_SEARCH_NOTE =
  'Try all or part of a name: a person, committee, payee, or lobbyist';
export const MONEY_LANDING_SEARCH_PLACEHOLDER = 'Search a name';
export const RECENT_FILINGS_HEADING = 'Recently filed reports';

export const MONEY_LANE_LEGISLATORS = {
  title: 'Legislators',
  body: 'See each legislator’s campaign donations and payments',
} as const;

/**
 * The Legislators lane's body as the card actually draws it.
 *
 * A partial confirmation count gains a second sentence at render time, making the
 * full stop after `MONEY_LANE_LEGISLATORS.body` INTERNAL rather than
 * terminal. The card joins the body and the confirmation sentence into a single run of
 * text, so with the second sentence attached the 2 need separating; with no confirmation
 * served the body stands alone and takes no closing mark, exactly like the other lanes
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
  if (!confirmation || confirmation.total <= 0) return MONEY_LANE_LEGISLATORS.body;
  if (confirmation.confirmed === confirmation.total) {
    return 'Each legislator’s campaign donations and payments, with their committee match confirmed';
  }
  return `${MONEY_LANE_LEGISLATORS.body}. ${legislatorsLaneSentence(confirmation)}`;
}

export const MONEY_LANE_COMMITTEES = {
  title: 'Committees',
  body: 'Browse campaign committees, party units, and political funds',
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
 *
 * The card says only what the lane does. The lack of a complete recipient directory
 * is explained in `MONEY_LANDING_RECORD_DOES_NOT_COVER` rather than in this card.
 */
export const MONEY_LANE_WHO_GOT_PAID = {
  title: 'Who got paid',
  body: 'Every payment filed under a name, as spelled on the filing',
} as const;

/**
 * Money by race: the card promises no ranking and no total (rule 12), and it no longer
 * states the list's order — "in district and then name order" was cut on 8 Sep 2026
 * (accepted, proposed by Design), because the order is a property of the list and the
 * race page prints its own order line above the rows. Outside spending: "spending" is
 * allowed here because it IS spending, by groups that are not the campaign; the word
 * stays banned for a committee's own money out.
 */
export const MONEY_LANE_BY_RACE = {
  title: 'Money by race',
  body: 'Candidate committees’ filed figures, grouped by the seat',
} as const;

export const MONEY_LANE_OUTSIDE_SPENDING = {
  title: 'Outside spending',
  body: 'Money spent for or against candidates, without their campaigns',
} as const;

/** The shared coverage heading used outside the landing. */
export const RECORD_DOES_NOT_COVER_HEADING = 'What this record does not cover';

/**
 * The Research card sits between the navigation cards and the records explanation.
 * With nothing published it carries 1 line, no count and no second link.
 * Research pieces only, never a guide: the link says "Read the research", so a guide
 * featured here would be labelled as something it is not.
 */
export const RESEARCH_ROW_LABEL = 'RESEARCH';
export const RESEARCH_ROW_LINK = 'Read the research';
export const RESEARCH_ROW_EMPTY = 'Nothing is published yet';
