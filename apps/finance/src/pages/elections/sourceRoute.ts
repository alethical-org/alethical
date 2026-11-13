import type { RouteMatch } from '../../routes';

const HASH = /^[a-f0-9]{64}$/;
const VERSION = /^[a-f0-9]{16}$/;
const DATASETS = new Set(['contributions', 'independent_expenditures', 'expenditures']);
const ELECTION = /^mn-[0-9]{4}-[0-9]{2}-[0-9]{2}-(general|primary|special)$/;

/** The address carries only typed immutable IDs, never an origin or fetch path.
 * Authenticated bytes still come from the configured API through the existing
 * retained-source loader, which independently validates its allowed paths. */
export function retainedSourceSelection(match: RouteMatch, search: string, hash = '') {
  const { election, source } = match.params;
  if (!ELECTION.test(election ?? '') || hash) return null;
  const query = new URLSearchParams(search);
  const kind = query.get('kind');
  if (kind === 'analytics') {
    const snapshot = query.get('snapshot_id'),
      version = query.get('version');
    if (
      !DATASETS.has(source ?? '') ||
      [...query.entries()].length !== 3 ||
      query.getAll('kind').length !== 1 ||
      query.getAll('snapshot_id').length !== 1 ||
      query.getAll('version').length !== 1 ||
      !snapshot ||
      !HASH.test(snapshot) ||
      !version ||
      !VERSION.test(version)
    )
      return null;
    return {
      attachment: `finance/elections/${election}/analytics/sources/${source}?snapshot_id=${snapshot}&version=${version}`,
      election,
      source,
      pin: 'snapshot_id',
      value: snapshot,
    };
  }
  if (!HASH.test(source ?? '')) return null;
  if (kind === 'external') {
    const generation = query.get('generation_id');
    if (
      [...query.entries()].length !== 2 ||
      query.getAll('kind').length !== 1 ||
      !generation ||
      !HASH.test(generation)
    )
      return null;
    return {
      attachment: `finance/elections/${election}/external-finance/sources/${source}?generation_id=${generation}`,
      election,
      source,
      pin: 'generation_id',
      value: generation,
    };
  }
  if (kind === 'outside') {
    const snapshot = query.get('election_snapshot_id'),
      version = query.get('version'),
      release = query.get('release_id');
    if (
      [...query.entries()].length !== 4 ||
      query.getAll('kind').length !== 1 ||
      !snapshot ||
      !HASH.test(snapshot) ||
      !version ||
      !VERSION.test(version) ||
      !release ||
      !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(release)
    )
      return null;
    return {
      attachment: `finance/elections/${election}/outside-spending/source?election_snapshot_id=${snapshot}&version=${version}&release_id=${release}&source_hash=${source}`,
      election,
      source,
      pin: 'election_snapshot_id',
      value: snapshot,
    };
  }
  if (kind !== 'election' && kind !== 'report' && kind !== 'finance') return null;
  const pin = kind === 'election' ? 'snapshot_id' : 'collection_id';
  const entries = [...query.entries()];
  const value = query.get(pin);
  if (
    entries.length !== 2 ||
    query.getAll('kind').length !== 1 ||
    query.getAll(pin).length !== 1 ||
    !value ||
    !HASH.test(value)
  )
    return null;
  const prefix = `finance/elections/${election}/`;
  const path = `${prefix}${kind === 'election' ? '' : 'finance/'}sources/${source}${kind === 'finance' ? '/raw' : ''}?${pin}=${value}`;
  return { attachment: path, election, source, pin, value };
}
