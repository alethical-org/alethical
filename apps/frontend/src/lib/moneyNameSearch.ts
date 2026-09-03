/**
 * What the name search at /money/search is allowed to say
 * ("Money lists web.dc.html" screen B, and "Campaign money IA.dc.html" §02 and
 * §06; `.claude/rules/grounded-answers.md` rules 11 and 12).
 *
 * Framework-free, in the style of lib/committeeList.ts. The rules doing the most
 * work, each of which the served answer is already shaped around:
 *
 * - **Exactly what was typed, and no did-you-mean anywhere.** 178 registered
 *   filer names sit a single character apart from another registered name, and
 *   every one of those pairs is a different organisation — the Green Party and
 *   the Republican Party of the same district among them (#1661). A correction
 *   here does not fix a typo; it hands a reader one organisation's money under
 *   another's name with nothing on screen to reveal it.
 * - **The 5 groups are never added together.** 2 of them are 2 separate filings
 *   whose rows overlap: 491 rows of the independent-expenditures file share a
 *   spender, name, amount and date with an ordinary expenditures row, and
 *   whether that is one payment filed twice or 2 that coincide is not
 *   established. So this page prints a count per group and never a total across
 *   them — which is why the design's single "5 matches across …" summary line is
 *   deliberately absent from the build.
 * - **A capped count is never printed as a total.** A broad name genuinely
 *   matches thousands; the server counts distinct names up to its own ceiling and
 *   then says "at least", so the page says "more than N" rather than dressing a
 *   ceiling up as a fact (rule 11).
 * - **A group with nothing in it still appears, labelled empty.** Dropping it
 *   would let a reader read "we did not look" as "nothing is filed".
 */

import { formatCount } from './moneyLanding';

/** The server's own group names, in the order it always returns them. */
export type NameSearchGroupKind =
  'people' | 'committees' | 'gave' | 'got_paid' | 'got_paid_independent';

/**
 * The order the page draws the groups in, and every slot it draws. The server
 * already returns all 5 in this order; the page walks this list rather than the
 * served array so a group the server ever stops returning still renders its own
 * empty state instead of vanishing, which is the one reading that would be a lie
 * — "we did not look" shown as "nothing is filed".
 */
export const NAME_SEARCH_GROUP_ORDER: readonly NameSearchGroupKind[] = [
  'people',
  'committees',
  'gave',
  'got_paid',
  'got_paid_independent',
] as const;

const GROUP_HEADINGS: Record<NameSearchGroupKind, string> = {
  people: 'PEOPLE',
  committees: 'COMMITTEES',
  gave: 'NAMES THAT GAVE',
  got_paid: 'NAMES THAT GOT PAID',
  got_paid_independent: 'NAMES PAID BY INDEPENDENT SPENDING',
};

export function groupHeading(kind: NameSearchGroupKind): string {
  return GROUP_HEADINGS[kind];
}

/**
 * The note under each group's heading. Every one of them answers the same
 * question — why this group behaves the way it does — because a reader who is not
 * told will infer, and the inferences available here are all wrong.
 */
const GROUP_NOTES: Record<NameSearchGroupKind, string> = {
  people:
    'A person is a result only where we hold a record of them beyond these filings — the 200 ' +
    'sitting legislators. Everyone else on a filing resolves to what they filed.',
  committees:
    'A committee carries a registration number, so its row opens a page about the committee ' +
    'itself and that address survives a change of name. Two committees registered under one ' +
    'person’s name are never added together — money moved between committees one person ' +
    'controls is filed as a contribution in both, so a combined figure would count the same ' +
    'dollars twice.',
  gave:
    'A row opens the payments filed under that exact spelling, and is deliberately not a ' +
    'profile. We never join 2 spellings into one person: the records hold “Messinger, Alida”, ' +
    '“Messinger, Alida R” and “Messinger, Alida Rockefelle” as 3 separate strings, and the same ' +
    'file holds 2 spellings of another name that any rule loose enough to join the first 3 ' +
    'would join to each other.',
  got_paid:
    'A name that only ever got paid carries no registration number, so it has no page about ' +
    'it — a row opens the payments filed under that name, exactly as spelled here. The number ' +
    'beside it counts payment records under that spelling, and it is never an amount.',
  got_paid_independent:
    'A separate filing from the one above, and the 2 are never added: 491 rows of the ' +
    'independent-spending file share a spender, name, amount and date with an ordinary ' +
    'expenditure row, and whether that is one payment filed twice or 2 that coincide is not ' +
    'established.',
};

export function groupNote(kind: NameSearchGroupKind): string {
  return GROUP_NOTES[kind];
}

/** "1 MATCH" / "12 MATCHES" / "MORE THAN 200 MATCHES", or null when the server
 *  served no figure at all. Never a number the server did not count. */
export function groupCountLabel(total: number | null, atLeast: number | null): string | null {
  if (total !== null) {
    return total === 1 ? '1 MATCH' : `${formatCount(total)} MATCHES`;
  }
  if (atLeast !== null) return `MORE THAN ${formatCount(atLeast)} MATCHES`;
  return null;
}

/** The line under a group whose count hit the server's ceiling, so "more than
 *  200" is never read as a shrug. */
export function countedUpToNote(countedUpTo: number | null): string | null {
  if (countedUpTo === null) return null;
  return (
    `We stop counting distinct names at ${formatCount(countedUpTo)}. A common name genuinely ` +
    `matches thousands, and a ceiling printed as a total would be a figure we made up.`
  );
}

/** "9 payments filed under this name" — a count of records, never an amount. */
export function paymentNameMeta(paymentCount: number | null): string {
  if (paymentCount === null) return 'Payments filed under this name';
  return `${formatCount(paymentCount)} ${paymentCount === 1 ? 'payment' : 'payments'} filed under this name`;
}

/** "Senate District 41 · DFL · sitting member" — what we hold about a person
 *  beyond these filings, which is why they are a result at all. */
export function personMeta(person: {
  chamber: string | null;
  districtCode: string | null;
  party: string | null;
}): string {
  const parts: string[] = [];
  const seat =
    person.chamber === 'house'
      ? 'House'
      : person.chamber === 'senate'
        ? 'Senate'
        : (person.chamber ?? null);
  if (seat && person.districtCode) parts.push(`${seat} District ${person.districtCode}`);
  else if (seat) parts.push(seat);
  else if (person.districtCode) parts.push(`District ${person.districtCode}`);
  if (person.party) parts.push(person.party);
  parts.push('sitting member');
  return parts.join(' · ');
}

/** "See all 12 committees" — the one group with a list page of its own to
 *  continue into. Null when nothing is being held back. */
export function seeAllCommitteesLabel(total: number | null, hasMore: boolean): string | null {
  if (!hasMore) return null;
  if (total === null) return 'Browse all committees';
  return `See all ${formatCount(total)} ${total === 1 ? 'committee' : 'committees'}`;
}

export const NAME_SEARCH_PLACEHOLDER = 'Search any name — people, committees, who got paid';

/** The heading. The query is quoted rather than standing alone as the heading, so
 *  a screen reader announces what the page is before what was typed. */
export function nameSearchHeading(query: string): string {
  const trimmed = query.trim();
  return trimmed ? `Results for “${trimmed}”` : 'Search these records by name';
}

/** The list's footnote, printed under the groups as the drawing places it
 *  ("Money lists.dc.html", issue #1946) — so it says "above", never "below". */
export const NAME_SEARCH_MATCHED_ON =
  'Matched on the name as it was filed, exactly as typed. Each group above is counted on its ' +
  'own and the counts are never added: 2 of them come from 2 separate filings whose rows ' +
  'overlap.';

/** Nothing typed yet. Not an error and not "no matches" — the field simply has
 *  nothing to search on. */
export const NAME_SEARCH_EMPTY_QUERY_TITLE = 'Type a name to search';

export const NAME_SEARCH_EMPTY_QUERY_WHY =
  'This searches Minnesota state campaign filings by the name each record was filed under — a ' +
  'legislator, a committee, a party unit, a donor, or a business that got paid.';

/** Below the index's floor. A served state, not an error: a trigram index holds
 *  no whole trigram for a 2-character query, so searching on one would fall back
 *  to reading every contribution row (#1486). */
export function tooShortTitle(minLength: number | null): string {
  const floor = minLength ?? 3;
  return `Type at least ${floor} characters`;
}

export function tooShortWhy(minLength: number | null): string {
  const floor = minLength ?? 3;
  return (
    `A shorter piece of text has nothing for the name index to match on, so we do not search ` +
    `on it. Type ${floor} or more characters of the name as it was filed. This is a limit of ` +
    `ours, and says nothing about what is in the records.`
  );
}

/** Nothing carried that spelling. A fact about the spelling and our records,
 *  never about anybody's giving — which is why the wording names neither an
 *  agency nor a reason. */
export function noMatchTitle(query: string): string {
  const trimmed = query.trim();
  return trimmed ? `Nothing is filed under “${trimmed}”` : 'Nothing is filed under that name';
}

export const NO_MATCH_WHY =
  'Names are searched as they were filed, and spellings vary between filings — try a shorter ' +
  'part of the name. We do not offer a nearest match: names here differ from each other by a ' +
  'single character often enough that a guess would put you on the wrong organisation.';

export const BROWSE_ALL_COMMITTEES = 'Browse all committees';

/** What one group says when the server could not read the records behind it. Per
 *  group rather than per page, because the register and the downloads are 2
 *  separate copies of Minnesota's data and one missing copy must not blank the
 *  groups that do not depend on it. */
export const GROUP_UNAVAILABLE =
  'We could not search this part of our records just now. A gap on our side, not a statement ' +
  'about anyone’s giving.';

/** What one group says when it is served and holds nothing. */
export const GROUP_EMPTY = 'Nothing here carries that spelling.';

/**
 * Whether the whole answer has anything to show. Used to choose between the
 * grouped view and the single no-match card: 5 empty groups read as 5 shrugs,
 * where one sentence saying nothing is filed under that name is the honest
 * version and the only one a reader can act on.
 */
export function hasAnyResult(groups: readonly { results: readonly unknown[] }[]): boolean {
  return groups.some((group) => group.results.length > 0);
}

/**
 * Whether every group was actually searched. A "nothing is filed under that
 * name" card is a claim about the records, so it may only be shown when nothing
 * went unread: if one group could not be read, an empty page says we could not
 * look rather than that nobody filed.
 */
export function everyGroupWasSearched(groups: readonly { state: string }[]): boolean {
  return groups.length > 0 && groups.every((group) => group.state !== 'unavailable');
}

/** What the page says when nothing turned up AND part of the records could not be
 *  read. Never "nothing is filed": that would be a claim we did not establish. */
export const NOT_ALL_SEARCHED_TITLE = 'We could not search all of these records just now';

export const NOT_ALL_SEARCHED_WHY =
  'Part of our copy of Minnesota’s files did not answer, so an empty result here is not a ' +
  'statement that nothing is filed under that name. This is a gap on our side. Try again in a ' +
  'moment.';
