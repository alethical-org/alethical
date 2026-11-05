import type { CSSProperties } from 'react';
import { centralDateLabel } from '@alethical/shared/moneyLanding';
import { apiPath, useRead } from '../api/read';
import { Link, useLocation } from '../router';
import { withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { Refused } from '../ui/controls';
import { Arrow, SourcesAndUpdates, WithArrow } from '../ui/parts';
import {
  LoadingBox,
  MediaPage,
  NotHeld,
  connectionLabel,
  connectionPath,
  day,
  fileHref,
  lastSegment,
  mediaPath,
  plural,
} from './media/shared';
import type { Agency, FileRow, Folder, Sources, Station } from './media/types';
import { AgencySimilarNames } from './media/AgencySimilarNames';

/** Saved/check instants use Minnesota's calendar day; a plain source date stays as filed. */
function checkedDay(value?: string | null): string {
  if (!value || Number.isNaN(new Date(value).getTime())) return 'Unavailable';
  return value.includes('T') ? centralDateLabel(value) : day(value);
}

const MEDIA_BUYS = { to: hrefFor('media-buys'), name: 'Media buys' };

function CheckedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#0E6A82" strokeWidth="2" />
      <path
        d="M8 12.5 L10.8 15.2 L16 9.5"
        stroke="#0E6A82"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
/** The station-wide counts, in the drawn order (TV Station drawing). */
export function stationCounts(station: Station): [string, number][] {
  return [
    ['TV station files held', station.counts.station_files_held],
    ['Unique file contents', station.counts.unique_file_contents],
    ['Files whose text could not be fully read', station.counts.text_read_failures],
    ['Files we couldn’t download', station.counts.download_failures],
    ['Folders we couldn’t list', station.folder_failures],
  ];
}

/** Missing new fields stay unknown; an old response can still show its held-file count. */
function yearCountRows(year: Station['years'][number]): [string, number][] {
  const counts = year.counts ?? {};
  const rows: [string, number | undefined][] = [
    ['TV station files held', counts.station_files_held ?? year.file_count],
    ['Unique file contents', counts.unique_file_contents],
    ['Files whose text could not be fully read', counts.text_read_failures],
    ['Files we couldn’t download', counts.download_failures],
    ['Folders we couldn’t list', counts.folder_failures],
  ];
  return rows.filter((row): row is [string, number] => row[1] != null);
}

/** The 3 drawn notes on what the counts mean (TV Station drawing). */
export const STATION_NOTES = [
  'Unique file contents counts distinct saved contents; a file re-uploaded unchanged adds a version, not new contents',
  'Files we couldn’t download and folders we couldn’t list are collection gaps on our side, not statements about the station',
  'Files whose text could not be fully read still have page images; their machine-read text is partial and Not checked',
];

export function NotCheckedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#5F6B76" strokeWidth="2" strokeDasharray="3 3" />
    </svg>
  );
}

function stationLink(callSign: string, here: string) {
  return withFrom(hrefFor('station', { id: callSign }), here);
}

/** A TV station folder: the files held in it and its one checked connection. */
export function StationFolder({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const read = useRead<Folder>(mediaPath(['folders', match.params.id]));
  const sources = useRead<Sources>(mediaPath(['sources']));
  const data = read.data;
  const source = sources.data?.stations.find((s) => s.call_sign === data?.station);
  const connection = data?.relationship?.status === 'checked' ? data.relationship : null;
  const to = connection ? connectionPath(connection) : null;
  const listed = source?.last_list_check ? day(source.last_list_check) : null;
  return (
    <MediaPage
      fallback={MEDIA_BUYS}
      footer={
        data &&
        source && (
          <SourcesAndUpdates>
            <p className="f-sources-line f-num">
              TV station files copied {day(source.last_file_copy)}. Folder listing read from the FCC
              public inspection file on {day(source.last_list_check)}
            </p>
          </SourcesAndUpdates>
        )
      }
    >
      {read.notFound && (
        <NotHeld title="This folder is no longer available">
          No TV station folder with this reference is in the current copy. Open Media buys for the
          folders held.
        </NotHeld>
      )}
      {read.loading && <LoadingBox />}
      {read.failed && !data && (
        <div className="mb-section-body">
          <Refused onRetry={read.retry} retrying={read.pending}>
            We couldn’t load this folder. This is a problem on our side.
          </Refused>
        </div>
      )}
      {data && (
        <>
          <header className="mb-head">
            <span className="mb-badge">TV STATION FOLDER</span>
            <h1 tabIndex={-1} className="mb-title">
              {data.label}
            </h1>
            <dl className="mb-meta">
              <div>
                <dt>Station</dt>
                <dd>
                  <Link to={stationLink(data.station, here)}>{data.station}</Link>
                </dd>
              </div>
              <div>
                <dt>Folder year</dt>
                <dd className="mb-strong">{data.year ?? 'Unavailable'}</dd>
              </div>
              <div>
                <dt>Station category</dt>
                <dd>{data.category || 'Unavailable'}</dd>
              </div>
              {listed && (
                <div>
                  <dt>Folder listed</dt>
                  <dd className="mb-strong">{listed}</dd>
                </div>
              )}
            </dl>
          </header>
          <div className="mb-two">
            <section aria-labelledby="files-heading">
              <div className="mb-section-head">
                <h2 id="files-heading">Files held</h2>
                <span className="mb-section-count">
                  {plural(data.files.length, 'file', 'files')} held
                </span>
              </div>
              <div className="mb-section-body">
                {data.files.length === 0 ? (
                  <div className="f-empty-box">No files to show in this folder</div>
                ) : (
                  <>
                    <FolderFiles files={data.files} here={here} />
                    <p className="mb-note">
                      The station’s upload date, the date Alethical first saved particular contents,
                      the invoice date, and scheduled airing dates describe different events. An
                      unavailable upload date stays unavailable.
                    </p>
                  </>
                )}
              </div>
            </section>
            <aside className="mb-aside">
              <section className="mb-card">
                <h2>Related records</h2>
                {connection ? (
                  <>
                    {to ? (
                      <Link className="mb-link-row" to={withFrom(to, here)}>
                        <span>
                          <span className="mb-link-name">{connection.label}</span>
                          <span className="mb-link-note">
                            {connection.kind === 'committee'
                              ? `Folder checked as relating to this committee · Checked on ${day(connection.checked_at)}`
                              : `Checked on ${day(connection.checked_at)}`}
                          </span>
                        </span>
                        <Arrow />
                      </Link>
                    ) : (
                      <div className="mb-plain-row">
                        <span>
                          <span className="mb-link-name">{connection.label}</span>
                          <span className="mb-link-note">
                            {connection.kind === 'committee'
                              ? `Folder checked as relating to this committee · Checked on ${day(connection.checked_at)}`
                              : `${connectionLabel(connection.kind)} · Checked on ${day(connection.checked_at)}`}
                          </span>
                        </span>
                      </div>
                    )}
                    <p className="mb-card-line mb-card-note">
                      A folder connection does not establish the same link for each file. Each
                      file’s own connections carry their version, quote, page, role and check date.
                    </p>
                  </>
                ) : (
                  <p className="mb-card-empty">No checked connection for this folder</p>
                )}
              </section>
            </aside>
          </div>
        </>
      )}
    </MediaPage>
  );
}

function FolderFiles({ files, here }: { files: FileRow[]; here: string }) {
  const cols = {
    '--cols': 'minmax(0, 1fr) 150px 150px',
    '--cols-tablet': 'minmax(0, 1fr) 130px 130px',
  } as CSSProperties;
  return (
    <div role="table" aria-label="Files held" className="mb-table">
      <div role="row" className="mb-table-row mb-table-head" style={cols}>
        <span role="columnheader">FILE</span>
        <span role="columnheader">STATION UPLOAD</span>
        <span role="columnheader">FIRST SAVED</span>
      </div>
      {files.map((file) => (
        <div role="row" key={file.key} className="mb-table-row" style={cols}>
          <span role="cell" className="mb-cell-name">
            <Link to={withFrom(fileHref(file.key, file.version_id), here)}>
              {file.label || file.name}
            </Link>
            <span className="mb-cell-sub">
              {plural(file.version_count, 'saved version', 'saved versions')}
            </span>
          </span>
          <span
            role="cell"
            className="mb-cell mb-cell-strong"
            data-missing={!file.uploaded_at || undefined}
          >
            <span className="mb-cell-label mb-phone-only">Station upload</span>
            {file.uploaded_at ? day(file.uploaded_at) : 'Unavailable'}
          </span>
          <span
            role="cell"
            className="mb-cell mb-cell-strong"
            data-missing={!file.first_saved_at || undefined}
          >
            <span className="mb-cell-label mb-phone-only">First saved</span>
            {checkedDay(file.first_saved_at)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A TV station: what is held from its FCC public inspection file, by year. */
export function TVStation({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const read = useRead<Station>(mediaPath(['stations', match.params.id]));
  const sources = useRead<Sources>(mediaPath(['sources']));
  const data = read.data;
  const others = (sources.data?.stations ?? []).filter((s) => s.call_sign !== data?.call_sign);
  return (
    <MediaPage
      fallback={{
        to: hrefFor('media-buys', {}, { tab: 'stations' }),
        name: 'Media buys',
      }}
      footer={
        data && (
          <SourcesAndUpdates>
            <dl className="mb-src-dl">
              <div>
                <dt>FCC folder listing read</dt>
                <dd className="f-num">{day(data.last_list_check)}</dd>
              </div>
              <div>
                <dt>TV station files copied</dt>
                <dd className="f-num">{day(data.last_file_copy)}</dd>
              </div>
              <div>
                <dt>Latest station upload held</dt>
                <dd className="f-num">{day(data.newest_upload)}</dd>
              </div>
              <div>
                <dt>Latest review check</dt>
                <dd className="f-num">{checkedDay(data.latest_check_at)}</dd>
              </div>
            </dl>
          </SourcesAndUpdates>
        )
      }
    >
      {read.notFound && (
        <NotHeld title="This station is no longer available">
          No station with this reference is in the current copy. Open Media buys › Stations for the
          stations held.
        </NotHeld>
      )}
      {read.loading && <LoadingBox />}
      {read.failed && !data && (
        <div className="mb-section-body">
          <Refused onRetry={read.retry} retrying={read.pending}>
            We couldn’t load this station’s counts. This is a problem on our side.
          </Refused>
        </div>
      )}
      {data && (
        <>
          <header className="mb-head">
            <span className="mb-badge">STATION</span>
            <h1 tabIndex={-1} className="mb-title mb-title-station">
              {data.call_sign}
            </h1>
            <p className="mb-lead">
              Held records from this station’s FCC public inspection file. Counts are files,
              contents and folders, not ads or spend.
            </p>
          </header>
          <div className="mb-two">
            <section aria-labelledby="held-heading">
              <div className="mb-section-head">
                <h2 id="held-heading">Records held, by year</h2>
              </div>
              <div className="mb-years">
                {/* All-years unique contents are served directly; never sum the
                    per-year counts because a copy can occur in several years. */}
                <section aria-label="All years" className="mb-year">
                  <div className="mb-year-head">
                    <span>All years</span>
                  </div>
                  <dl className="mb-metrics">
                    {stationCounts(data).map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value.toLocaleString('en-US')}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                {data.years.map((year) => {
                  const label = year.year != null ? String(year.year) : 'Year unavailable';
                  return (
                    <section key={label} aria-label={label} className="mb-year">
                      <div className="mb-year-head">
                        <span>{label}</span>
                        {year.file_count > 0 && year.year != null ? (
                          <Link
                            className="f-dest mb-year-link"
                            to={withFrom(
                              hrefFor(
                                'media-buys',
                                {},
                                {
                                  station: data.call_sign,
                                  year: String(year.year),
                                },
                              ),
                              here,
                            )}
                          >
                            <span>
                              <WithArrow>Station folders</WithArrow>
                            </span>
                          </Link>
                        ) : year.file_count === 0 ? (
                          <span className="mb-section-count">None held</span>
                        ) : null}
                      </div>
                      <dl className="mb-metrics">
                        {yearCountRows(year).map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd data-zero={value === 0 || undefined}>
                              {value.toLocaleString('en-US')}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  );
                })}
                {data.years.length === 0 && <div className="f-empty-box">None held</div>}
              </div>
              <ul className="mb-note mb-note-list">
                {STATION_NOTES.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>
            {others.length > 0 && (
              <aside className="mb-aside">
                <section className="mb-card">
                  <h2>Other stations held</h2>
                  <ul className="mb-link-list">
                    {others.map((other) => (
                      <li key={other.call_sign}>
                        <Link className="mb-link-row" to={stationLink(other.call_sign, here)}>
                          <span className="mb-link-name">{other.call_sign}</span>
                          <Arrow />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              </aside>
            )}
          </div>
        </>
      )}
    </MediaPage>
  );
}

/** Each file/version is shown once, keeping every spelling on that version. */
export function agencySpellingGroups(agencies: Agency[]) {
  const seen = new Map<string, { name: string; row: FileRow & { alsoPrintedAs: string[] } }>();
  return agencies.map((agency) => ({
    key: agency.key,
    name: agency.name,
    files: agency.groups
      .flatMap((group) => group.files)
      .flatMap((file) => {
        const identity = `${file.key}|${file.version_id}`;
        const prior = seen.get(identity);
        if (prior) {
          if (prior.name !== agency.name && !prior.row.alsoPrintedAs.includes(agency.name)) {
            prior.row.alsoPrintedAs.push(agency.name);
          }
          return [];
        }
        const row = { ...file, alsoPrintedAs: [] as string[] };
        seen.set(identity, { name: agency.name, row });
        return [row];
      }),
  }));
}

/** Files grouped by original spelling, with exact-spelling address evidence. */
export function PrintedAgency({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const read = useRead<Agency>(mediaPath(['agencies', match.params.name]));
  const data = read.data;
  const variants = useRead<{
    key: string;
    version: string;
    spellings: Agency[];
  }>(
    data?.key === match.params.name && data.version
      ? apiPath(['finance', 'media-buys', 'agencies', data.key, 'spellings'], {
          version: data.version,
        })
      : null,
  );
  const included =
    data && variants.data?.key === data.key && variants.data.version === data.version
      ? variants.data.spellings
      : [];
  const spellingGroups = agencySpellingGroups(data ? [data, ...included] : []);
  const payments = isBuilt('payments-under-name') && data;
  const cols = {
    '--cols': 'minmax(0, 1.5fr) minmax(0, 1.5fr) 190px 120px',
    '--cols-tablet': 'minmax(0, 1.4fr) minmax(0, 1.2fr) 150px 100px',
  } as CSSProperties;
  return (
    <MediaPage
      fallback={{
        to: hrefFor('media-buys', {}, { tab: 'agencies' }),
        name: 'Media buys',
      }}
    >
      {read.notFound && (
        <NotHeld title="This name is no longer available">
          No printed agency name with this exact spelling is in the current copy. Open Media buys ›
          Agency names for the spellings held.
        </NotHeld>
      )}
      {read.loading && <LoadingBox />}
      {read.failed && !data && (
        <div className="mb-section-body">
          <Refused onRetry={read.retry} retrying={read.pending}>
            We couldn’t load these files. This is a problem on our side.
          </Refused>
        </div>
      )}
      {data && (
        <>
          <header className="mb-head">
            <span className="mb-badge">PRINTED AGENCY NAME</span>
            <h1 tabIndex={-1} className="mb-title mb-title-agency">
              {data.name}
            </h1>
          </header>
          <div className="mb-two">
            <div className="mb-stack">
              <section aria-labelledby="files-heading">
                <div className="mb-section-head">
                  <h2 id="files-heading">Files by reported name</h2>
                </div>
                <div className="mb-section-body">
                  {included.length > 0 && <p>Similar spellings may refer to the same agency</p>}
                  <div role="table" aria-label="Files by reported name" className="mb-table">
                    <div role="row" className="mb-table-row mb-table-head" style={cols}>
                      <span role="columnheader">FILE</span>
                      <span role="columnheader">STATION · FOLDER</span>
                      <span role="columnheader">NAME SOURCE</span>
                      <span role="columnheader">STATION UPLOAD</span>
                    </div>
                    {spellingGroups.map((group) => (
                      <div role="rowgroup" key={group.key} aria-label={group.name}>
                        <div role="row">
                          <div role="cell" aria-colspan={4} className="mb-spelling-head">
                            <h3>{group.name}</h3>
                            <span className="mb-section-count">
                              {plural(group.files.length, 'file', 'files')}
                              {group.files.length > 0 &&
                                ` · ${[...new Set(group.files.map((file) => file.station))].join(', ')}`}
                            </span>
                          </div>
                        </div>
                        {group.files.map((file) => (
                          <div
                            role="row"
                            key={`${file.key}|${file.version_id}`}
                            className="mb-table-row"
                            style={cols}
                          >
                            <span role="cell" className="mb-cell-name">
                              <Link to={withFrom(fileHref(file.key, file.version_id), here)}>
                                {file.label || file.name}
                              </Link>
                              {file.alsoPrintedAs.length > 0 && (
                                <span className="mb-cell mb-also-printed">
                                  Also printed as: {file.alsoPrintedAs.join(', ')}
                                </span>
                              )}
                            </span>
                            <span role="cell" className="mb-cell">
                              {[
                                file.station,
                                file.year,
                                file.category,
                                lastSegment(file.folder_label),
                              ]
                                .filter(
                                  (part) => part !== null && part !== '' && part !== undefined,
                                )
                                .join(' · ')}
                            </span>
                            <span role="cell" className="mb-cell mb-cell-source">
                              {file.agency_unchecked ? <NotCheckedIcon /> : <CheckedIcon />}
                              <span>
                                {file.agency_unchecked
                                  ? 'Machine-read · Not checked'
                                  : checkedDay(file.agency_checked_at) !== 'Unavailable'
                                    ? `Checked on ${checkedDay(file.agency_checked_at)}`
                                    : 'Checked'}
                              </span>
                            </span>
                            <span
                              role="cell"
                              className="mb-cell mb-cell-strong"
                              data-missing={!file.uploaded_at || undefined}
                            >
                              {file.uploaded_at ? day(file.uploaded_at) : 'Upload date unavailable'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  {variants.loading && <p role="status">Loading files for similar spellings…</p>}
                  {variants.failed && (
                    <Refused onRetry={variants.retry} retrying={variants.pending}>
                      We couldn’t load files for similar spellings
                    </Refused>
                  )}
                  <p className="mb-note">
                    Agency names come from checked facts or machine-read text. Machine-read names
                    are marked Not checked and may contain reading errors.
                  </p>
                </div>
              </section>
              <section aria-labelledby="address-heading">
                <div className="mb-section-head">
                  <h2 id="address-heading">Checked address evidence</h2>
                </div>
                {data.addresses.length === 0 ? (
                  <div className="mb-dashed mb-dashed-wide">
                    No address has been checked for this spelling
                  </div>
                ) : (
                  <>
                    {data.addresses.map((address) => (
                      <div key={address.address} className="mb-address">
                        <div className="mb-address-text">{address.address}</div>
                        {address.evidence.map((evidence) => (
                          <div
                            key={`${evidence.file_key}|${evidence.version_id}|${evidence.page}`}
                            className="mb-address-source"
                          >
                            <figure className="mb-address-quote">
                              <figcaption className="mb-address-cite">
                                {evidence.quote && (
                                  <>
                                    <span className="f-label">QUOTE</span> ·{' '}
                                  </>
                                )}
                                <strong>Page {evidence.page}</strong> · {evidence.file_name}
                              </figcaption>
                              {evidence.quote && <blockquote>{evidence.quote}</blockquote>}
                            </figure>
                            <div className="mb-address-foot">
                              <span className="mb-checked">
                                <CheckedIcon />
                                Checked on {checkedDay(evidence.checked_at)}
                              </span>
                              <Link
                                className="f-dest mb-inline-dest"
                                to={withFrom(
                                  fileHref(evidence.file_key, evidence.version_id, evidence.page),
                                  here,
                                )}
                              >
                                <span>
                                  <WithArrow>View evidence</WithArrow>
                                </span>
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    <p className="mb-note">
                      An address checked on one file belongs to that file’s version. Same address,
                      employer text or equal amounts do not prove identity.
                    </p>
                  </>
                )}
              </section>
            </div>
            <aside className="mb-aside">
              {payments && (
                <section className="mb-card">
                  <h2>Payment records</h2>
                  <p className="mb-card-line">
                    Search campaign and outside-spending payment files under this name and similar
                    spellings
                  </p>
                  <ul className="mb-link-list">
                    <li>
                      <Link
                        className="mb-link-row"
                        to={withFrom(
                          hrefFor(
                            'payments-under-name',
                            { query: data.name },
                            { role: 'payee', dataset: 'expenditures' },
                          ),
                          here,
                        )}
                      >
                        <span className="mb-link-name">Campaign payments under this name</span>
                        <Arrow />
                      </Link>
                    </li>
                    <li>
                      <Link
                        className="mb-link-row"
                        to={`${withFrom(hrefFor('payments-under-name', { query: data.name }, { role: 'payee', dataset: 'independent' }), here)}#outside-payments`}
                      >
                        <span className="mb-link-name">
                          Outside spending payments under this name
                        </span>
                        <Arrow />
                      </Link>
                    </li>
                  </ul>
                  <p className="mb-note">
                    A payment under this name does not prove the file was paid
                  </p>
                </section>
              )}
              <AgencySimilarNames
                agencyKey={data.key}
                here={here}
                sourceVersion={data.version}
                onRefreshSource={read.retry}
                excludedKeys={spellingGroups.map((group) => group.key)}
              />
            </aside>
          </div>
        </>
      )}
    </MediaPage>
  );
}
