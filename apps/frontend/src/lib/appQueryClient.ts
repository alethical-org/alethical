import { QueryClient } from '@tanstack/react-query';

import { shouldRefreshBillQuery } from './billFreshness';
import { claimsSomethingCurrent } from './currentClaimFreshness';

export const APP_QUERY_STALE_TIME = 5 * 60_000;

/**
 * Which reads a returning reader gets rechecked.
 *
 * Two questions, not one, and they are different questions. A bill read can
 * display facts from a saved record whose status changes daily. A money read can
 * assert that somebody currently holds an office or that a committee currently
 * belongs to a named member, and a confirmation can be taken back
 * (`lib/currentClaimFreshness.ts`).
 *
 * The money half was missing, and it was the whole of issue 2023's open tab: every
 * money read goes through a key the bill set does not contain, so returning to a
 * money tab rechecked nothing at all and a person's name could sit on screen
 * indefinitely.
 *
 * Deliberately still not everything. A read of dated filings is left alone: it
 * carries the period it covers and the day we copied it, and rechecking it on
 * every tab switch would spend a request to redraw the same labelled figure.
 */
export function shouldRefreshOnReturn(queryKey: readonly unknown[]): boolean {
  return shouldRefreshBillQuery(queryKey) || claimsSomethingCurrent(queryKey);
}

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data we've already fetched stays fresh for 5 minutes and lingers in
        // memory for 30 minutes, so Back and quick returns remain instant.
        staleTime: APP_QUERY_STALE_TIME,
        gcTime: 30 * 60_000,
        // Once that window has passed, returning to the tab rechecks reads that
        // can carry a saved bill record or a claim about who currently holds
        // office. React Query shares an in-flight promise, so a focus/reconnect
        // burst cannot fan out duplicate requests.
        refetchOnWindowFocus: (query) => shouldRefreshOnReturn(query.queryKey),
        // Preserve React Query's existing reconnect behavior for ordinary reads,
        // but never replay the free-form Ask POST, which can generate an answer.
        refetchOnReconnect: (query) => query.queryKey[0] !== 'ask',
      },
    },
  });
}
