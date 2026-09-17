import type { LobbyingLobbyistListRow, LobbyingPrincipalListRow } from './lobbyingTypes';

export const LOBBYING_SEARCH_LIMIT = 5;
export const LOBBYING_SEARCH_MIN_LENGTH = 3;
export const LOBBYING_SEARCH_COPY = {
  label: 'Search lobbying records',
  clear: 'Clear search',
  tooShort: 'Enter at least 3 characters',
  loading: 'Searching lobbying records',
  unavailable: 'We couldn’t search lobbying records just now. Please try again.',
  noMatchHint: 'Try a shorter part of the name',
  lobbyists: {
    title: 'Lobbyists',
    note: 'Registered lobbyists and the organisations they represent',
    empty: 'No lobbyists match this name',
    unavailable: 'We couldn’t search lobbyist records just now. Please try again.',
    more: 'View all matching lobbyists',
  },
  principals: {
    title: 'Principals',
    note: 'Organisations named in the Board’s lobbying spending file or lobbyist list',
    empty: 'No principals match this name',
    unavailable: 'We couldn’t search principal records just now. Please try again.',
    more: 'View all matching principals',
  },
};

export function lobbyingSearchTitle(query: string) {
  return `Results for “${query}”`;
}
export function lobbyingWiderSearchLabel(query: string) {
  return `Search all money records for “${query}”`;
}
export function lobbyingSearchCount(count: number | null) {
  return count == null
    ? null
    : count === 1
      ? '1 MATCH'
      : `${count.toLocaleString('en-US')} MATCHES`;
}
export function lobbyingResultMeta(row: LobbyingLobbyistListRow | LobbyingPrincipalListRow) {
  if ('registration_number' in row) {
    const n = row.principal_count;
    return `Registration ${row.registration_number} · ${n.toLocaleString('en-US')} ${n === 1 ? 'principal' : 'principals'} listed`;
  }
  return `Entity ${row.entity_id}${row.latest_reported_year == null ? '' : ` · Latest reported year ${row.latest_reported_year}`}`;
}
