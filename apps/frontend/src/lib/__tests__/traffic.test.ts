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

  it('takes a count of separated automated clients only with the flag that explains it', () => {
    // A bare count cannot say whether 0 means nothing automated arrived or nothing
    // was looked for, and those are opposite facts about the figure beside it.
    const safe = {
      lcpP75Ms: 644,
      lcpSamples: 121,
      inpP75Ms: 64,
      inpSamples: 60,
      clsP75: 0,
      clsSamples: 116,
      sampleInterval: 1,
      periodStartedOn: '2026-09-15',
      periodEndedOn: '2026-09-21',
      fetchedAt: '2026-09-22T12:00:00.000Z',
    };
    expect(isPerformanceTotals(safe)).toBe(true);
    expect(
      isPerformanceTotals({
        ...safe,
        automatedSamples: 7374,
        automatedClientsSeparated: true,
      }),
    ).toBe(true);
    expect(isPerformanceTotals({ ...safe, automatedSamples: 7374 })).toBe(false);
    expect(isPerformanceTotals({ ...safe, automatedClientsSeparated: true })).toBe(false);
    expect(
      isPerformanceTotals({ ...safe, automatedSamples: -1, automatedClientsSeparated: true }),
    ).toBe(false);
  });

  it('takes the Vercel page-view source only with the bot-filter answer beside it', () => {
    const profile = {
      pageViews: 0,
      differentProfilesViewed: { count: 0, capped: false, cap: 100 },
    };
    const breakdown = {
      destinationPageViews: {
        home: 118,
        billSearch: 14,
        billProfiles: 0,
        legislatorSearch: 50,
        legislatorProfiles: 0,
        findMyLegislator: 4,
        other: 0,
      },
      billProfiles: profile,
      legislatorProfiles: profile,
    };
    const safe = {
      pageViews24h: 240,
      pageViews7d: 1680,
      pageViews30d: 7200,
      estimatedVisitors24h: 9,
      estimatedVisitors7d: 19,
      estimatedVisitors30d: 40,
      trafficBreakdown7d: breakdown,
      trafficBreakdown30d: breakdown,
      fetchedAt: '2026-09-22T12:00:00.000Z',
      windowEndedAt: '2026-09-22T12:00:00.000Z',
      countingStartedAt: '2026-08-15T02:01:44.000Z',
      teamExclusionConfigured: true,
    };
    // A payload cached before these keys shipped stays readable.
    expect(isTrafficTotals(safe)).toBe(true);
    expect(
      isTrafficTotals({
        ...safe,
        measurementSource: 'vercel-web-analytics',
        botFilterRequested: false,
      }),
    ).toBe(true);
    expect(isTrafficTotals({ ...safe, measurementSource: 'vercel-web-analytics' })).toBe(false);
    expect(
      isTrafficTotals({
        ...safe,
        measurementSource: 'cloudflare-web-analytics',
        botFilterRequested: false,
      }),
    ).toBe(false);
    expect(
      isTrafficTotals({
        ...safe,
        measurementSource: 'vercel-web-analytics',
        botFilterRequested: true,
      }),
    ).toBe(false);
  });
});
