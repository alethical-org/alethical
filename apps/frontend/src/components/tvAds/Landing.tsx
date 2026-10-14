import { RETRY_EXPLANATION } from './copy';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useResponsive } from '../../hooks/useResponsive';
import {
  readTV,
  isAccessFailure,
  queryString,
  orderStationCategories,
  centralDate,
  uploaded,
  tvHref,
  type BrowseQuery,
  type BrowseResult,
  type BrowseTab,
  type Counts,
  type Recent,
  type Sources,
} from './api';
import {
  Arrow,
  Busy,
  ChoiceMenu,
  External,
  Failure,
  FileRows,
  Kind,
  Metric,
  TVSession,
  useTVRead,
} from './pieces';

export const COVERAGE_LINES = [
  'No other stations, and no cable, radio, streaming, or online ads',
  'Stations must keep these files for at least 2 years, so older files may be gone from the FCC',
  'A document’s title alone does not establish that an ad aired or a bill was paid',
  'A name on a file is the spelling the station printed, and a matching name alone does not establish identity',
];
const TABS: Array<[BrowseTab, string]> = [
  ['folders', 'Station folders'],
  ['agencies', 'Ad agency names'],
  ['stations', 'Stations'],
  ['years', 'Years'],
];
export function highlight(text: string, query: string) {
  if (!query.trim()) return text;
  const terms = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .split(new RegExp(`(${terms})`, 'gi'))
    .map((part, index) =>
      part.toLowerCase() === query.trim().toLowerCase() ? <mark key={index}>{part}</mark> : part,
    );
}
function shownScope(result: BrowseResult) {
  if (result.q) return `the earlier results for “${result.q}”`;
  const label = TABS.find(([key]) => key === result.tab)?.[1].toLowerCase() ?? 'station folders';
  const filters = [result.station, result.year, result.category].filter(Boolean);
  return filters.length ? `${label} for ${filters.join(' · ')}` : `all ${label}`;
}
export function initialBrowse(params: Record<string, unknown>): BrowseQuery {
  const tab = TABS.some(([key]) => key === params.tab) ? (params.tab as BrowseTab) : 'folders';
  return {
    tab,
    q: typeof params.q === 'string' ? params.q.slice(0, 200) : '',
    station: tab === 'folders' && typeof params.station === 'string' ? params.station : '',
    year:
      tab === 'folders' && typeof params.year === 'string' && params.year !== 'all'
        ? params.year
        : '',
    category: tab === 'folders' && typeof params.category === 'string' ? params.category : '',
    page: Math.max(1, Number(params.page) || 1),
  };
}
/** A folders address with no year and no search shows the newest folder year. */
function usesDefaultYear(params: Record<string, unknown>) {
  const browse = initialBrowse(params);
  return !params.year && !browse.q && browse.tab === 'folders';
}
function browseKey(params: Record<string, unknown>) {
  return JSON.stringify([initialBrowse(params), usesDefaultYear(params)]);
}
export function TVLanding({
  params,
  onParams,
}: {
  params: Record<string, unknown>;
  onParams: (values: Record<string, string | undefined>) => void;
}) {
  const { isMobile } = useResponsive();
  const [query, setQuery] = useState(() => initialBrowse(params));
  const [draft, setDraft] = useState(query.q);
  const [defaultYear, setDefaultYear] = useState(() => usesDefaultYear(params));
  // The landing stays mounted when a link or Back/Forward changes only its address, so
  // follow every address this component did not write itself.
  const latestParams = useRef(params);
  latestParams.current = params;
  const written = useRef(browseKey(params));
  const writeParams = useCallback(
    (values: Record<string, string | undefined>) => {
      written.current = browseKey({ ...latestParams.current, ...values });
      onParams(values);
    },
    [onParams],
  );
  const addressKey = browseKey(params);
  useEffect(() => {
    if (addressKey === written.current) return;
    written.current = addressKey;
    const next = initialBrowse(latestParams.current);
    setQuery(next);
    setDraft(next.q);
    setDefaultYear(usesDefaultYear(latestParams.current));
  }, [addressKey]);
  const browse = useTVRead<BrowseResult>(
    `/browse${queryString({ ...query, default_year: defaultYear || undefined })}`,
  );
  const counts = useTVRead<Counts>('/counts');
  const recent = useTVRead<Recent>('/recent');
  const countRef = useRef<HTMLParagraphElement>(null);
  const moveToResult = useRef<'page' | 'search' | null>(null);
  const result = browse.data;
  useEffect(() => {
    if (defaultYear && result?.year) writeParams({ year: String(result.year), page: undefined });
  }, [defaultYear, result?.year, writeParams]);
  useEffect(() => {
    if (browse.loading || !moveToResult.current) return;
    if (moveToResult.current === 'page') countRef.current?.scrollIntoView?.({ block: 'start' });
    countRef.current?.focus({ preventScroll: true });
    moveToResult.current = null;
  }, [browse.loading]);
  const change = (patch: Partial<BrowseQuery>, action?: 'page' | 'search') => {
    const next = {
      ...query,
      year: defaultYear ? String(result?.year || '') : query.year,
      page: 1,
      ...patch,
    };
    setDefaultYear(false);
    setQuery(next);
    writeParams({
      q: next.q || undefined,
      tab: next.tab,
      station: next.station || undefined,
      year: next.tab === 'folders' ? next.year || 'all' : undefined,
      category: next.category || undefined,
      page: next.page > 1 ? String(next.page) : undefined,
    });
    if (action) moveToResult.current = action;
  };
  // Build the return address from query fields alone, never serialize response rows.
  const from = result
    ? `/money/ads${queryString({ tab: result.tab, q: result.q, station: result.station, year: result.year || (result.tab === 'folders' && !result.q ? 'all' : undefined), category: result.category, page: result.page })}`
    : `/money/ads${queryString(query as unknown as Record<string, unknown>)}`;
  const totalPages = result
    ? Math.max(
        1,
        Math.ceil(Math.min(result.total, result.capped ? 500 : result.total) / result.page_size),
      )
    : 1;
  const requestedDiffers =
    !!result &&
    Object.keys(query).some(
      (key) =>
        String(
          key === 'year' && defaultYear ? result.year || '' : query[key as keyof BrowseQuery],
        ) !== String(result[key as keyof BrowseQuery] ?? ''),
    );
  return (
    <>
      <h1>TV ad records</h1>
      <p className="tv-lead">
        Explore orders, invoices, and agreements for political ads from KSTP-TV, KARE, and KMSP-TV.
        We copy these records from the Federal Communications Commission’s website.
      </p>
      <form
        className="tv-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          (document.activeElement as HTMLElement)?.blur();
          change({ q: draft.trim() }, 'search');
        }}
      >
        <div className="tv-search-field">
          <svg
            className="tv-search-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="6.5" stroke="#6f756f" strokeWidth="2" />
            <path d="M16 16 L21 21" stroke="#6f756f" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            aria-label="Search TV ad records"
            aria-describedby={isMobile ? 'tv-search-help' : undefined}
            placeholder={
              isMobile
                ? 'Search TV ad records'
                : 'Try a candidate, committee, agency, or order number'
            }
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={200}
            enterKeyHint="search"
            type="search"
          />
          {isMobile && (
            <p id="tv-search-help" className="tv-small" style={{ paddingLeft: 14, marginTop: 8 }}>
              Try a candidate, committee, agency, or order number
            </p>
          )}
        </div>
        <button
          className="tv-button"
          type="submit"
          aria-disabled={browse.loading && requestedDiffers}
          onClick={(event) => {
            if (browse.loading && requestedDiffers) event.preventDefault();
          }}
        >
          {browse.loading && requestedDiffers ? 'Searching…' : 'Search'}
        </button>
      </form>
      <div className="tv-tabs" role="tablist" aria-label="Browse TV ad records">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={query.tab === key}
            onClick={() => {
              setDraft('');
              change({ tab: key, q: '', station: '', year: '', category: '' });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="tv-small">
        {query.tab === 'folders'
          ? 'Browse files grouped and named by each station'
          : query.tab === 'agencies'
            ? 'Names as printed, with each spelling listed separately'
            : query.tab === 'stations'
              ? 'Browse records from each station'
              : 'Browse station folders by year'}
      </p>
      {query.tab === 'folders' && (
        <div className="tv-filters">
          <ChoiceMenu
            label="Station"
            value={query.station}
            choices={[
              { value: '', label: 'All stations' },
              ...['KSTP-TV', 'KARE', 'KMSP-TV'].map((s) => ({ value: s, label: s })),
            ]}
            onChange={(station) => change({ station })}
          />
          <ChoiceMenu
            label="Folder year"
            value={defaultYear ? String(result?.year || '') : query.year}
            choices={[
              { value: '', label: 'All years' },
              ...(result?.years || []).map((y) => ({ value: String(y), label: String(y) })),
            ]}
            onChange={(year) => change({ year })}
          />
          <ChoiceMenu
            label="Category"
            value={query.category}
            choices={[
              { value: '', label: 'All categories' },
              ...orderStationCategories(result?.categories || []).map((c) => ({
                value: c,
                label: c,
              })),
            ]}
            onChange={(category) => change({ category })}
          />
        </div>
      )}
      <div aria-busy={browse.loading}>
        {!!browse.error && (
          <Failure retry={browse.retry} detail={RETRY_EXPLANATION}>
            We couldn’t search these records just now
          </Failure>
        )}
        {result && (requestedDiffers || !!browse.error) && (
          <p role="status" className="tv-small">
            Still showing {shownScope(result)}
          </p>
        )}
        {!result && !browse.error && (
          <div style={{ minHeight: 867 }}>
            <Busy label="Loading station folders" />
            {Array.from({ length: 9 }, (_, i) => (
              <div className="tv-skeleton" key={i} />
            ))}
          </div>
        )}
        {result && (
          <div style={{ opacity: browse.loading ? 0.85 : 1 }}>
            <p className="tv-result-count" ref={countRef} tabIndex={-1}>
              {result.capped ? 'More than 500' : result.total.toLocaleString('en-US')}{' '}
              {result.q
                ? result.total === 1 && !result.capped
                  ? 'file'
                  : 'files'
                : result.tab === 'folders'
                  ? result.total === 1
                    ? 'station folder'
                    : 'station folders'
                  : result.tab === 'agencies'
                    ? result.total === 1
                      ? 'ad agency name'
                      : 'ad agency names'
                    : result.tab === 'stations'
                      ? result.total === 1
                        ? 'station'
                        : 'stations'
                      : result.total === 1
                        ? 'year'
                        : 'years'}
            </p>
            {result.capped && (
              <p className="tv-small">Showing the first 500: add a word to narrow the search</p>
            )}
            {result.rows.length ? (
              <div className="tv-rows">
                {result.rows.map((row) => {
                  const kind = result.q
                    ? 'file'
                    : result.tab === 'folders'
                      ? 'folder'
                      : result.tab === 'agencies'
                        ? 'agency'
                        : 'station';
                  const href =
                    result.tab === 'years' && !result.q
                      ? `/money/ads${queryString({ tab: 'folders', year: row.key })}`
                      : tvHref(kind, row.key, {
                          version: row.version_id,
                          copy: row.copy_id,
                          q: result.q || undefined,
                          from,
                        });
                  return (
                    <a key={row.key} href={href} className="tv-row">
                      <div className="tv-row-main">
                        {result.q && (
                          <div className="tv-eyebrow">
                            {row.station} · {row.year} ·{' '}
                            {row.category
                              ? `STATION CATEGORY: ${row.category}`
                              : 'CATEGORY NOT IDENTIFIED'}
                          </div>
                        )}
                        <strong>{row.label}</strong>
                        {!result.q && (
                          <div className="tv-small">
                            {[
                              ...(result.tab === 'folders'
                                ? [
                                    row.station,
                                    row.year,
                                    row.category
                                      ? `Station category: ${row.category}`
                                      : 'Category not identified',
                                  ]
                                : []),
                              (result.tab === 'stations' || result.tab === 'years') &&
                              typeof row.folder_count === 'number'
                                ? `${row.folder_count.toLocaleString('en-US')} ${row.folder_count === 1 ? 'folder' : 'folders'}`
                                : null,
                              typeof row.file_count === 'number'
                                ? `${row.file_count.toLocaleString('en-US')} ${row.file_count === 1 ? 'file' : 'files'}`
                                : null,
                              result.tab === 'agencies' ? row.stations?.join(', ') : null,
                              row.unchecked ? 'Includes names not checked' : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        )}
                        {result.q && (
                          <>
                            <Kind value={row.kind} />
                            <p className="tv-small">{uploaded(row.uploaded_at)}</p>
                            {row.excerpt && (
                              <p style={{ marginTop: 8 }}>
                                <b>{row.match_label}: </b>
                                {highlight(row.excerpt, result.q)}
                              </p>
                            )}
                            {row.text_match && (
                              <p className="tv-small" style={{ color: '#7a5a12' }}>
                                Not checked
                              </p>
                            )}
                          </>
                        )}
                      </div>
                      <Arrow />
                    </a>
                  );
                })}
              </div>
            ) : (
              <p className="tv-notice">
                {result.q
                  ? `No station files match “${result.q}”`
                  : 'No records match these choices'}
                {result.q && (
                  <span style={{ display: 'block', marginTop: 10 }}>
                    Try a shorter part of the name or number, or a different spelling
                  </span>
                )}
              </p>
            )}
            {totalPages > 1 && (
              <nav className="tv-pagination" aria-label="Results pages">
                <button
                  className="tv-button tv-secondary"
                  disabled={result.page <= 1 || browse.loading}
                  onClick={() => change({ page: result.page - 1 }, 'page')}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M15 5 L8 12 L15 19"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Previous
                </button>
                <span>
                  Page {result.page} of {totalPages}
                </span>
                <button
                  className="tv-button tv-secondary"
                  disabled={result.page >= totalPages || browse.loading}
                  onClick={() => change({ page: result.page + 1 }, 'page')}
                >
                  Next
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M9 5 L16 12 L9 19"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </nav>
            )}
          </div>
        )}
      </div>
      {counts.data && !counts.error && (
        <section className="tv-section" aria-label="Records held">
          <div className="tv-metrics">
            <Metric value={counts.data.station_files_held} label="Station files held" />
            <Metric value={counts.data.unique_file_contents} label="Unique file contents">
              Identical contents counted once, including older versions
            </Metric>
          </div>
          <div className="tv-count-divider" />
          <div className="tv-metrics">
            <Metric
              value={counts.data.files_with_approved_copy}
              label="Files with an approved copy"
            />
            <Metric
              value={counts.data.text_read_failures}
              label="Files whose text could not be fully read"
            />
            <Metric
              value={counts.data.download_failures}
              label="Files we couldn’t download from the FCC"
            />
          </div>
          <p className="tv-small" style={{ marginTop: 14 }}>
            These counts can overlap
          </p>
          <p style={{ marginTop: 24 }}>
            {counts.data.checked_connection_files.toLocaleString('en-US')}{' '}
            {counts.data.checked_connection_files === 1 ? 'file has' : 'files have'} a checked
            connection to a campaign, candidate, lobbying principal, election, issue, or reported
            expense
          </p>
        </section>
      )}
      <section className="tv-section tv-recent-section">
        <h2>Recent station uploads</h2>
        {recent.loading && !recent.data ? (
          <Busy />
        ) : recent.error && !recent.data ? (
          <Failure retry={recent.retry} />
        ) : (
          <div className="tv-grid3">
            {recent.data?.stations.map((station) => (
              <div
                className={`tv-card tv-recent-card${station.files.length ? '' : ' tv-recent-card-empty'}`}
                key={station.call_sign}
              >
                <h3>{station.call_sign}</h3>
                {station.files.length ? (
                  <FileRows files={station.files} returnTo={from} recent />
                ) : (
                  <p className="tv-small">No records to show</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <p className="tv-section tv-guide-link">
        <a href="/money/ads/guide">
          How to read TV ad records
          <Arrow />
        </a>
      </p>
      <SourceDates />
      <section className="tv-section" aria-labelledby="tv-coverage">
        <h2 id="tv-coverage">Coverage and limits</h2>
        <ul className="tv-plain-list">
          {COVERAGE_LINES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </>
  );
}

export function SourceDates() {
  const initial = useTVRead<Sources>('/sources');
  const { token, denied } = useContext(TVSession);
  const [updated, setUpdated] = useState<Sources | null>(null);
  const [notice, setNotice] = useState<{
    names: string[];
    state: 'trying' | 'success' | 'failed';
    repeat: boolean;
  } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const inFlight = useRef<AbortController | null>(null);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => () => inFlight.current?.abort(), []);
  const data = updated || initial.data;
  const failures =
    data?.stations.filter((station) => station.error).map((station) => station.call_sign) || [];
  const names = notice?.names || failures;
  const readable =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  const retry = () => {
    if (!data) {
      initial.retry();
      return;
    }
    if (notice?.state === 'trying') return;
    const controller = new AbortController();
    inFlight.current = controller;
    setNotice({ names: failures, state: 'trying', repeat: !!notice });
    setAnnouncement('Trying again');
    void readTV<Sources>(
      token,
      `/sources${queryString({ stations: failures.join(',') })}`,
      controller.signal,
    ).then(
      (next) => {
        if (controller.signal.aborted) return;
        const nextData = {
          ...data,
          stations: data.stations.map(
            (station) =>
              next.stations.find((item) => item.call_sign === station.call_sign) || station,
          ),
        };
        setUpdated(nextData);
        const remaining = nextData.stations
          .filter((station) => station.error)
          .map((station) => station.call_sign);
        if (remaining.length) {
          setNotice({ names: remaining, state: 'failed', repeat: true });
          setAnnouncement(`We still couldn’t get the latest dates for ${remaining.join(' and ')}`);
          return;
        }
        const heldFocus = document.activeElement === button.current;
        setNotice({ names: failures, state: 'success', repeat: false });
        setAnnouncement(heldFocus ? '' : `Dates updated for ${readable}`);
        if (heldFocus)
          requestAnimationFrame(() => confirmation.current?.focus({ preventScroll: true }));
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (isAccessFailure(error)) {
          denied();
          return;
        }
        setNotice({ names: failures, state: 'failed', repeat: true });
        setAnnouncement(`We still couldn’t get the latest dates for ${readable}`);
      },
    );
  };
  return (
    <section className="tv-section tv-source-section">
      <h2>Sources and copy dates</h2>
      <p className="tv-small">The copy date does not mean every listed file has been copied</p>
      <span className="tv-sr" role="status">
        {announcement}
      </span>
      {(failures.length > 0 || notice) && (
        <div
          ref={confirmation}
          tabIndex={-1}
          className={`tv-notice tv-date-notice ${notice?.state === 'success' ? 'tv-success' : 'tv-error'}`}
        >
          <span>
            {notice?.state === 'success'
              ? `Dates updated for ${readable}`
              : `${notice?.repeat ? 'We still couldn’t' : 'We couldn’t'} get the latest dates for ${readable}`}
          </span>
          {notice?.state !== 'success' && (
            <button
              ref={button}
              className="tv-button"
              aria-disabled={notice?.state === 'trying'}
              onClick={retry}
            >
              {notice?.state === 'trying' ? 'Trying again…' : 'Try again'}
            </button>
          )}
        </div>
      )}
      {!!initial.error && !data && (
        <Failure retry={initial.retry}>We couldn’t load the copy dates</Failure>
      )}
      {initial.loading && !data && <Busy label="Loading copy dates" />}
      <div className="tv-grid3" style={{ marginTop: 16 }}>
        {(
          data?.stations || [
            {
              call_sign: 'KSTP-TV',
              facility_id: 28010,
              fcc_url: 'https://publicfiles.fcc.gov/tv-profile/kstp-tv',
              newest_upload: null,
              last_list_check: null,
              last_file_copy: null,
            },
            {
              call_sign: 'KARE',
              facility_id: 23079,
              fcc_url: 'https://publicfiles.fcc.gov/tv-profile/kare',
              newest_upload: null,
              last_list_check: null,
              last_file_copy: null,
            },
            {
              call_sign: 'KMSP-TV',
              facility_id: 68883,
              fcc_url: 'https://publicfiles.fcc.gov/tv-profile/kmsp-tv',
              newest_upload: null,
              last_list_check: null,
              last_file_copy: null,
            },
          ]
        ).map((station) => (
          <div className="tv-source" key={station.call_sign}>
            <h3>{station.call_sign}</h3>
            {station.error &&
              [station.newest_upload, station.last_list_check, station.last_file_copy].some(
                Boolean,
              ) && <p className="tv-small">Showing the last dates we had</p>}
            <dl className="tv-dates">
              <dt>Newest known upload</dt>
              <dd>{centralDate(station.newest_upload)}</dd>
              <dt>Last successful file-list check</dt>
              <dd>{centralDate(station.last_list_check)}</dd>
              <dt>Last successful file copy</dt>
              <dd>{centralDate(station.last_file_copy)}</dd>
            </dl>
            <External href={station.fcc_url} suffix={`for ${station.call_sign}`}>
              Public records on the FCC website
            </External>
          </div>
        ))}
      </div>
      {data?.text_reader_version && (
        <details style={{ marginTop: 24 }}>
          <summary>Technical details</summary>
          <p className="tv-small" style={{ paddingLeft: 13 }}>
            Text-reading version: {data.text_reader_version}
          </p>
        </details>
      )}
    </section>
  );
}
