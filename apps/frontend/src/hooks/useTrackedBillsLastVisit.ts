import { useQuery } from '@tanstack/react-query';

import { markTrackedBillsViewedFromApi, readTrackedBillsLastViewedFromApi } from '../data/api';
import {
  hasAdvancedThisSession,
  holdLastVisit,
  markAdvancedThisSession,
  readHeldLastVisit,
} from '../lib/trackedBillsLastVisit';
import { useAuth } from '../providers/AuthProvider';

// Two hooks, because exactly one surface is allowed to move the mark forward.
//
// The tracked list is that surface: opening it IS the act of looking, so it reads
// the previous mark and advances it. Every other surface shows a SUBSET of what
// moved — the homepage's Session watch card shows two bills — and advancing there
// would mark six as seen when the reader saw two, which is information loss
// dressed as a feature (#1034).
//
// Both hooks share one comparison point, so the two pages measure the same window
// whichever loads first. What they do not share is the advanced-this-session flag
// (lib/trackedBillsLastVisit), which only the tracked list ever sets.

const QUERY_DEFAULTS = {
  retry: false,
  // Never re-run on its own: the answer is fixed for the whole browser session, and
  // on the advancing hook a second ask would move the mark again.
  staleTime: Infinity,
  gcTime: Infinity,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

/** When this reader PREVIOUSLY opened their tracked list, and mark it opened NOW.
 *  For the tracked-bills page only.
 *
 *  Returns an ISO timestamp, or `''` on their first ever visit. `undefined` while
 *  loading: the page waits rather than rendering "first visit" and correcting
 *  itself.
 *
 *  Advances the server's mark exactly once per browser session — guarded on the
 *  advanced flag, not on whether a comparison point is held, because the homepage
 *  may have already held one by reading. */
export function useTrackedBillsLastVisit(userId?: string) {
  const { accessToken } = useAuth();

  return useQuery({
    // A key of its OWN, not shared with the read-only hook below. They cache with
    // staleTime: Infinity, so one key would mean the homepage's read populates the
    // cache, the tracked page reuses it, its queryFn never runs, and the mark never
    // advances — the exact failure the split exists to prevent, reintroduced one
    // layer up. The shared state is the module-level hold, never the query cache.
    queryKey: ['tracked-bills-last-visit', 'advancing', userId ?? 'anon'],
    queryFn: async () => {
      if (hasAdvancedThisSession(userId!)) {
        // Already advanced this session, so the held value is the comparison point
        // and asking again would move the mark a second time.
        return readHeldLastVisit(userId!) ?? '';
      }
      const previous = await markTrackedBillsViewedFromApi(accessToken ?? '');
      const value = previous ?? '';
      // Hold the value the WRITE returned, not any value a read had held: they are
      // the same until something advances, and this one is authoritative.
      holdLastVisit(userId!, value);
      markAdvancedThisSession(userId!);
      return value;
    },
    enabled: Boolean(userId && accessToken),
    ...QUERY_DEFAULTS,
  });
}

/** When this reader last opened their tracked list, WITHOUT advancing the mark.
 *
 *  For any surface that reports on a subset — today the signed-in homepage. Same
 *  return shape as the advancing hook above, and the same held comparison point, so
 *  the two pages never disagree about the window they are describing.
 *
 *  `undefined` while loading is the caller's `not-checked` state, and it must render
 *  as such: it is NOT "nothing moved" and NOT "first visit" (#1026). Pass whatever
 *  comes back through `lastVisitFrom`, which keeps those three apart. */
export function useLastVisitWithoutAdvancing(userId?: string) {
  const { accessToken } = useAuth();

  return useQuery({
    // Separate key — see the note on the advancing hook above.
    queryKey: ['tracked-bills-last-visit', 'read-only', userId ?? 'anon'],
    queryFn: async () => {
      const held = readHeldLastVisit(userId!);
      if (held !== null) return held;
      const value = (await readTrackedBillsLastViewedFromApi(accessToken ?? '')) ?? '';
      // Holding what we READ is safe and is the point of sharing the key: the
      // tracked list keys its write off the advanced flag, so this cannot make it
      // skip advancing.
      holdLastVisit(userId!, value);
      return value;
    },
    enabled: Boolean(userId && accessToken),
    ...QUERY_DEFAULTS,
  });
}
