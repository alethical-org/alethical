/** Public report state only; never carry arbitrary parameters into shared links. */
const common = ['election', 'race', 'q', 'list', 'page', 'from', 'fromq'];
const funder = [
  'fq',
  'start',
  'end',
  'fpage',
  'funder',
  'panel',
  'fcpage',
  'fdpage',
  'ffpage',
  'fapage',
  'fupage',
  'fopage',
];
const comparison = [
  'reports',
  'externalReports',
  'pq',
  'ppage',
  'pay',
  'paypage',
  'source',
  'votesView',
  'outView',
];
const expense = [
  'expenseQuery',
  'expenseReports',
  'expenseExcluded',
  'expenseCandidate',
  'expenseCandidatePage',
  'expensePayeePage',
  'expensePaymentsPage',
  'expensePayeeQuery',
  'expenseSearchPage',
  'expensePayee',
  'expenseSource',
];
export function reportHref(location: URL, mode: 'comparison' | 'funders' | 'expenses') {
  const allowed = new Set([
    ...common,
    // Reports open from the comparison and return to its selected filing and precinct scope.
    ...comparison,
    ...(mode === 'funders' ? funder : mode === 'expenses' ? expense : []),
  ]);
  const params = new URLSearchParams();
  for (const [key, value] of location.searchParams) if (allowed.has(key)) params.set(key, value);
  params.set('report', mode);
  return location.pathname + '?' + params;
}
export function funderReturnHref(location: URL): string | null {
  const raw = location.searchParams.get('freturn');
  if (!raw || !raw.startsWith('?') || raw.length > 8000) return null;
  const query = new URLSearchParams(raw);
  if (
    query.get('report') !== 'funders' ||
    query.get('election') !== location.searchParams.get('election')
  )
    return null;
  const target = new URL(location.pathname, location.origin);
  target.search = query.toString();
  return reportHref(target, 'funders');
}
export function changeElection(location: URL, election: string) {
  const params = new URLSearchParams();
  params.set('election', election);
  const mode = location.searchParams.get('report');
  if (mode === 'expenses' || mode === 'funders') params.set('report', mode);
  for (const key of ['from', 'fromq']) {
    const value = location.searchParams.get(key);
    if (value) params.set(key, value);
  }
  if (!mode || mode === 'comparison') params.set('list', '1');
  return location.pathname + '?' + params;
}
