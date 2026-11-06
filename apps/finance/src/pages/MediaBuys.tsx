import { useFinanceSession } from '../auth/session';
import { useVersionedRead } from '../api/versionedRead';
import { useEffect, useLayoutEffect, useRef, type FormEvent, type MouseEvent } from 'react';
import { useRead, type Read } from '../api/read';
import { Link, useLocation } from '../router';
import { useLiveSearch } from '../search/useLiveSearch';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt } from '../routes';
import { useAddressState } from '../ui/addressState';
import { ClearAll, Dropdown, Empty, LoadingRows } from '../ui/controls';
import { ScrollingTabs } from '../ui/scrollingTabs';
import { Arrow, BackLink, SourcesAndUpdates, WithArrow } from '../ui/parts';
import {
  Pager,
  ReadState,
  copiedLines,
  day,
  fileHref,
  lastSegment,
  mediaPath,
  plural,
} from './media/shared';
import type { Browse, FileRow, Group, Sources } from './media/types';
import './media/directory.css';

type Tab = 'folders' | 'agencies' | 'stations' | 'years';
const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'folders', label: 'TV station folders' },
  { value: 'agencies', label: 'Agency names' },
  { value: 'stations', label: 'Stations' },
  { value: 'years', label: 'Years' },
];
const INTRO: Record<Tab, string> = {
  folders: '',
  agencies: 'Names as printed, with each spelling listed separately',
  stations: '',
  years: 'Folders held, by the year the TV station filed them',
};
const NOUNS: Record<Tab | 'files', [string, string]> = {
  folders: ['TV station folder', 'TV station folders'],
  agencies: ['agency name', 'agency names'],
  stations: ['station', 'stations'],
  years: ['year', 'years'],
  files: ['TV station file', 'TV station files'],
};
const NOTES: Record<Tab, string> = {
  folders:
    'A folder checked as relating to a committee does not establish the same link for each file inside it',
  agencies:
    'Agency names come from checked facts or machine-read text. Machine-read names are marked Not checked and may contain reading errors.',
  stations: 'Counts are held files and folders, not ads or spend',
  years: 'Counts are held files and folders, not ads or spend',
};

function isFile(row: Group | FileRow): row is FileRow {
  return 'version_id' in row;
}

export interface BrowseRow {
  key: string;
  name: string;
  note: string;
  mid: string;
  end: string;
  href: string;
}

/** One browse row as the drawing prints it, for the tab the server answered. */
export function browseRow(tab: Tab, row: Group | FileRow): BrowseRow {
  if (isFile(row))
    return {
      key: row.key,
      name: row.label || row.name,
      note: [row.station, lastSegment(row.folder_label)].filter(Boolean).join(' · '),
      mid: '',
      end: row.uploaded_at ? day(row.uploaded_at) : '',
      href: fileHref(row.key, row.version_id),
    };
  const files = plural(row.file_count, 'file', 'files');
  if (tab === 'agencies')
    return {
      key: row.key,
      name: row.label,
      note: (row.stations ?? []).join(', '),
      mid: row.unchecked ? 'Not checked' : 'Checked',
      end: files,
      href: hrefFor('printed-agency-name', { name: row.key }),
    };
  if (tab === 'stations')
    return {
      key: row.key,
      name: row.label,
      note: row.years?.length ? `Folders held for ${row.years.join(', ')}` : '',
      mid: row.folder_count != null ? plural(row.folder_count, 'folder', 'folders') : '',
      end: files,
      href: hrefFor('station', { id: row.key }),
    };
  if (tab === 'years')
    return {
      key: row.key,
      name: row.label,
      note:
        row.folder_count != null
          ? plural(row.folder_count, 'TV station folder', 'TV station folders')
          : '',
      mid: '',
      end: files,
      href: hrefFor('media-buys', {}, { year: String(row.year ?? row.key) }),
    };
  return {
    key: row.key,
    name: lastSegment(row.label),
    note: [row.station, row.year, row.category].filter(Boolean).join(' · '),
    mid: '',
    end: files,
    href: hrefFor('station-folder', { id: row.key }),
  };
}

const pageNumber = (raw: string) => Math.min(42, Math.max(1, Math.trunc(Number(raw)) || 1));
const PAGE_KEYS = {
  folders: 'foldersPage',
  agencies: 'agenciesPage',
  stations: 'stationsPage',
  years: 'yearsPage',
} as const;

const PIN_KEYS = {
  folders: 'foldersSource',
  agencies: 'agenciesSource',
  stations: 'stationsSource',
  years: 'yearsSource',
} as const;

function sourcePin(raw: string, scope: string): string | undefined {
  try {
    const saved: unknown = JSON.parse(raw);
    if (
      Array.isArray(saved) &&
      saved[0] === scope &&
      typeof saved[1] === 'string' &&
      /^[0-9a-f]{16}$/.test(saved[1])
    )
      return saved[1];
  } catch {
    /* An absent or invalid address pin starts a fresh list. */
  }
  return undefined;
}

export function MediaBuys() {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const [state, setState] = useAddressState({
    q: '',
    tab: 'folders',
    station: '',
    year: '',
    category: '',
    page: '1',
    view: '',
    foldersPage: '1',
    agenciesPage: '1',
    stationsPage: '1',
    yearsPage: '1',
    browseSource: '',
    foldersSource: '',
    agenciesSource: '',
    stationsSource: '',
    yearsSource: '',
    searchFilters: '',
    searchStation: '',
    searchYear: '',
    searchCategory: '',
  });
  const tab: Tab = TABS.some((item) => item.value === state.tab) ? (state.tab as Tab) : 'folders';
  const query = state.q.trim().slice(0, 200);
  const view = query && TABS.some((item) => item.value === state.view) ? (state.view as Tab) : null;
  const preview = !!query && !view;
  const searchFilters = !!query && state.searchFilters === '1';
  const filters = {
    station: searchFilters ? state.searchStation : state.station,
    year: searchFilters ? state.searchYear : state.year,
    category: searchFilters ? state.searchCategory : state.category,
  };
  const filtered = !!(filters.station || filters.year || filters.category);
  const resetPages = {
    foldersPage: '1',
    agenciesPage: '1',
    stationsPage: '1',
    yearsPage: '1',
  };
  function commitQuery(q: string) {
    setState(
      {
        q,
        view: '',
        ...resetPages,
        foldersSource: '',
        agenciesSource: '',
        stationsSource: '',
        yearsSource: '',
        ...(!query && q
          ? {
              searchFilters: '1',
              searchStation: state.station,
              searchYear: state.year,
              searchCategory: state.category,
            }
          : {}),
        ...(!q
          ? {
              searchFilters: '',
              searchStation: '',
              searchYear: '',
              searchCategory: '',
            }
          : {}),
      },
      { replace: !!query === !!q },
    );
  }
  const [typed, setTyped, applySearch] = useLiveSearch(query, here, commitQuery, (value) =>
    value.trim().slice(0, 200),
  );
  function useGroup(kind: Tab) {
    const active = !!query || kind === tab;
    const page = query
      ? view === kind
        ? pageNumber(state[PAGE_KEYS[kind]])
        : 1
      : pageNumber(state.page);
    const pinKey = query ? PIN_KEYS[kind] : 'browseSource';
    const scope = JSON.stringify([
      kind,
      query,
      ...(kind === 'folders' ? [filters.station, filters.year, filters.category] : []),
    ]);
    const version = sourcePin(state[pinKey], scope);
    const read = useVersionedRead<Browse>(
      active
        ? mediaPath(['browse'], {
            tab: kind,
            version,
            search_scope: 'tab',
            q: query,
            page,
            station: kind === 'folders' ? filters.station : '',
            year: kind === 'folders' ? filters.year : '',
            category: kind === 'folders' ? filters.category : '',
          })
        : null,
      {
        page,
        acceptData: (data) => !!data && Array.isArray(data.rows) && Number.isFinite(data.total),
        onRestart: () =>
          setState({ [pinKey]: '', ...(query ? { [PAGE_KEYS[kind]]: '1' } : { page: '1' }) }),
      },
    );
    useEffect(() => {
      if (
        !active ||
        read.loading ||
        read.updating ||
        read.pending ||
        read.failed ||
        read.notFound ||
        !read.data
      )
        return;
      const value = read.data.version;
      const changes: Partial<typeof state> = {};
      if (!version && typeof value === 'string' && /^[0-9a-f]{16}$/.test(value))
        changes[pinKey] = JSON.stringify([scope, value]);
      const lastPage = Math.max(1, Math.ceil(read.data.total / read.data.page_size));
      if (page > lastPage) changes[query ? PAGE_KEYS[kind] : 'page'] = String(lastPage);
      if (Object.keys(changes).length) setState(changes);
    }, [
      active,
      read.loading,
      read.updating,
      read.pending,
      read.failed,
      read.notFound,
      read.data,
      version,
      scope,
      pinKey,
      page,
      query,
      kind,
      setState,
    ]);
    // A missing directory endpoint is a failed category read, not evidence that
    // a source record disappeared or the search returned no matches.
    return { ...read, failed: read.failed || read.notFound, notFound: false };
  }
  const reads: Record<Tab, Read<Browse>> = {
    folders: useGroup('folders'),
    agencies: useGroup('agencies'),
    stations: useGroup('stations'),
    years: useGroup('years'),
  };
  const sources = useRead<Sources>(mediaPath(['sources']));
  const list = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<'results' | 'search' | null>(null);
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === 'results') resultsHeading.current?.focus();
    if (target === 'search') searchInput.current?.focus();
  }, [query, view]);
  function focusResults(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey)
      pendingFocus.current = 'results';
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    applySearch();
  }
  function changeFilters(changes: Partial<typeof filters>) {
    setState(
      query
        ? {
            searchFilters: '1',
            searchStation: filters.station,
            searchYear: filters.year,
            searchCategory: filters.category,
            ...('station' in changes ? { searchStation: changes.station } : {}),
            ...('year' in changes ? { searchYear: changes.year } : {}),
            ...('category' in changes ? { searchCategory: changes.category } : {}),
            foldersPage: '1',
            foldersSource: '',
          }
        : { ...changes, page: '1', browseSource: '' },
    );
  }
  function pageTo(kind: Tab, next: number) {
    setState(query ? { [PAGE_KEYS[kind]]: String(next) } : { page: String(next) });
    const target = list.current;
    if (target) {
      window.scrollTo({
        top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - 20),
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
      target.focus({ preventScroll: true });
    }
  }
  const allEmpty =
    preview &&
    !filtered &&
    TABS.every(({ value }) => {
      const read = reads[value];
      return (
        read.data?.q === query &&
        read.data.total === 0 &&
        !read.pending &&
        !read.loading &&
        !read.updating &&
        !read.failed &&
        !read.notFound
      );
    });
  const countOf = (kind: Tab) => {
    const read = reads[kind];
    return read.data &&
      !read.failed &&
      !read.pending &&
      !read.loading &&
      !read.updating &&
      !read.notFound &&
      read.data.q === query &&
      (kind !== 'folders' ||
        ((read.data.station ?? '') === filters.station &&
          String(read.data.year ?? '') === filters.year &&
          (read.data.category ?? '') === filters.category))
      ? `${read.data.capped ? 'At least ' : ''}${read.data.total.toLocaleString('en-US')}`
      : null;
  };
  const groups = preview ? TABS : TABS.filter(({ value }) => value === (view ?? tab));
  function viewHref(kind: Tab | '') {
    const params = new URLSearchParams(location.search);
    if (kind) params.set('view', kind);
    else params.delete('view');
    return location.pathname + (params.size ? `?${params}` : '');
  }
  const check = useFinanceSession().canEdit !== false && isBuilt('check-station-files');
  return (
    <main id="main" className="f-page mb-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        <header className="mb-head">
          <div className="mb-head-row">
            <h1 tabIndex={-1} className="f-page-title">
              Media buys
            </h1>
            {check && (
              <Link
                className="f-btn mb-head-action"
                to={withFrom(hrefFor('check-station-files'), here)}
              >
                <span>
                  <WithArrow stroke="#fff">Check TV station files</WithArrow>
                </span>
              </Link>
            )}
          </div>
          <p className="mb-lead">
            TV political-ad files from <span className="f-nowrap">KSTP-TV</span>, KARE and{' '}
            <span className="f-nowrap">KMSP-TV</span>
          </p>
        </header>
        <form role="search" className="mb-search" onSubmit={submit}>
          <label className="f-visually-hidden" htmlFor="tv-search">
            Search media buys
          </label>
          <input
            id="tv-search"
            ref={searchInput}
            type="search"
            className="f-field"
            value={typed}
            maxLength={200}
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Search media buys"
          />
          <button type="submit" className="f-btn">
            Search
          </button>
        </form>
        <div className="mb-browse mb-directory" ref={list} tabIndex={-1}>
          {query && (
            <div className="mb-search-heading">
              {view && (
                <Link className="mb-all-results" to={viewHref('')} onClick={focusResults}>
                  Back to all results
                </Link>
              )}
              <div>
                <h2 ref={resultsHeading} tabIndex={-1}>
                  Results for “{query}”
                </h2>
                <button
                  type="button"
                  className="f-btn f-btn-secondary"
                  onClick={() => {
                    pendingFocus.current = 'search';
                    setTyped('');
                    commitQuery('');
                  }}
                >
                  Clear search
                </button>
              </div>
            </div>
          )}
          {!preview && (
            <ScrollingTabs
              label={query ? 'Result groups' : 'Browse'}
              value={view ?? tab}
              tabs={TABS.map((item) => ({
                ...item,
                count: query
                  ? countOf(item.value)
                  : !reads[tab].failed && !reads[tab].pending
                    ? reads[tab].data?.tab_counts?.[item.value]?.toLocaleString('en-US')
                    : null,
              }))}
              onChange={(value) =>
                query
                  ? setState({ view: value }, { replace: false })
                  : setState({ tab: value, page: '1' })
              }
            />
          )}
          {allEmpty ? (
            <Empty title={`No matches for “${query}”`} next="Try a full or partial name" />
          ) : (
            groups.map(({ value: kind, label }) => {
              const read = reads[kind];
              const data = read.data;
              const shownTab = (TABS.find((item) => item.value === data?.tab)?.value ??
                kind) as Tab;
              const filesShown = data?.rows.some(isFile) ?? false;
              const noun = NOUNS[filesShown ? 'files' : shownTab];
              const rows = (data?.rows ?? [])
                .slice(0, preview ? 5 : undefined)
                .map((row) => browseRow(shownTab, row));
              const count = countOf(kind);
              const retainedScope =
                data &&
                (data.q !== query ||
                  (kind === 'folders' &&
                    ((data.station ?? '') !== filters.station ||
                      String(data.year ?? '') !== filters.year ||
                      (data.category ?? '') !== filters.category)));
              const showFilters = kind === 'folders' && (!!rows.length || filtered);
              return (
                <section key={kind} className="mb-result-group" aria-label={label}>
                  {preview && (
                    <h3>
                      {label}
                      {count !== null && ` (${count})`}
                    </h3>
                  )}
                  {INTRO[kind] && (!query || kind === 'agencies') && (
                    <p className="mb-tab-intro">{INTRO[kind]}</p>
                  )}
                  {showFilters && (
                    <div className="mb-filters">
                      <Dropdown
                        name="Station"
                        value={filters.station}
                        options={[
                          { value: '', label: 'All stations' },
                          ...[
                            ...new Set([
                              ...(sources.data?.stations ?? []).map((source) => source.call_sign),
                              ...(filters.station ? [filters.station] : []),
                            ]),
                          ].map((station) => ({ value: station, label: station })),
                        ]}
                        onChange={(station) => changeFilters({ station })}
                      />
                      <Dropdown
                        name="Year"
                        value={filters.year}
                        options={[
                          { value: '', label: 'All years' },
                          ...[
                            ...new Set([
                              ...(data?.years ?? []),
                              ...(filters.year ? [Number(filters.year)] : []),
                            ]),
                          ]
                            .sort((a, b) => b - a)
                            .map((year) => ({
                              value: String(year),
                              label: String(year),
                            })),
                        ]}
                        onChange={(year) => changeFilters({ year })}
                      />
                      <Dropdown
                        name="Category"
                        value={filters.category}
                        options={[
                          { value: '', label: 'All categories' },
                          ...[
                            ...new Set([
                              ...(data?.categories ?? []),
                              ...(filters.category ? [filters.category] : []),
                            ]),
                          ].map((category) => ({
                            value: category,
                            label: category,
                          })),
                        ]}
                        onChange={(category) => changeFilters({ category })}
                      />
                      {filtered && (
                        <ClearAll
                          onClick={() =>
                            changeFilters({
                              station: '',
                              year: '',
                              category: '',
                            })
                          }
                        />
                      )}
                    </div>
                  )}
                  <div className="mb-results">
                    {read.loading && (
                      <LoadingRows
                        label={`Loading ${label === 'TV station folders' ? label : label.toLowerCase()}`}
                      />
                    )}
                    <ReadState read={{ ...read, loading: false }} />
                    {data && (
                      <>
                        {(!preview || retainedScope) && (
                          <p aria-live="polite" className="f-count-line mb-count">
                            {data.capped ? 'At least ' : ''}
                            {data.total.toLocaleString('en-US')}{' '}
                            {data.total === 1 ? noun[0] : noun[1]}
                            {data.q ? ` matching “${data.q}”` : ''}
                            {retainedScope && kind === 'folders' && (
                              <span className="mb-held-scope">
                                {[
                                  data.station || 'All stations',
                                  data.year || 'All years',
                                  data.category || 'All categories',
                                ].join(' · ')}
                              </span>
                            )}
                          </p>
                        )}
                        {rows.length === 0 ? (
                          !read.failed &&
                          !read.pending &&
                          !read.updating &&
                          data.total === 0 && <p className="mb-group-empty">No matches</p>
                        ) : (
                          <>
                            <ul className="mb-list" data-tab={filesShown ? 'files' : shownTab}>
                              {rows.map((row) => (
                                <li key={row.key}>
                                  <Link className="mb-row" to={withFrom(row.href, here)}>
                                    <span className="mb-row-name">
                                      <span className="mb-row-title">{row.name}</span>
                                      {row.note && <span className="mb-row-note">{row.note}</span>}
                                    </span>
                                    <span className="mb-row-mid">{row.mid}</span>
                                    <span className="mb-row-end">
                                      {row.end}
                                      <Arrow />
                                    </span>
                                  </Link>
                                </li>
                              ))}
                            </ul>
                            {preview ? (
                              data.total > 5 &&
                              !read.pending &&
                              !read.failed &&
                              !read.notFound && (
                                <Link
                                  className="mb-view-all"
                                  to={viewHref(kind)}
                                  onClick={focusResults}
                                >
                                  View all matching {NOUNS[kind][1]}
                                </Link>
                              )
                            ) : (
                              <Pager
                                page={data.page}
                                pages={Math.ceil(data.total / data.page_size)}
                                busy={read.pending || read.updating || read.failed || read.notFound}
                                onChange={(next) => pageTo(kind, next)}
                              />
                            )}
                            {data.capped && (
                              <p className="mb-end-note">
                                Results are limited to 500; add a word to narrow the search
                              </p>
                            )}
                            {kind === 'agencies' && <p className="mb-end-note">{NOTES.agencies}</p>}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </section>
              );
            })
          )}
        </div>
        <section aria-labelledby="about-h" className="mb-about">
          <h2 id="about-h">About these records</h2>
          <ul>
            <li>
              Only these 3 stations’ files are held, not the whole media market. Radio, cable,
              streaming, print and online ads are not held.
            </li>
            <li>
              A station category describes where the station put a file. It does not establish the
              advertiser’s identity or the election the document concerns.
            </li>
            <li>
              A name on a file is the spelling the station printed, and a matching name alone does
              not establish identity.
            </li>
            <li>
              Ordered, billed, credited, commission, net, gross and reported campaign expense are
              different. A document’s title or an invoice does not prove that an ad aired or a bill
              was paid.
            </li>
            <li>File and version counts are not ad counts or spend.</li>
            <li>{NOTES.folders}.</li>
          </ul>
        </section>
      </div>
      {sources.data && sources.data.stations.length > 0 && (
        <SourcesAndUpdates>
          {copiedLines(sources.data.stations).map((line) => (
            <p key={line} className="f-sources-line f-num">
              {line}
            </p>
          ))}
        </SourcesAndUpdates>
      )}
    </main>
  );
}
