import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useRead, type Read } from '../api/read';
import { useFinanceSession } from '../auth/session';
import { cameByHistory, Link, navigate, savedScroll, useLocation } from '../router';
import { useLiveSearch } from '../search/useLiveSearch';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt } from '../routes';
import { useAddressState } from '../ui/addressState';
import { useBand } from '../ui/band';
import {
  ClearAll,
  Cross,
  Dropdown,
  Empty,
  EvidencePanel,
  LoadingRows,
  Refused,
} from '../ui/controls';
import type { Evidence, EvidenceRow, Option } from '../ui/controls';
import { BackLink, LoadingLine, WithArrow } from '../ui/parts';
import { ScrollingTabs } from '../ui/scrollingTabs';
import { Pager, ReadState, day, fileHref, mediaPath } from './media/shared';
import type {
  FilingDetail,
  FilingFolder,
  FilingFolders,
  FilingOutlet,
  FilingOutlets,
  FilingPdf,
  FilingRow,
  Filings,
} from './media/types';
import './media/directory.css';
import './media/filings.css';

/**
 * NOT APPROVED COPY. A filing whose PDF check has not completed has no reader
 * state in the approved design (v2 Media Buys, Nov 18, 2026: only Open and Not
 * available). This placeholder keeps such a cell from reading as Not available
 * or blank. It must not ship: the page releases only once every filing is checked,
 * or once Alethical approves wording for this state.
 */
export const PENDING_LABEL = 'Check pending';

type Tab = 'all-filings' | 'advertisers' | 'stations-and-providers';
const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'all-filings', label: 'All filings' },
  { value: 'advertisers', label: 'Advertisers' },
  { value: 'stations-and-providers', label: 'Stations and providers' },
];
const SEARCH: Record<Tab, { label: string; placeholder: string; hint?: string }> = {
  'all-filings': {
    label: 'Search filings',
    placeholder: '',
    hint: 'Filename, folder, station, provider or FCC file ID',
  },
  advertisers: {
    label: 'Search by advertiser or folder name',
    placeholder: 'Advertiser or folder name',
  },
  'stations-and-providers': {
    label: 'Search stations and providers',
    placeholder: 'Station, call sign or provider',
  },
};
const FILE_NOTE =
  'Filename or folder matches do not prove a purchase, buyer, order number, document type or price';
const ADVERTISER_NOTE =
  'Only checked facts establish an advertiser. Folder names are listed separately so they are not read as checked.';
const DOCTYPES: ReadonlyArray<Option<string>> = [
  { value: '', label: 'All types' },
  { value: 'orders', label: 'Orders and contracts' },
];
const SORTS: ReadonlyArray<Option<string>> = [
  { value: '', label: 'Newest upload first' },
  { value: 'name', label: 'Name A–Z' },
];
const GUIDE = {
  label: 'What can a filing show?',
  items: [
    {
      lead: 'Who requested the ad.',
      rest: 'A request can name the sponsor, buyer or agency, identify the candidate, election or issue, and show whether the request was accepted in full, accepted in part or turned down.',
    },
    {
      lead: 'What was booked and what aired.',
      rest: 'An order can show where ads were booked, their number and length, and the agreed price. An airing record can show when each ad ran and whether any were missed or replaced.',
    },
    {
      lead: 'What was billed or paid.',
      rest: 'An invoice can show the price per ad, total charges, agency commission and balance due. Some also show payments received.',
    },
    {
      lead: 'How filings fit together.',
      rest: 'One ad buy can have several filings. Order and contract numbers can help trace the same buy from request to invoice. Other filings cover station rates, free airtime or requests for equal airtime.',
    },
  ],
} as const;
const MAX_PAGE = 100_000;

/** Older Media buys tabs, each opened as the nearest current view. */
const LEGACY_TABS: Record<string, { tab: Tab; doctype?: 'orders' }> = {
  overview: { tab: 'all-filings' },
  'source-documents': { tab: 'all-filings' },
  national: { tab: 'all-filings' },
  folders: { tab: 'all-filings' },
  years: { tab: 'all-filings' },
  'orders-and-contracts': { tab: 'all-filings', doctype: 'orders' },
  stations: { tab: 'stations-and-providers' },
  agencies: { tab: 'advertisers' },
};
/** Address keys of the retired directory and audience split, dropped on arrival. */
const RETIRED_KEYS = [
  'scope',
  'station',
  'category',
  'view',
  'foldersPage',
  'agenciesPage',
  'stationsPage',
  'yearsPage',
  'nationalPage',
  'browseSource',
  'foldersSource',
  'agenciesSource',
  'stationsSource',
  'yearsSource',
  'nationalSource',
  'searchFilters',
  'searchStation',
  'searchYear',
  'searchCategory',
];

/**
 * The address this page shows, as a query string without its `?`: older tab
 * links open the nearest current view, `scope=` and retired keys are dropped,
 * and values the page does not offer are removed. Other keys (`from`) stay.
 */
export function mediaBuysAddress(search: string): string {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  const legacy = tab !== null ? LEGACY_TABS[tab] : undefined;
  // A TV station page's "folders" link names its station: search for it.
  const station = params.get('station')?.trim();
  if ((tab === null || tab === 'folders') && station && !params.get('q')) params.set('q', station);
  let next: Tab = 'all-filings';
  if (legacy) {
    next = legacy.tab;
    if (legacy.doctype && !params.get('doctype')) params.set('doctype', legacy.doctype);
    params.delete('page');
  } else if (TABS.some((item) => item.value === tab)) next = tab as Tab;
  if (next === 'all-filings') params.delete('tab');
  else params.set('tab', next);
  for (const key of RETIRED_KEYS) params.delete(key);
  if (params.has('doctype') && params.get('doctype') !== 'orders') params.delete('doctype');
  if (params.has('pdf') && params.get('pdf') !== 'yes') params.delete('pdf');
  if (params.has('sort') && params.get('sort') !== 'name') params.delete('sort');
  if (params.has('year') && !/^\d{4}$/.test(params.get('year') ?? '')) params.delete('year');
  if (params.has('q') && !params.get('q')?.trim()) params.delete('q');
  if (params.has('page')) {
    const page = Math.trunc(Number(params.get('page')));
    if (page > 1) params.set('page', String(Math.min(MAX_PAGE, page)));
    else params.delete('page');
  }
  if (next !== 'all-filings') for (const key of ['doctype', 'pdf', 'sort']) params.delete(key);
  return params.toString();
}

function readView(address: string) {
  const params = new URLSearchParams(address);
  return {
    tab: (params.get('tab') as Tab | null) ?? 'all-filings',
    q: (params.get('q') ?? '').trim().slice(0, 200),
    year: params.get('year') ?? '',
    doctype: params.get('doctype') ?? '',
    pdf: params.get('pdf') ?? '',
    sort: params.get('sort') ?? '',
    page: Number(params.get('page') ?? '1') || 1,
  };
}

/** Where a filing's saved PDF opens: the held Minnesota TV station file, or
 * the national file reader for that FCC record. */
export function filingHref(row: Pick<FilingRow, 'key' | 'minnesota_key'>): string {
  return row.minnesota_key ? fileHref(row.minnesota_key) : fileHref('national-' + row.key);
}

/** The Filing PDF value in the FCC details. */
function pdfDetail(pdf: FilingPdf, savedOn: string | null): string {
  if (pdf === 'saved') return savedOn ? `Saved ${day(savedOn)}` : 'Saved';
  return pdf === 'unavailable' ? 'Not available' : PENDING_LABEL;
}

const count = (value: number) => value.toLocaleString('en-US');
const isList = (data: { rows?: unknown; total?: unknown; years?: unknown } | null) =>
  !!data && Array.isArray(data.rows) && Number.isFinite(data.total) && Array.isArray(data.years);

function busy(read: Read<unknown>) {
  return read.loading || read.updating || read.pending;
}

export function MediaBuys() {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const address = mediaBuysAddress(location.search);
  const view = readView(address);
  const [, setAddress] = useAddressState({
    tab: 'all-filings',
    q: '',
    year: '',
    doctype: '',
    pdf: '',
    sort: '',
    page: '1',
  });
  const shown = new URLSearchParams(location.search).toString();
  useLayoutEffect(() => {
    if (address !== shown)
      navigate(location.pathname + (address ? `?${address}` : ''), { replace: true });
  }, [address, shown, location.pathname]);

  const [typed, setTyped, applySearch] = useLiveSearch(
    view.q,
    here,
    (q) => setAddress({ q, page: '1' }),
    (value) => value.trim().slice(0, 200),
  );
  const list = {
    q: view.q,
    year: view.year,
    page: view.page > 1 ? view.page : undefined,
  };
  const filings = useRead<Filings>(
    view.tab === 'all-filings'
      ? mediaPath(['filings'], {
          ...list,
          doctype: view.doctype || undefined,
          pdf: view.pdf || undefined,
          sort: view.sort || undefined,
        })
      : null,
    {
      keepPrevious: true,
      acceptData: (data) => isList(data) && !!data.about,
    },
  );
  const advertisers = useRead<FilingFolders>(
    view.tab === 'advertisers' ? mediaPath(['filing-advertisers'], list) : null,
    { keepPrevious: true, acceptData: isList },
  );
  const outlets = useRead<FilingOutlets>(
    view.tab === 'stations-and-providers' ? mediaPath(['filing-outlets'], list) : null,
    { keepPrevious: true, acceptData: isList },
  );
  const read: Read<Filings | FilingFolders | FilingOutlets> =
    view.tab === 'all-filings' ? filings : view.tab === 'advertisers' ? advertisers : outlets;
  const data = read.data;
  const settled = !!data && !busy(read) && !read.failed;

  // A results page past the end (an old link) opens the last page instead.
  useEffect(() => {
    if (!settled || !data || data.page !== view.page) return;
    const last = Math.max(1, Math.ceil(data.total / data.page_size));
    if (view.page > last) setAddress({ page: String(last) });
  }, [settled, data, view.page, setAddress]);

  // Back to this address returns to where the reader was, once results are drawn.
  const restore = useRef<number | null | undefined>(undefined);
  if (restore.current === undefined) restore.current = cameByHistory() ? savedScroll() : null;
  useEffect(() => {
    if (restore.current == null || !data) return;
    const y = restore.current;
    restore.current = null;
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
  }, [data]);

  const [guideOpen, setGuideOpen] = useState(false);
  const [source, setSource] = useState<FilingRow | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const detail = useRead<FilingDetail>(source ? mediaPath(['filings', source.key]) : null);
  const closeSource = useCallback(() => setSource(null), []);
  useEffect(() => {
    if (source !== null || !opener.current) return;
    const button = opener.current;
    opener.current = null;
    if (button.isConnected) button.focus({ preventScroll: true });
  }, [source]);
  function openSource(row: FilingRow, button: HTMLElement) {
    opener.current = button;
    setSource(row);
  }

  const results = useRef<HTMLDivElement>(null);
  function pageTo(next: number) {
    setAddress({ page: String(next) }, { replace: false });
    const target = results.current;
    if (!target) return;
    window.scrollTo({
      top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - 20),
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
    target.focus({ preventScroll: true });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    applySearch();
  }
  function goTab(tab: Tab) {
    // The query and year carry over; this tab's own filters, sort and page do not.
    setAddress({ tab, doctype: '', pdf: '', sort: '', page: '1' }, { replace: false });
  }
  const filter = (changes: Partial<Record<'year' | 'doctype' | 'pdf', string>>) =>
    setAddress({ ...changes, page: '1' }, { replace: false });

  const session = useFinanceSession();
  const check = session.canEdit !== false && isBuilt('check-station-files');
  const band = useBand();
  const search = SEARCH[view.tab];
  const years = [
    ...new Set([...(data?.years ?? []), ...(view.year ? [Number(view.year)] : [])]),
  ].sort((a, b) => b - a);
  const yearValue = view.year || (data ? String(data.year) : '');
  const chips = [
    ...(view.doctype === 'orders'
      ? [{ label: 'Document type: Orders and contracts', clear: { doctype: '' } }]
      : []),
    ...(view.pdf === 'yes' ? [{ label: 'Has filing PDF', clear: { pdf: '' } }] : []),
  ];
  const note =
    view.tab === 'all-filings' ? FILE_NOTE : view.tab === 'advertisers' ? ADVERTISER_NOTE : '';
  const statusLine = read.loading
    ? 'Loading'
    : read.updating || (read.pending && !!data)
      ? 'Updating results…'
      : data
        ? read.failed && data.q
          ? `Previous results for “${data.q}”`
          : `${count(data.total)} ${data.total === 1 ? 'result' : 'results'}`
        : '';
  const about = view.tab === 'all-filings' ? filings.data?.about : undefined;

  return (
    <main id="main" className="f-page mb-page mbf-page">
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
            FCC political ad filings from TV and radio stations, cable systems and satellite
            providers across the U.S.
          </p>
        </header>
        <div className="mbf-tabs">
          <ScrollingTabs
            label="Media buys"
            value={view.tab}
            tabs={TABS}
            onChange={(tab) => goTab(tab)}
          />
        </div>
        <section
          className="mbf-panel"
          aria-label={TABS.find((item) => item.value === view.tab)?.label}
        >
          <div className="mbf-controls" data-wide={view.tab === 'all-filings' || undefined}>
            <form role="search" className="mbf-search" onSubmit={submit}>
              <label htmlFor="mbf-q">{search.label}</label>
              {search.hint && <span id="mbf-q-hint">{search.hint}</span>}
              <input
                id="mbf-q"
                type="search"
                className="f-field"
                value={typed}
                maxLength={200}
                autoComplete="off"
                enterKeyHint="search"
                aria-describedby={search.hint ? 'mbf-q-hint' : undefined}
                placeholder={search.placeholder || undefined}
                onChange={(event) => setTyped(event.target.value)}
              />
            </form>
            <div className="mbf-menus">
              {years.length > 0 && (
                <Dropdown
                  name="File year"
                  value={yearValue}
                  options={years.map((year) => ({ value: String(year), label: String(year) }))}
                  onChange={(year) => filter({ year })}
                />
              )}
              {view.tab === 'all-filings' && (
                <>
                  <Dropdown
                    name="Document type"
                    value={view.doctype}
                    options={DOCTYPES}
                    onChange={(doctype) => filter({ doctype })}
                  />
                  <label className="mbf-toggle" data-checked={view.pdf === 'yes' || undefined}>
                    <input
                      type="checkbox"
                      checked={view.pdf === 'yes'}
                      onChange={(event) => filter({ pdf: event.target.checked ? 'yes' : '' })}
                    />
                    Has filing PDF
                  </label>
                  <Dropdown
                    name="Sort by"
                    value={view.sort}
                    options={SORTS}
                    onChange={(sort) => setAddress({ sort, page: '1' })}
                  />
                </>
              )}
            </div>
          </div>
          {chips.length > 0 && (
            <div className="mbf-chips">
              {chips.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  className="mbf-chip"
                  aria-label={`Remove ${chip.label}`}
                  onClick={() => filter(chip.clear)}
                >
                  {chip.label}
                  <Cross />
                </button>
              ))}
              <ClearAll onClick={() => filter({ doctype: '', pdf: '' })} />
            </div>
          )}
          {note && (
            <div className="mbf-note">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="#0E6A82" strokeWidth="2" />
                <path
                  d="M12 11 V16.5 M12 7.5 V8"
                  stroke="#0E6A82"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
              <span>{note}</span>
            </div>
          )}
          {read.failed && (
            <div className="mbf-alert">
              <Refused onRetry={read.retry} retrying={read.pending}>
                Couldn’t load results
              </Refused>
            </div>
          )}
          <div className="mbf-results" ref={results} tabIndex={-1}>
            <div role="status" aria-live="polite" className="mbf-status f-num">
              {(read.loading || read.updating || (read.pending && !!data)) && (
                <span className="f-spinner" aria-hidden="true" />
              )}
              <span>{statusLine}</span>
            </div>
            {read.loading && <LoadingRows label="Loading results" />}
            {data && data.rows.length === 0 && !read.loading && !read.failed && (
              <Empty title="No matching records" />
            )}
            {data && data.rows.length > 0 && (
              <div className="mbf-rows" data-busy={busy(read) || undefined} aria-busy={busy(read)}>
                {view.tab === 'all-filings' && filings.data && (
                  <FilingResults
                    rows={filings.data.rows}
                    orders={view.doctype === 'orders'}
                    phone={band === 'phone'}
                    here={here}
                    onSource={openSource}
                  />
                )}
                {view.tab === 'advertisers' && advertisers.data && (
                  <AdvertiserResults
                    rows={advertisers.data.rows}
                    year={advertisers.data.year}
                    phone={band === 'phone'}
                    here={here}
                  />
                )}
                {view.tab === 'stations-and-providers' && outlets.data && (
                  <OutletResults
                    rows={outlets.data.rows}
                    year={outlets.data.year}
                    phone={band === 'phone'}
                    here={here}
                  />
                )}
              </div>
            )}
            {data && (
              <Pager
                page={data.page}
                pages={Math.ceil(data.total / data.page_size)}
                busy={busy(read) || read.failed}
                onChange={pageTo}
              />
            )}
          </div>
        </section>
        {about && (
          <section aria-labelledby="about-h" className="mb-about mbf-about">
            <h2 id="about-h">About these records</h2>
            <ul>
              <li>
                {count(about.filings)} searchable filings ·{' '}
                <a href="https://publicfiles.fcc.gov/" target="_blank" rel="noopener noreferrer">
                  FCC Public Inspection Files
                  <span className="f-visually-hidden"> (opens in a new tab)</span>
                </a>{' '}
                through {day(about.index_through)}
              </li>
              <li>
                {count(about.saved)} filings with a saved PDF of the original paperwork a station or
                provider filed with the FCC · Updated {day(about.saved_updated)}
              </li>
            </ul>
            <div className="mbf-guide">
              <h3>
                <button
                  type="button"
                  id="mbf-guide-button"
                  aria-expanded={guideOpen}
                  aria-controls={guideOpen ? 'mbf-guide' : undefined}
                  onClick={() => setGuideOpen((open) => !open)}
                >
                  {GUIDE.label}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M9 5 L16 12 L9 19"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </h3>
              {guideOpen && (
                <div id="mbf-guide" role="region" aria-labelledby="mbf-guide-button">
                  {GUIDE.items.map((item) => (
                    <p key={item.lead}>
                      <strong>{item.lead}</strong> {item.rest}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
      <EvidencePanel
        evidence={source ? sourceEvidence(source, detail.data) : null}
        onClose={closeSource}
      >
        {source && sourceGap(source, detail)}
      </EvidencePanel>
    </main>
  );
}

/** A filing's FCC details: what the index holds, with no separate evidence check. */
function sourceEvidence(row: FilingRow, held: FilingDetail | null): Evidence {
  const record = held && held.key === row.key ? held : null;
  const shown = record ?? row;
  const rows: EvidenceRow[] = [
    { label: 'Station or provider', value: `${shown.station} · ${shown.service}` },
    { label: 'Folder', value: shown.folder },
    { label: 'FCC file ID', value: shown.file_id },
    { label: 'Uploaded', value: shown.uploaded ? day(shown.uploaded) : 'Not given' },
  ];
  // A saved PDF's row waits for its verified save date.
  if (record) rows.push({ label: 'Filing PDF', value: pdfDetail(record.pdf, record.saved_on) });
  else if (row.pdf !== 'saved') rows.push({ label: 'Filing PDF', value: pdfDetail(row.pdf, null) });
  return { title: row.name, authority: 'FCC Public Inspection Files', rows, checked: null };
}

function sourceGap(row: FilingRow, detail: Read<FilingDetail>) {
  if (row.pdf !== 'saved' || detail.data?.key === row.key) return null;
  if (detail.loading) return <LoadingLine>Loading…</LoadingLine>;
  return <ReadState read={{ ...detail, loading: false }} noun="details" />;
}

function PdfCell({ row, here }: { row: FilingRow; here: string }) {
  if (row.pdf === 'saved')
    return (
      <Link
        className="mbf-link"
        to={withFrom(filingHref(row), here)}
        aria-label={`Open filing PDF for ${row.name}`}
      >
        Open
      </Link>
    );
  if (row.pdf === 'unavailable') return <span>Not available</span>;
  return <span className="mbf-missing">{PENDING_LABEL}</span>;
}

function Uploaded({ value }: { value: string | null }) {
  return value ? (
    <span className="f-nowrap">{day(value)}</span>
  ) : (
    <span className="mbf-missing">Not given</span>
  );
}

function FilingResults({
  rows,
  orders,
  phone,
  here,
  onSource,
}: {
  rows: FilingRow[];
  orders: boolean;
  phone: boolean;
  here: string;
  onSource: (row: FilingRow, button: HTMLElement) => void;
}) {
  const sourceButton = (row: FilingRow) => (
    <button
      type="button"
      className="mbf-source"
      onClick={(event) => onSource(row, event.currentTarget)}
    >
      View source
    </button>
  );
  if (phone)
    return (
      <ul className="mbf-cards">
        {rows.map((row) => (
          <li key={row.key}>
            <article className="mbf-card">
              <div className="mbf-card-head">
                <span className="mbf-card-title">{row.name}</span>
                <span className="mbf-sub">{row.folder}</span>
              </div>
              <dl>
                <dt>Station or provider</dt>
                <dd>
                  {row.station}
                  <span className="mbf-sub">{row.service}</span>
                </dd>
                <dt>Uploaded</dt>
                <dd>
                  <Uploaded value={row.uploaded} />
                </dd>
                <dt>FCC file ID</dt>
                <dd>{row.file_id}</dd>
                {orders && (
                  <>
                    <dt>Order number</dt>
                    <dd className="mbf-missing">Not checked</dd>
                  </>
                )}
                <dt>Filing PDF</dt>
                <dd>
                  <PdfCell row={row} here={here} />
                </dd>
              </dl>
              {sourceButton(row)}
            </article>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="mbf-table-box">
      <table className="mbf-table">
        <thead>
          <tr>
            <th scope="col">Filing</th>
            <th scope="col">Station or provider</th>
            <th scope="col">Uploaded</th>
            <th scope="col">FCC file ID</th>
            {orders && <th scope="col">Order number</th>}
            <th scope="col">Filing PDF</th>
            <th scope="col" className="mbf-source-head">
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="mbf-name">
                {row.name}
                <span className="mbf-sub">{row.folder}</span>
              </td>
              <td>
                {row.station}
                <span className="mbf-sub">{row.service}</span>
              </td>
              <td>
                <Uploaded value={row.uploaded} />
              </td>
              <td className="f-nowrap">{row.file_id}</td>
              {orders && <td className="mbf-missing f-nowrap">Not checked</td>}
              <td className="f-nowrap">
                <PdfCell row={row} here={here} />
              </td>
              <td className="mbf-source-cell">{sourceButton(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function filingsLabel(value: number) {
  return `${count(value)} ${value === 1 ? 'filing' : 'filings'}`;
}

function AdvertiserResults({
  rows,
  year,
  phone,
  here,
}: {
  rows: FilingFolder[];
  year: number;
  phone: boolean;
  here: string;
}) {
  const filingsLink = (row: FilingFolder) => (
    <>
      <Link
        className="mbf-link"
        to={withFrom(hrefFor('media-buys', {}, { year: String(year), q: row.label }), here)}
      >
        {filingsLabel(row.filings)}
      </Link>
      <span className="mbf-sub">{row.station}</span>
    </>
  );
  const basis = 'Folder name as printed · Not checked';
  if (phone)
    return (
      <ul className="mbf-cards">
        {rows.map((row) => (
          <li key={row.key}>
            <article className="mbf-card">
              <div className="mbf-card-head">
                <span className="mbf-card-title">{row.label}</span>
              </div>
              <dl>
                <dt>Basis</dt>
                <dd className="mbf-missing">{basis}</dd>
                <dt>Filings</dt>
                <dd>{filingsLink(row)}</dd>
              </dl>
            </article>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="mbf-table-box">
      <table className="mbf-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Basis</th>
            <th scope="col">Filings</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="mbf-name">{row.label}</td>
              <td className="mbf-missing">{basis}</td>
              <td>{filingsLink(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OutletResults({
  rows,
  year,
  phone,
  here,
}: {
  rows: FilingOutlet[];
  year: number;
  phone: boolean;
  here: string;
}) {
  const name = (row: FilingOutlet) =>
    row.minnesota_station ? (
      <Link
        className="mbf-link"
        to={withFrom(hrefFor('station', { id: row.minnesota_station }), here)}
      >
        {row.name}
      </Link>
    ) : (
      row.name
    );
  const inYear = (row: FilingOutlet) =>
    row.filings > 0 ? (
      <span className="mbf-figure">{count(row.filings)}</span>
    ) : (
      <span className="mbf-missing">None held</span>
    );
  const withPdf = (row: FilingOutlet) =>
    row.filings > 0 ? <span className="mbf-figure">{count(row.with_pdf)}</span> : null;
  const yearsLabel = (row: FilingOutlet) => row.years.join(', ');
  if (phone)
    return (
      <ul className="mbf-cards">
        {rows.map((row) => (
          <li key={row.key}>
            <article className="mbf-card">
              <div className="mbf-card-head">
                <span className="mbf-card-title">{name(row)}</span>
                {row.place && <span className="mbf-sub">{row.place}</span>}
              </div>
              <dl>
                <dt>Service</dt>
                <dd>
                  <span className="mbf-tag">{row.service}</span>
                </dd>
                <dt>Call sign or ID</dt>
                <dd>{row.ident}</dd>
                {row.years.length > 0 && (
                  <>
                    <dt>Years</dt>
                    <dd>{yearsLabel(row)}</dd>
                  </>
                )}
                <dt>Filings in {year}</dt>
                <dd>{inYear(row)}</dd>
                {row.filings > 0 && (
                  <>
                    <dt>With filing PDF</dt>
                    <dd>{withPdf(row)}</dd>
                  </>
                )}
              </dl>
            </article>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="mbf-table-box">
      <table className="mbf-table">
        <thead>
          <tr>
            <th scope="col">Station or provider</th>
            <th scope="col">Service</th>
            <th scope="col">Call sign or ID</th>
            <th scope="col">Years</th>
            <th scope="col" className="mbf-num">
              Filings in {year}
            </th>
            <th scope="col" className="mbf-num">
              With filing PDF
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="mbf-name">
                {name(row)}
                {row.place && <span className="mbf-sub">{row.place}</span>}
              </td>
              <td>
                <span className="mbf-tag">{row.service}</span>
              </td>
              <td>{row.ident}</td>
              <td>{yearsLabel(row)}</td>
              <td className="mbf-num">{inYear(row)}</td>
              <td className="mbf-num">{withPdf(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
