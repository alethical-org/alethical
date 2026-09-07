import { describe, expect, it } from 'vitest';
import { isPerformanceTotals, isUptimeTotals } from '../traffic';

describe('independent, source-labelled measurements', () => {
  const uptime = {
    websiteAvailability30d: 100,
    trafficPageAvailability30d: null,
    apiAvailability30d: null,
    measuredAt: { website: '2026-09-07T22:00:00Z', api: null },
    monitoringStartedAt: { website: '2026-08-15T14:20:00Z', api: null },
    measurementSource: { website: 'status-page', api: null },
    fetchedAt: '2026-09-07T22:01:00Z',
  };
  it('retains a current availability figure when its sibling is missing', () => {
    expect(isUptimeTotals(uptime)).toBe(true);
    expect(isUptimeTotals({ ...uptime, websiteAvailability30d: 101 })).toBe(false);
    expect(isUptimeTotals({ ...uptime, measuredAt: { website: null, api: null } })).toBe(false);
    expect(isUptimeTotals({ ...uptime, monitoringStartedAt: { website: '2026-09-08T00:00:00Z', api: null } })).toBe(false);
  });
  it('does not accept a blank availability answer as a successful measurement', () => {
    expect(isUptimeTotals({ ...uptime, websiteAvailability30d: null })).toBe(false);
  });
  const performance = {
    lcpP75Ms: 4500,
    lcpSamples: 100,
    inpP75Ms: null,
    inpSamples: 12,
    clsP75: 1,
    clsSamples: 100,
    sampleInterval: 6,
    periodStartedOn: '2026-08-08',
    periodEndedOn: '2026-09-06',
    fetchedAt: '2026-09-07T22:00:00Z',
    measurementScope: 'document-loads',
    navigationTypes: ['navigate', 'reload', 'back-forward', 'restore', 'prerender'],
    knownBotsExcluded: true,
    sampleCountSource: 'cloudflare-confidence',
    minimumSamples: 50,
  };
  it('accepts actual sample counts and their defined scope', () => {
    expect(isPerformanceTotals(performance)).toBe(true);
    expect(isPerformanceTotals({ ...performance, inpP75Ms: 64 })).toBe(false);
    expect(isPerformanceTotals({ ...performance, sampleCountSource: 'estimated' })).toBe(false);
  });
});
