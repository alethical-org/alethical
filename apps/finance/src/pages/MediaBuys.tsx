import { useEffect, useState, type FormEvent } from 'react';
import { useRead } from '../api/read';
import { Link, useLocation } from '../router';
import { withFrom } from '../returnContext';
import { hrefFor, isBuilt } from '../routes';
import { useAddressState } from '../ui/addressState';
import { ClearAll, Dropdown, Empty, Tabs } from '../ui/controls';
import { Arrow } from '../ui/parts';
import { Frame, Pager, ReadState, mediaPath } from './media/shared';
import type { Browse, Group, Sources } from './media/types';

const TABS = [
  { value: 'folders', label: 'Station folders' },
  { value: 'agencies', label: 'Agency names' },
  { value: 'stations', label: 'Stations' },
  { value: 'years', label: 'Years' },
];
const INTRO: Record<string, string> = {
  folders: 'Browse station folders by year',
  agencies: 'Names as printed, with each spelling listed separately',
  stations: 'Browse records from each station',
  years: 'Folders held, by the year the station filed them',
};
export function browseLink(tab: string, row: Group) {
  if (tab === 'agencies') return hrefFor('printed-agency-name', { name: row.key });
  if (tab === 'stations') return hrefFor('station', { id: row.key });
  if (tab === 'years')
    return hrefFor('media-buys', {}, { tab: 'folders', year: String(row.year ?? row.key) });
  return hrefFor('station-folder', { id: row.key });
}
export function MediaBuys() {
  const location = useLocation();
  const here = location.pathname + location.search;
  const [state, setState] = useAddressState({
    q: '',
    tab: 'folders',
    station: '',
    year: '',
    category: '',
    page: '1',
  });
  const tab = TABS.some((t) => t.value === state.tab) ? state.tab : 'folders';
  const page = Math.min(42, Math.max(1, Number(state.page) || 1));
  const [typed, setTyped] = useState(state.q);
  useEffect(() => setTyped(state.q), [state.q]);
  const read = useRead<Browse>(
    mediaPath(['browse'], {
      tab,
      q: state.q,
      page,
      station: tab === 'folders' ? state.station : '',
      year: tab === 'folders' ? state.year : '',
      category: tab === 'folders' ? state.category : '',
    }),
    { keepPrevious: true },
  );
  const sources = useRead<Sources>(mediaPath(['sources']));
  const data = read.data;
  function submit(e: FormEvent) {
    e.preventDefault();
    setState({ q: typed.trim(), page: '1' });
  }
  const shownTab = data?.tab ?? tab;
  const nouns: Record<string, string> = {
    folders: 'station folders',
    agencies: 'agency names',
    stations: 'stations',
    years: 'years',
  };
  return (
    <Frame title="Media buys" sources={sources.data}>
      <p className="mb-lead">
        TV station files from KSTP-TV, KARE and KMSP-TV, not the whole media market. Radio, cable,
        streaming, print and online ads are not held. A document’s title alone does not establish
        that an ad aired or a bill was paid.
      </p>
      <form role="search" className="mb-search" onSubmit={submit}>
        <label className="f-visually-hidden" htmlFor="media-query">
          Search media buys
        </label>
        <input
          id="media-query"
          type="search"
          className="f-field"
          value={typed}
          maxLength={200}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Search media buys"
        />
        <button className="f-btn">Search</button>
      </form>
      <div className="mb-layout">
        <section aria-label="Browse station files">
          <Tabs
            label="Browse"
            value={tab}
            tabs={TABS}
            onChange={(value) =>
              setState({ tab: value, page: '1', station: '', year: '', category: '' })
            }
          />
          <p className="mb-lead">{INTRO[tab]}</p>
          {tab === 'folders' && (
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
          <ReadState read={read} />
          {data && (
            <>
              <p aria-live="polite" className="mb-note f-num">
                {data.capped ? 'At least ' : ''}
                {data.total.toLocaleString('en-US')}{' '}
                {data.total === 1 ? nouns[shownTab]?.replace(/s$/, '') : nouns[shownTab]}
              </p>
              {data.rows.length === 0 ? (
                <Empty title="No station files match this search" />
              ) : (
                <ul className="mb-list">
                  {data.rows.map((r) => (
                    <li key={r.key}>
                      <Link className="mb-row" to={withFrom(browseLink(shownTab, r), here)}>
                        <span>
                          <strong>{r.label}</strong>
                          <small>
                            {[r.station, r.year, r.category, r.stations?.join(', ')]
                              .filter(Boolean)
                              .join(' · ')}
                          </small>
                        </span>
                        <span>
                          {shownTab === 'agencies' && r.unchecked
                            ? 'Not checked'
                            : r.folder_count != null
                              ? `${r.folder_count} folders`
                              : ''}
                        </span>
                        <span>
                          {r.file_count.toLocaleString('en-US')}{' '}
                          {r.file_count === 1 ? 'file' : 'files'} <Arrow />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Pager
                page={data.page}
                pages={Math.ceil(data.total / data.page_size)}
                busy={read.pending}
                onChange={(next) => setState({ page: String(next) })}
              />
              <p className="mb-note">
                {shownTab === 'agencies'
                  ? 'Agency names come from checked facts or machine-read text. Machine-read names are marked Not checked and may contain reading errors. Each spelling is kept separate.'
                  : shownTab === 'folders'
                    ? 'A folder checked as relating to a committee does not establish the same link for each file inside it.'
                    : 'Counts are held files and folders, not ads or spend.'}
              </p>
            </>
          )}
        </section>
        <aside>
          {isBuilt('check-station-files') && (
            <Link className="mb-card mb-row" to={withFrom(hrefFor('check-station-files'), here)}>
              <span>
                <strong>Check station files</strong>
                <small>Check facts and connections against the page images</small>
              </span>
              <Arrow />
            </Link>
          )}
          <section className="mb-card">
            <h2 className="f-label">About these records</h2>
            <ul>
              <li>
                A station category describes where the station put a file. It does not establish the
                advertiser’s identity or the election the document concerns.
              </li>
              <li>
                A name on a file is the spelling the station printed, and a matching name alone does
                not establish identity
              </li>
              <li>
                Ordered, billed, credited, commission, net, gross and reported campaign expense are
                different. An invoice does not prove payment or airing.
              </li>
              <li>File and version counts are not ad counts or spend.</li>
            </ul>
            <p className="mb-note">Original files and review notes stay private</p>
          </section>
        </aside>
      </div>
    </Frame>
  );
}
