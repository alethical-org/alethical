export type TrafficTotals = {
  pageViews24h: number;
  pageViews7d: number;
  pageViews30d: number;
  fetchedAt: string;
  windowEndedAt: string;
  countingStartedAt: string;
  teamExclusionConfigured: boolean;
};

export type SearchTotals = {
  clicks28d: number;
  impressions28d: number;
  previousClicks28d: number;
  previousImpressions28d: number;
  periodStartedOn: string;
  periodEndedOn: string;
  previousPeriodStartedOn: string;
  previousPeriodEndedOn: string;
  fetchedAt: string;
};

export type UptimeTotals = {
  websiteAvailability30d: number;
  trafficPageAvailability30d: number;
  apiAvailability30d: number;
  fetchedAt: string;
};

export type PerformanceTotals = {
  lcpP75Ms: number | null;
  lcpSamples: number;
  inpP75Ms: number | null;
  inpSamples: number;
  clsP75: number | null;
  clsSamples: number;
  sampleInterval: number;
  periodStartedOn: string;
  periodEndedOn: string;
  fetchedAt: string;
};
export function redactTrafficUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}

export function formatTrafficWindowEnd(iso: string): string {
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
  }).format(new Date(iso));
  return `${time} CT`;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validCalendarDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
  );
}

function exactKeys(value: object, keys: string[]) {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
  );
}

function validPercentage(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function nullableNonNegative(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

export function isTrafficTotals(value: unknown): value is TrafficTotals {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const totals = value as Partial<TrafficTotals>;
  return (
    nonNegativeInteger(totals.pageViews24h) &&
    nonNegativeInteger(totals.pageViews7d) &&
    nonNegativeInteger(totals.pageViews30d) &&
    validDate(totals.fetchedAt) &&
    validDate(totals.windowEndedAt) &&
    validDate(totals.countingStartedAt) &&
    typeof totals.teamExclusionConfigured === 'boolean'
  );
}

export function isSearchTotals(value: unknown): value is SearchTotals {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const totals = value as Partial<SearchTotals>;
  return (
    exactKeys(value, [
      'clicks28d',
      'impressions28d',
      'previousClicks28d',
      'previousImpressions28d',
      'periodStartedOn',
      'periodEndedOn',
      'previousPeriodStartedOn',
      'previousPeriodEndedOn',
      'fetchedAt',
    ]) &&
    nonNegativeInteger(totals.clicks28d) &&
    nonNegativeInteger(totals.impressions28d) &&
    nonNegativeInteger(totals.previousClicks28d) &&
    nonNegativeInteger(totals.previousImpressions28d) &&
    validCalendarDate(totals.periodStartedOn) &&
    validCalendarDate(totals.periodEndedOn) &&
    validCalendarDate(totals.previousPeriodStartedOn) &&
    validCalendarDate(totals.previousPeriodEndedOn) &&
    validDate(totals.fetchedAt)
  );
}

export function isUptimeTotals(value: unknown): value is UptimeTotals {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const totals = value as Partial<UptimeTotals>;
  return (
    exactKeys(value, [
      'websiteAvailability30d',
      'trafficPageAvailability30d',
      'apiAvailability30d',
      'fetchedAt',
    ]) &&
    validPercentage(totals.websiteAvailability30d) &&
    validPercentage(totals.trafficPageAvailability30d) &&
    validPercentage(totals.apiAvailability30d) &&
    validDate(totals.fetchedAt)
  );
}

export function isPerformanceTotals(value: unknown): value is PerformanceTotals {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const totals = value as Partial<PerformanceTotals>;
  return (
    exactKeys(value, [
      'lcpP75Ms',
      'lcpSamples',
      'inpP75Ms',
      'inpSamples',
      'clsP75',
      'clsSamples',
      'sampleInterval',
      'periodStartedOn',
      'periodEndedOn',
      'fetchedAt',
    ]) &&
    nullableNonNegative(totals.lcpP75Ms) &&
    nonNegativeInteger(totals.lcpSamples) &&
    nullableNonNegative(totals.inpP75Ms) &&
    nonNegativeInteger(totals.inpSamples) &&
    nullableNonNegative(totals.clsP75) &&
    nonNegativeInteger(totals.clsSamples) &&
    typeof totals.sampleInterval === 'number' &&
    Number.isFinite(totals.sampleInterval) &&
    totals.sampleInterval >= 0 &&
    validCalendarDate(totals.periodStartedOn) &&
    validCalendarDate(totals.periodEndedOn) &&
    validDate(totals.fetchedAt)
  );
}
