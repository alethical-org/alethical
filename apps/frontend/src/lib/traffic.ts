export type TrafficTotals = {
  pageViews24h: number;
  pageViews7d: number;
  pageViews30d: number;
  fetchedAt: string;
  windowEndedAt: string;
  countingStartedAt: string;
  teamExclusionConfigured: boolean;
};

const METHOD_START =
  'How we count: Vercel anonymously counts page loads without cookies or names. Vercel filters traffic it identifies as automated. Anything after ? or # in a page address is removed before counting.';
const TEAM_EXCLUSION = 'Browsing while signed into Alethical team accounts is not counted.';
const METHOD_END = 'Numbers refresh every few minutes.';

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

export function trafficMethodNote(teamExclusionConfigured: boolean): string {
  return [METHOD_START, teamExclusionConfigured ? TEAM_EXCLUSION : null, METHOD_END]
    .filter((part): part is string => Boolean(part))
    .join(' ');
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
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
