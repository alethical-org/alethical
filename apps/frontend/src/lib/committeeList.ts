/**
 * What the committees list at /money/committees is allowed to say
 * ("Money lists web.dc.html" screen A; `.claude/rules/grounded-answers.md`
 * rule 12; `docs/architecture/campaign-finance-system-design.md` §7).
 *
 * Framework-free, in the style of lib/committeeMoney.ts, whose label functions
 * this reuses rather than restates: the same filer must not read one way on this
 * list and another on its own page, so `committeeEyebrow` there is the only
 * place a kind becomes words.
 *
 * The rules doing the most work:
 *
 * - **No row carries an amount and nothing sorts by one.** These filers file to
 *   different calendars, so 2 dollar figures side by side would set one period
 *   against another rather than compare money. The order is the filed name, A to
 *   Z, and the page says so out loud.
 * - **A party unit's meta line is its kind alone.** Minnesota publishes no layer
 *   for 289 of the 299 registered party units, and 21 filers are named exactly
 *   "Nth Congressional District <party>" while 3 of those are political
 *   committees or funds — so reading a geography out of a printed name starts out
 *   wrong about 3 named organisations (#1661).
 * - **Every count is served, never pasted.** A pasted count is how the money
 *   landing once said 1,336 filers on a day the register held 1,603.
 */

import { committeeEyebrow, formatDay } from './committeeMoney';
import { formatCount } from './moneyLanding';

/** The register's own 3 kinds, plus the unfiltered view. The register holds 3
 *  and no finer filter may exist here: the finer sub-type is `null` for 33
 *  registered filers, so a "ballot question" chip would present "we cannot tell"
 *  as "not one of these" (#1661). */
export type CommitteeKindFilter =
  'all' | 'candidate_committee' | 'party_unit' | 'political_committee_or_fund';

export const COMMITTEE_KIND_FILTERS: readonly CommitteeKindFilter[] = [
  'all',
  'candidate_committee',
  'party_unit',
  'political_committee_or_fund',
] as const;

const KIND_FILTER_LABELS: Record<CommitteeKindFilter, string> = {
  all: 'All kinds',
  candidate_committee: 'Candidate committees',
  party_unit: 'Party units',
  political_committee_or_fund: 'Committees and funds',
};

/** The chip's label. The register's own vocabulary, pluralised — never a finer
 *  kind of our own. */
export function kindFilterLabel(filter: CommitteeKindFilter): string {
  return KIND_FILTER_LABELS[filter];
}

/** The words a sentence about a filtered list uses, e.g. "778 candidate
 *  committees". "all" reads as the register's own name for everyone in it. */
export function kindFilterNoun(filter: CommitteeKindFilter, count: number): string {
  if (filter === 'all') return count === 1 ? 'registered filer' : 'registered filers';
  if (filter === 'candidate_committee') {
    return count === 1 ? 'candidate committee' : 'candidate committees';
  }
  if (filter === 'party_unit') return count === 1 ? 'party unit' : 'party units';
  return count === 1 ? 'committee or fund' : 'committees and funds';
}

/** An address's `kind` param, or 'all' for anything the register does not hold.
 *  An unknown value is the unfiltered list rather than an error: a mistyped or
 *  stale link still shows the register. */
export function kindFilterFromParam(raw: string | null | undefined): CommitteeKindFilter {
  const match = COMMITTEE_KIND_FILTERS.find((filter) => filter === raw);
  return match ?? 'all';
}

/** How many rows one load asks for. 50 is half the served maximum, so a
 *  "Show more" is always one request. */
export const COMMITTEE_PAGE_SIZE = 50;

/** The hard ceiling on how many rows one address may ask for at once, so a
 *  hand-edited `show` cannot turn into 1,603 requests. */
export const COMMITTEE_MAX_SHOWN = 600;

/**
 * How many rows the address asks to have shown. It rides in the address so a
 * reader who scrolled through 4 loads can share what they were looking at
 * (`.claude/rules/grounded-answers.md` rule 5) — a "Show more" that lived in
 * component state would leave the link pointing at the first 50 rows.
 */
export function shownCountFromParam(raw: string | null | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < COMMITTEE_PAGE_SIZE) return COMMITTEE_PAGE_SIZE;
  const rounded = Math.ceil(parsed / COMMITTEE_PAGE_SIZE) * COMMITTEE_PAGE_SIZE;
  return Math.min(rounded, COMMITTEE_MAX_SHOWN);
}

export const COMMITTEE_LIST_TITLE = 'Committees';

export const COMMITTEE_LIST_DEK =
  'Everyone registered to raise or spend money in Minnesota state politics — candidate ' +
  'committees, party units, and the committees and funds that give to them.';

export const COMMITTEE_FIND_LABEL = 'Find a committee by name';

export const COMMITTEE_FIND_PLACEHOLDER = 'Type part of a committee’s name';

/** "NAME A–Z" — printed beside the count so the order is never inferred. */
export const COMMITTEE_ORDER_LABEL = 'NAME A–Z';

/**
 * "1,603 REGISTERED FILERS · COUNTED FROM THE REGISTER 12 AUG 2026".
 *
 * A count of what we hold, so it needs no freshness date under rule 12 — the
 * register's own date is shown anyway because it costs a reader nothing and
 * answers "how old is this list". `formatDay` rather than the landing's
 * `centralDateLabel`: `as_of` is a plain calendar date, and running one through a
 * timezone conversion moves it back a day.
 */
export function registerCountLine(total: number | null, asOf: string | null): string | null {
  if (total === null) return null;
  const head = `${formatCount(total)} REGISTERED FILERS`;
  const day = formatDay(asOf);
  return day ? `${head} · COUNTED FROM THE REGISTER ${day.toUpperCase()}` : head;
}

/**
 * "Showing 50 of 778 candidate committees", or the plain count once every row is
 * on screen. Null when no total is served: a list with no served count says
 * nothing about how long it is rather than guessing from the rows it holds.
 */
export function committeeShowingLine(
  shown: number,
  total: number | null,
  filter: CommitteeKindFilter,
): string | null {
  if (total === null) return null;
  const noun = kindFilterNoun(filter, total);
  if (shown < total) {
    return `Showing ${formatCount(shown)} of ${formatCount(total)} ${noun}`;
  }
  return `${formatCount(total)} ${noun}`;
}

/** "Show the next 50" — the same shape as the payments view's cap button, so the
 *  2 lists behave alike. */
export function committeeMoreLabel(shown: number, total: number | null): string {
  if (total === null) return `Show ${formatCount(COMMITTEE_PAGE_SIZE)} more`;
  const next = Math.min(COMMITTEE_PAGE_SIZE, Math.max(total - shown, 0));
  return `Show the next ${formatCount(next)}`;
}

/**
 * The grey line under a row's name: the register's own kind, plus the seat a
 * candidate committee registered for. Nothing else — a party unit's geography is
 * legible only inside its printed name, and reading it out of there is a mapping
 * a person confirms rather than a column we hold (#1661).
 */
export function committeeRowMeta(row: {
  kind: string | null;
  subType: string | null;
  office: string | null;
  district: string | null;
}): string {
  const parts: string[] = [];
  const label = committeeEyebrow(row.kind, row.subType);
  if (label) parts.push(label);
  if (row.kind === 'candidate_committee' && row.office) {
    if (row.district && (row.office === 'House' || row.office === 'Senate')) {
      parts.push(`${row.office} District ${row.district}`);
    } else if (row.district) {
      parts.push(`${row.office} · District ${row.district}`);
    } else {
      parts.push(row.office);
    }
  }
  return parts.join(' · ');
}

/**
 * The sentence under the list. It carries the 2 things a reader would otherwise
 * have to guess: why no money is on the page, and why a row opens by a number
 * rather than a name.
 */
export const COMMITTEE_LIST_NOTE =
  'Ordered by name, and a list of many committees carries no dollar figures — they file to ' +
  'different calendars, so 2 rows side by side would set one period against another. Money is ' +
  'on each committee’s own page, where the period it belongs to is stated. Every row opens by ' +
  'its registration number, so a committee that changes its name keeps its address.';

/**
 * The empty state's headline. The design's own version read "No all kinds match"
 * when no filter was applied; the unfiltered list says "committees" instead.
 */
export function committeeEmptyTitle(query: string, filter: CommitteeKindFilter): string {
  const noun = filter === 'all' ? 'committees' : kindFilterLabel(filter).toLowerCase();
  const trimmed = query.trim();
  if (!trimmed) return `No ${noun} in our copy of the register`;
  return `No ${noun} match “${trimmed}”`;
}

/**
 * Why nothing matched, and the one thing a reader can act on. No nearest-match
 * suggestion is offered anywhere and this says so: 178 registered names sit a
 * single character apart from another registered name, and every one of those
 * pairs is a different organisation, so a correction would quietly hand a reader
 * one organisation under another's name.
 */
export function committeeEmptyWhy(filter: CommitteeKindFilter): string {
  const shorter =
    'Names are searched as they were filed, and spellings vary between filings — try a shorter ' +
    'part of the name.';
  const dropFilter = filter === 'all' ? '' : ' You can also drop the filter and search every kind.';
  const noGuess =
    ' We do not offer a nearest match: names here differ from each other by a single character ' +
    'often enough that a guess would put you on the wrong organisation.';
  return shorter + dropFilter + noGuess;
}

/** What the page says when our copy of the register cannot be read. A gap on our
 *  side, never a claim that Minnesota registers nobody. */
export const COMMITTEE_LIST_UNAVAILABLE =
  'We could not read our copy of the Board’s register just now. This is a gap on our side, and ' +
  'an empty list here is never a claim that Minnesota registers nobody.';
