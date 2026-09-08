import {
  isSiteMetricRecordTotals,
  type SiteMetricActions,
  type SiteMetricRecordTotals,
} from './traffic';

type Period = {
  startsAt: string;
  endsAt: string;
  previousStartsAt: string;
  previousEndsAt: string;
};
type UnknownCount = { value: null; reason: string };
type RecordedCount = { value: number; meaning: string };
export type LeadershipOperations = {
  fetchedAt: string;
  periodStartedAt: string;
  periodEndedAt: string;
  corpus: {
    bills: number;
    legislators: number;
    current_legislators: number;
    committees: number;
    scope: string;
    coveragePercentage: UnknownCount;
  };
  freshness: Array<{
    source: string;
    lastSucceededAt: string | null;
    meaning: string;
    unavailableReason: string | null;
    currentPublishedFetchCompletedAt: string | null;
    publishedDataMeaning: string;
    publishedDataUnavailableReason: string | null;
  }>;
  reliability: {
    recordedIngestionFailures: RecordedCount;
    billSummaryFailures: RecordedCount;
    billSummaryAmbiguous: RecordedCount;
    allRequestFailures: UnknownCount;
    allJobFailures: UnknownCount;
  };
  costs: {
    billSummaryLoggedCost: {
      valueMicrousd: number | null;
      requestsWithLoggedCost: number;
      requestsWithoutLoggedCost: number;
      status: 'available' | 'partial' | 'unavailable';
      unavailableReason: string | null;
      meaning: string;
    };
    totalOperatingCost: UnknownCount;
  };
};
export type LeadershipAccounts = {
  currentAccountsCreated: number;
  currentConfirmedAccounts: number;
  currentUnconfirmedAccounts: number;
  created7d: number;
  created30d: number;
  previousCreated7d: number;
  previousCreated30d: number;
  periods7d: Period;
  periods30d: Period;
  asOf: string;
  source: 'supabase';
  scope: 'current_surviving_reader_accounts';
  definition: string;
  historyLimitation: 'Deleted accounts are not included, so past creation totals can decrease.';
};
export type LeadershipMetrics = {
  operations: LeadershipOperations | null;
  activity: SiteMetricRecordTotals | null;
  accounts: LeadershipAccounts | null;
  asOf: string;
  errors: { operations: string | null; activity: string | null; accounts: string | null };
};

type Check = (value: unknown) => boolean;
const count: Check = (v) => Number.isSafeInteger(v) && Number(v) >= 0;
const text: Check = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 2048;
const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const literal =
  (expected: unknown): Check =>
  (v) =>
    v === expected;
function shape(fields: Record<string, Check>): Check {
  return (v) =>
    Boolean(
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.keys(v).length === Object.keys(fields).length &&
      Object.entries(fields).every(
        ([key, check]) => Object.hasOwn(v, key) && check((v as Record<string, unknown>)[key]),
      ),
    );
}
const date: Check = (value) => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const [hour, minute, second] = value.slice(11, 19).split(':').map(Number);
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= new Date(Date.UTC(year, month, 0)).getUTCDate() &&
    hour < 24 &&
    minute < 60 &&
    second < 60
  );
};
const period = shape({
  startsAt: date,
  endsAt: date,
  previousStartsAt: date,
  previousEndsAt: date,
});
const unknownCount = shape({ value: literal(null), reason: text });
const recordedCount = shape({ value: count, meaning: text });
const sourceNames = [
  'Minnesota bills',
  'Minnesota legislator roster',
  'Minnesota campaign payments',
  'Minnesota campaign filings',
  'Minnesota lobbying expenditures',
];
const freshness = shape({
  source: (v) => typeof v === 'string' && sourceNames.includes(v),
  lastSucceededAt: nullable(date),
  meaning: text,
  unavailableReason: nullable(text),
  currentPublishedFetchCompletedAt: nullable(date),
  publishedDataMeaning: text,
  publishedDataUnavailableReason: nullable(text),
});
const operations = shape({
  fetchedAt: date,
  periodStartedAt: date,
  periodEndedAt: date,
  corpus: shape({
    bills: count,
    legislators: count,
    current_legislators: count,
    committees: count,
    scope: text,
    coveragePercentage: unknownCount,
  }),
  freshness: (v) =>
    Array.isArray(v) &&
    v.length === sourceNames.length &&
    v.every(freshness) &&
    new Set(v.map((row) => row.source)).size === sourceNames.length,
  reliability: shape({
    recordedIngestionFailures: recordedCount,
    billSummaryFailures: recordedCount,
    billSummaryAmbiguous: recordedCount,
    allRequestFailures: unknownCount,
    allJobFailures: unknownCount,
  }),
  costs: shape({
    billSummaryLoggedCost: shape({
      valueMicrousd: nullable(count),
      requestsWithLoggedCost: count,
      requestsWithoutLoggedCost: count,
      status: (v) => ['available', 'partial', 'unavailable'].includes(String(v)),
      unavailableReason: nullable(text),
      meaning: text,
    }),
    totalOperatingCost: unknownCount,
  }),
});
const accounts = shape({
  currentAccountsCreated: count,
  currentConfirmedAccounts: count,
  currentUnconfirmedAccounts: count,
  created7d: count,
  created30d: count,
  previousCreated7d: count,
  previousCreated30d: count,
  periods7d: period,
  periods30d: period,
  asOf: date,
  source: literal('supabase'),
  scope: literal('current_surviving_reader_accounts'),
  definition: text,
  historyLimitation: literal(
    'Deleted accounts are not included, so past creation totals can decrease.',
  ),
});
function matchingPeriod(value: Period, days: number) {
  const span = days * 86400000;
  return (
    Date.parse(value.endsAt) - Date.parse(value.startsAt) === span &&
    Date.parse(value.previousEndsAt) === Date.parse(value.startsAt) &&
    Date.parse(value.previousEndsAt) - Date.parse(value.previousStartsAt) === span
  );
}

function safeCounts(value: unknown): boolean {
  if (typeof value === 'number') return count(value);
  return value === null || typeof value !== 'object' || Object.values(value).every(safeCounts);
}

/** Reject extra fields at every level so private account rows cannot cross this boundary. */
export function isLeadershipMetrics(value: unknown): value is LeadershipMetrics {
  if (
    !shape({
      operations: nullable(operations),
      activity: nullable((v) => isSiteMetricRecordTotals(v) && safeCounts(v)),
      accounts: nullable(accounts),
      asOf: date,
      errors: shape({
        operations: nullable(text),
        activity: nullable(text),
        accounts: nullable(text),
      }),
    })(value)
  )
    return false;
  const result = value as LeadershipMetrics;
  for (const source of ['operations', 'activity', 'accounts'] as const) {
    if ((result[source] === null) !== (result.errors[source] !== null)) return false;
  }
  const a = result.accounts;
  if (
    a &&
    (a.currentConfirmedAccounts + a.currentUnconfirmedAccounts !== a.currentAccountsCreated ||
      a.created7d > a.created30d ||
      a.created30d > a.currentAccountsCreated ||
      a.previousCreated7d > a.currentAccountsCreated ||
      a.previousCreated30d > a.currentAccountsCreated ||
      !matchingPeriod(a.periods7d, 7) ||
      !matchingPeriod(a.periods30d, 30))
  )
    return false;
  const o = result.operations;
  if (o) {
    if (
      o.corpus.current_legislators > o.corpus.legislators ||
      Date.parse(o.periodEndedAt) - Date.parse(o.periodStartedAt) !== 30 * 86400000 ||
      Date.parse(o.periodStartedAt) % 86400000 !== 0 ||
      Date.parse(o.periodEndedAt) % 86400000 !== 0 ||
      Date.parse(o.periodEndedAt) > Date.parse(o.fetchedAt)
    )
      return false;
    for (const row of o.freshness) {
      if (
        (row.lastSucceededAt === null) !== (row.unavailableReason !== null) ||
        (row.currentPublishedFetchCompletedAt === null) !==
          (row.publishedDataUnavailableReason !== null)
      )
        return false;
    }
    const c = o.costs.billSummaryLoggedCost;
    const expected =
      c.requestsWithLoggedCost === 0
        ? 'unavailable'
        : c.requestsWithoutLoggedCost > 0
          ? 'partial'
          : 'available';
    if (
      c.status !== expected ||
      (c.valueMicrousd === null) !== (c.requestsWithLoggedCost === 0) ||
      (c.unavailableReason === null) !== (c.status === 'available')
    )
      return false;
  }
  const activity = result.activity;
  if (activity) {
    if (!date(activity.fetchedAt)) return false;
    for (const [p, days] of [
      [activity.periods7d, 7],
      [activity.periods30d, 30],
    ] as const) {
      if (p && (!period(p) || !matchingPeriod(p, days))) return false;
    }
    if (
      activity.history &&
      !Object.values(activity.history).every((h) => nullable(date)(h.recordingStartedAt))
    )
      return false;
  }
  return true;
}

export function leadershipDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(new Date(value)) + ' UTC'
    : 'Not recorded yet';
}

const actionLabels: Array<[keyof SiteMetricActions, string]> = [
  ['newReaderAccounts', 'Accounts first used'],
  ['billSearchesWithResults', 'Bill searches with results'],
  ['legislatorSearchesWithResults', 'Legislator searches with results'],
  ['moneySearchesWithResults', 'Money searches with results'],
  ['findMyLegislatorWithResults', 'Address lookups with results'],
  ['officialSourceLinksOpened', 'Official source links opened'],
  ['newBillWatches', 'New bill follows'],
  ['newCommitteeWatches', 'New committee follows'],
];
export function leadershipActionRows(activity: SiteMetricRecordTotals, days: 7 | 30) {
  return actionLabels.map(([key, label]) => {
    const h = activity.history?.[key];
    const current = activity[days === 7 ? 'actions7d' : 'actions30d'][key];
    const previous = activity[days === 7 ? 'previousActions7d' : 'previousActions30d']?.[key];
    const recorded = Boolean(h?.recordingStartedAt) && typeof current === 'number';
    const complete = h?.[days === 7 ? 'current7dComplete' : 'current30dComplete'];
    const priorComplete = h?.[days === 7 ? 'previous7dComplete' : 'previous30dComplete'];
    return {
      label,
      current: !recorded
        ? 'Not recorded yet'
        : `${current.toLocaleString('en-US')}${complete ? '' : ' · Partial range'}`,
      previous:
        recorded && priorComplete && typeof previous === 'number'
          ? previous.toLocaleString('en-US')
          : recorded
            ? 'Unavailable'
            : 'Not recorded yet',
      note: recorded
        ? `Recording began ${leadershipDate(h?.recordingStartedAt ?? null)}${priorComplete ? '' : '. The previous range is incomplete.'}`
        : 'Recording history is unavailable.',
    };
  });
}
