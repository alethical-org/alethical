import { describe, expect, it } from 'vitest';
import { isLeadershipMetrics, leadershipActionRows, leadershipDate } from '../leadershipMetrics';
import { leadershipFixture } from './leadershipMetricsFixture';

describe('leadership aggregate boundary', () => {
  it('requires a valid current-serving count no larger than stored people', () => {
    for (const count of [undefined, -1, 1.5, 207]) {
      const value = leadershipFixture();
      (value.operations!.corpus as any).current_legislators = count;
      expect(isLeadershipMetrics(value)).toBe(false);
    }
    const value = leadershipFixture();
    value.operations!.corpus.current_legislators = 0;
    expect(isLeadershipMetrics(value)).toBe(true);
  });
  it('rejects action counts too large to represent exactly', () => {
    const value = leadershipFixture();
    value.activity!.actions7d.billSearchesWithResults = Number.MAX_SAFE_INTEGER + 1;
    expect(isLeadershipMetrics(value)).toBe(false);
  });
  it('accepts the aggregate contract and independently unavailable sources', () => {
    expect(isLeadershipMetrics(leadershipFixture())).toBe(true);
    for (const source of ['operations', 'activity', 'accounts'] as const) {
      const value = leadershipFixture();
      value[source] = null;
      value.errors[source] = 'This source is unavailable.';
      expect(isLeadershipMetrics(value)).toBe(true);
    }
  });
  it.each([
    [],
    ['accounts'],
    ['operations', 'corpus'],
    ['operations', 'costs', 'billSummaryLoggedCost'],
    ['activity', 'readers'],
    ['activity', 'actions7d'],
    ['activity', 'history', 'newReaderAccounts'],
  ])('rejects unexpected identity fields at %j', (...path) => {
    const value = leadershipFixture();
    let target: any = value;
    for (const key of path) target = target[key];
    target.email = 'fake@example.test';
    expect(isLeadershipMetrics(value)).toBe(false);
  });
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '23'])(
    'rejects invalid account counts: %s',
    (count) => {
      const value = leadershipFixture();
      (value.accounts as any).currentAccountsCreated = count;
      expect(isLeadershipMetrics(value)).toBe(false);
    },
  );
  it.each(['not a date', '2026-02-30T00:00:00Z', '2026-09-07', '2026-09-07T24:00:00Z'])(
    'rejects invalid dates: %s',
    (date) => {
      const value = leadershipFixture();
      value.asOf = date;
      expect(isLeadershipMetrics(value)).toBe(false);
    },
  );
  it('rejects missing source reasons, mismatched periods, duplicate sources, and invented cost totals', () => {
    const missing = leadershipFixture();
    missing.accounts = null;
    expect(isLeadershipMetrics(missing)).toBe(false);
    const period = leadershipFixture();
    period.accounts!.periods7d = {
      ...period.accounts!.periods7d,
      startsAt: '2026-08-30T00:00:00Z',
    };
    expect(isLeadershipMetrics(period)).toBe(false);
    const duplicate = leadershipFixture();
    duplicate.operations!.freshness[1] = duplicate.operations!.freshness[0];
    expect(isLeadershipMetrics(duplicate)).toBe(false);
    const cost = leadershipFixture();
    (cost.operations!.costs.totalOperatingCost as any).value = 10;
    expect(isLeadershipMetrics(cost)).toBe(false);
    const partial = leadershipFixture();
    partial.operations!.costs.billSummaryLoggedCost.status = 'available';
    expect(isLeadershipMetrics(partial)).toBe(false);
  });
});

describe('honest history display', () => {
  it('does not turn missing history into a measured zero', () => {
    const value = leadershipFixture().activity!;
    const history = value.history!.moneySearchesWithResults;
    Object.assign(history, {
      recordingStartedAt: null,
      current7dComplete: false,
      current30dComplete: false,
      previous7dComplete: false,
      previous30dComplete: false,
    });
    expect(
      leadershipActionRows(value, 7).find((row) => row.label === 'Money searches with results'),
    ).toMatchObject({ current: 'Not recorded yet', previous: 'Not recorded yet' });
  });
  it('marks partial current ranges and refuses incomplete previous counts', () => {
    const value = leadershipFixture().activity!;
    Object.assign(value.history!.billSearchesWithResults, {
      current7dComplete: false,
      previous7dComplete: false,
    });
    expect(
      leadershipActionRows(value, 7).find((row) => row.label === 'Bill searches with results'),
    ).toMatchObject({ current: '12 · Partial range', previous: 'Unavailable' });
    expect(
      leadershipActionRows(value, 30).find((row) => row.label === 'Bill searches with results'),
    ).toMatchObject({ current: '12', previous: '12' });
  });
  it('keeps complete measured zeroes and prints human-readable UTC dates', () => {
    expect(
      leadershipActionRows(leadershipFixture().activity!, 7).find(
        (row) => row.label === 'Money searches with results',
      )?.current,
    ).toBe('0');
    expect(leadershipDate('2026-09-07T00:00:00Z')).toContain('Sep 7, 2026');
    expect(leadershipDate(null)).toBe('Not recorded yet');
  });
});
