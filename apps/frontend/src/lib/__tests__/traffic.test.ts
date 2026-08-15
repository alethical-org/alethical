import { describe, expect, it } from 'vitest';

import {
  formatTrafficWindowEnd,
  isPerformanceTotals,
  isSearchTotals,
  isUptimeTotals,
  redactTrafficUrl,
} from '../traffic';

describe('traffic display formatting and address redaction', () => {
  it('removes everything after the page path before a view is sent', () => {
    expect(redactTrafficUrl('https://www.alethical.com/ask?q=private#answer')).toBe(
      'https://www.alethical.com/ask',
    );
  });

  it('shows the last completed hour in Minnesota daylight time', () => {
    expect(formatTrafficWindowEnd('2026-08-15T13:00:00.000Z')).toBe('8:00 AM CT');
  });

  it('shows the last completed hour in Minnesota standard time', () => {
    expect(formatTrafficWindowEnd('2026-12-15T13:00:00.000Z')).toBe('7:00 AM CT');
  });

  it('accepts only safe combined search totals', () => {
    const safe = {
      clicks28d: 3,
      impressions28d: 40,
      previousClicks28d: 1,
      previousImpressions28d: 20,
      periodStartedOn: '2026-07-16',
      periodEndedOn: '2026-08-12',
      previousPeriodStartedOn: '2026-06-18',
      previousPeriodEndedOn: '2026-07-15',
      fetchedAt: '2026-08-15T12:00:00.000Z',
    };
    expect(isSearchTotals(safe)).toBe(true);
    expect(isSearchTotals({ ...safe, queries: ['private words'] })).toBe(false);
  });

  it('accepts only 3 valid Checkly availability percentages', () => {
    const safe = {
      websiteAvailability30d: 99.9,
      trafficPageAvailability30d: 100,
      apiAvailability30d: 99.8,
      fetchedAt: '2026-08-15T12:00:00.000Z',
    };
    expect(isUptimeTotals(safe)).toBe(true);
    expect(isUptimeTotals({ ...safe, apiAvailability30d: 101 })).toBe(false);
  });

  it('allows a Cloudflare score to wait for 50 browser samples', () => {
    const safe = {
      lcpP75Ms: null,
      lcpSamples: 12,
      inpP75Ms: 123,
      inpSamples: 80,
      clsP75: 0.08,
      clsSamples: 90,
      sampleInterval: 1,
      periodStartedOn: '2026-07-19',
      periodEndedOn: '2026-08-15',
      fetchedAt: '2026-08-15T12:00:00.000Z',
    };
    expect(isPerformanceTotals(safe)).toBe(true);
    expect(isPerformanceTotals({ ...safe, referrers: ['/private'] })).toBe(false);
  });
});
