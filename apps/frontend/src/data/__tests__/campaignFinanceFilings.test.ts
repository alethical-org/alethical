import { describe, expect, it } from 'vitest';

import { campaignFinanceFilingsFromPayload } from '../api';

const filing = {
  filer_name: 'Example Political Fund',
  report_name: '2025 Year-End Report',
  period_start: '2025-01-01',
  period_end: '2025-12-31',
  filed_date: '2026-08-10',
};

describe('campaign filing records preserve identity and independent reporting periods', () => {
  it('keeps the registration number and the older row period beside the newest-period count', () => {
    const feed = campaignFinanceFilingsFromPayload({
      state: 'reported',
      ordered_by: 'filed_date_then_period_end',
      filings: [{ ...filing, registration_number: '00123' }],
      newest_period: { period_end: '2026-07-20', filing_count: 1203 },
    });
    expect(feed.filings).toEqual([
      {
        registrationNumber: '00123',
        filerName: filing.filer_name,
        reportName: filing.report_name,
        periodStart: '2025-01-01',
        periodEnd: '2025-12-31',
        filedDate: '2026-08-10',
      },
    ]);
    expect(feed.newestPeriod).toEqual({ periodEnd: '2026-07-20', filingCount: 1203 });
    expect(feed.orderedBy).toBe('filed_date_then_period_end');
  });

  it.each([undefined, null])(
    'does not invent an identity or a received date from %s',
    (missing) => {
      const feed = campaignFinanceFilingsFromPayload({
        state: 'reported',
        filings: [{ ...filing, registration_number: missing, filed_date: missing }],
      });
      expect(feed.filings[0].registrationNumber).toBeNull();
      expect(feed.filings[0].filedDate).toBeNull();
      expect(feed.filings[0].periodEnd).toBe('2025-12-31');
    },
  );

  it.each([undefined, null])('does not turn a missing count of %s into zero', (missing) => {
    expect(
      campaignFinanceFilingsFromPayload({
        state: 'reported',
        newest_period: { period_end: '2026-07-20', filing_count: missing },
      }).newestPeriod,
    ).toBeNull();
  });

  it('retains a reported zero and a missing cutoff as different facts', () => {
    expect(
      campaignFinanceFilingsFromPayload({
        state: 'reported',
        newest_period: { filing_count: 0 },
      }).newestPeriod,
    ).toEqual({ periodEnd: null, filingCount: 0 });
  });

  it('drops stale rows and counts when the source is unavailable', () => {
    const feed = campaignFinanceFilingsFromPayload({
      state: 'unavailable',
      filings: [{ ...filing, registration_number: '123' }],
      newest_period: { period_end: '2026-07-20', filing_count: 1203 },
    });
    expect(feed.filings).toEqual([]);
    expect(feed.newestPeriod).toBeNull();
  });
});
