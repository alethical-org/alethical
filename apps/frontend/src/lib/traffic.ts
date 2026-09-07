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
  money?: number;
  read?: number;
  legacyAsk?: number;
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
  moneySearchesWithResults?: number;
  newReaderAccounts?: number;
  newCommitteeWatches?: number;
};

export type SiteMetricReaders = {
  registeredReaders: number;
  currentBillWatches: number;
  differentBillsCurrentlyWatched: number;
  currentReaderAccounts?: number;
  currentBillFollowingReaders?: number;
  currentCommitteeFollowingReaders?: number;
  currentCommitteeWatches?: number;
  differentCommitteesCurrentlyWatched?: number;
};

export type MetricHistory = {
  recordingStartedAt: string | null;
  current7dComplete: boolean;
  current30dComplete: boolean;
  previous7dComplete: boolean;
  previous30dComplete: boolean;
};
export type MetricPeriod = {
  startsAt: string;
  endsAt: string;
  previousStartsAt: string;
  previousEndsAt: string;
};
export type PreviousMetricActions = { [K in keyof SiteMetricActions]: number | null };

export type SiteMetricRecordTotals = {
  actions7d: SiteMetricActions;
  actions30d: SiteMetricActions;
  readers: SiteMetricReaders;
  fetchedAt: string;
  teamExclusionConfigured: boolean;
  previousActions7d?: PreviousMetricActions;
  previousActions30d?: PreviousMetricActions;
  periods7d?: MetricPeriod;
  periods30d?: MetricPeriod;
  history?: Record<keyof SiteMetricActions, MetricHistory>;
  totalsSinceStart?: {
    newReaderAccounts: number;
    newBillWatches: number;
    newCommitteeWatches: number;
  };
};

export type SiteMetricEventName =
  | 'bill_search_with_results'
  | 'money_search_with_results'
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
  websiteAvailability30d: number | null;
  trafficPageAvailability30d: number | null;
  apiAvailability30d: number | null;
  measuredAt?: { website: string | null; api: string | null };
  monitoringStartedAt?: { website: string | null; api: string | null };
  measurementSource?: {
    website: 'analytics' | 'status-page' | null;
    api: 'analytics' | 'status-page' | null;
  };
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
  measurementScope?: 'document-loads';
  navigationTypes?: string[];
  knownBotsExcluded?: true;
  sampleCountSource?: 'cloudflare-confidence';
  minimumSamples?: 50;
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

function allowedKeys(value: object, required: string[], optional: string[]) {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}

const ADDED_ACTIONS = ['moneySearchesWithResults', 'newReaderAccounts', 'newCommitteeWatches'];
const ACTION_KEYS = [
  'billSearchesWithResults',
  'legislatorSearchesWithResults',
  'findMyLegislatorWithResults',
  'officialSourceLinksOpened',
  'newBillWatches',
  ...ADDED_ACTIONS,
];

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
    allowedKeys(
      value,
      [
        'home',
        'billSearch',
        'billProfiles',
        'legislatorSearch',
        'legislatorProfiles',
        'findMyLegislator',
        'other',
      ],
      ['money', 'read', 'legacyAsk'],
    ) &&
    ['money', 'read', 'legacyAsk'].every(
      (key) =>
        !Object.hasOwn(value, key) || nonNegativeInteger((value as Record<string, unknown>)[key]),
    ) &&
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
    allowedKeys(
      value,
      [
        'billSearchesWithResults',
        'legislatorSearchesWithResults',
        'findMyLegislatorWithResults',
        'officialSourceLinksOpened',
        'newBillWatches',
      ],
      ADDED_ACTIONS,
    ) &&
    ADDED_ACTIONS.every(
      (key) =>
        !Object.hasOwn(value, key) || nonNegativeInteger((value as Record<string, unknown>)[key]),
    ) &&
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
    allowedKeys(
      value,
      ['registeredReaders', 'currentBillWatches', 'differentBillsCurrentlyWatched'],
      [
        'currentReaderAccounts',
        'currentBillFollowingReaders',
        'currentCommitteeFollowingReaders',
        'currentCommitteeWatches',
        'differentCommitteesCurrentlyWatched',
      ],
    ) &&
    Object.values(value).every(nonNegativeInteger) &&
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
    allowedKeys(
      value,
      ['actions7d', 'actions30d', 'readers', 'fetchedAt', 'teamExclusionConfigured'],
      [
        'previousActions7d',
        'previousActions30d',
        'periods7d',
        'periods30d',
        'history',
        'totalsSinceStart',
      ],
    ) &&
    validRecordHistory(totals) &&
    isSiteMetricActions(totals.actions7d) &&
    isSiteMetricActions(totals.actions30d) &&
    isSiteMetricReaders(totals.readers) &&
    validDate(totals.fetchedAt) &&
    typeof totals.teamExclusionConfigured === 'boolean'
  );
}

function validRecordHistory(totals: Partial<SiteMetricRecordTotals>) {
  const extended = [
    'previousActions7d',
    'previousActions30d',
    'periods7d',
    'periods30d',
    'history',
    'totalsSinceStart',
  ];
  if (!extended.some((key) => Object.hasOwn(totals, key))) return true;
  if (!extended.every((key) => Object.hasOwn(totals, key))) return false;
  const object = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
  for (const actions of [totals.actions7d, totals.actions30d]) {
    if (
      !actions ||
      !exactKeys(actions, ACTION_KEYS) ||
      !Object.values(actions).every(nonNegativeInteger)
    )
      return false;
  }
  for (const previous of [totals.previousActions7d, totals.previousActions30d]) {
    if (
      !object(previous) ||
      !exactKeys(previous, ACTION_KEYS) ||
      !Object.values(previous).every((v) => v === null || nonNegativeInteger(v))
    )
      return false;
  }
  for (const period of [totals.periods7d, totals.periods30d]) {
    if (
      !object(period) ||
      !exactKeys(period, ['startsAt', 'endsAt', 'previousStartsAt', 'previousEndsAt']) ||
      !Object.values(period).every(validDate)
    )
      return false;
    if (
      Date.parse(String(period.startsAt)) >= Date.parse(String(period.endsAt)) ||
      Date.parse(String(period.previousEndsAt)) !== Date.parse(String(period.startsAt))
    )
      return false;
  }
  if (!object(totals.history) || !exactKeys(totals.history, ACTION_KEYS)) return false;
  for (const h of Object.values(totals.history)) {
    if (
      !object(h) ||
      !exactKeys(h, [
        'recordingStartedAt',
        'current7dComplete',
        'current30dComplete',
        'previous7dComplete',
        'previous30dComplete',
      ])
    )
      return false;
    if (h.recordingStartedAt !== null && !validDate(h.recordingStartedAt)) return false;
    if (
      !(
        [
          'current7dComplete',
          'current30dComplete',
          'previous7dComplete',
          'previous30dComplete',
        ] as const
      ).every((key) => typeof h[key] === 'boolean')
    )
      return false;
    if (
      h.recordingStartedAt === null &&
      Object.entries(h).some(([key, v]) => key !== 'recordingStartedAt' && v === true)
    )
      return false;
  }
  return (
    object(totals.totalsSinceStart) &&
    exactKeys(totals.totalsSinceStart, [
      'newReaderAccounts',
      'newBillWatches',
      'newCommitteeWatches',
    ]) &&
    Object.values(totals.totalsSinceStart).every(nonNegativeInteger)
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
    allowedKeys(
      value,
      ['websiteAvailability30d', 'trafficPageAvailability30d', 'apiAvailability30d', 'fetchedAt'],
      ['measuredAt', 'measurementSource', 'monitoringStartedAt'],
    ) &&
    (totals.websiteAvailability30d === null || validPercentage(totals.websiteAvailability30d)) &&
    (totals.trafficPageAvailability30d === null ||
      validPercentage(totals.trafficPageAvailability30d)) &&
    (totals.apiAvailability30d === null || validPercentage(totals.apiAvailability30d)) &&
    (totals.websiteAvailability30d !== null || totals.apiAvailability30d !== null) &&
    validUptimeProvenance(totals) &&
    validDate(totals.fetchedAt)
  );
}

function validUptimeProvenance(totals: Partial<UptimeTotals>) {
  if (!totals.measuredAt && !totals.measurementSource && !totals.monitoringStartedAt) return true;
  if (
    !totals.measuredAt ||
    !totals.measurementSource ||
    !exactKeys(totals.measuredAt, ['website', 'api']) ||
    !exactKeys(totals.measurementSource, ['website', 'api']) ||
    (totals.monitoringStartedAt && !exactKeys(totals.monitoringStartedAt, ['website', 'api']))
  )
    return false;
  return (['website', 'api'] as const).every((key) => {
    const value = key === 'website' ? totals.websiteAvailability30d : totals.apiAvailability30d;
    const source = totals.measurementSource?.[key];
    const date = totals.measuredAt?.[key];
    const started = totals.monitoringStartedAt?.[key];
    if (
      totals.monitoringStartedAt &&
      (value === null
        ? started !== null
        : !validDate(started) || Date.parse(started) > Date.parse(date ?? ''))
    )
      return false;
    return value === null
      ? date === null && source === null
      : validDate(date) && (source === 'analytics' || source === 'status-page');
  });
}

export function isPerformanceTotals(value: unknown): value is PerformanceTotals {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const totals = value as Partial<PerformanceTotals>;
  return (
    allowedKeys(
      value,
      [
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
      ],
      [
        'measurementScope',
        'navigationTypes',
        'knownBotsExcluded',
        'sampleCountSource',
        'minimumSamples',
      ],
    ) &&
    validPerformanceScope(totals) &&
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

function validPerformanceScope(totals: Partial<PerformanceTotals>) {
  if (
    ![
      'measurementScope',
      'navigationTypes',
      'knownBotsExcluded',
      'sampleCountSource',
      'minimumSamples',
    ].some((key) => Object.hasOwn(totals, key))
  )
    return true;
  const navigationTypes = ['navigate', 'reload', 'back-forward', 'restore', 'prerender'];
  return (
    totals.measurementScope === 'document-loads' &&
    totals.knownBotsExcluded === true &&
    totals.sampleCountSource === 'cloudflare-confidence' &&
    totals.minimumSamples === 50 &&
    Array.isArray(totals.navigationTypes) &&
    totals.navigationTypes.length === navigationTypes.length &&
    navigationTypes.every((v) => totals.navigationTypes?.includes(v)) &&
    [
      [totals.lcpP75Ms, totals.lcpSamples],
      [totals.inpP75Ms, totals.inpSamples],
      [totals.clsP75, totals.clsSamples],
    ].every(([score, count]) => score === null || (typeof count === 'number' && count >= 50))
  );
}
