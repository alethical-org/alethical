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

const HELD_IN_MEMORY = new Map<string, string>();

// Per user: two people sharing a browser must not inherit each other's mark.
const storageKey = (userId: string) => `alethical.trackedBillsLastVisit.${userId}`;

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
 *  held yet and the caller should ask the API. */
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

/** Forget every held mark. For tests, and for sign-out, so the next reader on this
 *  browser starts from their own visit rather than the previous one's. */
export function forgetHeldLastVisits(): void {
  HELD_IN_MEMORY.clear();
}

/** The held value as a date to compare actions against: `null` on a first visit
 *  (nothing held, or a value that is not a usable timestamp), which the page
 *  renders as its first-visit state rather than as "everything moved". */
export function lastVisitDate(held: string | null | undefined): Date | null {
  if (!held) return null;
  const parsed = new Date(held);
  return isNaN(parsed.getTime()) ? null : parsed;
}
