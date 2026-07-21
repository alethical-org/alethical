import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  askFromApi,
  createChatSessionFromApi,
  BillListFilters,
  getBillFromApi,
  getChatSessionFromApi,
  getCurrentUserFromApi,
  getLegislatorBillsFromApi,
  getMetaFromApi,
  getLegislatorFromApi,
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
  });
}

export function usePolicyAreas(session?: string) {
  return useQuery({
    queryKey: ['policy-areas', session ?? 'current'],
    queryFn: () => listPolicyAreasFromApi(session),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: listSessionsFromApi,
  });
}

export function useMeta() {
  return useQuery({
    queryKey: ['meta'],
    queryFn: getMetaFromApi,
  });
}

export function useBill(billId: string) {
  return useQuery({
    queryKey: ['bill', billId],
    queryFn: () => getBillFromApi(billId),
    retry: false,
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
