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

/** One seeded read: the query key it answers, and the payload the service sent. */
export interface PageDataEntry {
  key: readonly unknown[];
  payload: unknown;
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
  const json = JSON.stringify(entries.map((entry) => ({ key: entry.key, payload: entry.payload })));
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

function loadSeededPayloads(): Map<string, unknown> {
  if (seededPayloads) return seededPayloads;
  const loaded = new Map<string, unknown>();
  seededPayloads = loaded;
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
      const { key, payload } = entry as Partial<PageDataEntry>;
      if (!Array.isArray(key)) continue;
      if (payload === null || typeof payload !== 'object') continue;
      loaded.set(JSON.stringify(key), payload);
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

/** Test seam: forget what this load parsed, so a case can seed a fresh document. */
export function resetSeededPayloadsForTests(): void {
  seededPayloads = null;
}
