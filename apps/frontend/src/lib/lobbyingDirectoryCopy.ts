/** Fixed wording for the lazy lobbying landing and its 2 directories. */
export const LOBBYING_DIRECTORY_PAGE_SIZE = 50;
export type LobbyingDirectoryKind = 'lobbyists' | 'principals';

export const LOBBYING_DIRECTORY_COPY = {
  title: 'Lobbying',
  landingLabel: 'FOLLOW THE MONEY',
  directoryLabel: 'LOBBYING',
  back: 'Go back',
  intro:
    "Who is registered to lobby Minnesota's state government, which organisations they work for, and what those organisations report spending on lobbying each year",
  search: 'Search a lobbyist or an organisation by name',
  searchButton: 'Search',
  searchNote: 'Matched on the name as it was filed, exactly as typed',
  filter: 'Narrow by name, as filed',
  order: 'A TO Z',
  copiedLabel: 'FILES LAST COPIED',
  copiedNote:
    "When we last copied the Board's two lobbying files. Not the year a figure covers — each spending figure states its own year",
  coverageLabel: 'WHAT THIS RECORD DOES NOT COVER',
  currentOnly:
    'The lobbyist list is current only — who is registered on the copy date, with no past clients',
  annual: 'Spending is reported by calendar year, with reports due the following March',
  coverageCloser: 'These are properties of the record itself, not gaps we can close',
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
    intro: 'Everyone registered to lobby today, and the organisations each one represents',
    empty: 'No lobbyist is registered under that spelling today',
    loading: 'Loading registered lobbyists',
    unavailable:
      "We couldn't load the Board's current lobbyist list just now. This says nothing about who is registered.",
  },
  principals: {
    title: 'Principals',
    intro: "Organisations named in the Board's lobbying spending file or current lobbyist list",
    lane: 'The organisations that pay for lobbying, and what each one reports spending, year by year',
    empty: "No principal matches that spelling in the Board's files",
    loading: 'Loading principals',
    unavailable:
      "We couldn't load the Board's principal records just now. This says nothing about what was reported.",
  },
} as const;

export const MONEY_LANE_LOBBYING = {
  title: 'Lobbying',
  body: 'Who is registered to lobby the state, who they represent, and what those organisations report spending each year',
} as const;

const count = (value: number) => value.toLocaleString('en-US');

export function lobbyistLaneCount(value: number | null | undefined): string | null {
  return value == null ? null : `${count(value)} REGISTERED TODAY`;
}

export function principalLaneCount(
  value: number | null | undefined,
  year: number | null | undefined,
) {
  return value == null || year == null ? null : `${count(value)} REPORTED SPENDING FOR ${year}`;
}

export function lobbyingHeldYearsNote(firstYear: number | null | undefined): string | null {
  return firstYear == null ? null : `No lobbying spending held before ${firstYear}`;
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
