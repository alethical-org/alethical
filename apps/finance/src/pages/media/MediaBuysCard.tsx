import { useRead } from '../../api/read';
import { Link, useLocation } from '../../router';
import { withFrom } from '../../returnContext';
import { isBuilt } from '../../routes';
import { Refused } from '../../ui/controls';
import { Arrow, LoadingLine } from '../../ui/parts';
import { day, fileHref, mediaPath } from './shared';
import type { Connected, FileRow } from './types';
import './media.css';

/** The record kinds the server can list connected TV station files for. */
export type MediaBuysKind = 'committee' | 'candidate' | 'principal' | 'election' | 'race' | 'name';

/** The server's title for a candidacy's files that print the candidate's name
 * (`connected` in alethical/api/services/tv_ads.py), and the drawing's words for
 * that group (settled wording row 18). */
const NAMED_GROUP = 'Station files that name this candidate';
export const NAMED_TITLE = 'TV station files that name this candidate';

/** The race card's target: the campaign-money contest a checked election names,
 * exactly as the server compares it (`money_context`: the register's office and
 * district, and the election year). */
export function raceTarget(office: string, district: string | null, year: number): string {
  return JSON.stringify({ office, district, year });
}

interface CardGroup {
  key: string;
  title: string;
  files: FileRow[];
}

/**
 * The groups as the card prints them. Every row the server lists sits in a group
 * with its role line (its flat `files` list repeats them without one). Only a
 * candidacy's groups carry titles: its committees' files first, then the files
 * that name the candidate, never mixed (Media Buys Card drawing). A race's groups
 * are named by their election stage, which each row's role line already prints.
 */
export function cardGroups(kind: MediaBuysKind, data: Connected): CardGroup[] {
  const groups = data.groups
    .filter((group) => group.files.length > 0)
    .map((group, index) => {
      const named =
        group.kind === 'named' ||
        (group.kind == null && (group.label === NAMED_GROUP || group.label === NAMED_TITLE));
      return {
        key: `${index}-${group.label}`,
        named,
        title: kind !== 'candidate' ? '' : named ? NAMED_TITLE : group.label,
        files: group.files,
      };
    });
  return [...groups.filter((group) => !group.named), ...groups.filter((group) => group.named)].map(
    ({ key, title, files }) => ({ key, title, files }),
  );
}

function Row({ row, here }: { row: FileRow; here: string }) {
  const lead = row.kind
    ? `${row.station} ${row.kind.toLowerCase()}`
    : `${row.station} ${row.label}`;
  return (
    <li>
      <Link
        className="mb-link-row"
        to={withFrom(fileHref(row.key, row.version_id, row.page ?? undefined), here)}
      >
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
  const groups = data ? cardGroups(kind, data) : [];
  return (
    <section aria-labelledby="media-buys-h" className="mb-card mb-buys-card">
      <h2 id="media-buys-h">Media buys</h2>
      <p className="mb-card-line">KSTP-TV, KARE and KMSP-TV station files, not in money totals</p>
      {read.loading && !data && (
        <div className="mb-buys-group">
          <LoadingLine>Loading…</LoadingLine>
        </div>
      )}
      {(read.failed || read.notFound) && !data && (
        <div className="mb-buys-group">
          <Refused onRetry={read.retry} retrying={read.pending}>
            We couldn’t load these TV station files
          </Refused>
        </div>
      )}
      {data && groups.length === 0 && (
        <p className="mb-card-empty">No TV station files have a checked connection to {name}</p>
      )}
      {groups.map((group) => (
        <div key={group.key} className="mb-buys-group">
          {group.title && <h3>{group.title}</h3>}
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
