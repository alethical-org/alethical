import { MONEY_SECTION_NAME } from './moneySectionName';

/** Fixed wording for the lazy lobbying landing and its 2 directories. */
export const LOBBYING_DIRECTORY_PAGE_SIZE = 50;
export type LobbyingDirectoryKind = 'lobbyists' | 'principals';

export const LOBBYING_SOURCE_URL =
  'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/';

export const LOBBYING_DIRECTORY_COPY = {
  title: 'Lobbying',
  landingLabel: MONEY_SECTION_NAME.toUpperCase(),
  directoryLabel: 'LOBBYING',
  back: 'Go back',
  intro:
    'Find registered lobbyists, the organisations they represent, and what those organisations report spending on lobbying in Minnesota',
  search: 'Search by name',
  searchButton: 'Search',
  searchNote:
    'Search lobbyists and organisations by name. You can enter part of a name, but spelling is not corrected.',
  filter: 'Narrow by name, as filed',
  order: 'A TO Z',
  copiedLabel: 'FILES LAST COPIED',
  copiedNote:
    'We copied these lobbying records from the Minnesota Campaign Finance and Public Disclosure Board on this date',
  sourceLabel: 'View Minnesota’s lobbying source files',
  coverageLabel: 'ABOUT THESE RECORDS',
  currentOnly:
    'The lobbyist list shows who was registered and which clients they represented on the copy date. It does not show past clients.',
  annual: 'Spending is reported by calendar year.',
  loading: 'Loading lobbying records',
  unavailable:
    "We couldn't load the Board's lobbying records just now. This says nothing about who is registered or what was reported.",
  retry: 'Try again',
  emptyPage: 'No names on this page',
  firstPage: 'Go to the first page',
  noMatchWhy:
    'Names are matched as filed, and spellings vary between filings — try a shorter part of the name',
  lobbyists: {
    title: 'Lobbyists',
    lane: 'Registered lobbyists and the organisations they represent',
    intro:
      'Everyone registered to lobby when these files were copied, and the organisations each one represents',
    empty: 'No lobbyist is registered under that spelling today',
    loading: 'Loading registered lobbyists',
    unavailable:
      "We couldn't load the Board's current lobbyist list just now. This says nothing about who is registered.",
  },
  principals: {
    title: 'Principals',
    intro: "Organisations named in the Board's lobbying spending file or current lobbyist list",
    lane: 'Organisations listed in lobbying records and their reported spending by year',
    empty: "No principal matches that spelling in the Board's files",
    loading: 'Loading principals',
    unavailable:
      "We couldn't load the Board's principal records just now. This says nothing about what was reported.",
  },
} as const;

export const MONEY_LANE_LOBBYING = {
  title: 'Lobbying',
  body: 'Who is registered to lobby, who they represent, and what is reported spent',
} as const;

const count = (value: number) => value.toLocaleString('en-US');

/** /money names what is counted; its source box states the lobbying copy date. */
export function moneyLandingLobbyistCount(value: number | null | undefined): string | null {
  return value == null ? null : `${count(value)} REGISTERED LOBBYISTS`;
}

export function lobbyistLaneCount(value: number | null | undefined): string | null {
  return value == null ? null : `${count(value)} LOBBYISTS LISTED`;
}

export function principalLaneCount(
  value: number | null | undefined,
  year: number | null | undefined,
) {
  return value == null || year == null ? null : `${count(value)} REPORTED SPENDING FOR ${year}`;
}

export function lobbyingHeldYearsNote(firstYear: number | null | undefined): string | null {
  return firstYear == null ? null : `The spending records shown here begin in ${firstYear}.`;
}

export function lobbyingPrincipalCount(value: number): string {
  return `${count(value)} ${value === 1 ? 'principal' : 'principals'} today`;
}

export function lobbyingLatestYear(year: number | null): string | null {
  return year == null ? null : `Latest reported year ${year}`;
}

export function lobbyingNoSpendingRows(year: number | null): string {
  return year == null
    ? "No spending rows in the Board's file, so no page to open"
    : `No spending rows in the Board's file through ${year}, so no page to open`;
}

export function lobbyingShowingLine(
  kind: LobbyingDirectoryKind,
  page: number,
  shown: number,
  total: number,
): string {
  const noun =
    kind === 'lobbyists'
      ? total === 1
        ? 'registered lobbyist'
        : 'registered lobbyists'
      : total === 1
        ? 'principal'
        : 'principals';
  if (shown === 0 || (page === 1 && shown === total)) return `${count(total)} ${noun}`;
  const start = (page - 1) * LOBBYING_DIRECTORY_PAGE_SIZE + 1;
  return `Showing ${count(start)}–${count(start + shown - 1)} of ${count(total)} ${noun}`;
}
