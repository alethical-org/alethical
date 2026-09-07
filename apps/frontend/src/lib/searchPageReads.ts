/**
 * The 3 small reads behind the controls on `/bills` and `/legislators`: the issue
 * buttons, the session dropdown's label, and the freshness date under the count.
 *
 * They live here so `api/page.ts` can make them for the reader and hand the
 * answers to the app inside the SAME first response (issue #1996). Until then
 * the app made them itself, and on a phone the issue buttons landing pushed
 * roughly 300px of page down at once: `/bills` measured 0.29 against Google's
 * passing mark of 0.1, the worst address on the site.
 *
 * What has to be shared is the React Query KEY, not the read. A seeded entry is
 * matched to the query it answers by that key alone, so a key written out by hand
 * on one side and built on the other seeds nothing while the page still works —
 * the reader waits exactly as before and nothing anywhere reports a problem. A
 * builder both sides call cannot drift that way. The read path is here for the
 * same reason: a seeded payload has to be the answer to the very URL the app
 * would otherwise have asked for.
 *
 * The shapers that turn each payload into what the screen draws stay in
 * `data/api.ts`, beside the fetch they already shape, so a seeded value and a
 * fetched value run through the same code and cannot differ.
 */

/** Every issue in the taxonomy fits well inside this; the screen then shows the
 *  first few and puts the rest behind "More". */
export const POLICY_AREA_READ_LIMIT = 50;

export interface PolicyAreaRead {
  /** One named session's issues. Absent means the whole current Legislature. */
  session?: string;
  /** The resting `/bills` view covers the whole Legislature rather than one session. */
  scope?: 'legislature';
}

/** The issue buttons on `/bills`, with each issue's bill count. */
export function policyAreasQueryKey(read: PolicyAreaRead): readonly unknown[] {
  return ['policy-areas', read.session ?? 'current', read.scope ?? 'session'];
}

export function policyAreasReadPath(read: PolicyAreaRead): string {
  const params = new URLSearchParams();
  params.set('limit', String(POLICY_AREA_READ_LIMIT));
  if (read.session?.trim()) params.set('session', read.session.trim());
  if (read.scope) params.set('scope', read.scope);
  return `/policy-areas?${params.toString()}`;
}

/** The legislative sessions the session dropdown lists, and the label it shows. */
export function sessionsQueryKey(): readonly unknown[] {
  return ['sessions'];
}

export const SESSIONS_READ_PATH = '/sessions';

/** The date under a result count, saying how current the records are. */
export function metaQueryKey(): readonly unknown[] {
  return ['meta'];
}

export const META_READ_PATH = '/meta';
