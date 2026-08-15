import { describe, expect, it } from 'vitest';

import {
  formatTrafficWindowEnd,
  isPerformanceTotals,
  isSearchTotals,
  isSiteMetricRecordTotals,
  isTrafficTotals,
  isUptimeTotals,
  redactTrafficUrl,
} from '../traffic';

describe('traffic display formatting and address redaction', () => {
  const trafficBreakdown = {
    destinationPageViews: {
      home: 1,
      billSearch: 2,
      billProfiles: 3,
      legislatorSearch: 4,
      legislatorProfiles: 5,
      findMyLegislator: 6,
      other: 7,
    },
    billProfiles: {
      pageViews: 3,
      differentProfilesViewed: { count: 2, capped: false, cap: 100 },
    },
    legislatorProfiles: {
      pageViews: 5,
      differentProfilesViewed: { count: 2, capped: false, cap: 100 },
    },
  };

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

  it('accepts the full privacy-safe reach and exploration answer only', () => {
    const safe = {
      pageViews24h: 8,
      pageViews7d: 20,
      pageViews30d: 40,
      estimatedVisitors24h: 4,
      estimatedVisitors7d: 10,
      estimatedVisitors30d: 18,
      trafficBreakdown7d: trafficBreakdown,
      trafficBreakdown30d: trafficBreakdown,
      fetchedAt: '2026-08-15T12:00:00.000Z',
      windowEndedAt: '2026-08-15T12:00:00.000Z',
      countingStartedAt: '2026-08-03T00:00:00.000Z',
      teamExclusionConfigured: true,
    };
    expect(isTrafficTotals(safe)).toBe(true);
    expect(isTrafficTotals({ ...safe, paths: ['/private'] })).toBe(false);
  });

  it('accepts only fixed anonymous actions and current reader totals', () => {
    const actions = {
      billSearchesWithResults: 1,
      legislatorSearchesWithResults: 2,
      findMyLegislatorWithResults: 3,
      officialSourceLinksOpened: 4,
      newBillWatches: 5,
    };
    const safe = {
      actions7d: actions,
      actions30d: actions,
      readers: {
        registeredReaders: 6,
        currentBillWatches: 7,
        differentBillsCurrentlyWatched: 8,
      },
      fetchedAt: '2026-08-15T12:00:00.000Z',
      teamExclusionConfigured: false,
    };
    expect(isSiteMetricRecordTotals(safe)).toBe(true);
    expect(isSiteMetricRecordTotals({ ...safe, accountIds: ['private'] })).toBe(false);
  });

  it('accepts only safe combined search totals', () => {
    const safe = {
      clicks30d: 3,
      impressions30d: 40,
      previousClicks30d: 1,
      previousImpressions30d: 20,
      periodStartedOn: '2026-07-16',
      periodEndedOn: '2026-08-12',
      previousPeriodStartedOn: '2026-06-18',
      previousPeriodEndedOn: '2026-07-15',
      fetchedAt: '2026-08-15T12:00:00.000Z',
    };
    expect(isSearchTotals(safe)).toBe(true);
    expect(isSearchTotals({ ...safe, clicks30d: 3.5 })).toBe(true);
    expect(isSearchTotals({ ...safe, clicks30d: Number.NaN })).toBe(false);
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
