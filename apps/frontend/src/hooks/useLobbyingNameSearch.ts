import { useQuery } from '@tanstack/react-query';

import { getLobbyingSearchLobbyists, getLobbyingSearchPrincipals } from '../data/lobbying';
import { LOBBYING_SEARCH_MIN_LENGTH } from '../lib/lobbyingSearch';

/** Separate keys and abort signals prevent an older query replacing the submitted one. */
export function useLobbyingNameSearch(query: string) {
  const q = query.trim();
  const enabled = q.length >= LOBBYING_SEARCH_MIN_LENGTH;
  const options = { enabled, retry: false, refetchOnWindowFocus: false } as const;
  const lobbyists = useQuery({
    ...options,
    queryKey: ['lobbying-search-lobbyists', q],
    queryFn: ({ signal }) => getLobbyingSearchLobbyists(q, signal),
  });
  const principals = useQuery({
    ...options,
    queryKey: ['lobbying-search-principals', q],
    queryFn: ({ signal }) => getLobbyingSearchPrincipals(q, signal),
  });
  return { lobbyists, principals };
}
