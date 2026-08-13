import { QueryClient } from '@tanstack/react-query';

import { shouldRefreshBillQuery } from './billFreshness';

export const APP_QUERY_STALE_TIME = 5 * 60_000;

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data we've already fetched stays fresh for 5 minutes and lingers in
        // memory for 30 minutes, so Back and quick returns remain instant.
        staleTime: APP_QUERY_STALE_TIME,
        gcTime: 30 * 60_000,
        // Once that window has passed, returning to the tab rechecks only reads
        // that can carry a saved bill record. React Query shares an in-flight
        // promise, so a focus/reconnect burst cannot fan out duplicate requests.
        refetchOnWindowFocus: (query) => shouldRefreshBillQuery(query.queryKey),
        // Preserve React Query's existing reconnect behavior for ordinary reads,
        // but never replay the free-form Ask POST, which can generate an answer.
        refetchOnReconnect: (query) => query.queryKey[0] !== 'ask',
      },
    },
  });
}
