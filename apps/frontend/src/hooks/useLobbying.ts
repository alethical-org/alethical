import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getLobbyingLobbyist,
  getLobbyingLobbyists,
  getLobbyingPrincipal,
  getLobbyingPrincipals,
  getLobbyingSummary,
  lobbyingFromPayload,
  type LobbyingResponse,
} from '../data/lobbying';
import {
  lobbyingListOptions,
  lobbyingDonationSort,
  lobbyingDonationYear,
  lobbyingLobbyistQueryKey,
  lobbyingLobbyistsQueryKey,
  lobbyingPrincipalQueryKey,
  lobbyingPrincipalsQueryKey,
  lobbyingSummaryQueryKey,
  type LobbyingIdentifier,
  type LobbyingListOptions,
  type LobbyingLobbyist,
  type LobbyingLobbyistsPage,
  type LobbyingPrincipal,
  type LobbyingPrincipalsPage,
  type LobbyingSummary,
} from '../lib/lobbyingTypes';
import { APP_QUERY_STALE_TIME } from '../lib/appQueryClient';
import { readerIsSavingData } from '../lib/dataSaving';
import { seededQuery } from '../lib/pageData';

function validId(id: LobbyingIdentifier | null | undefined): id is LobbyingIdentifier {
  return id !== null && id !== undefined && /^\d+$/.test(String(id)) && Number(id) > 0;
}

export function useLobbyingSummary() {
  const key = lobbyingSummaryQueryKey();
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getLobbyingSummary(signal),
    ...seededQuery<LobbyingResponse<LobbyingSummary>, LobbyingSummary>(key, lobbyingFromPayload),
    retry: false,
  });
}

export function useLobbyingPrincipal(entityId: LobbyingIdentifier | null | undefined) {
  const key = lobbyingPrincipalQueryKey(entityId);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getLobbyingPrincipal(entityId!, signal),
    ...seededQuery<LobbyingResponse<LobbyingPrincipal>, LobbyingPrincipal>(
      key,
      lobbyingFromPayload,
    ),
    enabled: validId(entityId),
    retry: false,
  });
}

export function useLobbyingLobbyist(
  registrationNumber: LobbyingIdentifier | null | undefined,
  enabled = true,
) {
  const key = lobbyingLobbyistQueryKey(registrationNumber);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getLobbyingLobbyist(registrationNumber!, signal),
    ...seededQuery<LobbyingResponse<LobbyingLobbyist>, LobbyingLobbyist>(key, lobbyingFromPayload),
    enabled: enabled && validId(registrationNumber),
    retry: false,
  });
}

export function useLobbyingPrincipals(options: LobbyingListOptions = {}) {
  const key = lobbyingPrincipalsQueryKey(options);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getLobbyingPrincipals(options, signal),
    ...seededQuery<LobbyingResponse<LobbyingPrincipalsPage>, LobbyingPrincipalsPage>(
      key,
      lobbyingFromPayload,
    ),
    retry: false,
  });
}

export function useLobbyingLobbyists(options: LobbyingListOptions = {}) {
  const client = useQueryClient();
  const { q, page } = lobbyingListOptions(options);
  const year = lobbyingDonationYear(options.year);
  const sort = lobbyingDonationSort(options.sort);
  const normalized = { q, page, year, sort };
  const key = lobbyingLobbyistsQueryKey(normalized);
  const result = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getLobbyingLobbyists(normalized, signal),
    ...seededQuery<LobbyingResponse<LobbyingLobbyistsPage>, LobbyingLobbyistsPage>(
      key,
      lobbyingFromPayload,
    ),
    staleTime: APP_QUERY_STALE_TIME,
    gcTime: 30 * 60_000,
    retry: false,
  });
  // Warm only the next numbered page after the requested read has settled. No
  // warming chain: a prefetched response never mounts this hook itself.
  useEffect(() => {
    if (
      !result.isSuccess ||
      result.isFetching ||
      !result.data?.has_more ||
      result.data.state !== 'reported' ||
      readerIsSavingData()
    )
      return;
    const next = {
      q,
      page: page + 1,
      year: year ?? result.data.donations?.year ?? undefined,
      sort,
    };
    const nextKey = lobbyingLobbyistsQueryKey(next);
    void client.prefetchQuery({
      queryKey: nextKey,
      queryFn: ({ signal }) => getLobbyingLobbyists(next, signal),
      staleTime: APP_QUERY_STALE_TIME,
      gcTime: 30 * 60_000,
      retry: false,
    });
    return () => {
      // Do not cancel a prepared request that the reader has now selected.
      const query = client.getQueryCache().find({ queryKey: nextKey, exact: true });
      if (query && query.getObserversCount() === 0)
        void client.cancelQueries({ queryKey: nextKey, exact: true });
    };
  }, [client, q, page, year, sort, result.data, result.isSuccess, result.isFetching]);
  return result;
}
