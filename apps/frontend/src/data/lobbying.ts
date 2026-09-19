import { publicApiRequest } from './api';
import { LOBBYING_SEARCH_LIMIT } from '../lib/lobbyingSearch';
import {
  LOBBYING_PAGE_SIZE,
  lobbyingListOptions,
  lobbyingDonationYear,
  lobbyingDonationSort,
  type LobbyingIdentifier,
  type LobbyingListOptions,
  type LobbyingLobbyist,
  type LobbyingLobbyistsPage,
  type LobbyingPrincipal,
  type LobbyingPrincipalsPage,
  type LobbyingSourceStamp,
  type LobbyingSummary,
} from '../lib/lobbyingTypes';

export interface LobbyingResponse<T> {
  data: T;
}

/** Keep each response whole, including the distinct campaign-payment copy date. */
export function lobbyingFromPayload<T extends LobbyingSourceStamp>(
  payload: LobbyingResponse<T>,
): T {
  const data = payload?.data;
  if (!data || !('state' in data) || !('copied_at' in data) || !data.sources) {
    throw new Error('The lobbying response is incomplete.');
  }
  return data;
}

async function read<T extends LobbyingSourceStamp>(path: string, signal?: AbortSignal) {
  return lobbyingFromPayload(await publicApiRequest<LobbyingResponse<T>>(path, signal));
}

function listPath(kind: 'principals' | 'lobbyists', options: LobbyingListOptions) {
  const { q, page } = lobbyingListOptions(options);
  const params = new URLSearchParams({
    limit: String(LOBBYING_PAGE_SIZE),
    offset: String((page - 1) * LOBBYING_PAGE_SIZE),
  });
  if (q) params.set('q', q);
  if (kind === 'lobbyists') {
    const year = lobbyingDonationYear(options.year);
    if (year) params.set('year', String(year));
    const sort = lobbyingDonationSort(options.sort);
    // Always stated, never inferred. The app and the API deploy separately, so a
    // window where they disagree about the default would leave the directory
    // loading forever against its own request-matching guard.
    params.set('sort', sort);
  }
  return `/lobbying/${kind}?${params.toString()}`;
}

export function getLobbyingSummary(signal?: AbortSignal): Promise<LobbyingSummary> {
  return read<LobbyingSummary>('/lobbying/summary', signal);
}

export function getLobbyingPrincipal(
  entityId: LobbyingIdentifier,
  signal?: AbortSignal,
): Promise<LobbyingPrincipal> {
  return read<LobbyingPrincipal>(`/lobbying/principals/${encodeURIComponent(entityId)}`, signal);
}

export function getLobbyingLobbyist(
  registrationNumber: LobbyingIdentifier,
  signal?: AbortSignal,
): Promise<LobbyingLobbyist> {
  return read<LobbyingLobbyist>(
    `/lobbying/lobbyists/${encodeURIComponent(registrationNumber)}`,
    signal,
  );
}

export function getLobbyingPrincipals(
  options: LobbyingListOptions = {},
  signal?: AbortSignal,
): Promise<LobbyingPrincipalsPage> {
  return read<LobbyingPrincipalsPage>(listPath('principals', options), signal);
}

export function getLobbyingLobbyists(
  options: LobbyingListOptions = {},
  signal?: AbortSignal,
): Promise<LobbyingLobbyistsPage> {
  return read<LobbyingLobbyistsPage>(listPath('lobbyists', options), signal);
}

/** Five-row previews have distinct query keys from the 50-row directories. */
export function getLobbyingSearchLobbyists(q: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: String(LOBBYING_SEARCH_LIMIT), offset: '0', q });
  return read<LobbyingLobbyistsPage>(`/lobbying/lobbyists?${params}`, signal);
}
export function getLobbyingSearchPrincipals(q: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: String(LOBBYING_SEARCH_LIMIT), offset: '0', q });
  return read<LobbyingPrincipalsPage>(`/lobbying/principals?${params}`, signal);
}
