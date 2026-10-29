import { useRead } from '../api/read';
import { Link, useLocation } from '../router';
import { withFrom } from '../returnContext';
import { hrefFor, type RouteMatch } from '../routes';
import { Empty } from '../ui/controls';
import { SourcesAndUpdates } from '../ui/parts';
import { FileList, Frame, ReadState, connectionPath, day, mediaPath } from './media/shared';
import type { Agency, Folder, Sources, Station } from './media/types';

export function StationFolder({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const read = useRead<Folder>(mediaPath(['folders', match.params.id]));
  const sources = useRead<Sources>(mediaPath(['sources']));
  const data = read.data;
  const connection = data?.relationship;
  const to = connection ? connectionPath(connection) : null;
  return (
    <Frame title={data?.label ?? 'Station folder'} eyebrow="Station folder" sources={sources.data}>
      <ReadState read={read} noun="files" />
      {data && (
        <>
          <dl className="mb-meta">
            <div>
              <dt>Station</dt>
              <dd>{data.station}</dd>
            </div>
            <div>
              <dt>Folder year</dt>
              <dd>{data.year ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Station category</dt>
              <dd>{data.category || 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Files held</dt>
              <dd>{data.files.length}</dd>
            </div>
          </dl>
          <FileList files={data.files} here={here} />
          <p className="mb-note">
            The station’s upload date, the date Alethical first saved particular contents, the
            invoice date, and scheduled airing dates describe different events. An unavailable
            upload date stays unavailable.
          </p>
          <section className="mb-card mb-section">
            <h2>Related records</h2>
            {connection?.status === 'checked' ? (
              <>
                {to ? (
                  <Link to={withFrom(to, here)}>{connection.label}</Link>
                ) : (
                  <p>{connection.label}</p>
                )}
                <p>
                  {connection.role} · Checked on {day(connection.checked_at)}
                </p>
                <p className="mb-note">
                  A folder connection does not establish the same link for each file. Each file’s
                  own connections carry their version, quote, page, role and check date.
                </p>
              </>
            ) : (
              <p>No checked connection for this folder</p>
            )}
          </section>
        </>
      )}
    </Frame>
  );
}

export function TVStation({ match }: { match: RouteMatch }) {
  const read = useRead<Station>(mediaPath(['stations', match.params.id]));
  const data = read.data;
  return (
    <Frame title={data?.call_sign ?? 'TV station'} eyebrow="Station">
      <p className="mb-lead">
        Held records from this station’s FCC public inspection file. Counts are files, contents and
        folders, not ads or spend.
      </p>
      <ReadState read={read} noun="counts" />
      {data && (
        <>
          <section className="mb-card">
            <h2>Records held, by year</h2>
            {data.years.length ? (
              data.years.map((y) => (
                <div key={y.year ?? 'unknown'} className="mb-section">
                  <h3>{y.year ?? 'Year unavailable'}</h3>
                  <p className="f-num">{y.file_count.toLocaleString('en-US')} files</p>
                  <ul>
                    {y.categories.map((c) => (
                      <li key={c.name}>
                        {c.name}: {c.count.toLocaleString('en-US')}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <Empty title="None held" />
            )}
            <h3>All held years</h3>
            <dl className="mb-stat-grid">
              {[
                ['Station files held', data.counts.station_files_held],
                ['Unique file contents', data.counts.unique_file_contents],
                ['Station folders', data.folder_count],
                ['Files we couldn’t download', data.counts.download_failures],
                ['Folders we couldn’t list', data.folder_failures],
                ['Files with text reading gaps', data.counts.text_read_failures],
              ].map(([label, count]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{Number(count).toLocaleString('en-US')}</dd>
                </div>
              ))}
            </dl>
            <p className="mb-note">
              Unique file contents counts distinct saved contents; a file re-uploaded unchanged adds
              a version, not new contents.
            </p>
            <p className="mb-note">
              Files we couldn’t download and folders we couldn’t list are collection gaps on our
              side, not statements about the station.
            </p>
            <p className="mb-note">
              Files whose text could not be fully read still have page images; their machine-read
              text is partial and Not checked.
            </p>
          </section>
          <SourcesAndUpdates
            groups={[
              {
                source: data.call_sign,
                items: [
                  <a href={data.fcc_url} target="_blank" rel="noreferrer" key="fcc">
                    FCC public inspection file
                  </a>,
                  `FCC folder listing read ${day(data.last_list_check)}`,
                  `Station files copied ${day(data.last_file_copy)}`,
                  `Latest station upload held ${day(data.newest_upload)}`,
                ],
              },
            ]}
          />
        </>
      )}
    </Frame>
  );
}

export function PrintedAgency({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const read = useRead<Agency>(mediaPath(['agencies', match.params.name]));
  const data = read.data;
  const sources = useRead<Sources>(mediaPath(['sources']));
  return (
    <Frame
      title={data?.name ?? 'Printed agency name'}
      eyebrow="Printed agency name"
      sources={sources.data}
    >
      <p className="mb-lead">
        A name printed in a station file is kept as its exact spelling; a matching name alone does
        not establish identity
      </p>
      <ReadState read={read} noun="files" />
      {data && (
        <>
          <h2 className="f-section-title">Files under this exact spelling</h2>
          {data.groups.map((g) => (
            <section key={`${g.station}|${g.year}`}>
              <h3>
                {g.station} · {g.year ?? 'Year unavailable'}
              </h3>
              <FileList files={g.files} here={here} />
              {g.files.some((f) => f.agency_unchecked) && (
                <p className="mb-note">
                  Not checked: agency names read from machine-read text may contain reading errors
                </p>
              )}
            </section>
          ))}
          {!data.groups.length && <Empty title="No files to show" />}
          <section className="mb-card mb-section">
            <h2>Checked address evidence</h2>
            {data.addresses.length ? (
              data.addresses.map((a) => (
                <div key={a.address}>
                  <p>{a.address}</p>
                  {a.evidence.map((e) => (
                    <p key={`${e.file_key}|${e.page}`}>
                      <Link
                        to={withFrom(
                          hrefFor(
                            'station-file',
                            { key: e.file_key },
                            { version: e.version_id, page: String(e.page) },
                          ),
                          here,
                        )}
                      >
                        View evidence · Page {e.page} · {e.file_name}
                      </Link>
                      <br />
                      Checked on {day(e.checked_at)}
                    </p>
                  ))}
                </div>
              ))
            ) : (
              <p>No address has been checked for this spelling</p>
            )}
            <p className="mb-note">
              An address checked on one file belongs to that file’s version. Same address, employer
              text or equal amounts do not prove identity.
            </p>
          </section>
          <section className="mb-card">
            <h2>Payment records</h2>
            <p>
              Separate searches of the campaign and outside-spending payment files for this exact
              printed spelling. A payment under this name does not prove the file was paid.
            </p>
            <p>
              <Link
                to={withFrom(
                  hrefFor('payments-under-name', { query: data.name }, { role: 'vendor' }),
                  here,
                )}
              >
                Campaign payments with this exact printed name
              </Link>
            </p>
            <p>
              <Link
                to={withFrom(
                  hrefFor(
                    'payments-under-name',
                    { query: data.name },
                    { role: 'independent_vendor' },
                  ),
                  here,
                )}
              >
                Outside spending payments with this exact printed name
              </Link>
            </p>
          </section>
        </>
      )}
    </Frame>
  );
}
