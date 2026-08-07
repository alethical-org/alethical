import { describe, expect, it } from 'vitest';

import {
  CLEAR_SEARCH_TARGET_SIZE,
  LEGISLATOR_PAGE_SIZE,
  LEGISLATOR_SEARCH_LABEL,
  billAuthorshipLabel,
  clearAllLegislatorSearchParams,
  clearLegislatorFilterParams,
  clearLegislatorSearchParams,
  deriveLegislatorEmptyState,
  filterLegislatorsByName,
  paginateLegislatorResults,
} from '../legislatorSearch';

describe('Search Legislators presentation', () => {
  it('uses the approved visible and spoken search wording and clear target', () => {
    expect(LEGISLATOR_SEARCH_LABEL).toBe('Search by name');
    expect(CLEAR_SEARCH_TARGET_SIZE).toBe(44);
  });

  it.each([
    [
      'search only',
      { query: 'Ada', chamber: 'All', party: 'All', hasSessionData: true } as const,
      {
        heading: 'No legislators match “Ada”',
        body: 'Try a different name.',
        action: 'Clear search',
      },
    ],
    [
      'filters only',
      { query: '', chamber: 'House', party: 'All', hasSessionData: true } as const,
      {
        heading: 'No legislators match these filters',
        body: 'Remove a filter or clear them all.',
        action: 'Clear filters',
      },
    ],
    [
      'search and filters',
      { query: 'Ada', chamber: 'House', party: 'DFL', hasSessionData: true } as const,
      {
        heading: 'No legislators match “Ada” with these filters',
        body: 'Try a different name or remove a filter.',
        action: 'Clear all',
      },
    ],
  ])('uses the approved $s empty-state copy', (_cause, input, expected) => {
    expect(deriveLegislatorEmptyState(input)).toEqual(expected);
  });

  it('does not turn a session with no roster data into a no-match message', () => {
    expect(
      deriveLegislatorEmptyState({
        query: 'Ada',
        chamber: 'House',
        party: 'DFL',
        hasSessionData: false,
      }),
    ).toBeNull();
  });

  it('clears only the intended controls and always returns to page 1', () => {
    expect(clearLegislatorSearchParams()).toEqual({ page: undefined, q: undefined });
    expect(clearLegislatorFilterParams()).toEqual({
      page: undefined,
      chamber: undefined,
      party: undefined,
    });
    expect(clearAllLegislatorSearchParams()).toEqual({
      page: undefined,
      q: undefined,
      chamber: undefined,
      party: undefined,
    });
  });

  it('keeps the full matching count and paginates it in groups of 12', () => {
    const result = paginateLegislatorResults(
      Array.from({ length: 13 }, (_, index) => `legislator-${index + 1}`),
      2,
    );

    expect(LEGISLATOR_PAGE_SIZE).toBe(12);
    expect(result.total).toBe(13);
    expect(result.totalPages).toBe(2);
    expect(result.page).toBe(2);
    expect(result.items).toEqual(['legislator-13']);
  });

  it('filters the saved roster by every word in a name search', () => {
    const roster = [{ name: 'Ada Lovelace' }, { name: 'Grace Hopper' }, { name: 'Ada Grace' }];

    expect(filterLegislatorsByName(roster, 'ada grace')).toEqual([{ name: 'Ada Grace' }]);
    expect(filterLegislatorsByName(roster, '')).toEqual(roster);
  });

  it('uses the approved singular and plural bill wording', () => {
    expect(billAuthorshipLabel(1)).toBe('1 bill authored or co-authored across available sessions');
    expect(billAuthorshipLabel(2)).toBe(
      '2 bills authored or co-authored across available sessions',
    );
  });
});
