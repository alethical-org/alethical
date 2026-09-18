/**
 * What the Money by race page at /money/races is allowed to say
 * ("Money by race.dc.html", 3 Sep 2026 campaign-money package; issue #1954;
 * `.claude/rules/grounded-answers.md` rule 12;
 * `docs/architecture/campaign-finance-system-design.md` §7).
 *
 * Framework-free, in the style of lib/committeeList.ts. Three constraints are the
 * whole design, and every builder here serves one of them:
 *
 * - **No per-contest total, ever.** A contest heading carries a COUNT of committees
 *   and nothing on the page adds 2 committees' figures. A person can hold 2
 *   committees at once, and money moved between them is reported by both, so a sum
 *   counts it twice (#1663). Nothing in this file turns an amount into a number.
 * - **Never ordered by amount.** The order is office, then district as a person
 *   reads it, then the filed name A to Z, and the page prints that order beside
 *   the count so a reader is never left inferring one from the amounts.
 * - **Every figure carries its own dates.** Each committee's reported total prints
 *   the period its own filing states; its named-donations figure prints the dates
 *   of the payments we hold; a contest whose reported totals cover different
 *   periods says so above its rows.
 *
 * The 2 figures per committee are the same 2 the committee page's money-in card
 * shows, under the same labels, so a committee cannot read one way here and
 * another on its own page.
 */

import { coveredPeriodLine } from './committeeMoneyShared';
import {
  formatDay,
  formatMoney,
  moneyFigure,
  paymentDateRangeLabel,
  type FigureText,
} from './legislatorCampaignMoney';
import { formatCount } from './moneyLanding';
import type { MoneyByRacePage, RaceCommittee, RaceContest } from '../data/types';

export { getCampaignFinanceRacesFromApiPayload, moneyByRaceQueryKey } from './moneyByRaceReads';
export type { ApiMoneyByRacePayload } from './moneyByRaceReads';

export const MONEY_BY_RACE_TITLE = 'Money by race';

export const MONEY_BY_RACE_DEK =
  'Find candidate committees and their reported donations by office, district or court seat. ' +
  'Candidate committees raise and spend money for a candidate’s campaign.';

/** The chip that clears the office filter. */
export const ALL_OFFICES_LABEL = 'All offices';

/**
 * The order label beside the count, printed so it is never inferred. An
 * `orderedBy` this mapping does not know prints nothing rather than a guess: the
 * sentence and the real order must not be able to drift apart.
 */
export function racesOrderingLine(orderedBy: string, office?: string | null): string | null {
  if (orderedBy !== 'district_then_name') return null;
  return office ? 'By district or court seat' : 'By office, then district or court seat';
}

/**
 * The office an address asked for, or null for every office. Only an office the
 * register actually holds narrows the list; a mistyped or stale value shows the
 * whole list rather than an empty page with a filter nobody can see.
 */
export function officeFilterFromParam(
  raw: string | null | undefined,
  offices: readonly { office: string }[],
): string | null {
  if (!raw) return null;
  return offices.some((entry) => entry.office === raw) ? raw : null;
}

/** "candidate committee" / "candidate committees", the register's own noun. */
export function candidateCommitteeNoun(count: number): string {
  return count === 1 ? 'candidate committee' : 'candidate committees';
}

/**
 * The seat a contest is for, as the heading's first part: "House District 12A",
 * "Senate District 41", "Governor · Statewide", "District Court · District 2-14".
 * The 2 chambers read as a person says them; every other office keeps the
 * register's own office word and adds the district only where the register holds
 * one. Never a person's name: a contest is a grouping the state made, not a race
 * we narrated.
 */
export function contestSeatLabel(contest: { office: string; district: string | null }): string {
  const { office, district } = contest;
  if (!district) return `${office} · Statewide`;
  if (office === 'House' || office === 'Senate') return `${office} District ${district}`;
  if (office === 'Supreme Court' || office === 'Appellate Court') {
    if (district.toLowerCase() === 'chief' && office === 'Supreme Court') {
      return `${office} · Chief justice`;
    }
    return /^\d+$/.test(district) ? `${office} · Seat ${district}` : `${office} · ${district}`;
  }
  const seat = office === 'District Court' ? /^(\d+)-(\d+)$/.exec(district) : null;
  return seat ? `${office} · District ${seat[1]} · Seat ${seat[2]}` : `${office} · ${district}`;
}

/** A group keeps the served identifier and year in a normal, shareable link. */
export function raceGroupHref(
  contest: Pick<RaceContest, 'office' | 'anchor'>,
  year: number,
): string {
  const params = new URLSearchParams({
    office: contest.office,
    year: String(year),
    group: contest.anchor,
  });
  return `/money/races?${params}`;
}

/** "3 candidate committees" — the count, and never a sum. */
export function contestCountLabel(committeeCount: number): string {
  return `${formatCount(committeeCount)} ${candidateCommitteeNoun(committeeCount)}`;
}

/**
 * The 2 parts of a contest heading. The computer band joins them on one line with
 * a separator; the phone band stacks them, breaking at the fact boundary rather
 * than mid-sentence. Both bands print the same words.
 */
export function contestHeadingParts(contest: {
  office: string;
  district: string | null;
  committeeCount: number;
}): [string, string] {
  return [contestSeatLabel(contest), contestCountLabel(contest.committeeCount)];
}

/**
 * The line above a contest whose reported totals cover different periods. It says
 * what is true, that the periods differ and each row states its own, and does not
 * guess why: a special-election calendar is one cause, and no field we serve says
 * which committee is on one.
 */
export const MIXED_PERIODS_NOTE =
  'The reported totals in this group cover different periods. Each total shows its own dates.';

/** The label on the first figure, verbatim from the committee page's money-in card. */
export const REPORTED_FIGURE_LABEL = 'Total contributions';

/** The label on the second figure, verbatim from the committee page's money-in card. */
export const NAMED_FIGURE_LABEL = 'Itemized contributions';

export interface RaceFigure extends FigureText {
  label: string;
  /** The figure's own dates, or null when there is nothing to date. */
  period: string | null;
  explanation: string | null;
}

/**
 * A committee's 2 figures, each with its own label and its own dates.
 *
 * The reported total's period is the one its filing states — the end read off
 * the filing, the start only where the Board's own calendars print one (§7), so
 * it reads "Figures for 1 Jan 2026 – 20 Jul 2026" or "Figures through 20 Jul
 * 2026" and never assumes a 1 January. The named figure's dates are those of the
 * payments we hold, worded "Payments dated …" rather than "covering", because a
 * coverage claim is one we did not check.
 *
 * A missing official total names our gap. Missing named contributions name the gap in our records and the requested year. Neither carries a date on a missing amount.
 */
export function committeeFigures(committee: RaceCommittee, year: number): [RaceFigure, RaceFigure] {
  const reported = formatMoney(committee.reportedTotal);
  const reportedFigure: RaceFigure = reported
    ? {
        label: REPORTED_FIGURE_LABEL,
        text: reported,
        isFigure: true,
        period:
          coveredPeriodLine(committee.reportedThrough, committee.reportedPeriodStart)?.replace(
            ' – ',
            ' to ',
          ) ?? null,
        explanation: null,
      }
    : {
        label: REPORTED_FIGURE_LABEL,
        text: `No usable official total in our records for ${year}`,
        isFigure: false,
        period: null,
        explanation: null,
      };
  const named = moneyFigure(committee.named.state, committee.named.total);
  const namedFigure: RaceFigure = {
    label: NAMED_FIGURE_LABEL,
    ...named,
    text: named.isFigure
      ? named.text
      : committee.named.state === 'not_reported'
        ? `No named contributions in our records for ${year}`
        : 'We couldn’t load this figure',
    explanation: null,
    period: named.isFigure
      ? paymentDateRangeLabel(committee.named.firstPaymentOn, committee.named.lastPaymentOn)
      : null,
  };
  return [reportedFigure, namedFigure];
}

/** Counts for the displayed groups. The register date has its own line. */
export function racesCountLine(
  contestCount: number | null,
  committeeCount: number | null,
  _asOf?: string | null,
): string | null {
  if (contestCount === null || committeeCount === null) return null;
  return contestCountLabel(committeeCount);
}

export function registerDateLine(asOf: string | null): string | null {
  const day = formatDay(asOf);
  return day ? `Committee list copied ${day}` : null;
}

/** Sum counts, never money. The API's top-level committee count is global. */
export function shownCommitteeCount(contests: readonly RaceContest[]): number {
  return contests.reduce((total, contest) => total + contest.committeeCount, 0);
}

/** Local navigation over served groups. It never filters or sorts committee rows. */
export function matchingRaceContests(
  contests: readonly RaceContest[],
  query: string,
): RaceContest[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return contests.filter((contest) => {
    const text = `${contestSeatLabel(contest)} ${contest.district ?? ''}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export const RACE_FIGURE_DEFINITIONS = [
  {
    label: REPORTED_FIGURE_LABEL,
    text: 'Donations the committee reported to the state',
  },
  {
    label: NAMED_FIGURE_LABEL,
    text: 'Donations with named givers in our payment records',
  },
] as const;
export const RACE_REGISTRATION_NOTE = 'These records do not confirm who is on the ballot';
export const RACE_COMPARISON_NOTE =
  'The report and payment records can cover different dates. Read the dates beside each amount before comparing.';
export const RACE_COVERAGE_HEADING = 'Limits of the campaign records';
export const RACE_COVERAGE = ['Payment records before 2015 are not included'] as const;

export const RACE_DONOR_EXPLANATION =
  'Named donors include people, lobbyists, other campaigns, political committees and funds, and party organisations. ' +
  'A candidate committee must name a donor whose total donations to that committee exceed $200 in a calendar year. ' +
  'It may also name donors who gave $200 or less.';

/** "Campaign contributions for 2026" — which year the figures on the page belong to.
 *  Each figure still states its own period; this names the year the page asked
 *  the records for. */
export function figuresYearLine(year: number): string {
  return `Campaign contributions for ${year}`;
}

/**
 * The page's one labelled freshness date (rule 12; #861): when we copied the
 * Board's download that the named figures come from. Null with no release held,
 * and the page then prints no date rather than borrowing the register's.
 */
export const FILES_COPIED_LABEL = 'Payment files copied';

/** Explain why the list never adds money across committees. */
export const MONEY_BY_RACE_NOTE =
  'We do not add committees’ money together. Transfers between committees could otherwise be counted twice.';

/** The empty state's headline when an office filter finds nothing. */
export function noContestsTitle(office: string | null): string {
  return office
    ? `No ${office} candidate committees in our copy of the committee list`
    : 'No candidate committees in our copy of the committee list';
}

/** What the page says when our copy of the register cannot be read. A gap on our
 *  side, never a claim that Minnesota has no candidates. */
export const MONEY_BY_RACE_UNAVAILABLE =
  'We couldn’t load the committee list. This does not tell us who is running.';
