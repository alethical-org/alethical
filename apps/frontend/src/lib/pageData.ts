/**
 * The records `api/page.ts` already read, handed to the app inside the SAME first
 * response (issue #1966, acceptance criterion 2).
 *
 * The page function fetches each money page's JSON to build the factual snapshot
 * in `pageSnapshot.ts`. Until now nothing passed that JSON to the app, so React
 * Query started empty and asked the data service for the identical URL a second
 * later: 518 ms of pure duplicate on `/money/committees` with every cache warm,
 * and up to 2,975 ms when Cloudflare missed.
 *
 * Three properties, each one a way this could be wrong while looking right:
 *
 * - **The seed is the service's own JSON, unchanged.** Nothing here reshapes,
 *   rounds, re-totals or re-dates a figure; the app runs the same shaper on the
 *   seeded payload that it runs on a fetched one, so a seeded figure and a
 *   fetched figure cannot differ (`.claude/rules/grounded-answers.md` rule 12).
 * - **One read, so a figure and its date always agree.** A whole payload is
 *   seeded, never a figure lifted out of one, so the freshness date the page
 *   prints (`as_of`, `fetched_at`, `downloads_fetched_at`) is the date of the
 *   very read the figures came from.
 * - **A seed that is missing, mismatched or malformed falls back to fetching.**
 *   Never to a blank screen and never to a stale figure: an entry is keyed on the
 *   exact React Query key it answers, so a key the app does not ask for is simply
 *   never read, and a payload the shaper cannot read is dropped.
 *
 * Transport: a `<script type="application/json">` data block. It is not
 * executable, so `vercel.json`'s per-script-hash Content Security Policy does not
 * apply to it — the same reason the shell's existing `application/ld+json` blocks
 * need no hash. Nothing new is added to `script-src`.
 */

import { claimsSomethingCurrent, seededClaimAgeMs } from './currentClaimFreshness';

/** One seeded read: the query key it answers, and the payload the service sent. */
export interface PageDataEntry {
  key: readonly unknown[];
  payload: unknown;
  /**
   * How old this answer's validation already was, in milliseconds, when the page
   * function read it — measured from the response's `Age` header, not from 2
   * clocks subtracted (`lib/currentClaimFreshness.ts`).
   *
   * Optional, and its absence is not neutral: a seeded answer with no age is
   * treated as the oldest the whole chain allows, because the app cannot tell a
   * fresh answer from one a cache held. Only reads whose answer claims something
   * about the state of the world right now need it; a dated filing carries its
   * own date and does not expire.
   */
  validatedAgeMs?: number;
}

export const PAGE_DATA_ELEMENT_ID = 'alethical-page-data';

/**
 * The markers in `apps/frontend/public/index.html`. The block sits AFTER
 * `<div id="root">` and BEFORE the app bundle: after, so the parser reaches the
 * snapshot text first and a large payload cannot delay the first paint; before,
 * so the element exists by the time the deferred bundle runs.
 */
export const PAGE_DATA_MARKER_START = '<!--alethical:page-data-->';
export const PAGE_DATA_MARKER_END = '<!--/alethical:page-data-->';

/**
 * Escaped so the HTML parser can never leave the data block early. `<` cannot
 * appear at all afterwards, so no payload value can close the element; U+2028 and
 * U+2029 are escaped because they are line terminators to a JavaScript parser but
 * not to JSON. The money payloads carry filed names typed by 1,603 filers, which
 * is 1,603 chances for one stray character.
 */
function escapeJsonForHtml(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** The data block for this address, or an empty string where nothing was read. */
export function renderPageData(entries: readonly PageDataEntry[]): string {
  if (entries.length === 0) return '';
  const json = JSON.stringify(
    entries.map((entry) => ({
      key: entry.key,
      payload: entry.payload,
      // Written only where the page function measured one, so an entry that
      // never had an age does not gain a misleading `null` in the block.
      ...(typeof entry.validatedAgeMs === 'number' ? { validatedAgeMs: entry.validatedAgeMs } : {}),
    })),
  );
  return `<script type="application/json" id="${PAGE_DATA_ELEMENT_ID}">${escapeJsonForHtml(
    json,
  )}</script>`;
}

export function injectPageData(shellHtml: string, dataHtml: string): string {
  const start = shellHtml.indexOf(PAGE_DATA_MARKER_START);
  const end = shellHtml.indexOf(PAGE_DATA_MARKER_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error('page shell is missing its page-data markers');
  }
  return (
    shellHtml.slice(0, start + PAGE_DATA_MARKER_START.length) + dataHtml + shellHtml.slice(end)
  );
}

// --- The app's side ---

/**
 * Parsed once per load. The element is removed after parsing, so a 271 KB payload
 * does not sit in the document for the life of the page.
 */
let seededPayloads: Map<string, unknown> | null = null;

/**
 * When each seeded answer was validated, on THIS browser's clock, worked out once
 * at parse time and never recomputed.
 *
 * Separate from the payload map on purpose, and it outlives it: a payload is
 * consumed the first time a read asks for it, while React Query asks for the
 * payload and its age in an order this file does not control. Fixed at parse time
 * rather than computed per call for the same reason — a stamp derived from a
 * later `Date.now()` would report the same answer as fresher the longer the page
 * stayed open, which is the direction that hides staleness.
 */
let seededValidatedAt: Map<string, number> | null = null;

function loadSeededPayloads(): Map<string, unknown> {
  if (seededPayloads) return seededPayloads;
  const loaded = new Map<string, unknown>();
  const validatedAt = new Map<string, number>();
  seededPayloads = loaded;
  seededValidatedAt = validatedAt;
  const parsedAt = Date.now();
  try {
    if (typeof document === 'undefined') return loaded;
    const element = document.getElementById(PAGE_DATA_ELEMENT_ID);
    if (!element) return loaded;
    const text = element.textContent ?? '';
    element.remove();
    if (!text) return loaded;
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return loaded;
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const { key, payload, validatedAgeMs } = entry as Partial<PageDataEntry>;
      if (!Array.isArray(key)) continue;
      if (payload === null || typeof payload !== 'object') continue;
      const id = JSON.stringify(key);
      loaded.set(id, payload);
      // Only the reads whose answer claims something about the state of the world
      // right now. A dated filing is deliberately left alone: it carries the
      // period it covers and the day we copied it, and
      // `docs/architecture/campaign-finance-system-design.md` prefers an old
      // labelled figure to a blank one, so aging it out would trade a working
      // page for nothing. An unstamped read behaves exactly as it did before this
      // existed.
      //
      // An entry that carried no measured age still gets a stamp:
      // `seededClaimAgeMs` reads a missing age as the oldest the chain allows, so
      // the absence puts the answer at its deadline rather than making it look
      // new.
      if (claimsSomethingCurrent(key)) {
        validatedAt.set(id, parsedAt - seededClaimAgeMs(validatedAgeMs));
      }
    }
  } catch {
    // A block we cannot read leaves the map as it stands, and every read then
    // fetches exactly as it did before this existed.
  }
  return loaded;
}

/**
 * The payload seeded for one query key, once. Consuming it means a later refetch
 * of the same key goes to the data service, so a reader who sits on a page still
 * gets fresh records rather than the first response's copy forever.
 */
export function takeSeededPayload<T>(key: readonly unknown[]): T | undefined {
  const payloads = loadSeededPayloads();
  const id = JSON.stringify(key);
  if (!payloads.has(id)) return undefined;
  const payload = payloads.get(id);
  payloads.delete(id);
  return payload as T;
}

/**
 * A React Query `initialData` reader for one key. Returning `undefined` is how
 * React Query is told there is no initial data, so an absent or unreadable seed
 * leaves the query to fetch.
 *
 * `initialData` rather than a background refetch on purpose: the app's default
 * freshness window is 5 minutes (`lib/appQueryClient.ts`), so data present at the
 * first render is not stale and no request is made at all. The list is drawn in
 * the app's first paint, which is the same paint that clears the snapshot.
 */
export function seededQueryData<Payload, Data>(
  key: readonly unknown[],
  shape: (payload: Payload) => Data,
): () => Data | undefined {
  return () => {
    const payload = takeSeededPayload<Payload>(key);
    if (payload === undefined) return undefined;
    try {
      return shape(payload);
    } catch {
      // A payload the shaper cannot read is dropped rather than half-rendered.
      return undefined;
    }
  };
}

/**
 * When a seeded answer was validated, on this browser's clock, for React Query's
 * `initialDataUpdatedAt`. `undefined` for every read that does not claim
 * something about the state of the world right now, which leaves React Query's
 * own behaviour untouched: it stamps the data at first render, exactly as it did
 * before this existed.
 *
 * Readable whether or not the payload has already been consumed, because React
 * Query asks for the data and its age in an order this file does not control.
 */
export function seededQueryDataUpdatedAt(key: readonly unknown[]): number | undefined {
  loadSeededPayloads();
  return seededValidatedAt?.get(JSON.stringify(key));
}

/**
 * Both halves of one seeded read, for spreading into a `useQuery` call.
 *
 * One function rather than 2 so a hook cannot take the data without its age. That
 * pairing is the point: an answer seeded with no age is stamped as fetched at
 * first render, which is exactly the defect issue 2023 was filed for, and it is
 * invisible at the call site because the page still draws perfectly.
 *
 * For a read of dated records the age is `undefined` and React Query behaves
 * exactly as it did before any of this existed.
 */
export function seededQuery<Payload, Data>(
  key: readonly unknown[],
  shape: (payload: Payload) => Data,
): { initialData: () => Data | undefined; initialDataUpdatedAt: number | undefined } {
  return {
    initialData: seededQueryData(key, shape),
    initialDataUpdatedAt: seededQueryDataUpdatedAt(key),
  };
}

/** Test seam: forget what this load parsed, so a case can seed a fresh document. */
export function resetSeededPayloadsForTests(): void {
  seededPayloads = null;
  seededValidatedAt = null;
}
