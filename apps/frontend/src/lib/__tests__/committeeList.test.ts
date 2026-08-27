/**
 * The committees list's rules (#1696; grounded-answers.md rules 5 and 12;
 * campaign-finance-system-design.md §7). Each test is one way this page could
 * show a confident wrong sentence, or lose the state a shared link carries.
 */
import { describe, expect, it } from 'vitest';

import {
  COMMITTEE_KIND_FILTERS,
  COMMITTEE_LIST_NOTE,
  COMMITTEE_MAX_SHOWN,
  COMMITTEE_PAGE_SIZE,
  committeeEmptyTitle,
  committeeEmptyWhy,
  committeeMoreLabel,
  committeeRowMeta,
  committeeShowingLine,
  kindFilterFromParam,
  kindFilterLabel,
  kindFilterNoun,
  registerCountLine,
  shownCountFromParam,
} from '../committeeList';

describe('the kind filter offers exactly the register’s own 3 kinds', () => {
  // The finer sub-type is null for 33 registered filers, so a "ballot question"
  // or "caucus" chip would present "we cannot tell" as "not one of these"
  // (#1661). The register holds 3 kinds and this list may offer no more.
  it('lists all kinds plus the register’s 3, and nothing finer', () => {
    expect(COMMITTEE_KIND_FILTERS).toEqual([
      'all',
      'candidate_committee',
      'party_unit',
      'political_committee_or_fund',
    ]);
  });

  it('labels each chip in the register’s own vocabulary', () => {
    expect(COMMITTEE_KIND_FILTERS.map(kindFilterLabel)).toEqual([
      'All kinds',
      'Candidate committees',
      'Party units',
      'Committees and funds',
    ]);
  });

  it('reads an unknown or stale kind in the address as the unfiltered list', () => {
    expect(kindFilterFromParam('ballot_question')).toBe('all');
    expect(kindFilterFromParam(undefined)).toBe('all');
    expect(kindFilterFromParam('party_unit')).toBe('party_unit');
  });

  it('says a singular kind when there is one of it', () => {
    expect(kindFilterNoun('candidate_committee', 1)).toBe('candidate committee');
    expect(kindFilterNoun('candidate_committee', 778)).toBe('candidate committees');
    expect(kindFilterNoun('all', 1603)).toBe('registered filers');
  });
});

describe('how many rows the address asks for', () => {
  // A "Show more" that lived in component state would leave the shared link
  // pointing at the first page (grounded-answers rule 5).
  it('starts at one page and rounds a hand-edited value up to a whole page', () => {
    expect(shownCountFromParam(undefined)).toBe(COMMITTEE_PAGE_SIZE);
    expect(shownCountFromParam('0')).toBe(COMMITTEE_PAGE_SIZE);
    expect(shownCountFromParam('not a number')).toBe(COMMITTEE_PAGE_SIZE);
    expect(shownCountFromParam('51')).toBe(COMMITTEE_PAGE_SIZE * 2);
    expect(shownCountFromParam('100')).toBe(COMMITTEE_PAGE_SIZE * 2);
  });

  it('caps a hand-edited value so one address cannot fetch the whole register', () => {
    expect(shownCountFromParam('999999')).toBe(COMMITTEE_MAX_SHOWN);
  });
});

describe('the count line', () => {
  it('counts the register live and dates it from the register’s own date', () => {
    expect(registerCountLine(1603, '2026-08-12')).toBe(
      '1,603 REGISTERED FILERS · COUNTED FROM THE REGISTER 12 AUG 2026',
    );
  });

  // `as_of` is a plain calendar date. Running one through a timezone conversion
  // would move it back a day, which is why this reads 12 Aug and not 11 Aug.
  it('keeps the register’s date on its own day', () => {
    expect(registerCountLine(1603, '2026-08-12')).toContain('12 AUG 2026');
  });

  it('prints the count with no date rather than an invented one', () => {
    expect(registerCountLine(1603, null)).toBe('1,603 REGISTERED FILERS');
  });

  it('prints nothing at all when no count is served', () => {
    expect(registerCountLine(null, '2026-08-12')).toBeNull();
  });
});

describe('the showing line speaks for the list on screen', () => {
  it('names the filter’s own total while rows are held back', () => {
    expect(committeeShowingLine(50, 778, 'candidate_committee')).toBe(
      'Showing 50 of 778 candidate committees',
    );
  });

  it('drops the "showing" once every row is on screen', () => {
    expect(committeeShowingLine(299, 299, 'party_unit')).toBe('299 party units');
  });

  it('says nothing rather than guessing a length from the rows it holds', () => {
    expect(committeeShowingLine(50, null, 'all')).toBeNull();
  });

  it('never offers more rows than are left', () => {
    expect(committeeMoreLabel(1600, 1603)).toBe('Show the next 3');
    expect(committeeMoreLabel(50, 1603)).toBe('Show the next 50');
  });
});

describe('a row’s meta line', () => {
  it('gives a candidate committee the seat it registered for', () => {
    expect(
      committeeRowMeta({
        kind: 'candidate_committee',
        subType: null,
        office: 'Senate',
        district: '41',
      }),
    ).toBe('Candidate committee · Senate District 41');
  });

  // 21 registered filers are named exactly "Nth Congressional District <party>"
  // and 3 of those are political committees or funds, so a geography read out of
  // a printed name starts out wrong about 3 named organisations (#1661).
  it('gives a party unit its kind and no geography', () => {
    expect(
      committeeRowMeta({ kind: 'party_unit', subType: null, office: null, district: null }),
    ).toBe('Party unit');
  });

  it('uses the Board’s own finer word where the Board publishes one', () => {
    expect(
      committeeRowMeta({ kind: 'party_unit', subType: 'CAU', office: null, district: null }),
    ).toBe('Legislative caucus');
    expect(
      committeeRowMeta({
        kind: 'political_committee_or_fund',
        subType: 'BC',
        office: null,
        district: null,
      }),
    ).toBe('Ballot question committee');
  });

  it('says nothing for a kind it does not know rather than guessing', () => {
    expect(
      committeeRowMeta({ kind: 'something_new', subType: null, office: null, district: null }),
    ).toBe('');
  });
});

describe('the empty state', () => {
  // The design's own wording built the headline from the filter label, which read
  // "No all kinds match" with no filter applied.
  it('says "committees" rather than "all kinds" on the unfiltered list', () => {
    expect(committeeEmptyTitle('ratepayers', 'all')).toBe('No committees match “ratepayers”');
  });

  it('names the filter when one is applied', () => {
    expect(committeeEmptyTitle('ratepayers', 'party_unit')).toBe(
      'No party units match “ratepayers”',
    );
  });

  it('says the register itself could not be read when nothing was typed', () => {
    expect(committeeEmptyTitle('', 'all')).toBe('No committees in our copy of the register');
  });

  // 178 register names sit one character apart from another register name and
  // every one of those pairs is a different organisation, so a nearest-match
  // suggestion would hand a reader the wrong organisation (#1661).
  it('rules out a nearest match out loud', () => {
    expect(committeeEmptyWhy('all')).toContain('We do not offer a nearest match');
  });

  it('offers dropping the filter only when one is applied', () => {
    expect(committeeEmptyWhy('party_unit')).toContain('drop the filter');
    expect(committeeEmptyWhy('all')).not.toContain('drop the filter');
  });
});

describe('the list note', () => {
  // No row carries an amount and nothing sorts by one: these filers file to
  // different calendars (grounded-answers rule 12).
  it('says why a list of many committees carries no dollar figures', () => {
    expect(COMMITTEE_LIST_NOTE).toContain('no dollar figures');
    expect(COMMITTEE_LIST_NOTE).toContain('different calendars');
  });

  it('says a row opens by its registration number, not its name', () => {
    expect(COMMITTEE_LIST_NOTE).toContain('registration number');
  });
});
