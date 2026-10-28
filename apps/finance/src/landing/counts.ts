/**
 * The landing page's 4 record counts and source dates, read live from
 * `GET /api/v1/finance/landing/counts` (docs/architecture/alethical-finance-architecture.md
 * §9, Landing-page counts). A count the server could not read is left out, never
 * shown as 0; a date it could not support is left out of its source line.
 */

export interface ServedCount {
  state: 'reported' | 'unavailable';
  count: number | null;
  first_year: number | null;
  last_year: number | null;
  copied_at: string | null;
  organizations?: number | null;
}

export type CountKey =
  | 'campaign_money_records'
  | 'lobbying_spending_reports'
  | 'current_legislature_bills'
  | 'tv_station_files';

export type ServedCounts = Partial<Record<CountKey, ServedCount>>;

export interface Figure {
  key: CountKey;
  value: string;
  label: string;
  span: string | null;
}

const NUMBER = new Intl.NumberFormat('en-US');
const DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'America/Chicago',
});

const LABELS: Record<CountKey, string> = {
  campaign_money_records: 'Campaign money records',
  lobbying_spending_reports: 'Lobbying spending reports',
  current_legislature_bills: 'Bills',
  tv_station_files: 'TV station files on political ad time',
};

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

function spanFor(key: CountKey, served: ServedCount): string | null {
  if (key === 'current_legislature_bills') {
    const legislature = years(served.first_year, served.last_year, '–');
    return legislature ? `${legislature} Legislature` : null;
  }
  const period = years(served.first_year, served.last_year, ' to ');
  if (key === 'lobbying_spending_reports' && positive(served.organizations)) {
    const from = `From ${NUMBER.format(served.organizations)} organizations`;
    return period ? `${from}, ${period}` : from;
  }
  return period;
}

/** The tiles to draw, in the drawing's order; an unreadable count has no tile. */
export function figuresFrom(counts: ServedCounts): Figure[] {
  return (Object.keys(LABELS) as CountKey[]).flatMap((key) => {
    const served = counts[key];
    if (!reported(served)) return [];
    return [
      { key, value: NUMBER.format(served.count), label: LABELS[key], span: spanFor(key, served) },
    ];
  });
}

/** "Sep 1, 2026" in Minnesota time, or null when the server gave no date. */
export function copyDate(counts: ServedCounts, key: CountKey): string | null {
  const served = counts[key];
  if (!reported(served) || !served.copied_at) return null;
  const date = new Date(served.copied_at);
  return Number.isNaN(date.getTime()) ? null : DATE.format(date);
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
