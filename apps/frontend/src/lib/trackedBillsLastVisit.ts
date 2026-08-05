// Holding the tracked-bills comparison point for a whole browser session (#1009).
//
// The server's "last viewed" mark advances to now the first time the page loads,
// so the PREVIOUS value has to be caught once and then held. Without that, a
// reload would re-read a mark the page had just written itself and every change
// would vanish from the screen — exactly the thing the reader came back to see.
//
// Two layers, because they survive different things. The module map survives a
// component remount, and is the only layer that exists on native. sessionStorage
// survives a page reload, which the map does not. Whichever answers first wins, so
// the round trip happens once per browser session and never again.
//
// Kept free of React and react-native imports so it is testable on its own — the
// test runner can't load a module that pulls in components.

import type { LastVisit } from './trackedBillsChanges';

// TWO facts, held separately and deliberately (#1034). They used to be one value,
// and collapsing them breaks the mechanism outright: if the homepage loads first
// and holds what it READ, the tracked list would later find something held, skip
// its write, and the server's mark would never advance again for that browser
// session — and the key survives a reload, so possibly never again at all.
//
//  1. the comparison point — shared, written by whichever surface asks first
//  2. whether THIS browser session has already advanced the mark — written only by
//     the tracked list, which is the one surface allowed to advance it
const HELD_IN_MEMORY = new Map<string, string>();
const ADVANCED_IN_MEMORY = new Set<string>();

// Per user: two people sharing a browser must not inherit each other's mark.
const storageKey = (userId: string) => `alethical.trackedBillsLastVisit.${userId}`;
const advancedKey = (userId: string) => `alethical.trackedBillsAdvanced.${userId}`;

// Absent on native, and throws rather than returning null in Safari private
// browsing — so every use is guarded and every failure is survivable.
function sessionStore(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The comparison point already held for this browser session: an ISO timestamp,
 *  or `''` for a reader with no recorded previous visit. `null` means nothing is
 *  held yet and the caller should ask the API.
 *
 *  Safe for a read-only caller — this never asks the API and so never advances
 *  the mark. Pass whatever it returns through `lastVisitFrom`, which maps its
 *  `null` to `not-checked` and only its `''` to `first-visit`; those two used to
 *  collapse into one value and the collapse read as "nothing has moved" (#1026). */
export function readHeldLastVisit(userId: string): string | null {
  const inMemory = HELD_IN_MEMORY.get(userId);
  if (inMemory !== undefined) return inMemory;
  const store = sessionStore();
  if (!store) return null;
  try {
    const stored = store.getItem(storageKey(userId));
    if (stored === null) return null;
    HELD_IN_MEMORY.set(userId, stored);
    return stored;
  } catch {
    return null;
  }
}

/** Hold a freshly fetched comparison point for the rest of the browser session. */
export function holdLastVisit(userId: string, value: string): void {
  HELD_IN_MEMORY.set(userId, value);
  const store = sessionStore();
  if (!store) return;
  try {
    store.setItem(storageKey(userId), value);
  } catch {
    // Storage full or blocked. The in-memory layer still holds the mark for this
    // mount; a reload then costs one request and shows a shorter window of
    // changes, never a wrong one.
  }
}

/** Has THIS browser session already advanced the server's mark for this reader?
 *
 *  Only the tracked list advances it, and only once per browser session. Kept apart
 *  from the comparison point because the homepage holds that too, by reading —
 *  and a read must never make the tracked list think the write already happened. */
export function hasAdvancedThisSession(userId: string): boolean {
  if (ADVANCED_IN_MEMORY.has(userId)) return true;
  const store = sessionStore();
  if (!store) return false;
  try {
    if (store.getItem(advancedKey(userId)) === null) return false;
    ADVANCED_IN_MEMORY.add(userId);
    return true;
  } catch {
    return false;
  }
}

/** Record that the tracked list has advanced the mark for this browser session, so
 *  a reload does not advance it a second time. */
export function markAdvancedThisSession(userId: string): void {
  ADVANCED_IN_MEMORY.add(userId);
  const store = sessionStore();
  if (!store) return;
  try {
    store.setItem(advancedKey(userId), '1');
  } catch {
    // See holdLastVisit. Worst case a reload advances the mark once more, which
    // shortens the window shown; it never reports a change that did not happen.
  }
}

/** Forget every held mark and every advanced flag. For tests, and for sign-out, so
 *  the next reader on this browser starts from their own visit rather than the
 *  previous one's. */
export function forgetHeldLastVisits(): void {
  HELD_IN_MEMORY.clear();
  ADVANCED_IN_MEMORY.clear();
}

/** Turn what the API or the hold gave us into the three-way answer the page needs
 *  (`LastVisit`, lib/trackedBillsChanges). This is where the two meanings of "no
 *  value" used to collapse into one null, which is the bug #1026 removed:
 *
 *  - **nothing at all** (`null`/`undefined`) — we have NOT asked. Not the same as
 *    a first visit, and it must not be reported as one.
 *  - **an empty string** — we asked, and the server has no previous visit for this
 *    reader. That is a genuine first visit.
 *  - **a usable timestamp** — we asked, and they had been here before.
 *  - **a non-empty string we cannot parse** — we asked and got something we cannot
 *    read, so we still do not know. Reported as not-checked, never as a first
 *    visit: "this is your first look" would be a claim we have no basis for. */
export function lastVisitFrom(held: string | null | undefined): LastVisit {
  if (held == null) return { state: 'not-checked' };
  if (held === '') return { state: 'first-visit' };
  const parsed = new Date(held);
  return isNaN(parsed.getTime())
    ? { state: 'not-checked' }
    : { state: 'previous-visit', at: parsed };
}
