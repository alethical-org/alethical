import { describe, expect, it } from 'vitest';
import {
  lobbyingResultMeta,
  lobbyingSearchCount,
  lobbyingSearchTitle,
  lobbyingWiderSearchLabel,
} from '../lobbyingSearch';

describe('lobbying search wording', () => {
  it('distinguishes missing counts, zero and singular results', () => {
    expect(lobbyingSearchCount(null)).toBeNull();
    expect(lobbyingSearchCount(0)).toBe('0 MATCHES');
    expect(lobbyingSearchCount(1)).toBe('1 MATCH');
    expect(lobbyingSearchCount(1234)).toBe('1,234 MATCHES');
  });
  it('preserves filed identifiers and omits an unavailable reported year', () => {
    expect(
      lobbyingResultMeta({
        registration_number: '0141',
        name: 'Kozak, Andrew',
        formatted_name: 'Andrew Kozak',
        principal_count: 1,
      }),
    ).toBe('Registration 0141 · 1 principal listed');
    expect(
      lobbyingResultMeta({
        entity_id: 2263,
        name: 'Principal',
        state: 'reported',
        linkable: true,
        latest_reported_year: null,
      }),
    ).toBe('Entity 2263');
  });
  it('labels both destinations with the submitted text, including a partial name', () => {
    expect(lobbyingSearchTitle('ass')).toBe('Results for “ass”');
    expect(lobbyingWiderSearchLabel('ass')).toBe('Search all money records for “ass”');
  });
});
