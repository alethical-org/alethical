import { useQuery } from '@tanstack/react-query';

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
  const key = lobbyingLobbyistsQueryKey(options);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getLobbyingLobbyists(options, signal),
    ...seededQuery<LobbyingResponse<LobbyingLobbyistsPage>, LobbyingLobbyistsPage>(
      key,
      lobbyingFromPayload,
    ),
    retry: false,
  });
}
