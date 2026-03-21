import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createChatSessionFromApi,
  getChatSessionFromApi,
  listChatSessionsFromApi,
  sendChatMessageToApi,
} from '../data/api';
import {
  getBill,
  getCurrentUser,
  getLegislator,
  getLegislatorBills,
  getNotificationPreference,
  getRepresentativeLookup,
  listBills,
  listLegislators,
  listSavedPlaces,
  listTrackedBills,
  toggleTrackedBill,
  updateNotificationPreference,
} from '../data/mockData';
import { NotificationPreference } from '../data/types';
import { useAuth } from '../providers/AuthProvider';

export function useCurrentUser() {
  return useQuery({
    queryKey: ['current-user'],
    queryFn: getCurrentUser,
  });
}

export function useBills(query?: string) {
  return useQuery({
    queryKey: ['bills', query ?? ''],
    queryFn: () => listBills(query),
  });
}

export function useBill(billId: string) {
  return useQuery({
    queryKey: ['bill', billId],
    queryFn: () => getBill(billId),
  });
}

export function useLegislators(query?: string) {
  return useQuery({
    queryKey: ['legislators', query ?? ''],
    queryFn: () => listLegislators(query),
  });
}

export function useLegislator(legislatorId: string) {
  return useQuery({
    queryKey: ['legislator', legislatorId],
    queryFn: () => getLegislator(legislatorId),
  });
}

export function useLegislatorBills(legislatorId: string) {
  return useQuery({
    queryKey: ['legislator-bills', legislatorId],
    queryFn: () => getLegislatorBills(legislatorId),
  });
}

export function useTrackedBills(userId?: string) {
  return useQuery({
    queryKey: ['tracked-bills', userId ?? 'anon'],
    queryFn: () => listTrackedBills(userId ?? ''),
    enabled: Boolean(userId),
  });
}

export function useToggleTrackedBill(userId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (billId: string) => toggleTrackedBill(userId ?? '', billId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tracked-bills', userId ?? 'anon'] });
      void queryClient.invalidateQueries({ queryKey: ['bills'] });
      void queryClient.invalidateQueries({ queryKey: ['bill'] });
    },
  });
}

export function useRepresentativeLookup() {
  return useMutation({
    mutationFn: (address: string) => getRepresentativeLookup(address),
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
      subjectType: 'bill' | 'legislator' | 'general';
      subjectId?: string;
      seedPrompt?: string;
      subjectLabel?: string;
    }) =>
      createChatSessionFromApi(accessToken ?? '', input),
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
    mutationFn: (input: {
      key: keyof NotificationPreference;
      value: boolean;
    }) => updateNotificationPreference(userId ?? '', input.key, input.value),
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
