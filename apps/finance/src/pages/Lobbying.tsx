import { useEffect, useRef, type FormEvent } from 'react';

import {
  LOBBYING_DIRECTORY_COPY as COPY,
  LOBBYING_SOURCE_URL,
  lobbyingPrincipalCount,
} from '@alethical/shared/lobbyingDirectoryCopy';
import type {
  LobbyingLobbyistsPage,
  LobbyingPrincipalsPage,
  LobbyingSummary,
} from '@alethical/shared/lobbyingTypes';
import { lobbyingDonationYear } from '@alethical/shared/lobbyingTypes';
import { centralDateLabel } from '@alethical/shared/moneyLanding';
import { formatMoney } from '../ui/money';

import { apiPath, useRead, type Read } from '../api/read';
import { Link, useLocation } from '../router';
import { useLiveSearch } from '../search/useLiveSearch';
import { withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { ClearAll, Dropdown, Empty, LoadingRows, Refused, Tabs, Updating } from '../ui/controls';
import { RecordMark } from '../ui/marks';
import { Arrow, BackLink, SourcesAndUpdates } from '../ui/parts';
import { OfficialLink } from './lobbying/parts';
import './lobbying.css';

/** The server's own page size and maximum for both lobbying lists. */
export const PAGE_SIZE = 50;
/** The list routes refuse a longer name (q max_length 200). */
const MAX_QUERY = 200;

export type DirectoryTab = 'lobbyists' | 'principals';

export function tabFromParam(raw: string): DirectoryTab {
  return raw === 'principals' ? 'principals' : 'lobbyists';
}

export function pageFromParam(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 1 ? parsed : 1;
}

/** Each tab's sort orders, in the drawing's menu order; the first is its default. */
export const SORTS: Record<DirectoryTab, ReadonlyArray<{ value: string; label: string }>> = {
  lobbyists: [
    { value: 'name', label: 'Name A–Z' },
    { value: 'donations_desc', label: 'Contributions: highest first' },
    { value: 'donations_asc', label: 'Contributions: lowest first' },
  ],
  principals: [
    { value: 'spending_desc', label: 'Spending: highest first' },
    { value: 'spending_asc', label: 'Spending: lowest first' },
    { value: 'name', label: 'Name A–Z' },
  ],
};

/** The sort a tab opens on, or the one the address names when it is one of its own. */
export function sortFromParam(tab: DirectoryTab, raw: string): string {
  const own = SORTS[tab];
  return own.some((sort) => sort.value === raw) ? raw : own[0].value;
}

/** A year the address may name: a held lobbying year for principals, a completed
 * calendar year for lobbyist contributions (the server refuses the current one). */
export function yearFromParam(tab: DirectoryTab, raw: string): string {
  if (tab === 'lobbyists') return lobbyingDonationYear(raw) === undefined ? '' : raw;
  // The server accepts 2009 to 2100; any other year in the address is ignored.
  return /^\d{4}$/.test(raw) && Number(raw) >= 2009 && Number(raw) <= 2100 ? raw : '';
}

/**
 * One directory page, paged and searched on the server. The lobbyist list is
 * served on contribution order unless asked, so its sort is always sent; the
 * principals list is served on name order unless asked.
 */
export function listPath(
  tab: DirectoryTab,
  query: string,
  page: number,
  year = '',
  sort = '',
): string {
  const order = sortFromParam(tab, sort);
  return apiPath(['finance', 'lobbying', tab], {
    q: query || null,
    sort: tab === 'lobbyists' ? order : order === 'name' ? null : order,
    year: year || null,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
}

/** The whole directory's count for a tab, unfiltered. */
export function countPath(tab: DirectoryTab): string {
  return apiPath(['finance', 'lobbying', tab], {
    sort: tab === 'lobbyists' ? 'name' : null,
    limit: 1,
  });
}

export function pageCount(total: number | null): number {
  return Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));
}

/** Membership in this directory never establishes a current representation link. */
export function principalsNote(_copiedAt: string | null, _latestYear: number | null): string {
  return 'Includes names from past years; listing does not establish current representation';
}

export type PrincipalDirectoryRow = LobbyingPrincipalsPage['principals'][number] & {
  spending_year?: number | null;
  total_spent?: string | null;
  spending_state?: 'reported' | 'not_reported' | 'ambiguous';
};
type PrincipalsPage = Omit<LobbyingPrincipalsPage, 'principals'> & {
  year?: number | null;
  years?: number[];
  principals: PrincipalDirectoryRow[];
};
type Page = LobbyingLobbyistsPage | PrincipalsPage;

/** A principal row's figure for the selected year: that year's own filed total, or
 * why there is none. Never the latest total, never zero for a missing row. */
export function principalSpending(row: PrincipalDirectoryRow, _year: string | number): string {
  if (row.spending_state === 'ambiguous') return 'Amount unavailable: more than one report';
  if (row.spending_state === 'reported')
    return formatMoney(row.total_spent ?? null) ?? 'Amount not given';
  if (!row.linkable || row.spending_state === 'not_reported') return 'No spending report available';
  return 'Amount unavailable';
}

type LobbyistRow = LobbyingLobbyistsPage['lobbyists'][number];

/** A lobbyist row's contributions recorded in the selected year (Round 30): the
 * matched sum, "No matching contribution records", or "Amount unavailable" when any
 * matching amount is missing or unresolved, which withholds the whole sum. */
export function lobbyistContributions(row: LobbyistRow): string {
  if (row.donation_state === 'reported') {
    return formatMoney(row.donation_amount ?? null) ?? 'Amount unavailable';
  }
  if (row.donation_state === 'no_records') return 'No matching contribution records';
  return 'Amount unavailable';
}

function isLobbyists(page: Page | null): page is LobbyingLobbyistsPage {
  return page !== null && 'lobbyists' in page;
}
function isPrincipals(page: Page | null): page is PrincipalsPage {
  return page !== null && 'principals' in page;
}

const COUNT = (value: number) => value.toLocaleString('en-US');

const FAILED: Record<DirectoryTab, string> = {
  lobbyists: 'Couldn’t load the Board’s lobbyist list. This says nothing about who was listed.',
  principals:
    'Couldn’t load the Board’s principal records. This says nothing about what was reported or registered.',
};
const LABELS: Record<DirectoryTab, string> = {
  lobbyists: 'Lobbyists',
  principals: 'Who lobbyists represent',
};
const DEFINITIONS: Record<DirectoryTab, string> = {
  lobbyists: 'People registered to influence government decisions on behalf of others',
  principals: 'Individuals, companies, associations, unions, nonprofits and public bodies',
};
const NO_MATCH_HINT =
  'Names appear as filed and spellings can vary. Try a shorter part of the name.';

function Chevron({ next = false }: { next?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={next ? 'M9 5 L16 12 L9 19' : 'M15 5 L8 12 L15 19'}
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type Choices = { year: string; sort: string; page: number };

/** Each group owns its answer and its labels, even when the other group fails. */
function DirectoryGroup({
  tab,
  read,
  choices,
  query,
  here,
  preview,
  search,
  latestYear,
  onChange,
  viewAllHref,
}: {
  tab: DirectoryTab;
  read: Read<Page>;
  choices: Choices;
  query: string;
  here: string;
  preview: boolean;
  search: boolean;
  latestYear: number | null;
  onChange: (next: Partial<Choices>) => void;
  viewAllHref: string;
}) {
  const { year, sort, page } = choices;
  const reported = read.data && read.data.state !== 'unavailable' ? read.data : null;
  const total = reported?.total ?? null;
  const rows = isLobbyists(reported)
    ? reported.lobbyists
    : isPrincipals(reported)
      ? reported.principals
      : [];
  const rowCount = Math.min(rows.length, preview ? 5 : PAGE_SIZE);
  const servedParams = new URLSearchParams(read.dataPath?.split('?')[1]);
  const shownQuery = reported?.q ?? servedParams.get('q') ?? '';
  const answerYear = isLobbyists(reported)
    ? reported.donations?.year
    : isPrincipals(reported)
      ? reported.year
      : null;
  const listYear = answerYear != null ? String(answerYear) : (servedParams.get('year') ?? '');
  const years = isLobbyists(reported)
    ? (reported.donations?.available_years ?? [])
    : isPrincipals(reported)
      ? (reported.years ?? [])
      : [];
  const yearOptions = [...new Set([...(year ? [Number(year)] : []), ...years])].sort(
    (a, b) => b - a,
  );
  const defaultYear = tab === 'lobbyists' ? String(years[0] ?? '') : String(latestYear ?? '');
  const shownYear = year || defaultYear || listYear;
  const pages = pageCount(total);
  const shownPage = reported ? Math.floor((reported.offset ?? 0) / PAGE_SIZE) + 1 : page;
  const blocked = read.loading || read.pending || read.updating || read.failed || read.notFound;
  const empty = reported !== null && total === 0 && !blocked;
  const filtered = (year !== '' && year !== defaultYear) || sort !== SORTS[tab][0].value;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      !preview &&
      reported &&
      !blocked &&
      reported.offset === (page - 1) * PAGE_SIZE &&
      page > pages
    )
      onChange({ page: pages });
  }, [reported, blocked, page, pages, preview, onChange]);
  function goPage(next: number) {
    if (blocked) return;
    onChange({ page: next });
    list.current?.focus({ preventScroll: true });
    if (list.current)
      window.scrollTo({
        top: Math.max(0, list.current.getBoundingClientRect().top + window.scrollY - 20),
        behavior: 'smooth',
      });
  }
  return (
    <section aria-label={LABELS[tab]} className="lb-dir">
      {preview && (
        <h3 className="lb-group-title">
          {LABELS[tab]}
          {total !== null &&
            !read.failed &&
            !read.notFound &&
            !read.updating &&
            !read.loading &&
            ` (${COUNT(total)})`}
        </h3>
      )}
      {!search && <p className="lb-lane">{DEFINITIONS[tab]}</p>}
      {tab === 'principals' && <p className="lb-lane">{principalsNote(null, null)}</p>}
      {read.loading && <LoadingRows label={`Loading ${LABELS[tab].toLowerCase()}`} />}
      {(read.failed || read.notFound) && (
        <div className="lb-notice">
          <Refused onRetry={read.retry} retrying={read.pending}>
            {reported
              ? 'Couldn’t update results. Previous results are shown.'
              : FAILED[tab]}
          </Refused>
        </div>
      )}
      {read.updating && (
        <div className="lb-notice">
          <Updating />
        </div>
      )}
      {!empty && reported && (
        <div className="lb-controls">
          {yearOptions.length > 0 && (
            <Dropdown
              name={tab === 'lobbyists' ? 'Contribution year' : 'Spending year'}
              value={shownYear}
              options={yearOptions.map((value) => ({ value: String(value), label: String(value) }))}
              onChange={(next) => onChange({ year: next === defaultYear ? '' : next, page: 1 })}
            />
          )}
          <Dropdown
            name="Sort by"
            value={sort}
            options={SORTS[tab]}
            onChange={(next) => onChange({ sort: next, page: 1 })}
          />
          {filtered && (
            <ClearAll onClick={() => onChange({ year: '', sort: SORTS[tab][0].value, page: 1 })} />
          )}
        </div>
      )}
      <div
        ref={list}
        tabIndex={-1}
        className={`lb-results${empty && search ? ' lb-results-empty' : ''}`}
      >
        {reported && (
          <>
            {!preview && !empty && total !== null && total > 0 && (
              <div aria-live="polite" className="lb-count f-num">
                {rowCount
                  ? `Showing ${COUNT((shownPage - 1) * PAGE_SIZE + 1)}–${COUNT((shownPage - 1) * PAGE_SIZE + rowCount)} of ${COUNT(total)}${!search ? (tab === 'lobbyists' ? ' registered lobbyists' : ' represented people and organizations') : ''}`
                  : 'No matches'}
                {shownQuery ? ` matching “${shownQuery}”` : query ? ' for all names' : ''}
              </div>
            )}
            {preview && shownQuery !== query && (read.failed || read.notFound || read.updating) && (
              <p className="lb-count" role="status">
                {shownQuery
                  ? `Previous results matching “${shownQuery}”`
                  : 'Previous results for all names'}
              </p>
            )}
            {empty ? (
              search ? (
                <p className="lb-empty-group" role="status">
                  No matches
                </p>
              ) : (
                <Empty title="No matches" next={NO_MATCH_HINT} />
              )
            ) : (
              rowCount > 0 && (
                <>
                  <div role="table" aria-label={LABELS[tab]} className="lb-table">
                    <div role="row" className="lb-tr lb-head">
                      <span role="columnheader">Name</span>
                      <span role="columnheader">
                        {tab === 'lobbyists' ? 'Registration and clients' : 'State entity ID'}
                      </span>
                      <span role="columnheader" className="lb-third">
                        {tab === 'lobbyists'
                          ? 'Campaign contributions in'
                          : 'Reported lobbying spending in'}
                        {listYear && (
                          <>
                            {' '}
                            <span className="lb-head-year f-num">{listYear}</span>
                          </>
                        )}
                      </span>
                    </div>
                    {isLobbyists(reported) &&
                      reported.lobbyists.slice(0, preview ? 5 : PAGE_SIZE).map((row) => {
                        const figure = lobbyistContributions(row);
                        const held = row.donation_state === 'reported';
                        return (
                          <div role="row" key={row.registration_number} className="lb-tr">
                            <span role="cell" className="lb-name f-marked">
                              <RecordMark kind="person" />
                              {isBuilt('lobbyist') ? (
                                <Link
                                  to={`${withFrom(
                                    hrefFor(
                                      'lobbyist',
                                      { id: row.registration_number },
                                      { year: listYear || null },
                                    ),
                                    here,
                                  )}#contributions`}
                                  className="lb-name-link"
                                >
                                  {row.name}
                                </Link>
                              ) : (
                                <span>{row.name}</span>
                              )}
                            </span>
                            <span role="cell" className="lb-second f-num">
                              Registration number{'\u00a0'}
                              {row.registration_number}
                              <span className="lb-second-b">
                                {lobbyingPrincipalCount(row.principal_count)}
                              </span>
                            </span>
                            <span
                              role="cell"
                              className={`lb-third lb-figure ${held ? 'lb-strong' : 'lb-missing'} f-num`}
                            >
                              {listYear && (
                                <span className="lb-phone-only">
                                  Campaign contributions in {listYear}:{' '}
                                </span>
                              )}
                              <span className="lb-figure-value">{figure}</span>
                            </span>
                          </div>
                        );
                      })}
                    {isPrincipals(reported) &&
                      reported.principals.slice(0, preview ? 5 : PAGE_SIZE).map((row) => {
                        const rowYear = row.spending_year ?? listYear;
                        const href =
                          row.linkable && isBuilt('principal')
                            ? withFrom(
                                hrefFor(
                                  'principal',
                                  { id: String(row.entity_id) },
                                  {
                                    year: rowYear ? String(rowYear) : null,
                                  },
                                ),
                                here,
                              )
                            : null;
                        return (
                          <div role="row" key={row.entity_id} className="lb-tr">
                            <span role="cell" className="lb-name f-marked">
                              <RecordMark kind="organization" />
                              {href ? (
                                <Link to={href} className="lb-name-link">
                                  {row.name}
                                </Link>
                              ) : (
                                <span>{row.name}</span>
                              )}
                            </span>
                            <span role="cell" className="lb-second f-num">
                              <span className="lb-phone-only">State entity ID{'\u00a0'}</span>
                              {row.entity_id}
                            </span>
                            <span
                              role="cell"
                              className={`lb-third lb-figure ${row.spending_state === 'reported' ? 'lb-strong' : 'lb-missing'} f-num`}
                            >
                              {rowYear && (
                                <span className="lb-phone-only">
                                  Reported lobbying spending in {rowYear}:{' '}
                                </span>
                              )}
                              <span className="lb-figure-value">
                                {principalSpending(row, rowYear)}
                              </span>
                            </span>
                          </div>
                        );
                      })}
                  </div>

                  {!preview && pages > 1 && (
                    <nav aria-label="Pages" className="lb-pager">
                      <button
                        type="button"
                        className="f-btn f-btn-secondary lb-page-btn"
                        disabled={blocked || shownPage <= 1}
                        onClick={() => goPage(shownPage - 1)}
                      >
                        <Chevron />
                        Previous
                      </button>
                      <span aria-live="polite" className="lb-page-line f-num">
                        Page {COUNT(Math.min(shownPage, pages))} of {COUNT(pages)}
                      </span>
                      <button
                        type="button"
                        className="f-btn f-btn-secondary lb-page-btn"
                        disabled={blocked || shownPage >= pages}
                        onClick={() => goPage(shownPage + 1)}
                      >
                        Next
                        <Chevron next />
                      </button>
                    </nav>
                  )}
                  {preview && total !== null && total > 5 && (
                    <Link
                      to={viewAllHref}
                      className="lb-view-all"
                      aria-disabled={blocked || undefined}
                      onClick={(event) => {
                        if (blocked) event.preventDefault();
                      }}
                    >
                      {tab === 'lobbyists'
                        ? 'View all matching '
                        : 'View all matching represented people and '}
                      <span className="lb-view-all-end">
                        {tab === 'lobbyists' ? 'lobbyists' : 'organizations'}
                        <Arrow />
                      </span>
                    </Link>
                  )}
                </>
              )
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function Lobbying(_props: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const [address, setAddress] = useAddressState({
    tab: 'lobbyists',
    q: '',
    page: '1',
    year: '',
    sort: '',
    view: '',
    lobbyistsYear: '',
    lobbyistsSort: '',
    lobbyistsPage: '1',
    principalsYear: '',
    principalsSort: '',
    principalsPage: '1',
    lobbyistsSearchYear: '',
    lobbyistsSearchSort: '',
    lobbyistsSearchPage: '1',
    principalsSearchYear: '',
    principalsSearchSort: '',
    principalsSearchPage: '1',
  });
  const tab = tabFromParam(address.tab);
  const query = address.q.trim().slice(0, MAX_QUERY).trimEnd();
  const search = query !== '';
  const expanded =
    search && (address.view === 'lobbyists' || address.view === 'principals') ? address.view : null;
  function browseChoices(kind: DirectoryTab): Choices {
    return {
      year: yearFromParam(kind, kind === tab ? address.year : address[`${kind}Year`]),
      sort: sortFromParam(kind, kind === tab ? address.sort : address[`${kind}Sort`]),
      page: pageFromParam(kind === tab ? address.page : address[`${kind}Page`]),
    };
  }
  function choices(kind: DirectoryTab): Choices {
    const browse = browseChoices(kind);
    if (!search) return browse;
    // An explicit "default" keeps a cleared search filter separate from browse choices.
    const rawYear = address[`${kind}SearchYear`];
    const rawSort = address[`${kind}SearchSort`];
    return {
      year: rawYear === 'default' ? '' : rawYear ? yearFromParam(kind, rawYear) : browse.year,
      sort: rawSort ? sortFromParam(kind, rawSort) : browse.sort,
      page: expanded === kind ? pageFromParam(address[`${kind}SearchPage`]) : 1,
    };
  }
  const lobbyistChoices = choices('lobbyists');
  const principalChoices = choices('principals');
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const previousView = useRef(expanded);
  useEffect(() => {
    if (previousView.current !== expanded && search) resultsHeading.current?.focus();
    previousView.current = expanded;
  }, [expanded, search]);
  const readOptions = {
    keepPrevious: true,
    acceptData: (data: Page) => data.state !== 'unavailable',
  };
  const lobbyists = useRead<Page>(
    search || tab === 'lobbyists'
      ? listPath(
          'lobbyists',
          query,
          lobbyistChoices.page,
          lobbyistChoices.year,
          lobbyistChoices.sort,
        )
      : null,
    readOptions,
  );
  const principals = useRead<Page>(
    search || tab === 'principals'
      ? listPath(
          'principals',
          query,
          principalChoices.page,
          principalChoices.year,
          principalChoices.sort,
        )
      : null,
    readOptions,
  );
  const lobbyistCount = useRead<LobbyingLobbyistsPage>(
    !search && tab !== 'lobbyists' ? countPath('lobbyists') : null,
  );
  const principalCount = useRead<LobbyingPrincipalsPage>(
    !search && tab !== 'principals' ? countPath('principals') : null,
  );
  const summary = useRead<LobbyingSummary>('lobbying/summary');
  function changeQuery(q: string) {
    setAddress(
      {
        q,
        view: '',
        lobbyistsSearchPage: '1',
        principalsSearchPage: '1',
        ...(!q
          ? {
              lobbyistsSearchYear: '',
              lobbyistsSearchSort: '',
              principalsSearchYear: '',
              principalsSearchSort: '',
            }
          : {}),
      },
      { replace: Boolean(query) === Boolean(q) },
    );
  }
  const [typed, setTyped, applySearch] = useLiveSearch(query, here, changeQuery, (value) =>
    value.trim().slice(0, MAX_QUERY).trimEnd(),
  );
  const searchBusy =
    search &&
    typed.trim() === query &&
    [lobbyists, principals].some((read) => read.loading || read.updating || read.pending);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!searchBusy) applySearch();
  }
  function openTab(next: DirectoryTab) {
    if (search) {
      setAddress({ view: next }, { replace: false });
      return;
    }
    const current = browseChoices(tab);
    const kept = browseChoices(next);
    setAddress(
      {
        tab: next,
        year: kept.year,
        sort: kept.sort === SORTS[next][0].value ? '' : kept.sort,
        page: String(kept.page),
        [`${tab}Year`]: current.year,
        [`${tab}Sort`]: current.sort === SORTS[tab][0].value ? '' : current.sort,
        [`${tab}Page`]: String(current.page),
      },
      { replace: false },
    );
  }
  function changeGroup(kind: DirectoryTab, next: Partial<Choices>) {
    if (search)
      setAddress({
        ...(next.year !== undefined ? { [`${kind}SearchYear`]: next.year || 'default' } : {}),
        ...(next.sort !== undefined ? { [`${kind}SearchSort`]: next.sort } : {}),
        ...(next.page !== undefined ? { [`${kind}SearchPage`]: String(next.page) } : {}),
      });
    else
      setAddress({
        ...(next.year !== undefined ? { year: next.year } : {}),
        ...(next.sort !== undefined
          ? { sort: next.sort === SORTS[kind][0].value ? '' : next.sort }
          : {}),
        ...(next.page !== undefined ? { page: String(next.page) } : {}),
      });
  }
  const reads = { lobbyists, principals };
  const bothEmpty =
    search &&
    [lobbyists, principals].every(
      (read) =>
        !read.loading &&
        !read.updating &&
        !read.failed &&
        !read.notFound &&
        read.data !== null &&
        read.data.state !== 'unavailable' &&
        read.data.total === 0,
    );
  function count(kind: DirectoryTab) {
    const read = reads[kind];
    const data =
      search || tab === kind
        ? read.data
        : kind === 'lobbyists'
          ? lobbyistCount.data
          : principalCount.data;
    return data !== null &&
      data.state !== 'unavailable' &&
      (!search || (!read.failed && !read.notFound && !read.updating && !read.loading)) &&
      data.total != null
      ? COUNT(data.total)
      : null;
  }
  const copiedAt =
    lobbyists.data?.copied_at ?? principals.data?.copied_at ?? summary.data?.copied_at;
  const donations = isLobbyists(lobbyists.data)
    ? lobbyists.data.donations
    : lobbyistCount.data?.donations;
  const allResultsParams = new URLSearchParams(location.search);
  allResultsParams.delete('view');
  const allResultsHref = location.pathname + (allResultsParams.size ? `?${allResultsParams}` : '');
  const groups: DirectoryTab[] =
    search && !expanded ? ['lobbyists', 'principals'] : [expanded ?? tab];
  return (
    <main id="main" className="f-page">
      <div className="f-content">
        <header>
          <h1 tabIndex={-1} className="f-page-title">
            Lobbying
          </h1>
          <p className="lb-lead">
            Find Minnesota lobbyists, who they represent, and reported lobbying spending
          </p>
        </header>
        <form role="search" onSubmit={submit} className="lb-search">
          <div className="lb-search-field">
            <label htmlFor="lob-name">Search by name</label>
            <input
              id="lob-name"
              type="search"
              className="f-field lb-field"
              value={typed}
              maxLength={MAX_QUERY}
              autoComplete="off"
              placeholder="Full or partial name"
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
          <button
            type="submit"
            className="f-btn lb-submit"
            aria-label={searchBusy ? 'Searching' : 'Search'}
            aria-disabled={searchBusy || undefined}
            aria-busy={searchBusy || undefined}
          >
            <span className="lb-submit-state" aria-hidden="true" data-visible={!searchBusy}>
              Search
            </span>
            <span className="lb-submit-state" aria-hidden="true" data-visible={searchBusy}>
              <span className="f-spinner" />
              Searching
            </span>
          </button>
        </form>
        {search && (
          <div className="lb-search-heading">
            {expanded && (
              <div className="lb-back">
                <BackLink to={allResultsHref} name="all results" />
              </div>
            )}
            <div className="lb-heading-line">
              <h2 ref={resultsHeading} tabIndex={-1}>
                Results for “{query}”
              </h2>
              <button
                type="button"
                className="f-btn f-btn-secondary"
                onClick={() => {
                  changeQuery('');
                  document.getElementById('lob-name')?.focus();
                }}
              >
                Clear search
              </button>
            </div>
          </div>
        )}
        <div className={`lb-layout${!search || expanded ? ' lb-full-layout' : ''}`}>
          {(!search || expanded) && (
            <div className="lb-tabs">
              <Tabs
                label={search ? 'Matching records' : 'Directory'}
                value={expanded ?? tab}
                tabs={(['lobbyists', 'principals'] as const).map((value) => ({
                  value,
                  label: LABELS[value],
                  count: count(value),
                }))}
                onChange={openTab}
              />
            </div>
          )}
          {bothEmpty ? (
            <Empty title={`No matches for “${query}”`} next={NO_MATCH_HINT} />
          ) : (
            groups.map((kind) => (
              <DirectoryGroup
                key={kind}
                tab={kind}
                read={reads[kind]}
                choices={kind === 'lobbyists' ? lobbyistChoices : principalChoices}
                query={query}
                here={here}
                preview={search && !expanded}
                search={search}
                latestYear={summary.data?.latest_reported_year ?? null}
                onChange={(next) => changeGroup(kind, next)}
                viewAllHref={(() => {
                  const params = new URLSearchParams(location.search);
                  params.set('view', kind);
                  return `${location.pathname}?${params}`;
                })()}
              />
            ))
          )}
        </div>
        <section aria-labelledby="lb-about" className="lb-about">
          <h2 id="lb-about">About these records</h2>
          <ul>
            {(search || tab === 'lobbyists') && (
              <li>
                Lobbyists and their clients reflect the registration-list copy date, not the
                selected contribution year. Past client relationships are not shown.
              </li>
            )}
            {(search || tab === 'principals') && (
              <>
                <li>Names come from registrations and spending reports across years.</li>
                <li>
                  Lobbying spending is reported by calendar year.
                  {summary.data?.first_year != null
                    ? ` These spending records begin in ${summary.data.first_year}.`
                    : ''}
                </li>
              </>
            )}
            {(search || tab === 'lobbyists') && (
              <>
                <li>
                  Contribution totals use records matched to each lobbyist’s registration and
                  include donated goods or services. They are not a complete record of giving.
                </li>
                <li>
                  A missing or unresolved matching amount means no contribution total is shown.
                </li>
              </>
            )}
            {(search || tab === 'principals') && (
              <li>
                In state spending records, a “principal” is a person or organization that funds
                lobbying and must report its spending under Minnesota law.
              </li>
            )}
          </ul>
        </section>
      </div>
      <SourcesAndUpdates>
        <p className="f-sources-line">
          State entity IDs and lobbyist registration numbers come from the Minnesota Campaign
          Finance and Public Disclosure Board
        </p>
        {copiedAt && (
          <p className="f-sources-line lb-sources-next f-num">
            Lobbying records copied: {centralDateLabel(copiedAt)}
          </p>
        )}
        {donations?.copied_at && (
          <p className="f-sources-line lb-sources-next f-num">
            Campaign contribution file copied: {centralDateLabel(donations.copied_at)}
          </p>
        )}
        <p className="f-sources-line lb-sources-gap">
          Copy dates show when Alethical obtained the files, not the reporting periods they cover
        </p>
        <OfficialLink href={LOBBYING_SOURCE_URL}>{COPY.sourceLabel}</OfficialLink>
      </SourcesAndUpdates>
    </main>
  );
}
