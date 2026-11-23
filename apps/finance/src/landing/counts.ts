/**
 * The landing page's record counts and source dates, read live from
 * `GET /api/v1/finance/landing/counts` (docs/architecture/alethical-finance-architecture.md
 * §9, Landing-page counts). A count the server could not read is left out, never
 * shown as 0; a date it could not support is left out, never guessed.
 */

export interface ServedCount {
  state: 'reported' | 'unavailable';
  count: number | null;
  first_year: number | null;
  last_year: number | null;
  copied_at: string | null;
  /** A calendar date the count speaks for, "YYYY-MM-DD", with no time of day. */
  as_of?: string | null;
  organizations?: number | null;
  roll_calls?: number | null;
  election_label?: string | null;
  results_status?: string | null;
}

export type CountKey =
  | 'national_fcc_filings'
  | 'campaign_money_records'
  | 'lobbying_spending_reports'
  | 'current_legislature_bills'
  | 'election_races_with_results'
  | 'tv_station_files';

export type ServedCounts = Partial<Record<CountKey, ServedCount>>;

export interface Figure {
  key: CountKey;
  count: number;
  value: string;
  label: string;
  span: string | null;
}

export interface FigureGroup {
  id: string;
  name: string;
  /** "As of Nov 18, 2026": the oldest date among the group's figures. */
  date: string | null;
  figures: Figure[];
}

const NUMBER = new Intl.NumberFormat('en-US');
const DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'America/Chicago',
});
// A date-only value names a calendar day, so it is read and printed in UTC and
// never moves to the day before.
const DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const LABELS: Record<Exclude<CountKey, 'tv_station_files'>, string> = {
  national_fcc_filings: 'FCC political ad filings',
  campaign_money_records: 'Campaign finance records',
  lobbying_spending_reports: 'Lobbying spending reports',
  current_legislature_bills: 'Bills',
  election_races_with_results: 'Races with reported results',
};

const GROUPS: { id: string; name: string; keys: (keyof typeof LABELS)[] }[] = [
  { id: 'lp-fig-national', name: 'NATIONWIDE', keys: ['national_fcc_filings'] },
  {
    id: 'lp-fig-minnesota',
    name: 'MINNESOTA',
    keys: [
      'campaign_money_records',
      'lobbying_spending_reports',
      'current_legislature_bills',
      'election_races_with_results',
    ],
  },
];

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function reported(served: ServedCount | undefined): served is ServedCount & { count: number } {
  return served?.state === 'reported' && positive(served.count);
}

function years(first: number | null, last: number | null, joiner: string): string | null {
  const start = positive(first) ? first : null;
  const end = positive(last) ? last : null;
  if (!start || !end) return start || end ? String(start || end) : null;
  return start === end ? String(start) : `${start}${joiner}${end}`;
}

/** "19.6 million", rounded down so the figure never claims more than is held. */
function value(key: CountKey, count: number): string {
  if (key === 'national_fcc_filings' && count >= 1_000_000) {
    return `${(Math.floor(count / 100_000) / 10).toFixed(1).replace(/\.0$/, '')} million`;
  }
  return NUMBER.format(count);
}

function spanFor(key: CountKey, served: ServedCount): string | null {
  if (key === 'national_fcc_filings') {
    return positive(served.first_year) ? `Indexed nationwide since ${served.first_year}` : null;
  }
  if (key === 'current_legislature_bills') {
    const legislature = years(served.first_year, served.last_year, '–');
    const votes = positive(served.roll_calls)
      ? `with ${NUMBER.format(served.roll_calls)} roll calls`
      : null;
    if (legislature && votes) return `${legislature} Legislature, ${votes}`;
    return legislature ? `${legislature} Legislature` : null;
  }
  if (key === 'election_races_with_results') {
    const election = served.election_label?.trim() || null;
    const status =
      served.results_status === 'unofficial'
        ? 'Results were unofficial at the time of this count.'
        : null;
    if (election && status) return `${election}. ${status}`;
    return election ?? status;
  }
  const period = years(served.first_year, served.last_year, ' to ');
  if (key === 'lobbying_spending_reports' && positive(served.organizations)) {
    const from = `From ${NUMBER.format(served.organizations)} organizations`;
    return period ? `${from}, ${period}` : from;
  }
  return period;
}

/** The figure's own date, "Nov 22, 2026", or null when the server gave none. */
export function dateOf(counts: ServedCounts, key: CountKey): string | null {
  const served = counts[key];
  if (!reported(served)) return null;
  if (served.as_of && /^\d{4}-\d{2}-\d{2}$/.test(served.as_of)) {
    const day = new Date(`${served.as_of}T00:00:00Z`);
    if (!Number.isNaN(day.getTime())) return DAY.format(day);
  }
  if (!served.copied_at) return null;
  const date = new Date(served.copied_at);
  return Number.isNaN(date.getTime()) ? null : DATE.format(date);
}

function instant(counts: ServedCounts, key: CountKey): number | null {
  const served = counts[key];
  if (!reported(served)) return null;
  const text = served.as_of ? `${served.as_of}T00:00:00Z` : served.copied_at;
  const time = text ? new Date(text).getTime() : NaN;
  return Number.isNaN(time) ? null : time;
}

/** The 2 figure groups in the drawing's order; an unreadable count has no tile
 * and a group with no readable count is left out. */
export function figureGroups(counts: ServedCounts): FigureGroup[] {
  return GROUPS.flatMap(({ id, name, keys }) => {
    const figures = keys.flatMap((key) => {
      const served = counts[key];
      if (!reported(served)) return [];
      return [
        {
          key,
          count: served.count,
          value: value(key, served.count),
          label: LABELS[key],
          span: spanFor(key, served),
        },
      ];
    });
    if (figures.length === 0) return [];
    // The oldest date, so the group's date never claims a newer copy than any
    // figure under it has. A figure without a date leaves the group undated.
    const times = figures.map(({ key }) => instant(counts, key));
    const oldest = times.every((time) => time !== null)
      ? figures[times.indexOf(Math.min(...(times as number[])))].key
      : null;
    return [{ id, name, date: oldest ? dateOf(counts, oldest) : null, figures }];
  });
}

/** "More than 20 million public records", from the figures on the page. */
export function recordsHeading(groups: FigureGroup[]): string {
  const total = groups.reduce(
    (sum, group) => sum + group.figures.reduce((part, figure) => part + figure.count, 0),
    0,
  );
  const millions = Math.floor(total / 1_000_000);
  return millions >= 1 ? `More than ${millions} million public records` : 'Public records';
}

export async function fetchCounts(
  apiBaseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<ServedCounts> {
  try {
    const response = await fetcher(`${apiBaseUrl}/api/v1/finance/landing/counts`);
    if (!response.ok) return {};
    const body = (await response.json()) as { data?: unknown } | null;
    const data = body?.data;
    return data && typeof data === 'object' ? (data as ServedCounts) : {};
  } catch {
    return {};
  }
}

/** The date the server gave for a count, "Sep 1, 2026", or null. */
export const copyDate = dateOf;
