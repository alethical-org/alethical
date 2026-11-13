import { expect, it } from 'vitest';
import { requestTimeoutMs, REQUEST_TIMEOUT_MS, ELECTION_REPORT_TIMEOUT_MS } from '../api/client';
import { analyticsPath } from '../pages/elections/funderData';
import { expensePath } from '../pages/elections/expenseReportData';

const election = 'mn-2026-11-03-general';
it('uses the same budget for every actual whole-election route builder', () => {
  expect(REQUEST_TIMEOUT_MS).toBe(10_000);
  expect(ELECTION_REPORT_TIMEOUT_MS).toBe(90_000);
  for (const section of ['funders', 'candidates', 'records', 'export'] as const)
    expect(requestTimeoutMs(analyticsPath(election, section, {}))).toBe(90_000);
  for (const dataset of ['contributions', 'expenditures', 'independent_expenditures'])
    expect(
      requestTimeoutMs(
        `finance/elections/${election}/analytics/sources/${dataset}?snapshot_id=${'a'.repeat(64)}&version=0123456789abcdef`,
      ),
    ).toBe(90_000);
  for (const section of ['', 'payees', 'payments', 'export'] as const)
    expect(requestTimeoutMs(expensePath(election, section, {}))).toBe(90_000);
});
it.each([
  'finance/access',
  'finance/sign-in/code',
  `finance/elections/${election}/analytics`,
  `finance/elections/${election}/analytics/funders/`,
  `finance/elections/${election}/analytics/funders/extra`,
  `finance/elections/${election}/analytics/funders#fragment`,
  `finance/elections/${election}/analytics/funders%2Fextra`,
  `finance/elections/${election}/analytics/expenses/unknown`,
  `finance/elections/${election}/analytics/expenses/payments/extra`,
  `finance/elections/${election}/analytics/sources/unknown`,
  `finance/elections/${election}/sources/${'a'.repeat(64)}`,
  `finance/elections/${election}/races/id/export`,
  `finance/elections/not-an-election/analytics/funders`,
  `finance/access?next=finance/elections/${election}/analytics/export`,
  `https://api.test/api/v1/finance/elections/${election}/analytics/funders`,
])('does not broaden the long deadline to %s', (path) => {
  expect(requestTimeoutMs(path)).toBe(10_000);
});
