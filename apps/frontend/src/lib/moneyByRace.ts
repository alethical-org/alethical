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

import { coveredPeriodLine } from './committeeMoney';
import {
  formatDay,
  formatMoney,
  moneyFigure,
  paymentDateRangeLabel,
  type FigureText,
} from './legislatorCampaignMoney';
import { formatCount } from './moneyLanding';
import type { RaceCommittee } from '../data/types';

export const MONEY_BY_RACE_TITLE = 'Money by race';

export const MONEY_BY_RACE_DEK =
  'Every candidate committee, grouped by the office and district it is registered for. ' +
  'Ordered by district, then by name — never by amount.';

/** The chip that clears the office filter. */
export const ALL_OFFICES_LABEL = 'All offices';

/**
 * The order label beside the count, printed so it is never inferred. An
 * `orderedBy` this mapping does not know prints nothing rather than a guess: the
 * sentence and the real order must not be able to drift apart.
 */
export function racesOrderingLine(orderedBy: string): string | null {
  return orderedBy === 'district_then_name' ? 'DISTRICT, THEN NAME A–Z' : null;
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
  return `${office} · District ${district}`;
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
  'The reported totals in this contest cover different periods — each row states its own';

/** The label on the first figure, verbatim from the committee page's money-in card. */
export const REPORTED_FIGURE_LABEL = 'Donations this committee reported to the state';

/** The label on the second figure, verbatim from the committee page's money-in card. */
export const NAMED_FIGURE_LABEL = 'Donations with a donor’s name';

/** What stands in for a figure we do not hold. Words, never `$0`. */
export const NOT_REPORTED_VALUE = 'Not reported';

export interface RaceFigure extends FigureText {
  label: string;
  /** The figure's own dates, or null when there is nothing to date. */
  period: string | null;
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
 * A missing figure is the words "Not reported" with no period: a period on a
 * missing figure would be a date on nothing.
 */
export function committeeFigures(committee: RaceCommittee): [RaceFigure, RaceFigure] {
  const reported = formatMoney(committee.reportedTotal);
  const reportedFigure: RaceFigure = reported
    ? {
        label: REPORTED_FIGURE_LABEL,
        text: reported,
        isFigure: true,
        period: coveredPeriodLine(committee.reportedThrough, committee.reportedPeriodStart),
      }
    : { label: REPORTED_FIGURE_LABEL, text: NOT_REPORTED_VALUE, isFigure: false, period: null };
  const named = moneyFigure(committee.named.state, committee.named.total);
  const namedFigure: RaceFigure = {
    label: NAMED_FIGURE_LABEL,
    ...named,
    period: named.isFigure
      ? paymentDateRangeLabel(committee.named.firstPaymentOn, committee.named.lastPaymentOn)
      : null,
  };
  return [reportedFigure, namedFigure];
}

/**
 * "222 CONTESTS · 778 CANDIDATE COMMITTEES · COUNTED FROM THE REGISTER 12 AUG 2026".
 *
 * Counts of what we hold, so they need no freshness date under rule 12; the
 * register's own date rides along because it answers "how old is this list".
 * Null when no counts are served: a list with no served count says nothing about
 * how long it is rather than guessing from the rows it holds.
 */
export function racesCountLine(
  contestCount: number | null,
  committeeCount: number | null,
  asOf: string | null,
): string | null {
  if (contestCount === null || committeeCount === null) return null;
  const head =
    `${formatCount(contestCount)} ${contestCount === 1 ? 'CONTEST' : 'CONTESTS'} · ` +
    `${formatCount(committeeCount)} ${candidateCommitteeNoun(committeeCount).toUpperCase()}`;
  const day = formatDay(asOf);
  return day ? `${head} · COUNTED FROM THE REGISTER ${day.toUpperCase()}` : head;
}

/** "Money figures are for 2026" — which year the figures on the page belong to.
 *  Each figure still states its own period; this names the year the page asked
 *  the records for. */
export function figuresYearLine(year: number): string {
  return `Money figures are for ${year}`;
}

/**
 * The page's one labelled freshness date (rule 12; #861): when we copied the
 * Board's download that the named figures come from. Null with no release held,
 * and the page then prints no date rather than borrowing the register's.
 */
export const FILES_COPIED_LABEL = 'Files last copied';

/**
 * The sentence under the list. It carries the 3 things a reader would otherwise
 * have to guess: why no contest has a total, why the list is not ranked, and why a
 * row opens by a number rather than a name.
 */
export const MONEY_BY_RACE_NOTE =
  'Contest headings carry a count of committees, never a total: money moved between one ' +
  'person’s committees is reported by both, so a sum would count it twice. Every figure is one ' +
  'committee’s own, with the period it covers stated beside it, and the list is ordered by ' +
  'district and then name so that no position reads as a ranking. Every row opens the ' +
  'committee by its registration number, so a committee that changes its name keeps its address.';

/** The empty state's headline when an office filter finds nothing. */
export function noContestsTitle(office: string | null): string {
  return office
    ? `No ${office} candidate committees in our copy of the register`
    : 'No candidate committees in our copy of the register';
}

/** What the page says when our copy of the register cannot be read. A gap on our
 *  side, never a claim that Minnesota has no candidates. */
export const MONEY_BY_RACE_UNAVAILABLE =
  'We could not read our copy of the Board’s register just now. This is a gap on our side, and ' +
  'an empty list here is never a claim that Minnesota has no candidates.';
