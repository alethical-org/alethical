export type TrafficTotals = {
  pageViews24h: number;
  pageViews7d: number;
  pageViews30d: number;
  estimatedVisitors24h: number;
  estimatedVisitors7d: number;
  estimatedVisitors30d: number;
  trafficBreakdown7d: TrafficBreakdown;
  trafficBreakdown30d: TrafficBreakdown;
  fetchedAt: string;
  windowEndedAt: string;
  countingStartedAt: string;
  teamExclusionConfigured: boolean;
};

export type DifferentProfilesViewed = {
  count: number;
  capped: boolean;
  cap: number;
};

export type ProfileTrafficTotals = {
  pageViews: number;
  differentProfilesViewed: DifferentProfilesViewed;
};

export type DestinationPageViews = {
  home: number;
  billSearch: number;
  billProfiles: number;
  legislatorSearch: number;
  legislatorProfiles: number;
  findMyLegislator: number;
  other: number;
};

export type TrafficBreakdown = {
  destinationPageViews: DestinationPageViews;
  billProfiles: ProfileTrafficTotals;
  legislatorProfiles: ProfileTrafficTotals;
};

export type SiteMetricActions = {
  billSearchesWithResults: number;
  legislatorSearchesWithResults: number;
  findMyLegislatorWithResults: number;
  officialSourceLinksOpened: number;
  newBillWatches: number;
};

export type SiteMetricReaders = {
  registeredReaders: number;
  currentBillWatches: number;
  differentBillsCurrentlyWatched: number;
};

export type SiteMetricRecordTotals = {
  actions7d: SiteMetricActions;
  actions30d: SiteMetricActions;
  readers: SiteMetricReaders;
  fetchedAt: string;
  teamExclusionConfigured: boolean;
};

export type SiteMetricEventName =
  | 'bill_search_with_results'
  | 'legislator_search_with_results'
  | 'find_my_legislator_with_results'
  | 'official_source_opened';

export type SearchTotals = {
  clicks30d: number;
  impressions30d: number;
  previousClicks30d: number;
  previousImpressions30d: number;
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

function finiteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
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

function isDifferentProfilesViewed(value: unknown): value is DifferentProfilesViewed {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const count = value as Partial<DifferentProfilesViewed>;
  return (
    exactKeys(value, ['count', 'capped', 'cap']) &&
    nonNegativeInteger(count.count) &&
    typeof count.capped === 'boolean' &&
    nonNegativeInteger(count.cap) &&
    count.cap > 0 &&
    count.count <= count.cap
  );
}

function isProfileTrafficTotals(value: unknown): value is ProfileTrafficTotals {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const totals = value as Partial<ProfileTrafficTotals>;
  return (
    exactKeys(value, ['pageViews', 'differentProfilesViewed']) &&
    nonNegativeInteger(totals.pageViews) &&
    isDifferentProfilesViewed(totals.differentProfilesViewed)
  );
}

function isDestinationPageViews(value: unknown): value is DestinationPageViews {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const totals = value as Partial<DestinationPageViews>;
  return (
    exactKeys(value, [
      'home',
      'billSearch',
      'billProfiles',
      'legislatorSearch',
      'legislatorProfiles',
      'findMyLegislator',
      'other',
    ]) &&
    nonNegativeInteger(totals.home) &&
    nonNegativeInteger(totals.billSearch) &&
    nonNegativeInteger(totals.billProfiles) &&
    nonNegativeInteger(totals.legislatorSearch) &&
    nonNegativeInteger(totals.legislatorProfiles) &&
    nonNegativeInteger(totals.findMyLegislator) &&
    nonNegativeInteger(totals.other)
  );
}

function isTrafficBreakdown(value: unknown): value is TrafficBreakdown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const totals = value as Partial<TrafficBreakdown>;
  return (
    exactKeys(value, ['destinationPageViews', 'billProfiles', 'legislatorProfiles']) &&
    isDestinationPageViews(totals.destinationPageViews) &&
    isProfileTrafficTotals(totals.billProfiles) &&
    isProfileTrafficTotals(totals.legislatorProfiles)
  );
}

function isSiteMetricActions(value: unknown): value is SiteMetricActions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const totals = value as Partial<SiteMetricActions>;
  return (
    exactKeys(value, [
      'billSearchesWithResults',
      'legislatorSearchesWithResults',
      'findMyLegislatorWithResults',
      'officialSourceLinksOpened',
      'newBillWatches',
    ]) &&
    nonNegativeInteger(totals.billSearchesWithResults) &&
    nonNegativeInteger(totals.legislatorSearchesWithResults) &&
    nonNegativeInteger(totals.findMyLegislatorWithResults) &&
    nonNegativeInteger(totals.officialSourceLinksOpened) &&
    nonNegativeInteger(totals.newBillWatches)
  );
}

function isSiteMetricReaders(value: unknown): value is SiteMetricReaders {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const totals = value as Partial<SiteMetricReaders>;
  return (
    exactKeys(value, [
      'registeredReaders',
      'currentBillWatches',
      'differentBillsCurrentlyWatched',
    ]) &&
    nonNegativeInteger(totals.registeredReaders) &&
    nonNegativeInteger(totals.currentBillWatches) &&
    nonNegativeInteger(totals.differentBillsCurrentlyWatched)
  );
}

export function isTrafficTotals(value: unknown): value is TrafficTotals {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const totals = value as Partial<TrafficTotals>;
  return (
    exactKeys(value, [
      'pageViews24h',
      'pageViews7d',
      'pageViews30d',
      'estimatedVisitors24h',
      'estimatedVisitors7d',
      'estimatedVisitors30d',
      'trafficBreakdown7d',
      'trafficBreakdown30d',
      'fetchedAt',
      'windowEndedAt',
      'countingStartedAt',
      'teamExclusionConfigured',
    ]) &&
    nonNegativeInteger(totals.pageViews24h) &&
    nonNegativeInteger(totals.pageViews7d) &&
    nonNegativeInteger(totals.pageViews30d) &&
    nonNegativeInteger(totals.estimatedVisitors24h) &&
    nonNegativeInteger(totals.estimatedVisitors7d) &&
    nonNegativeInteger(totals.estimatedVisitors30d) &&
    isTrafficBreakdown(totals.trafficBreakdown7d) &&
    isTrafficBreakdown(totals.trafficBreakdown30d) &&
    validDate(totals.fetchedAt) &&
    validDate(totals.windowEndedAt) &&
    validDate(totals.countingStartedAt) &&
    typeof totals.teamExclusionConfigured === 'boolean'
  );
}

export function isSiteMetricRecordTotals(value: unknown): value is SiteMetricRecordTotals {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const totals = value as Partial<SiteMetricRecordTotals>;
  return (
    exactKeys(value, [
      'actions7d',
      'actions30d',
      'readers',
      'fetchedAt',
      'teamExclusionConfigured',
    ]) &&
    isSiteMetricActions(totals.actions7d) &&
    isSiteMetricActions(totals.actions30d) &&
    isSiteMetricReaders(totals.readers) &&
    validDate(totals.fetchedAt) &&
    typeof totals.teamExclusionConfigured === 'boolean'
  );
}

export function isSearchTotals(value: unknown): value is SearchTotals {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const totals = value as Partial<SearchTotals>;
  return (
    exactKeys(value, [
      'clicks30d',
      'impressions30d',
      'previousClicks30d',
      'previousImpressions30d',
      'periodStartedOn',
      'periodEndedOn',
      'previousPeriodStartedOn',
      'previousPeriodEndedOn',
      'fetchedAt',
    ]) &&
    finiteNonNegativeNumber(totals.clicks30d) &&
    finiteNonNegativeNumber(totals.impressions30d) &&
    finiteNonNegativeNumber(totals.previousClicks30d) &&
    finiteNonNegativeNumber(totals.previousImpressions30d) &&
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
