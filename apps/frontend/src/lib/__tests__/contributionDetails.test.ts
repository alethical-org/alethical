import { describe, expect, it } from 'vitest';
import { contributionDetailRows, withContributionDetailRows } from '../contributionDetails';
import { pathForRoute, stateFromPathname } from '../../navigation/webRoutes';

describe('shared contribution details addresses', () => {
  it('starts closed and isolates committees and years', () => {
    expect(contributionDetailRows(undefined, '19019', 2026)).toEqual([]);
    const first = withContributionDetailRows(undefined, '19019', 2026, [0, 2]);
    const next = withContributionDetailRows(first, '19020', 2026, [1]);
    expect(contributionDetailRows(next, '19019', 2026)).toEqual([0, 2]);
    expect(contributionDetailRows(next, '19020', 2026)).toEqual([1]);
    expect(contributionDetailRows(next, '19019', 2025)).toEqual([]);
    expect(
      contributionDetailRows(withContributionDetailRows(next, '19019', 2026, []), '19020', 2026),
    ).toEqual([1]);
    expect(withContributionDetailRows('invalid', '19019', 2026, [8])).toBeUndefined();
  });
  it.each([
    {
      name: 'CommitteeMoney' as const,
      params: {
        slug: 'example-19019',
        year: '2025',
        tab: 'filings',
        contributionDetails: '19019.2025.0,19019.2025.2',
        evidence: '1',
        earlierYears: '1',
        spendingSort: 'largest',
      },
    },
    {
      name: 'LegislatorProfile' as const,
      params: {
        legislatorId: 'aaron-repinski',
        tab: 'money',
        year: '2025',
        contributionDetails: '19019.2025.1',
      },
    },
  ])('restores shared and browser-back state for $name', (route) => {
    const address = pathForRoute(route);
    expect(stateFromPathname(address)?.routes.at(-1)).toMatchObject(route);
  });
});
