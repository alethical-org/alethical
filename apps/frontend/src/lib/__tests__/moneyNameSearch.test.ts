/**
 * The name search results page's rules (#1696; grounded-answers.md rules 11 and
 * 12). Each test is one way this page could print a figure nobody counted, join
 * 2 filings that must not be joined, or promise a page that does not exist.
 */
import { describe, expect, it } from 'vitest';

import {
  GROUP_EMPTY,
  GROUP_UNAVAILABLE,
  NAME_SEARCH_GROUP_ORDER,
  NAME_SEARCH_MATCHED_ON,
  NOT_ALL_SEARCHED_TITLE,
  NOT_ALL_SEARCHED_WHY,
  NO_MATCH_WHY,
  countedUpToNote,
  everyGroupWasSearched,
  groupCountLabel,
  groupHeading,
  groupNote,
  groupRowsOpenAPage,
  hasAnyResult,
  nameSearchHeading,
  noMatchTitle,
  paymentNameMeta,
  personMeta,
  seeAllCommitteesLabel,
  tooShortTitle,
  tooShortWhy,
} from '../moneyNameSearch';

describe('all 5 groups are drawn, in the server’s own order', () => {
  // A group dropped for being empty would let a reader read "we did not look" as
  // "nothing is filed".
  it('names the 5 groups the endpoint serves', () => {
    expect(NAME_SEARCH_GROUP_ORDER).toEqual([
      'people',
      'committees',
      'gave',
      'got_paid',
      'got_paid_independent',
    ]);
  });

  it('gives every group a heading and a note', () => {
    for (const kind of NAME_SEARCH_GROUP_ORDER) {
      expect(groupHeading(kind).length).toBeGreaterThan(0);
      expect(groupNote(kind).length).toBeGreaterThan(0);
    }
  });

  // 491 rows of the independent-spending file share a spender, name, amount and
  // date with an ordinary expenditure row, and whether that is one payment filed
  // twice or 2 that coincide is not established (grounded-answers rule 12).
  it('says the 2 vendor groups are separate filings and are never added', () => {
    expect(groupNote('got_paid_independent')).toContain('never added');
    expect(NAME_SEARCH_MATCHED_ON).toContain('never added');
  });

  it('says only committees and sitting members open a page', () => {
    expect(groupRowsOpenAPage('people')).toBe(true);
    expect(groupRowsOpenAPage('committees')).toBe(true);
    expect(groupRowsOpenAPage('gave')).toBe(false);
    expect(groupRowsOpenAPage('got_paid')).toBe(false);
    expect(groupRowsOpenAPage('got_paid_independent')).toBe(false);
  });

  it('says in the group’s own words why a payment name has no page', () => {
    expect(groupNote('got_paid')).toContain('no registration number');
  });
});

describe('a group’s count', () => {
  it('prints an exact served count', () => {
    expect(groupCountLabel(12, null)).toBe('12 MATCHES');
    expect(groupCountLabel(1, null)).toBe('1 MATCH');
    expect(groupCountLabel(1603, null)).toBe('1,603 MATCHES');
  });

  // A ceiling printed as a total is a fabricated fact in the largest type on the
  // page (grounded-answers rule 11).
  it('never dresses the server’s counting ceiling up as a total', () => {
    expect(groupCountLabel(null, 200)).toBe('MORE THAN 200 MATCHES');
  });

  it('prints nothing when the server counted nothing at all', () => {
    expect(groupCountLabel(null, null)).toBeNull();
  });

  it('says why a count stops, so "more than 200" is not read as a shrug', () => {
    expect(countedUpToNote(200)).toContain('stop counting distinct names at 200');
    expect(countedUpToNote(null)).toBeNull();
  });

  // A served 0 is a fact about the spelling and our records, not a gap
  // (grounded-answers rule 12: a verified zero reads as the number it is).
  it('prints a served zero as a real count', () => {
    expect(groupCountLabel(0, null)).toBe('0 MATCHES');
  });
});

describe('a row’s own line', () => {
  it('counts payment records under a spelling and never an amount', () => {
    expect(paymentNameMeta(9)).toBe('9 payments filed under this name');
    expect(paymentNameMeta(1)).toBe('1 payment filed under this name');
    expect(paymentNameMeta(null)).toBe('Payments filed under this name');
  });

  it('says what we hold about a person beyond these filings', () => {
    expect(personMeta({ chamber: 'senate', districtCode: '41', party: 'DFL' })).toBe(
      'Senate District 41 · DFL · sitting member',
    );
    expect(personMeta({ chamber: null, districtCode: null, party: null })).toBe('sitting member');
  });

  it('offers the committees list only when rows are held back', () => {
    expect(seeAllCommitteesLabel(12, true)).toBe('See all 12 committees');
    expect(seeAllCommitteesLabel(1, true)).toBe('See all 1 committee');
    expect(seeAllCommitteesLabel(4, false)).toBeNull();
    expect(seeAllCommitteesLabel(null, true)).toBe('Browse all committees');
  });
});

describe('the page’s states', () => {
  it('announces what the page is before what was typed', () => {
    expect(nameSearchHeading('smith')).toBe('Results for “smith”');
    expect(nameSearchHeading('  ')).toBe('Search these records by name');
  });

  // A served state, not an error: the floor is the name index's, and searching
  // under it would fall back to reading all 583,152 contribution rows (#1486).
  it('says the index’s own floor rather than "nothing found"', () => {
    expect(tooShortTitle(3)).toBe('Type at least 3 characters');
    expect(tooShortWhy(3)).toContain('This is a limit of ours');
    expect(tooShortWhy(null)).toContain('3 or more characters');
  });

  it('makes a no-match a fact about the spelling, and offers no guess', () => {
    expect(noMatchTitle('aguire')).toBe('Nothing is filed under “aguire”');
    expect(NO_MATCH_WHY).toContain('We do not offer a nearest match');
    expect(NO_MATCH_WHY).toContain('try a shorter part of the name');
  });

  it('tells an unreadable group apart from an empty one', () => {
    expect(GROUP_UNAVAILABLE).toContain('gap on our side');
    expect(GROUP_EMPTY).toContain('Nothing here carries that spelling');
  });

  it('treats 5 empty groups as one no-match rather than 5 shrugs', () => {
    expect(hasAnyResult([{ results: [] }, { results: [] }])).toBe(false);
    expect(hasAnyResult([{ results: [] }, { results: [{}] }])).toBe(true);
  });

  // The first build of this page collapsed the server's `not_reported` onto
  // `unavailable`, so every zero-match group printed "a gap on our side" over a
  // search that had run and found nothing. That is the missing-versus-zero
  // failure grounded-answers rule 12 forbids, in the one place a reader would
  // read it as our data being broken rather than as an answer.
  it('counts a searched-and-empty group as searched, and an unreadable one as not', () => {
    expect(everyGroupWasSearched([{ state: 'reported' }, { state: 'not_reported' }])).toBe(true);
    expect(everyGroupWasSearched([{ state: 'not_reported' }, { state: 'unavailable' }])).toBe(
      false,
    );
  });

  it('has no "every group searched" answer for an answer with no groups at all', () => {
    expect(everyGroupWasSearched([])).toBe(false);
  });

  // A "nothing is filed under that name" card is a claim about the records, so an
  // empty page whose groups did not all answer says we could not look instead.
  it('never claims nothing is filed when part of the records went unread', () => {
    expect(NOT_ALL_SEARCHED_TITLE).toContain('could not search all of these records');
    expect(NOT_ALL_SEARCHED_WHY).toContain('not a statement that nothing is filed');
  });
});
