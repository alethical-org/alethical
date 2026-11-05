import { useFinanceSession } from '../auth/session';
import { useVersionedRead } from '../api/versionedRead';
import { useEffect, useState, type FormEvent } from 'react';
import { useRead } from '../api/read';
import { Link, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt } from '../routes';
import { useAddressState } from '../ui/addressState';
import { ClearAll, Dropdown, Empty } from '../ui/controls';
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
  stations: 'Browse records from each station',
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
    'Agency names come from checked facts or machine-read text. Machine-read names are marked Not checked and may contain reading errors. Each spelling is kept separate.',
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
  });
  const tab: Tab = TABS.some((t) => t.value === state.tab) ? (state.tab as Tab) : 'folders';
  const page = Math.min(42, Math.max(1, Math.trunc(Number(state.page)) || 1));
  const [typed, setTyped] = useState(state.q);
  useEffect(() => setTyped(state.q), [state.q]);
  const folders = tab === 'folders';
  const read = useVersionedRead<Browse>(
    mediaPath(['browse'], {
      tab,
      search_scope: 'tab',
      q: state.q,
      page,
      station: folders ? state.station : '',
      year: folders ? state.year : '',
      category: folders ? state.category : '',
    }),
    { page, onRestart: () => setState({ page: '1' }) },
  );
  const sources = useRead<Sources>(mediaPath(['sources']));
  const data = read.data;
  function submit(event: FormEvent) {
    event.preventDefault();
    setState({ q: typed.trim(), page: '1' });
  }
  const shownTab = (TABS.find((t) => t.value === data?.tab)?.value ?? tab) as Tab;
  const searching = !!data?.q;
  const filesShown = data?.rows.some(isFile) ?? false;
  const noun = NOUNS[filesShown ? 'files' : shownTab];
  const rows = (data?.rows ?? []).map((row) => browseRow(shownTab, row));
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
        <section className="mb-browse" aria-label="Browse TV station files">
          <ScrollingTabs
            label="Browse"
            value={tab}
            tabs={TABS.map((item) => ({
              ...item,
              count: data?.tab_counts?.[item.value]?.toLocaleString('en-US'),
            }))}
            onChange={(value) =>
              setState({ tab: value, page: '1', station: '', year: '', category: '' })
            }
          />
          {INTRO[tab] && <p className="mb-tab-intro">{INTRO[tab]}</p>}
          {folders && (
            <div className="mb-filters">
              <Dropdown
                name="Station"
                value={state.station}
                options={[
                  { value: '', label: 'All stations' },
                  ...(sources.data?.stations ?? []).map((s) => ({
                    value: s.call_sign,
                    label: s.call_sign,
                  })),
                ]}
                onChange={(station) => setState({ station, page: '1' })}
              />
              <Dropdown
                name="Year"
                value={state.year}
                options={[
                  { value: '', label: 'All years' },
                  ...(data?.years ?? []).map((y) => ({ value: String(y), label: String(y) })),
                ]}
                onChange={(year) => setState({ year, page: '1' })}
              />
              <Dropdown
                name="Category"
                value={state.category}
                options={[
                  { value: '', label: 'All categories' },
                  ...(data?.categories ?? []).map((c) => ({ value: c, label: c })),
                ]}
                onChange={(category) => setState({ category, page: '1' })}
              />
              {(state.station || state.year || state.category) && (
                <ClearAll
                  onClick={() => setState({ station: '', year: '', category: '', page: '1' })}
                />
              )}
            </div>
          )}
          <div className="mb-results">
            <ReadState read={read} />
            {data && (
              <>
                <p aria-live="polite" className="f-count-line mb-count">
                  {data.capped ? 'At least ' : ''}
                  {data.total.toLocaleString('en-US')} {data.total === 1 ? noun[0] : noun[1]}
                  {searching ? ` matching “${data.q}”` : ''}
                </p>
                {rows.length === 0 ? (
                  <Empty title={`No ${noun[1]} match this search`} />
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
                    <Pager
                      page={data.page}
                      pages={Math.ceil(data.total / data.page_size)}
                      busy={read.pending}
                      onChange={(next) => setState({ page: String(next) })}
                    />
                    {!searching && <p className="mb-end-note">{NOTES[shownTab]}</p>}
                  </>
                )}
              </>
            )}
          </div>
        </section>
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
