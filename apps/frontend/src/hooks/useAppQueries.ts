import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  askFromApi,
  createChatSessionFromApi,
  BillListFilters,
  fetchBillVersionText,
  getFeaturedBillsFromApi,
  getBillFromApi,
  getBillVotesFromApi,
  getChatSessionFromApi,
  getCurrentUserFromApi,
  getLegislatorBillsFromApi,
  getMetaFromApi,
  getLegislatorFromApi,
  getLegislatorVotesFromApi,
  ListPagination,
  LegislatorListFilters,
  listChatSessionsFromApi,
  listBillsFromApi,
  listLegislatorsFromApi,
  listPolicyAreasFromApi,
  listSessionsFromApi,
  listTrackedBillsFromApi,
  lookupRepresentativeFromApi,
  sendChatMessageToApi,
  toggleTrackedBillFromApi,
} from '../data/api';
import {
  getNotificationPreference,
  listSavedPlaces,
  updateNotificationPreference,
} from '../data/mockData';
import { NotificationPreference, RepresentativeLookupInput } from '../data/types';
import { trackState, TrackState } from '../lib/trackedState';
import { useAuth } from '../providers/AuthProvider';

export function useCurrentUser() {
  const { accessToken, user } = useAuth();

  return useQuery({
    queryKey: ['current-user', user?.id ?? 'anon'],
    queryFn: () => getCurrentUserFromApi(accessToken ?? ''),
    enabled: Boolean(accessToken),
    retry: false,
  });
}

export function useAskAnswer(question?: string) {
  const trimmed = question?.trim();
  return useQuery({
    queryKey: ['ask', trimmed ?? ''],
    queryFn: () => askFromApi(trimmed!),
    enabled: Boolean(trimmed),
  });
}

export function useBills(
  query?: string,
  session?: string,
  filters: BillListFilters = {},
  pagination: ListPagination = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: [
      'bills',
      session ?? 'current',
      query ?? '',
      filters,
      pagination.limit ?? 20,
      pagination.offset ?? 0,
    ],
    queryFn: () => listBillsFromApi(query, session, filters, pagination),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
    retry: false,
  });
}

export function usePolicyAreas(session?: string, scope?: 'legislature') {
  return useQuery({
    queryKey: ['policy-areas', session ?? 'current', scope ?? 'session'],
    queryFn: () => listPolicyAreasFromApi(session, scope),
    retry: false,
  });
}

export function useSessions(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: listSessionsFromApi,
    retry: false,
    enabled: options.enabled ?? true,
  });
}

export function useMeta() {
  return useQuery({
    queryKey: ['meta'],
    queryFn: getMetaFromApi,
    retry: false,
  });
}

export function useBill(
  billId: string,
  options: { enabled?: boolean; includeVotes?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const includeVotes = options.includeVotes ?? true;
  const billQuery = useQuery({
    queryKey: ['bill', billId],
    queryFn: () => getBillFromApi(billId),
    retry: false,
    enabled,
  });
  const votesQuery = useQuery({
    queryKey: ['bill-votes', billId],
    queryFn: () => getBillVotesFromApi(billId),
    retry: false,
    enabled: enabled && includeVotes,
  });

  const bill = billQuery.data;
  const votes = votesQuery.data;
  return {
    ...billQuery,
    data: bill && votes ? { ...bill, votes, rollCallCount: votes.length } : bill,
    isLoading: billQuery.isLoading || (includeVotes && votesQuery.isLoading),
    voteError: votesQuery.error,
    voteIsLoading: includeVotes && votesQuery.isLoading,
  };
}

export function useFeaturedBills(billIds: readonly string[], options: { enabled?: boolean } = {}) {
  const featuredIds = billIds.map((billId) => billId.trim()).filter(Boolean);
  return useQuery({
    queryKey: ['featured-bills', featuredIds],
    queryFn: () => getFeaturedBillsFromApi(featuredIds),
    retry: false,
    enabled: (options.enabled ?? true) && featuredIds.length > 0,
  });
}

export function useBillVersionText(billId?: string, versionCode?: string) {
  return useQuery({
    queryKey: ['bill-version-text', billId, versionCode],
    queryFn: () => fetchBillVersionText(billId!, versionCode!),
    retry: false,
    enabled: !!billId && !!versionCode,
  });
}

export function useLegislators(
  query?: string,
  session?: string,
  filters: LegislatorListFilters = {},
) {
  return useQuery({
    queryKey: ['legislators', session ?? 'current', query ?? '', filters],
    queryFn: () => listLegislatorsFromApi(query, session, filters),
    retry: false,
  });
}

export function useLegislator(legislatorId: string) {
  return useQuery({
    queryKey: ['legislator', legislatorId],
    queryFn: () => getLegislatorFromApi(legislatorId),
    retry: false,
  });
}

export function useLegislatorVotes(legislatorId: string, limit = 1) {
  return useQuery({
    queryKey: ['legislator-votes', legislatorId, limit],
    queryFn: () => getLegislatorVotesFromApi(legislatorId, limit),
    enabled: Boolean(legislatorId),
    retry: false,
  });
}

// Warm the detail-page cache on navigation intent (card hover / press-in) so the
// bill or legislator is already loading — usually loaded — by the time the user
// clicks, replacing the full-page "Loading…" spinner with an instant open. Keys
// and query fns match useBill / useLegislator exactly, so the prefetched entry is
// the one the detail screen reads; prefetchQuery honors the default staleTime, so
// hovering a whole list fetches each target at most once per freshness window.
export function usePrefetchBill() {
  const queryClient = useQueryClient();
  return (billId: string) =>
    void queryClient.prefetchQuery({
      queryKey: ['bill', billId],
      queryFn: () => getBillFromApi(billId),
      retry: false,
    });
}

export function usePrefetchBillVotes() {
  const queryClient = useQueryClient();
  return (billId: string) =>
    void queryClient.prefetchQuery({
      queryKey: ['bill-votes', billId],
      queryFn: () => getBillVotesFromApi(billId),
    });
}

export function usePrefetchLegislator() {
  const queryClient = useQueryClient();
  return (legislatorId: string) =>
    void queryClient.prefetchQuery({
      queryKey: ['legislator', legislatorId],
      queryFn: () => getLegislatorFromApi(legislatorId),
      retry: false,
    });
}

// Warm the bill-list cache for a filter combo the user is about to select
// (chip hover), so the filtered results are already loading — usually loaded —
// by the time they tap, making the swap feel instant instead of waiting on a
// fresh GET /bills round trip (#492). The key must match useBills exactly so
// the prefetched entry is the one the list reads; prefetchQuery honors the
// default staleTime, so hovering across chips fetches each combo at most once
// per freshness window.
export function usePrefetchBills() {
  const queryClient = useQueryClient();
  return (
    query: string | undefined,
    session: string | undefined,
    filters: BillListFilters,
    pagination: ListPagination,
  ) =>
    void queryClient.prefetchQuery({
      queryKey: [
        'bills',
        session ?? 'current',
        query ?? '',
        filters,
        pagination.limit ?? 20,
        pagination.offset ?? 0,
      ],
      queryFn: () => listBillsFromApi(query, session, filters, pagination),
      retry: false,
    });
}

export function useLegislatorBills(legislatorId: string, pagination: ListPagination = {}) {
  return useQuery({
    queryKey: [
      'legislator-bills',
      legislatorId,
      pagination.limit ?? 20,
      pagination.offset ?? 0,
      pagination.role ?? 'all',
      pagination.session ?? 'current',
    ],
    queryFn: () => getLegislatorBillsFromApi(legislatorId, pagination),
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function useTrackedBills(userId?: string) {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: ['tracked-bills', userId ?? 'anon'],
    queryFn: () => listTrackedBillsFromApi(accessToken ?? ''),
    enabled: Boolean(userId && accessToken),
    retry: false,
  });
}

// What the Track button honestly knows about this reader's tracked state, plus the
// way out when the answer never came (#1013, #1021). Kept next to the query it reads
// so the two cannot drift, and deliberately NOT derived from `isLoading` or
// `isPending` — see the comment block in `lib/trackedState.ts` for why neither flag
// alone is correct on this version of React Query.
//
// `recheck` refetches the ONE shared query every Track button on the page reads
// (`['tracked-bills', userId]`), so a single press resolves every unresolved button
// at once. That is the design's "one press fixes the page", and it needs no
// coordination — it falls out of every button already sharing one query key. The same
// sharing is why the extra observers cost nothing: measured A/B against main, page
// load fires the same number of requests with and without these subscriptions.
export function useTrackedListState(): {
  state: (isTracked: boolean) => TrackState;
  isError: boolean;
  recheck: () => void;
} {
  const { isSignedIn, user } = useAuth();
  const trackedQuery = useTrackedBills(user?.id);
  const hasList = trackedQuery.data !== undefined;
  const isError = trackedQuery.isError;
  return {
    state: (isTracked: boolean) => trackState({ isSignedIn, hasList, isError, isTracked }),
    // Only ever true for a signed-in reader with no list to fall back on: a
    // signed-out visitor's state is not unknown, so no page should show them a
    // failure notice about a list they do not have.
    isError: isSignedIn && !hasList && isError,
    recheck: () => void trackedQuery.refetch(),
  };
}

export function useToggleTrackedBill(userId?: string) {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();

  return useMutation({
    mutationFn: (billId: string) => toggleTrackedBillFromApi(accessToken ?? '', billId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tracked-bills', userId ?? 'anon'] });
      void queryClient.invalidateQueries({ queryKey: ['bills'] });
      void queryClient.invalidateQueries({ queryKey: ['bill'] });
    },
  });
}

export function useRepresentativeLookup() {
  return useMutation({
    mutationFn: (input: RepresentativeLookupInput) => lookupRepresentativeFromApi(input),
  });
}

export function useChatSessions(userId?: string) {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: ['chat-sessions', userId ?? 'anon'],
    queryFn: () => listChatSessionsFromApi(accessToken ?? ''),
    enabled: Boolean(userId && accessToken),
    retry: false,
  });
}

export function useChatSession(userId: string | undefined, sessionId: string | undefined) {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: ['chat-session', userId ?? 'anon', sessionId ?? 'new'],
    queryFn: () => getChatSessionFromApi(accessToken ?? '', sessionId ?? ''),
    enabled: Boolean(userId && sessionId && accessToken),
    retry: false,
  });
}

export function useCreateChatSession(userId?: string) {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();

  return useMutation({
    mutationFn: (input: {
      title: string;
      subjectType: 'bill';
      subjectId?: string;
      seedPrompt?: string;
      subjectLabel?: string;
    }) => createChatSessionFromApi(accessToken ?? '', input),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ['chat-sessions', userId ?? 'anon'] });
      queryClient.setQueryData(['chat-session', userId ?? 'anon', session.id], session);
    },
  });
}

export function useSendChatMessage(userId?: string) {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();

  return useMutation({
    mutationFn: (input: { sessionId: string; text: string }) =>
      sendChatMessageToApi(accessToken ?? '', input),
    onSuccess: (session) => {
      if (!session) {
        return;
      }

      queryClient.setQueryData(['chat-session', userId ?? 'anon', session.id], session);
      void queryClient.invalidateQueries({ queryKey: ['chat-sessions', userId ?? 'anon'] });
    },
  });
}

export function useNotificationPreference(userId?: string) {
  return useQuery({
    queryKey: ['notification-preference', userId ?? 'anon'],
    queryFn: () => getNotificationPreference(userId ?? ''),
    enabled: Boolean(userId),
  });
}

export function useUpdateNotificationPreference(userId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { key: keyof NotificationPreference; value: boolean }) =>
      updateNotificationPreference(userId ?? '', input.key, input.value),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['notification-preference', userId ?? 'anon'],
      });
    },
  });
}

export function useSavedPlaces(userId?: string) {
  return useQuery({
    queryKey: ['saved-places', userId ?? 'anon'],
    queryFn: () => listSavedPlaces(userId ?? ''),
    enabled: Boolean(userId),
  });
}
