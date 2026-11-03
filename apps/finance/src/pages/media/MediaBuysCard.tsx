import { useRead } from '../../api/read';
import { Link, useLocation } from '../../router';
import { withFrom } from '../../returnContext';
import { isBuilt } from '../../routes';
import { Refused } from '../../ui/controls';
import { Arrow } from '../../ui/parts';
import { day, fileHref, mediaPath } from './shared';
import type { Connected, FileRow } from './types';
import './media.css';

/** The record kinds the server can list connected TV station files for. */
export type MediaBuysKind = 'committee' | 'candidate' | 'principal' | 'election' | 'race' | 'name';

function Row({ row, here }: { row: FileRow; here: string }) {
  const lead = row.kind
    ? `${row.station} ${row.kind.toLowerCase()}`
    : `${row.station} ${row.label}`;
  return (
    <li>
      <Link className="mb-link-row" to={withFrom(fileHref(row.key, row.version_id), here)}>
        <span>
          <span className="mb-link-name mb-buys-lead">
            <span>{lead} ·</span>
            <span className="f-nowrap">
              {row.uploaded_at ? day(row.uploaded_at) : 'upload date not given'}
            </span>
          </span>
          {row.role && <span className="mb-link-note">{row.role}</span>}
        </span>
        <Arrow />
      </Link>
    </li>
  );
}

/**
 * Media buys on a record's own page (Media Buys Card drawing): the TV station
 * files with a checked connection to this record, each at its exact version.
 * TV station files are not part of any money total. Shown only once the TV
 * station file page is built.
 */
export function MediaBuysCard({
  kind,
  target,
  name,
}: {
  kind: MediaBuysKind;
  target: string;
  name: string;
}) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const built = isBuilt('station-file');
  const read = useRead<Connected>(built ? mediaPath(['connections'], { kind, target }) : null, {
    // An answer without its 2 lists is a failed read, never an empty card.
    acceptData: (data) => Array.isArray(data?.files) && Array.isArray(data?.groups),
  });
  if (!built) return null;
  const data = read.data;
  const groups = data
    ? [
        ...(data.files.length ? [{ label: '', files: data.files }] : []),
        ...data.groups.filter((group) => group.files.length > 0),
      ]
    : [];
  return (
    <section aria-labelledby="media-buys-h" className="mb-card mb-buys-card">
      <h2 id="media-buys-h">Media buys</h2>
      <p className="mb-card-line">KSTP-TV, KARE and KMSP-TV station files, not in money totals</p>
      {read.failed && !data && (
        <div className="mb-buys-group">
          <Refused onRetry={read.retry} retrying={read.pending}>
            We couldn’t load these TV station files. This is a problem on our side.
          </Refused>
        </div>
      )}
      {data && groups.length === 0 && (
        <p className="mb-card-empty">No TV station files have a checked connection to {name}</p>
      )}
      {groups.map((group) => (
        <div key={group.label || 'files'} className="mb-buys-group">
          {group.label && <h3>{group.label}</h3>}
          <ul className="mb-link-list">
            {group.files.map((row) => (
              <Row key={row.key} row={row} here={here} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
