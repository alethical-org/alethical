import type { CSSProperties } from 'react';
import { useRead } from '../api/read';
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
    '--cols': 'minmax(0, 1fr) 150px',
    '--cols-tablet': 'minmax(0, 1fr) 130px',
  } as CSSProperties;
  return (
    <div role="table" aria-label="Files held" className="mb-table">
      <div role="row" className="mb-table-row mb-table-head" style={cols}>
        <span role="columnheader">FILE</span>
        <span role="columnheader">STATION UPLOAD</span>
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
      fallback={{ to: hrefFor('media-buys', {}, { tab: 'stations' }), name: 'Media buys' }}
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
                                { station: data.call_sign, year: String(year.year) },
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
                      {year.file_count > 0 && (
                        <dl
                          className="mb-metrics"
                          style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}
                        >
                          <div>
                            <dt>TV station files held</dt>
                            <dd>{year.file_count.toLocaleString('en-US')}</dd>
                          </div>
                        </dl>
                      )}
                    </section>
                  );
                })}
                {data.years.length === 0 && <div className="f-empty-box">None held</div>}
              </div>
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

/** Files under 1 exact printed agency spelling, and addresses checked for it. */
export function PrintedAgency({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const read = useRead<Agency>(mediaPath(['agencies', match.params.name]));
  const data = read.data;
  const files = data ? data.groups.flatMap((group) => group.files) : [];
  const stations = [...new Set(files.map((file) => file.station))];
  const payments = isBuilt('payments-under-name') && data;
  const cols = {
    '--cols': 'minmax(0, 1.5fr) minmax(0, 1.5fr) 190px 120px',
    '--cols-tablet': 'minmax(0, 1.4fr) minmax(0, 1.2fr) 150px 100px',
  } as CSSProperties;
  return (
    <MediaPage
      fallback={{ to: hrefFor('media-buys', {}, { tab: 'agencies' }), name: 'Media buys' }}
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
            <p className="mb-lead">
              A name printed in a TV station file is kept as its exact spelling; a matching name
              alone does not establish identity
            </p>
          </header>
          <div className="mb-two">
            <div className="mb-stack">
              <section aria-labelledby="files-heading">
                <div className="mb-section-head">
                  <h2 id="files-heading">Files under this exact spelling</h2>
                  <span className="mb-section-count">
                    {plural(files.length, 'file', 'files')}
                    {stations.length > 0 && ` · ${stations.join(', ')}`}
                  </span>
                </div>
                <div className="mb-section-body">
                  <div
                    role="table"
                    aria-label="Files under this exact spelling"
                    className="mb-table"
                  >
                    <div role="row" className="mb-table-row mb-table-head" style={cols}>
                      <span role="columnheader">FILE</span>
                      <span role="columnheader">STATION · FOLDER</span>
                      <span role="columnheader">NAME SOURCE</span>
                      <span role="columnheader">STATION UPLOAD</span>
                    </div>
                    {files.map((file) => (
                      <div role="row" key={file.key} className="mb-table-row" style={cols}>
                        <span role="cell" className="mb-cell-name">
                          <Link to={withFrom(fileHref(file.key, file.version_id), here)}>
                            {file.label || file.name}
                          </Link>
                        </span>
                        <span role="cell" className="mb-cell">
                          {[file.station, file.year, file.category, lastSegment(file.folder_label)]
                            .filter((part) => part !== null && part !== '' && part !== undefined)
                            .join(' · ')}
                        </span>
                        <span role="cell" className="mb-cell">
                          {file.agency_unchecked ? <NotCheckedIcon /> : <CheckedIcon />}
                          {file.agency_unchecked ? 'Machine-read · Not checked' : 'Checked'}
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
                  <p className="mb-note">
                    Agency names come from checked facts or machine-read text. Machine-read names
                    are marked Not checked and may contain reading errors. Each spelling is kept
                    separate.
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
                            <span className="mb-address-cite">
                              <strong>Page {evidence.page}</strong> · {evidence.file_name}
                            </span>
                            <div className="mb-address-foot">
                              <span className="mb-checked">
                                <CheckedIcon />
                                Checked on {day(evidence.checked_at)}
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
            {payments && (
              <aside className="mb-aside">
                <section className="mb-card">
                  <h2>Payment records</h2>
                  <p className="mb-card-line">
                    Separate searches of the campaign and outside-spending payment files for this
                    exact printed spelling
                  </p>
                  <ul className="mb-link-list">
                    <li>
                      <Link
                        className="mb-link-row"
                        to={withFrom(hrefFor('payments-under-name', { query: data.name }), here)}
                      >
                        <span className="mb-link-name">
                          Campaign payments with this exact printed name
                        </span>
                        <Arrow />
                      </Link>
                    </li>
                    <li>
                      <Link
                        className="mb-link-row"
                        to={`${withFrom(hrefFor('payments-under-name', { query: data.name }), here)}#outside-payments`}
                      >
                        <span className="mb-link-name">
                          Outside spending payments with this exact printed name
                        </span>
                        <Arrow />
                      </Link>
                    </li>
                  </ul>
                  <p className="mb-note">
                    A payment under this name does not prove the file was paid
                  </p>
                </section>
              </aside>
            )}
          </div>
        </>
      )}
    </MediaPage>
  );
}
