/**
 * How old a displayed claim about who currently holds office, or whose committee
 * this currently is, is allowed to be — measured end to end rather than one hop
 * at a time (https://github.com/alethical-org/alethical/issues/2023).
 *
 * THE PROBLEM THIS SOLVES. Every hop already had a short limit and the limits did
 * not add up to a deadline on what a reader sees. A data answer may sit in the
 * API's shared cache; a page built around that answer may sit in the page cache;
 * and the answer embedded in that page reached the app's own store with no age at
 * all, so the app stamped it as fetched at first render whatever its real age and
 * then never asked again. Returning to a money tab rechecked bill reads only. So
 * the total was unbounded for an open tab, while each hop looked disciplined.
 *
 * THE ONE NUMBER is `CURRENT_CLAIM_MAX_AGE_MS`, and the 2 hop constants below
 * exist so it can be checked against the chain rather than asserted. Anyone
 * changing a cache window changes this arithmetic, and
 * `currentClaimDeadlineFitsTheChain` fails a test when the hops no longer fit.
 *
 * WHAT THIS IS NOT. It is not the filing period a figure covers
 * (`reported_through`), and it is not the day we copied a download from the Board
 * (`fetched_at`, `as_of`). Those are dates about records and they stay printed as
 * they are: a figure carrying its own date is allowed to be old, and
 * `docs/architecture/campaign-finance-system-design.md` prefers it to a blank.
 * A validation time is a different thing — the moment the origin last confirmed a
 * claim about the state of the world right now — and it is the only one of the 3
 * that expires.
 *
 * AGES HERE ARE DURATIONS, NEVER 2 CLOCKS SUBTRACTED. A reader's clock can be
 * wrong by hours, and `now - validated_at` across 2 machines would then read a
 * stale claim as fresh, which is the exact failure this file exists to stop. So
 * the origin serves the age it measured, every later hop adds the age it measured,
 * and the app adds only elapsed time from its own clock — deltas of one clock,
 * which cancel any offset.
 */

/**
 * The deadline. Past this, a current claim is withheld rather than drawn.
 *
 * 20 minutes, and it is the sum of what the chain can actually add:
 *
 * - up to 6 minutes in the API's shared cache before the page function reads the
 *   answer (`API_SHARED_CACHE_MAX_AGE_MS`),
 * - up to 10 minutes in the page cache before that page reaches a reader
 *   (`PAGE_SHARED_CACHE_MAX_AGE_MS`),
 * - leaving 4 minutes in the reader's own browser.
 *
 * The 4 minutes are a grace period, not a working window: a recheck takes under a
 * second, so the only reader who reaches the deadline is one whose recheck cannot
 * complete. That is the case the withholding is for.
 *
 * Shortening this is safe at any time. Lengthening it means being willing to name
 * a person as a committee's owner for longer after somebody has taken that
 * confirmation back, which is the identity error
 * `.claude/rules/grounded-answers.md` rule 3 exists to prevent.
 */
export const CURRENT_CLAIM_MAX_AGE_MS = 20 * 60_000;

/**
 * The worst age the API's shared cache can hand the next reader: `max-age=60`
 * plus `stale-while-revalidate=300` from `PUBLIC_CACHE_CONTROL`
 * (`alethical/api/routers/public.py`). The 4 reads carrying a current claim are
 * deliberately kept on that short window and off the 24-hour money-records one.
 */
export const API_SHARED_CACHE_MAX_AGE_MS = 360_000;

/**
 * The worst age the page cache can hand a reader: `s-maxage=300` plus the longer
 * of `stale-while-revalidate=300` and `stale-if-error=300` from `OK_CACHE` in
 * `api/page.ts`. A page delivered from that cache carries whatever answer was
 * embedded when it was built, so this is added to a seeded answer's own age.
 */
export const PAGE_SHARED_CACHE_MAX_AGE_MS = 600_000;

/**
 * Whether the deadline still covers the chain. A test asserts this, so raising a
 * cache window without raising the deadline fails rather than quietly producing a
 * claim older than the number we publish.
 */
export function currentClaimDeadlineFitsTheChain(): boolean {
  return API_SHARED_CACHE_MAX_AGE_MS + PAGE_SHARED_CACHE_MAX_AGE_MS <= CURRENT_CLAIM_MAX_AGE_MS;
}

/**
 * The reads whose answers carry a claim about the state of the world right now.
 *
 * These are the same 4 the API keeps off its long window, and they are named
 * there one at a time for the same reason they are named here: a list cannot let
 * a new read inherit a window by where its address sits. The line is not "does
 * the answer mention a person" — a donor named inside an accepted filing is a
 * dated record, and no later event makes yesterday's copy of it false. What
 * expires is a claim that somebody currently holds an office, or that a committee
 * currently belongs to a named member.
 *
 * - `committee-money` serves `confirmed_for`, the member a person signed off.
 * - `legislator-campaign-money` serves `link_state`.
 * - `campaign-finance-name-search` rows carry chamber, district and party.
 * - `campaign-finance-summary` counts who sits and how many links are live.
 *
 * `alethical/tests/test_api_contract.py` pins the API half and
 * `apps/frontend/src/lib/__tests__/currentClaimFreshness.test.ts` pins that this
 * list and that one name the same 4 reads, so they cannot drift apart.
 */
const CURRENT_CLAIM_QUERY_ROOTS = new Set([
  'committee-money',
  'legislator-campaign-money',
  'campaign-finance-name-search',
  'campaign-finance-summary',
]);

/** Whether this read's answer carries a claim that can expire. */
export function claimsSomethingCurrent(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0];
  return typeof root === 'string' && CURRENT_CLAIM_QUERY_ROOTS.has(root);
}

/** The read names above, for the test that holds them level with the API's list. */
export function currentClaimQueryRoots(): string[] {
  return [...CURRENT_CLAIM_QUERY_ROOTS].sort();
}

/**
 * How old an answer's validation was when it reached us, from what the caches
 * reported rather than from any clock comparison.
 *
 * `ageSeconds` is the HTTP `Age` header, which each shared cache increases by the
 * time it held the response. Absent means either a fresh answer from the origin
 * or a cache that did not say — and we cannot tell those apart, so an absent
 * header is read as the worst the window allows. Measure when we can, assume the
 * worst when we cannot: that is what keeps the published deadline true rather
 * than merely likely.
 */
export function servedClaimAgeMs(ageSeconds: number | null | undefined): number {
  if (typeof ageSeconds !== 'number' || !Number.isFinite(ageSeconds) || ageSeconds < 0) {
    return API_SHARED_CACHE_MAX_AGE_MS;
  }
  return Math.min(ageSeconds * 1000, API_SHARED_CACHE_MAX_AGE_MS);
}

/**
 * How old a claim embedded in a page's first response already was when it reached
 * the reader: the age the page function measured, plus the longest the page
 * itself can have sat in the page cache.
 *
 * A seed with no measured age is read as the worst the whole chain allows, which
 * puts it at the deadline on arrival. That is the safe direction and it is not
 * theoretical: it is what happens for any seeded read whose page function has not
 * been taught to pass the age on yet.
 */
export function seededClaimAgeMs(measuredAgeMs: number | null | undefined): number {
  const measured =
    typeof measuredAgeMs === 'number' && Number.isFinite(measuredAgeMs) && measuredAgeMs >= 0
      ? Math.min(measuredAgeMs, API_SHARED_CACHE_MAX_AGE_MS)
      : API_SHARED_CACHE_MAX_AGE_MS;
  return measured + PAGE_SHARED_CACHE_MAX_AGE_MS;
}

/**
 * Whether a claim this old may still be drawn. Exactly at the deadline it may
 * not: the deadline is the age we are willing to publish, so reaching it is
 * already past what we said.
 */
export function currentClaimIsWithheld(ageMs: number): boolean {
  return !(ageMs < CURRENT_CLAIM_MAX_AGE_MS);
}

/**
 * The age of a claim now: what it was when it reached us, plus the time our own
 * clock has measured since. One clock, so a wrong clock shifts both terms and
 * cancels.
 */
export function currentClaimAgeMs(options: {
  servedAgeMs: number;
  receivedAt: number;
  now: number;
}): number {
  const elapsed = Math.max(0, options.now - options.receivedAt);
  return options.servedAgeMs + elapsed;
}

/**
 * How long until a claim this old reaches the deadline, or 0 where it already has.
 *
 * A screen uses this to wake up exactly once at the moment the claim expires,
 * rather than polling. Without it a reader who leaves a page open passes the
 * deadline with the old name still drawn, because nothing re-renders on its own.
 */
export function msUntilCurrentClaimExpires(ageMs: number): number {
  return Math.max(0, CURRENT_CLAIM_MAX_AGE_MS - ageMs);
}

/**
 * The sentence a page prints where a confirmed member is withheld. It says what
 * happened and does not pretend the confirmation was withdrawn: those are
 * different facts, and `null` from the API already means "nobody has confirmed
 * one", so a withheld claim needs its own words rather than that state's.
 */
export const CONFIRMED_MEMBER_WITHHELD_LINE =
  'We are not naming whose committee this is right now. Someone at Alethical ' +
  'confirmed a member for it, but a confirmation can be taken back, and we have ' +
  'not been able to check that recently enough to repeat it here. The money on ' +
  'this page is the committee’s own filed record and is unaffected. Reload to ' +
  'try again.';

/**
 * The sentence a legislator's profile prints where their confirmed committees are
 * withheld.
 *
 * Its own words rather than the tab's "nobody has checked yet" panel, for the same
 * reason the committee page needs its own: that panel states nobody has confirmed a
 * committee for this member, and here somebody has. Saying so would replace a claim
 * we cannot vouch for with one that is plainly false.
 */
export function confirmedCommitteesWithheldLine(legislatorName: string): string {
  return (
    `We are not showing ${legislatorName}’s campaign committees right now. ` +
    'Someone at Alethical confirmed which committees are theirs, but a ' +
    'confirmation can be taken back, and we have not been able to check that ' +
    'recently enough to repeat it here. This says nothing about what they raised ' +
    'or spent. Reload to try again.'
  );
}
