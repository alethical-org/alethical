import { LOBBYING_NO_SPENDING_PAGE } from '@alethical/shared/lobbyingRecordCopy';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
  LOBBYING_DIRECTORY_COPY as COPY,
  LOBBYING_SOURCE_URL,
  lobbyingHeldYearsNote,
  lobbyingPrincipalCount,
  lobbyingShowingLine,
} from '@alethical/shared/lobbyingDirectoryCopy';
import type {
  LobbyingDirectoryDonations,
  LobbyingLobbyistsPage,
  LobbyingPrincipalsPage,
  LobbyingSummary,
} from '@alethical/shared/lobbyingTypes';
import { lobbyingDonationYear } from '@alethical/shared/lobbyingTypes';
import { centralDateLabel } from '@alethical/shared/moneyLanding';
import { formatMoney } from '../ui/money';

import { apiPath, useRead } from '../api/read';
import { Link, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { ClearAll, Dropdown, Empty, LoadingRows, Refused, Tabs, Updating } from '../ui/controls';
import { RecordMark } from '../ui/marks';
import { BackLink, SourcesAndUpdates } from '../ui/parts';
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
  return apiPath(['lobbying', tab], {
    q: query || null,
    sort: tab === 'lobbyists' ? order : order === 'name' ? null : order,
    year: year || null,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
}

/** The whole directory's count for a tab, unfiltered. */
export function countPath(tab: DirectoryTab): string {
  return apiPath(['lobbying', tab], { sort: tab === 'lobbyists' ? 'name' : null, limit: 1 });
}

export function pageCount(total: number | null): number {
  return Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));
}

/** The principals tab's note, qualifying its rows: names from several reporting years
 * and the dated lobbyist list, and why some rows have no page. */
export function principalsNote(copiedAt: string | null, latestYear: number | null): string {
  const list = copiedAt
    ? ` and the lobbyist list copied ${centralDateLabel(copiedAt)}`
    : ' and the lobbyist list';
  const through = latestYear == null ? '' : ` through ${latestYear}`;
  return `This directory includes organizations from different reporting years${list}. Some organizations have no spending page because the Board’s spending file has no rows for them${through}.`;
}

const LOBBYISTS_NOTE =
  'Amounts include matching campaign contribution records, including donated goods or services';
const GIVING_NOTE =
  'These amounts are not a complete record of giving. Client counts reflect the lobbyist-list copy date, not the selected contribution year.';
const SEARCH_NOTE = 'Find lobbyists or organizations using all or part of a name';
const PRINCIPALS_INTRO = 'Browse organizations named in lobbying registrations or spending reports';

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
export function principalSpending(row: PrincipalDirectoryRow, year: string | number): string {
  if (row.spending_state === 'ambiguous') return 'Amount unavailable: more than one report';
  if (row.spending_state === 'reported')
    return formatMoney(row.total_spent ?? null) ?? 'Amount not given';
  if (!row.linkable) return LOBBYING_NO_SPENDING_PAGE;
  if (row.spending_state === 'not_reported') return `No spending report for ${year}`;
  return 'Amount unavailable';
}

type LobbyistRow = LobbyingLobbyistsPage['lobbyists'][number];

/** A lobbyist row's contributions recorded in the selected year (Round 30): the
 * matched sum, "No matching donation records", or "Amount unavailable" when any
 * matching amount is missing or unresolved, which withholds the whole sum. */
export function lobbyistContributions(row: LobbyistRow): string {
  if (row.donation_state === 'reported') {
    return formatMoney(row.donation_amount ?? null) ?? 'Amount unavailable';
  }
  if (row.donation_state === 'no_records') return 'No matching donation records';
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
  lobbyists: 'We couldn’t load the Board’s lobbyist list. This says nothing about who was listed.',
  principals:
    'We couldn’t load the Board’s principal records. This says nothing about what was reported or registered.',
};
const EMPTY: Record<DirectoryTab, string> = {
  lobbyists: 'No lobbyist is listed under that spelling in these records',
  principals: 'No principal matches that spelling in the Board’s files',
};

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

/**
 * Lobbying (Lobbying drawing, Rounds 30 to 35): the Board's registered lobbyists
 * and the principals named in its lobbying files, in 2 tabs, searched and paged on
 * the server. Each tab has its own Year and Sort; the lobbyists' column is the
 * contributions matched to each registration in the selected completed year, the
 * principals' that year's own filed spending. Tab, name, page, year and sort live in
 * the address.
 */
export function Lobbying(_props: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const [address, setAddress] = useAddressState({
    tab: 'lobbyists',
    q: '',
    page: '1',
    year: '',
    sort: '',
  });
  const tab = tabFromParam(address.tab);
  const query = address.q.trim().slice(0, MAX_QUERY);
  const page = pageFromParam(address.page);
  const year = yearFromParam(tab, address.year);
  const sort = sortFromParam(tab, address.sort);
  const defaultSort = SORTS[tab][0].value;

  // Each tab keeps its own Year and Sort (Round 30): the other tab's last choice
  // returns to the address when the reader comes back to it.
  const remembered = useRef<Record<DirectoryTab, { year: string; sort: string }>>({
    lobbyists: { year: '', sort: '' },
    principals: { year: '', sort: '' },
  });
  remembered.current[tab] = { year, sort: sort === defaultSort ? '' : sort };

  const [typed, setTyped] = useState(query);
  // Back, Forward or a new link changes the address: the field follows it.
  useEffect(() => setTyped(query), [query]);

  const read = useRead<Page>(listPath(tab, query, page, year, sort), {
    keepPrevious: true,
    acceptData: (data) => data.state !== 'unavailable',
  });
  // The tab counts are each whole directory; the open tab's own read already holds
  // its count when nothing is searched.
  const lobbyistCount = useRead<LobbyingLobbyistsPage>(
    tab === 'lobbyists' && !query ? null : countPath('lobbyists'),
  );
  const principalCount = useRead<LobbyingPrincipalsPage>(
    tab === 'principals' && !query ? null : countPath('principals'),
  );
  const summary = useRead<LobbyingSummary>('lobbying/summary');

  // A kept answer from the other tab is never drawn under this tab.
  const own =
    tab === 'lobbyists'
      ? isLobbyists(read.data)
        ? read.data
        : null
      : isPrincipals(read.data)
        ? read.data
        : null;
  const reported = own !== null && own.state !== 'unavailable' ? own : null;
  const unavailable = own !== null && own.state === 'unavailable';
  const total = reported?.total ?? null;
  const pages = pageCount(total);

  // A page past the end (a stale link, or a search that now matches fewer) opens the
  // last page that exists rather than an empty list.
  useEffect(() => {
    const current = reported?.offset === (page - 1) * PAGE_SIZE;
    if (current && !read.updating && !read.failed && total !== null && page > pages) {
      setAddress({ page: String(pages) });
    }
  }, [reported, read.updating, read.failed, total, page, pages, setAddress]);

  function wholeCount(kind: DirectoryTab): string | null {
    const served =
      kind === tab && !query
        ? (reported?.total ?? null)
        : kind === 'lobbyists'
          ? lobbyistCount.data?.state === 'reported'
            ? lobbyistCount.data.total
            : null
          : principalCount.data?.state === 'reported'
            ? principalCount.data.total
            : null;
    return typeof served === 'number' ? COUNT(served) : null;
  }

  const list = useRef<HTMLDivElement>(null);
  function goPage(next: number) {
    setAddress({ page: String(next) });
    const element = list.current;
    if (!element) return;
    const top = element.getBoundingClientRect().top + window.scrollY - 20;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    element.focus({ preventScroll: true });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddress({ q: typed.trim().slice(0, MAX_QUERY), page: '1' });
  }

  function openTab(next: DirectoryTab) {
    const kept = remembered.current[next];
    setAddress({ tab: next, page: '1', year: kept.year, sort: kept.sort });
  }

  const freshFailure = (read.failed && own === null) || (unavailable && !read.updating);
  const retainedFailure = read.failed && reported !== null;
  const copiedAt = reported?.copied_at ?? summary.data?.copied_at ?? null;
  const latestYear =
    (isPrincipals(reported) ? reported.latest_reported_year : null) ??
    summary.data?.latest_reported_year ??
    null;
  // The contribution file's own years and copy date ride on the lobbyist list read,
  // including the count read made while the other tab is open.
  const donations: LobbyingDirectoryDonations | null =
    (isLobbyists(reported) ? reported.donations : null) ??
    (isLobbyists(read.data) ? read.data.donations : null) ??
    lobbyistCount.data?.donations ??
    null;
  const spendingYear = isPrincipals(reported) ? (reported.year ?? null) : null;
  const donationYear = isLobbyists(reported) ? (reported.donations?.year ?? null) : null;
  const shownYear =
    tab === 'principals'
      ? year || (spendingYear === null ? '' : String(spendingYear))
      : year || (donationYear === null ? '' : String(donationYear));
  const yearOptions = [
    ...new Set([
      ...(year ? [Number(year)] : []),
      ...(tab === 'principals'
        ? isPrincipals(reported)
          ? (reported.years ?? [])
          : []
        : (donations?.available_years ?? [])),
    ]),
  ].sort((a, b) => b - a);
  const heldYears = lobbyingHeldYearsNote(summary.data?.first_year ?? null);
  const rowCount = isLobbyists(reported)
    ? reported.lobbyists.length
    : isPrincipals(reported)
      ? reported.principals.length
      : 0;
  // The page the rows on screen belong to: while the next page loads, the
  // earlier rows keep their own numbers rather than the new page's.
  const shownPage = reported ? Math.floor((reported.offset ?? 0) / PAGE_SIZE) + 1 : page;
  const showing =
    reported && total !== null ? lobbyingShowingLine(tab, shownPage, rowCount, total) : null;
  // The year the server opens on: the newest completed year with matched
  // contributions, or the newest spending year. Choosing it leaves the address.
  const defaultYear =
    tab === 'lobbyists'
      ? String(donations?.available_years?.[0] ?? '')
      : String(summary.data?.latest_reported_year ?? '');
  const filtered = (year !== '' && year !== defaultYear) || sort !== defaultSort;

  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && (
          <div className="lb-back">
            <BackLink to={back.to} name={back.name} />
          </div>
        )}
        <header>
          <h1 tabIndex={-1} className="f-page-title">
            Lobbying
          </h1>
          <p className="lb-lead">{COPY.intro}</p>
        </header>

        <form role="search" onSubmit={submit} className="lb-search">
          <label htmlFor="lob-name" className="f-visually-hidden">
            Search by name
          </label>
          <input
            id="lob-name"
            type="search"
            className="f-field lb-field"
            value={typed}
            maxLength={MAX_QUERY}
            autoComplete="off"
            placeholder="Search by name"
            onChange={(event) => setTyped(event.target.value)}
          />
          <button type="submit" className="f-btn lb-submit">
            Search
          </button>
        </form>
        <p className="lb-helper">{SEARCH_NOTE}</p>

        <div className="lb-layout">
          <section aria-label={tab === 'lobbyists' ? 'Lobbyists' : 'Principals'} className="lb-dir">
            <div className="lb-tabs">
              <Tabs
                label="Directory"
                value={tab}
                tabs={[
                  { value: 'lobbyists', label: 'Lobbyists', count: wholeCount('lobbyists') },
                  { value: 'principals', label: 'Principals', count: wholeCount('principals') },
                ]}
                onChange={openTab}
              />
            </div>
            <p className="lb-lane">
              {tab === 'lobbyists' ? COPY.lobbyists.intro : PRINCIPALS_INTRO}
            </p>
            <div className="lb-controls">
              {yearOptions.length > 0 && (
                <Dropdown
                  name="Year"
                  value={shownYear}
                  options={yearOptions.map((option) => ({
                    value: String(option),
                    label: String(option),
                  }))}
                  onChange={(next) =>
                    setAddress({ year: next === defaultYear ? '' : next, page: '1' })
                  }
                />
              )}
              <Dropdown
                name="Sort by"
                value={sort}
                options={SORTS[tab]}
                onChange={(next) =>
                  setAddress({ sort: next === defaultSort ? '' : next, page: '1' })
                }
              />
              {filtered && (
                <ClearAll onClick={() => setAddress({ year: '', sort: '', page: '1' })} />
              )}
            </div>

            <div ref={list} tabIndex={-1} className="lb-results">
              {read.loading && (
                <LoadingRows
                  label={tab === 'lobbyists' ? COPY.lobbyists.loading : COPY.principals.loading}
                />
              )}
              {!read.loading && own === null && read.updating && (
                <LoadingRows
                  label={tab === 'lobbyists' ? COPY.lobbyists.loading : COPY.principals.loading}
                />
              )}
              {freshFailure && (
                <Refused onRetry={read.retry} retrying={read.pending}>
                  {FAILED[tab]}
                </Refused>
              )}
              {reported && (
                <>
                  {read.updating && (
                    <div className="lb-notice">
                      <Updating />
                    </div>
                  )}
                  {retainedFailure && (
                    <div className="lb-notice">
                      <Refused onRetry={read.retry} retrying={read.pending}>
                        We couldn’t update these results. Previous results are shown.
                      </Refused>
                    </div>
                  )}
                  <div aria-live="polite" className="lb-count f-num">
                    {showing}
                  </div>
                  {rowCount === 0 ? (
                    <Empty title={EMPTY[tab]} next={COPY.noMatchWhy} />
                  ) : (
                    <>
                      <div
                        role="table"
                        aria-label={tab === 'lobbyists' ? 'Lobbyists' : 'Principals'}
                        className="lb-table"
                      >
                        <div role="row" className="lb-tr lb-head">
                          <span role="columnheader">NAME</span>
                          <span role="columnheader">
                            {tab === 'lobbyists' ? 'REGISTRATION AND CLIENTS' : 'ENTITY ID'}
                          </span>
                          <span role="columnheader" className="lb-third">
                            {tab === 'lobbyists'
                              ? 'CONTRIBUTIONS RECORDED IN'
                              : 'REPORTED SPENDING'}
                            {shownYear && (
                              <>
                                {' '}
                                <span className="lb-head-year f-num">{shownYear}</span>
                              </>
                            )}
                          </span>
                        </div>
                        {isLobbyists(reported) &&
                          reported.lobbyists.map((row) => {
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
                                          { year: shownYear || null },
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
                                  Registration {row.registration_number}
                                  <span className="lb-second-b">
                                    {lobbyingPrincipalCount(row.principal_count)}
                                  </span>
                                </span>
                                <span
                                  role="cell"
                                  className={`lb-third lb-figure ${held ? 'lb-strong' : 'lb-missing'} f-num`}
                                >
                                  <span className="lb-phone-only">
                                    Contributions recorded in {shownYear}:{' '}
                                  </span>
                                  <span className="lb-figure-value">{figure}</span>
                                </span>
                              </div>
                            );
                          })}
                        {isPrincipals(reported) &&
                          reported.principals.map((row) => {
                            const rowYear = row.spending_year ?? spendingYear ?? shownYear;
                            const href =
                              row.linkable && isBuilt('principal')
                                ? withFrom(
                                    hrefFor(
                                      'principal',
                                      { id: String(row.entity_id) },
                                      { year: rowYear ? String(rowYear) : null },
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
                                  Entity ID {row.entity_id}
                                </span>
                                <span
                                  role="cell"
                                  className={`lb-third lb-figure ${row.spending_state === 'reported' ? 'lb-strong' : 'lb-missing'} f-num`}
                                >
                                  <span className="lb-phone-only">
                                    Reported spending {rowYear}:{' '}
                                  </span>
                                  <span className="lb-figure-value">
                                    {principalSpending(row, rowYear)}
                                  </span>
                                </span>
                              </div>
                            );
                          })}
                      </div>
                      <p className="lb-list-note">
                        {tab === 'lobbyists'
                          ? LOBBYISTS_NOTE
                          : principalsNote(copiedAt, latestYear)}
                      </p>
                      {pages > 1 && (
                        <nav aria-label="Pages" className="lb-pager">
                          <button
                            type="button"
                            className="f-btn f-btn-secondary lb-page-btn"
                            aria-disabled={page <= 1 || undefined}
                            onClick={() => page > 1 && goPage(page - 1)}
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
                            aria-disabled={page >= pages || undefined}
                            onClick={() => page < pages && goPage(page + 1)}
                          >
                            Next
                            <Chevron next />
                          </button>
                        </nav>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </section>
        </div>

        <section aria-labelledby="lb-about" className="lb-about">
          <h2 id="lb-about">About these records</h2>
          <ul>
            <li>{COPY.currentOnly}</li>
            <li>{COPY.annual}</li>
            <li>{COPY.principals.definition}</li>
            {heldYears && <li>{heldYears}</li>}
            <li>{GIVING_NOTE}</li>
          </ul>
        </section>
      </div>
      <SourcesAndUpdates>
        {copiedAt && (
          <p className="f-sources-line f-num">
            Lobbying records copied {centralDateLabel(copiedAt)}.
          </p>
        )}
        {donations?.copied_at && (
          <p className="f-sources-line lb-sources-next f-num">
            Campaign contribution file copied {centralDateLabel(donations.copied_at)}.
          </p>
        )}
        <p className="f-sources-line lb-sources-gap">
          These records come from the Minnesota Campaign Finance and Public Disclosure Board. The
          copy date is when Alethical obtained the source, not the end date of every filing.
        </p>
        <OfficialLink href={LOBBYING_SOURCE_URL}>{COPY.sourceLabel}</OfficialLink>
      </SourcesAndUpdates>
    </main>
  );
}
