import { describe, expect, it } from 'vitest';
import { isAccountSignupTotals } from '../accountSignupMetrics';

const period = (days: number) => {
  const end = Date.parse('2026-09-07T22:00:00Z');
  return {
    endsAt: new Date(end).toISOString(),
    startsAt: new Date(end - days * 86400000).toISOString(),
    previousEndsAt: new Date(end - days * 86400000).toISOString(),
    previousStartsAt: new Date(end - 2 * days * 86400000).toISOString(),
  };
};
export const SIGNUP_FIXTURE = {
  currentAccountsCreated: 16,
  currentConfirmedAccounts: 15,
  currentUnconfirmedAccounts: 1,
  created7d: 3,
  created30d: 16,
  previousCreated7d: 6,
  previousCreated30d: 0,
  periods7d: period(7),
  periods30d: period(30),
  asOf: '2026-09-07T22:15:00Z',
  source: 'supabase',
  scope: 'current_surviving_reader_accounts',
  definition: 'Currently surviving accounts. Linked sign-in records count once.',
  historyLimitation: 'Deleted accounts are not included, so past creation totals can decrease.',
};
describe('account creation aggregate boundary', () => {
  it('accepts sign-ups without calling them lifetime gross creation', () =>
    expect(isAccountSignupTotals(SIGNUP_FIXTURE)).toBe(true));
  it('rejects private fields, malformed dates and inconsistent counts', () => {
    for (const overrides of [
      { emails: ['private@example.com'] },
      { currentConfirmedAccounts: 17 },
      { created7d: 20 },
      { asOf: 'yesterday' },
      { source: 'product-first-use' },
      { created30d: NaN },
    ])
      expect(isAccountSignupTotals({ ...SIGNUP_FIXTURE, ...overrides })).toBe(false);
  });
  it('rejects unequal comparison periods', () =>
    expect(
      isAccountSignupTotals({
        ...SIGNUP_FIXTURE,
        periods7d: { ...period(7), previousStartsAt: '2026-08-01T22:00:00Z' },
      }),
    ).toBe(false));
});
