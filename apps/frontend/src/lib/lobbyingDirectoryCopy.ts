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
  back: 'Back to Lobbying',
  intro:
    'Find registered lobbyists, the organisations they represent, and what those organisations report spending on lobbying in Minnesota',
  search: 'Search by name',
  searchButton: 'Search',
  searchNote: 'Find lobbyists or organisations using all or part of a name.',
  filter: 'Search by name',
  filterNote: 'Enter all or part of a name',
  order: 'A TO Z',
  copiedLabel: 'RECORDS LAST COPIED',
  copiedNote: 'These records come from the Minnesota Campaign Finance and Public Disclosure Board.',
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
    'Names are matched as filed, and spellings vary between filings; try a shorter part of the name',
  lobbyists: {
    title: 'Lobbyists',
    lane: 'People registered to influence government decisions on behalf of others',
    intro:
      'Lobbyists are people registered to influence government decisions. Browse who they represent in these records.',
    searchLabel: 'Search lobbyists by name',
    empty: 'No lobbyist is listed under that spelling in these records',
    loading: 'Loading registered lobbyists',
    unavailable:
      "We couldn't load the Board's lobbyist list just now. This says nothing about who was listed.",
  },
  principals: {
    title: 'Principals',
    intro: 'Browse organisations named in lobbying registrations or spending reports.',
    lane: 'People or organisations that fund lobbying and must report their spending under Minnesota law',
    definition:
      'The Board uses “principal” for a person or organisation that funds lobbying and must report its spending under Minnesota law.',
    searchLabel: 'Search organisations by name',
    empty: "No principal matches that spelling in the Board's files",
    loading: 'Loading principals',
    unavailable:
      "We couldn't load the Board's principal records just now. This says nothing about what was reported or registered.",
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
  return value == null || year == null
    ? null
    : `${count(value)} ORGANISATIONS REPORTED SPENDING FOR ${year}`;
}

export function lobbyingHeldYearsNote(firstYear: number | null | undefined): string | null {
  return firstYear == null ? null : `The spending records shown here begin in ${firstYear}.`;
}

export function lobbyingPrincipalCount(value: number): string {
  return `${count(value)} ${value === 1 ? 'client' : 'clients'} listed`;
}

export function lobbyingLatestYear(year: number | null): string | null {
  return year == null ? null : `Latest spending year in these records: ${year}`;
}

export function lobbyingLobbyistDirectoryDate(
  copiedAt: string | null | undefined,
  dateLabel: (date: string) => string,
): string | null {
  return copiedAt ? `Registrations shown as listed in records copied ${dateLabel(copiedAt)}` : null;
}

export function lobbyingPrincipalDirectoryScope(
  latestYear: number | null | undefined,
  copiedAt: string | null | undefined,
  dateLabel: (date: string) => string,
): string {
  const registrations = copiedAt
    ? ` and the lobbyist list copied ${dateLabel(copiedAt)}`
    : ' and lobbyist registrations';
  const year =
    latestYear == null ? '' : ` The Lobbying page’s spending count covers ${latestYear} only.`;
  return `This directory includes organisations from different reporting years${registrations}.${year}`;
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
