import { useQuery } from '@tanstack/react-query';

import { markTrackedBillsViewedFromApi } from '../data/api';
import { holdLastVisit, readHeldLastVisit } from '../lib/trackedBillsLastVisit';
import { useAuth } from '../providers/AuthProvider';

/** When this reader PREVIOUSLY opened their tracked list — the point the page's
 *  "what moved since you last looked" blocks are measured against (#1009). An ISO
 *  timestamp, or `''` on their first ever visit. `undefined` while it is still
 *  loading: the page waits rather than rendering "first visit" and then correcting
 *  itself.
 *
 *  Asking advances the server's mark, so it is asked once per browser session and
 *  the answer is held (lib/trackedBillsLastVisit). Every refetch trigger is off for
 *  the same reason — a second ask would move the mark again. */
export function useTrackedBillsLastVisit(userId?: string) {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: ['tracked-bills-last-visit', userId ?? 'anon'],
    queryFn: async () => {
      const held = readHeldLastVisit(userId!);
      if (held !== null) return held;
      const previous = await markTrackedBillsViewedFromApi(accessToken ?? '');
      const value = previous ?? '';
      holdLastVisit(userId!, value);
      return value;
    },
    enabled: Boolean(userId && accessToken),
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
