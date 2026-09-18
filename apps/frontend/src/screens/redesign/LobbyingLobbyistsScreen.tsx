import { LobbyingDonationControls } from '../../components/lobbying/LobbyingDonationControls';
import {
  lobbyingDonationAmountLabel,
  LOBBYING_DONATION_SORTS,
} from '../../lib/lobbyingDonationDirectory';
import { lobbyingDonationYear, lobbyingDonationSort } from '../../lib/lobbyingTypes';
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
  const year = lobbyingDonationYear(route.params?.year);
  const sort = lobbyingDonationSort(route.params?.sort);
  const result = useLobbyingLobbyists({ q: query.trim() || undefined, page, year, sort });
  const responseMatches =
    result.data?.q === query.trim() &&
    result.data?.offset === (page - 1) * 50 &&
    (result.data?.requested_year ?? null) === (year ?? null) &&
    (result.data?.sort ?? 'name') === sort;
  const donations = responseMatches ? result.data?.donations : undefined;
  const rows = (result.data?.lobbyists ?? []).map((row) => ({
    id: row.registration_number,
    name: row.name,
    slug: committeeSlug(row.name, row.registration_number),
    linkable: true,
    meta: lobbyingPrincipalCount(row.principal_count),
    donationLabel: lobbyingDonationAmountLabel(row, donations?.year),
    year: donations?.year != null ? String(donations.year) : undefined,
  }));
  return (
    <LobbyingDirectoryPage
      navigation={navigation}
      kind="lobbyists"
      query={query}
      page={page}
      result={result}
      rows={rows}
      year={year ? String(year) : undefined}
      navigationYear={donations?.year != null ? String(donations.year) : undefined}
      sort={sort === 'name' ? undefined : sort}
      responseMatches={responseMatches}
      orderLabel={LOBBYING_DONATION_SORTS.find((item) => item.value === sort)?.label}
      controls={
        <LobbyingDonationControls
          donations={donations}
          sort={sort}
          requestedYear={year}
          loading={result.isPending || (!responseMatches && !result.isError)}
          onYear={(value) => navigation.setParams({ year: value || undefined, page: undefined })}
          onSort={(value) =>
            navigation.setParams({
              sort: value === 'name' ? undefined : value,
              page: undefined,
              ...(donations?.year != null ? { year: String(donations.year) } : {}),
            })
          }
        />
      }
    />
  );
}
