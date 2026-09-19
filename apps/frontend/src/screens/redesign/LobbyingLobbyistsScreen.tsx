import { useState } from 'react';
import { LobbyistDirectoryCard } from '../../components/lobbying/LobbyistDirectoryCard';
import {
  LOBBYING_DEFAULT_DONATION_SORT,
  lobbyingDonationYear,
  lobbyingDonationSort,
} from '../../lib/lobbyingTypes';
import { useLobbyingLobbyists } from '../../hooks/useLobbying';
import { committeeSlug } from '../../lib/committeeMoneyShared';
import { directoryPageNumber } from '../../lib/directoryPagination';
import { lobbyingPrincipalCount } from '../../lib/lobbyingDirectoryCopy';
import { routePath } from '../../navigation/links';
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
    (result.data?.sort ?? LOBBYING_DEFAULT_DONATION_SORT) === sort;
  // Retain one complete successful response, including provenance and link years.
  // A failed replacement must not erase it; unmatched responses never become it.
  const [previous, setPrevious] = useState<typeof result.data>();
  const usable =
    responseMatches && (result.data?.state === 'reported' || result.data?.state === 'not_reported');
  const accepted = usable ? result.data : previous;
  const data = accepted ?? (responseMatches ? result.data : undefined);
  if (usable && result.data !== previous) setPrevious(result.data);
  const updateFailed = Boolean(accepted) && (result.isError || (responseMatches && !usable));
  const updating = Boolean(accepted) && (result.isFetching || !usable) && !updateFailed;
  const donations = data?.donations;
  const donationYear = donations?.year ?? null;
  const navigationYear = donationYear != null ? String(donationYear) : undefined;
  const served = data?.lobbyists ?? [];
  const rows = served.map((row) => ({
    id: row.registration_number,
    name: row.name,
    slug: committeeSlug(row.name, row.registration_number),
    linkable: true,
    meta: lobbyingPrincipalCount(row.principal_count),
    year: navigationYear,
    source: row,
  }));
  return (
    <LobbyingDirectoryPage
      navigation={navigation}
      kind="lobbyists"
      query={query}
      page={page}
      result={{ ...result, data }}
      retainResults={Boolean(accepted)}
      rows={rows}
      year={year ? String(year) : undefined}
      navigationYear={navigationYear}
      sort={sort === LOBBYING_DEFAULT_DONATION_SORT ? undefined : sort}
      responseMatches={accepted ? usable : responseMatches}
      renderResults={(state) => (
        <LobbyistDirectoryCard
          {...state}
          updating={updating}
          updateFailed={updateFailed}
          rows={rows.map((row) => ({
            id: row.id,
            name: row.name,
            meta: row.meta,
            amount: row.source,
            href: routePath.lobbyingLobbyist(row.slug, row.year),
            open: () =>
              navigation.push('LobbyingLobbyist', {
                slug: row.slug,
                ...(row.year ? { year: row.year } : {}),
              }),
          }))}
          donations={donations}
          donationYear={donationYear}
          sort={sort}
          requestedYear={year}
          onYear={(value) => navigation.setParams({ year: value || undefined, page: undefined })}
          onSort={(value) =>
            navigation.setParams({
              sort: value === LOBBYING_DEFAULT_DONATION_SORT ? undefined : value,
              page: undefined,
              ...((year ?? donationYear) ? { year: String(year ?? donationYear) } : {}),
            })
          }
        />
      )}
    />
  );
}
