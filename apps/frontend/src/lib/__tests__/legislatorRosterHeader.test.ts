import { describe, expect, it } from 'vitest';

import {
  deriveLegislatorRosterHeader,
  LEGISLATOR_ROSTER_NOTE_TEXT,
  LEGISLATOR_SEAT_SOURCE_TEXT,
  LEGISLATOR_SEAT_SOURCE_URL,
} from '../legislatorRosterHeader';

const roster = [
  ...Array.from({ length: 133 }, () => ({ chamber: 'House' as const, party: 'DFL' as const })),
  ...Array.from({ length: 67 }, () => ({ chamber: 'Senate' as const, party: 'R' as const })),
];

describe('deriveLegislatorRosterHeader', () => {
  it('uses the returned officeholders for the header and every chamber count', () => {
    const all = deriveLegislatorRosterHeader(roster, {
      chamber: 'All',
      party: 'All',
      query: '',
      queryInput: '',
      sessionSlug: 'current',
      currentSessionSlug: 'current',
      rosterLoaded: true,
    });
    const house = deriveLegislatorRosterHeader(roster, {
      chamber: 'House',
      party: 'All',
      query: '',
      queryInput: '',
      sessionSlug: 'current',
      currentSessionSlug: 'current',
      rosterLoaded: true,
    });

    expect(all.chamberCounts).toEqual({ All: 200, House: 133, Senate: 67 });
    expect(all.displayedCount).toBe(all.chamberCounts.All);
    expect(house.displayedCount).toBe(house.chamberCounts.House);
  });

  it('keeps the selected chamber count aligned after another filter narrows the roster', () => {
    const houseDfl = deriveLegislatorRosterHeader(roster, {
      chamber: 'House',
      party: 'DFL',
      query: '',
      queryInput: '',
      sessionSlug: 'current',
      currentSessionSlug: 'current',
      rosterLoaded: true,
    });

    expect(houseDfl.displayedCount).toBe(houseDfl.chamberCounts.House);
    expect(houseDfl.chamberCounts).toEqual({ All: 133, House: 133, Senate: 0 });
  });

  it.each([
    ['a committed search', { query: 'smith' }],
    ['text still waiting to be searched', { queryInput: 'smith' }],
    ['a chamber filter', { chamber: 'House' as const }],
    ['a party filter', { party: 'DFL' as const }],
    ['a past session', { sessionSlug: 'past' }],
    ['a partial response', { rosterLoaded: false }],
  ])('hides the note for %s', (_label, override) => {
    const state = deriveLegislatorRosterHeader(roster, {
      chamber: 'All',
      party: 'All',
      query: '',
      queryInput: '',
      sessionSlug: 'current',
      currentSessionSlug: 'current',
      rosterLoaded: true,
      ...override,
    });

    expect(state.unnarrowed).toBe(false);
  });

  it('shows the note only for the loaded, full current roster', () => {
    const state = deriveLegislatorRosterHeader(roster, {
      chamber: 'All',
      party: 'All',
      query: '',
      queryInput: '',
      sessionSlug: 'current',
      currentSessionSlug: 'current',
      rosterLoaded: true,
    });

    expect(state.unnarrowed).toBe(true);
  });

  it('hides the note in the no-results state', () => {
    const state = deriveLegislatorRosterHeader([], {
      chamber: 'All',
      party: 'All',
      query: '',
      queryInput: '',
      sessionSlug: 'current',
      currentSessionSlug: 'current',
      rosterLoaded: true,
    });

    expect(state.unnarrowed).toBe(false);
  });

  it('keeps the approved static note and official source together', () => {
    expect(LEGISLATOR_SEAT_SOURCE_TEXT).toBe('Minnesota has 201 seats.');
    expect(LEGISLATOR_ROSTER_NOTE_TEXT).toBe('Vacant seats aren’t listed.');
    expect(LEGISLATOR_SEAT_SOURCE_URL).toBe('https://www.leg.mn.gov/leg/faq/faq?id=15');
  });
});
