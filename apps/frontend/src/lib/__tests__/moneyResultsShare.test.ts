import { describe, expect, it } from 'vitest';
import type { MoneyByRacePage } from '../../data/types';
import { stateFromPathname } from '../../navigation/webRoutes';
import {
  committeePaymentsShareContent,
  moneyByRaceShareContent,
  moneySearchShareContent,
  outsideBrowseShareContent,
  outsideSubjectShareContent,
  paymentsUnderNameShareContent,
} from '../moneyResultsShare';
import { outsideSpendingRecordPageFromPayload } from '../outsideSpending';
import type { OutsideSpendingNamesPage } from '../outsideSpendingBrowse';

function destination(url: string) {
  const parsed = new URL(url);
  expect(parsed.origin).toBe('https://www.alethical.com');
  const routes = stateFromPathname(`${parsed.pathname}${parsed.search}`).routes;
  return routes[routes.length - 1];
}

describe('money results sharing', () => {
  it('preserves the typed name without treating its punctuation as URL state', () => {
    const content = moneySearchShareContent('  Smith & Jones #2 / Minnesota  ');
    expect(content.subject).toBe('results');
    expect(content.resultsKind).toBe('search');
    expect(content.title).toBe('Results for “Smith & Jones #2 / Minnesota”');
    expect(content.description).not.toContain('Smith');
    expect(destination(content.url)).toMatchObject({
      name: 'MoneySearch',
      params: { q: 'Smith & Jones #2 / Minnesota' },
    });
  });

  it.each(['contributor', 'vendor', 'independent_vendor'] as const)(
    'preserves the exact spelling, role %s and return search',
    (role) => {
      const content = paymentsUnderNameShareContent('A & B / #1', role, 'A & B');
      expect(content.resultsKind).toBe('payments');
      expect(content.description).not.toContain('A & B');
      expect(content.description).toContain('exact spelling');
      expect(destination(content.url)).toMatchObject({
        name: 'PaymentsUnderName',
        params: { name: 'A & B / #1', role, q: 'A & B' },
      });
    },
  );

  it.each(['gave', 'spent'] as const)('pins the committee year and %s tab', (tab) => {
    const content = committeePaymentsShareContent({
      name: 'Friends of Example',
      registrationNumber: '1234',
      year: 2024,
      tab,
    });
    expect(content.title.match(/Friends of Example/g)).toHaveLength(1);
    expect(content.resultsKind).toBe('payments');
    expect(content.description).toBe(
      `${tab === 'gave' ? 'Incoming payment records' : 'Spending records'} in filing year 2024, largest first`,
    );
    expect(destination(content.url)).toMatchObject({
      name: 'CommitteePayments',
      params: { slug: 'friends-of-example-1234', year: '2024', tab },
    });
  });

  const races: MoneyByRacePage = {
    state: 'reported',
    year: 2026,
    office: 'House',
    offices: [],
    orderedBy: 'district_then_name',
    committeeCount: 0,
    contestCount: 1,
    contests: [
      {
        office: 'House',
        district: '12A',
        anchor: 'house-12a',
        committeeCount: 0,
        periodsDiffer: false,
        committees: [],
      },
    ],
    asOf: null,
    fetchedAt: null,
  };
  it('shares the accepted race year and office and an existing contest anchor', () => {
    const content = moneyByRaceShareContent(races, 'house-12a');
    expect(content.title).toBe('Money by race');
    expect(content.resultsKind).toBe('race');
    expect(content.description).toContain('House District 12A');
    expect(content.description).toContain('figures shown separately');
    expect(new URL(content.url).hash).toBe('');
    // A shared seat travels as the seat's own address. The office chip and the
    // name box narrowed the directory a reader came through, and neither is part
    // of the record they are sending (§28.6).
    expect(new URL(content.url).pathname).toBe('/money/races/house-12a');
    expect(destination(content.url)).toMatchObject({
      name: 'MoneyByRace',
      params: { group: 'house-12a' },
    });
    expect(new URL(moneyByRaceShareContent(races, 'access_token=private').url).hash).toBe('');
    expect(
      new URL(moneyByRaceShareContent(races, 'access_token=private').url).searchParams.has('group'),
    ).toBe(false);
    expect(destination(moneyByRaceShareContent(races, '', 'House 12').url)).toMatchObject({
      name: 'MoneyByRace',
      params: { office: 'House', year: '2026', q: 'House 12' },
    });
  });

  it('uses both accepted outside subjects and their year, ordering and page', () => {
    const page = outsideSpendingRecordPageFromPayload({
      state: 'reported',
      year: 2024,
      sort: 'largest',
      spender: { name: 'Example Fund', registration_number: '12' },
      about: { name: 'Example Campaign', registration_number: '34' },
      page: { number: 3, size: 50, total_rows: 150, has_more: false },
    });
    const content = outsideSubjectShareContent(page, 'spender')!;
    expect(content.title).toBe('Example Fund');
    expect(content.resultsKind).toBe('outside-spending');
    expect(content.description).toContain('independent of the campaign');
    expect(content.description).not.toContain('Example Fund');
    expect(destination(content.url)).toMatchObject({
      name: 'OutsideSpending',
      params: { spender: '12', about: '34', year: '2024', sort: 'largest', page: '3' },
    });
    expect(outsideSubjectShareContent({ ...page, state: 'unavailable' }, 'spender')).toBeNull();
    expect(outsideSubjectShareContent({ ...page, spender: null }, 'spender')).toBeNull();
    // A held spender response under a newly selected committee heading would
    // reopen as the spender view. Wait for the committee's own response instead.
    expect(outsideSubjectShareContent(page, 'about')).toBeNull();
    const allYears = outsideSubjectShareContent({ ...page, year: null, spender: null }, 'about')!;
    expect(allYears.description).toContain('All years we hold');
    expect(new URL(allYears.url).searchParams.has('year')).toBe(false);
  });

  it('shares accepted browse filters and page, excluding navigation and unknown parameters', () => {
    const page: OutsideSpendingNamesPage = {
      state: 'reported',
      browse: 'committees',
      query: 'Smith & Jones',
      year: null,
      names: [],
      years: [],
      page: { number: 2, size: 50, total_names: 60, has_more: false },
      snapshot_id: 'private-internal-snapshot',
      release_id: 'release',
      fetched_at: null,
      source_url: null,
    };
    const content = outsideBrowseShareContent(page);
    expect(destination(content.url)).toMatchObject({
      name: 'OutsideSpending',
      params: { browse: 'committees', q: 'Smith & Jones', page: '2' },
    });
    expect([...new URL(content.url).searchParams.keys()].sort()).toEqual(['browse', 'page', 'q']);
    expect(content.description).toContain('All years we hold');
    expect(content.description).not.toContain('snapshot');
  });
});
