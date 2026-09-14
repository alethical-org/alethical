import { useLobbyingLobbyists } from '../../hooks/useLobbying';
import { committeeSlug } from '../../lib/committeeMoneyShared';
import { directoryPageNumber } from '../../lib/directoryPagination';
import { lobbyingPrincipalCount } from '../../lib/lobbyingDirectoryCopy';
import type { RootScreenProps } from '../../navigation/types';
import { LobbyingDirectoryPage } from './LobbyingPrincipalsScreen';

export function LobbyingLobbyistsScreen({
  navigation,
  route,
}: RootScreenProps<'LobbyingLobbyists'>) {
  const query = typeof route.params?.q === 'string' ? route.params.q : '';
  const page = directoryPageNumber(route.params?.page);
  const result = useLobbyingLobbyists({ q: query.trim() || undefined, page });
  const rows = (result.data?.lobbyists ?? []).map((row) => ({
    id: row.registration_number,
    name: row.name,
    slug: committeeSlug(row.name, row.registration_number),
    linkable: true,
    meta: lobbyingPrincipalCount(row.principal_count),
  }));
  return (
    <LobbyingDirectoryPage
      navigation={navigation}
      kind="lobbyists"
      query={query}
      page={page}
      result={result}
      rows={rows}
    />
  );
}
