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
  LobbyingLobbyistsPage,
  LobbyingPrincipalsPage,
  LobbyingSummary,
} from '@alethical/shared/lobbyingTypes';
import { centralDateLabel } from '@alethical/shared/moneyLanding';

import { apiPath, useRead } from '../api/read';
import { Link, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { Dropdown, Empty, LoadingRows, Refused, Tabs, Updating } from '../ui/controls';
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

/**
 * One directory page, paged and searched on the server. The lobbyist list opens on
 * annual donation order unless asked; this directory offers Name A–Z only, as drawn,
 * so it always asks for `sort=name`.
 */
export function listPath(tab: DirectoryTab, query: string, page: number): string {
  return apiPath(['lobbying', tab], {
    q: query || null,
    sort: tab === 'lobbyists' ? 'name' : null,
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
  return `This directory includes organisations from different reporting years${list}. Some organisations have no spending page because the Board’s spending file has no rows for them${through}.`;
}

type Page = LobbyingLobbyistsPage | LobbyingPrincipalsPage;

function isLobbyists(page: Page | null): page is LobbyingLobbyistsPage {
  return page !== null && 'lobbyists' in page;
}
function isPrincipals(page: Page | null): page is LobbyingPrincipalsPage {
  return page !== null && 'principals' in page;
}

const COUNT = (value: number) => value.toLocaleString('en-US');

const FAILED: Record<DirectoryTab, string> = {
  lobbyists:
    'We couldn’t load the Board’s lobbyist list just now. This says nothing about who was listed.',
  principals:
    'We couldn’t load the Board’s principal records just now. This says nothing about what was reported or registered.',
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
 * Lobbying (Lobbying drawing): the Board's registered lobbyists and the principals
 * named in its lobbying files, in 2 tabs, searched and paged on the server, with the
 * limits of these records beside them. Tab, name and page live in the address.
 */
export function Lobbying(_props: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const [address, setAddress] = useAddressState({ tab: 'lobbyists', q: '', page: '1' });
  const tab = tabFromParam(address.tab);
  const query = address.q.trim().slice(0, MAX_QUERY);
  const page = pageFromParam(address.page);

  const [typed, setTyped] = useState(query);
  // Back, Forward or a new link changes the address: the field follows it.
  useEffect(() => setTyped(query), [query]);

  const read = useRead<Page>(listPath(tab, query, page), { keepPrevious: true });
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

  const freshFailure = (read.failed && own === null) || (unavailable && !read.updating);
  const retainedFailure = read.failed && reported !== null;
  const copiedAt = reported?.copied_at ?? summary.data?.copied_at ?? null;
  const latestYear =
    (isPrincipals(reported) ? reported.latest_reported_year : null) ??
    summary.data?.latest_reported_year ??
    null;
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
        <p className="lb-helper">{COPY.searchNote}</p>

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
                onChange={(next) => setAddress({ tab: next, page: '1' })}
              />
            </div>
            <p className="lb-lane">
              {tab === 'lobbyists' ? COPY.lobbyists.intro : COPY.principals.intro}
            </p>
            <div className="lb-controls">
              <Dropdown
                name="Sort by"
                value="name"
                options={[{ value: 'name', label: 'Name A–Z' }]}
                onChange={() => {}}
              />
            </div>

            <div ref={list} tabIndex={-1} className="lb-list">
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
                        className={tab === 'lobbyists' ? 'lb-table' : 'lb-table lb-table-two'}
                      >
                        <div role="row" className="lb-tr lb-head">
                          <span role="columnheader">NAME</span>
                          <span role="columnheader">
                            {tab === 'lobbyists' ? 'REGISTRATION' : 'ENTITY ID'}
                          </span>
                          {/* The principals' drawn "Reported spending {year}" column waits for
                              its server route (#2783); no stand-in figure is shown. */}
                          {tab === 'lobbyists' && (
                            <span role="columnheader" className="lb-third">
                              CLIENTS LISTED
                            </span>
                          )}
                        </div>
                        {isLobbyists(reported) &&
                          reported.lobbyists.map((row) => (
                            <div role="row" key={row.registration_number} className="lb-tr">
                              <span role="cell" className="lb-name f-marked">
                                <RecordMark kind="person" />
                                {isBuilt('lobbyist') ? (
                                  <Link
                                    to={withFrom(
                                      hrefFor('lobbyist', { id: row.registration_number }),
                                      here,
                                    )}
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
                              </span>
                              <span role="cell" className="lb-third lb-strong f-num">
                                {lobbyingPrincipalCount(row.principal_count)}
                              </span>
                            </div>
                          ))}
                        {isPrincipals(reported) &&
                          reported.principals.map((row) => {
                            const href =
                              row.linkable && isBuilt('principal')
                                ? withFrom(
                                    hrefFor('principal', { id: String(row.entity_id) }),
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
                                  {!row.linkable && ` · ${LOBBYING_NO_SPENDING_PAGE}`}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                      {tab === 'principals' && (
                        <p className="lb-list-note">{principalsNote(copiedAt, latestYear)}</p>
                      )}
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

          <aside className="lb-aside">
            <section aria-labelledby="lb-about" className="f-card lb-about">
              <h2 id="lb-about" className="f-label">
                {COPY.coverageLabel}
              </h2>
              <ul>
                <li>{COPY.currentOnly}</li>
                <li>{COPY.annual}</li>
                <li>{COPY.principals.definition}</li>
                {heldYears && <li>{heldYears}</li>}
              </ul>
            </section>
          </aside>
        </div>
      </div>
      <SourcesAndUpdates>
        {copiedAt && (
          <p className="f-sources-line f-num">
            Lobbying records copied {centralDateLabel(copiedAt)}
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
