import { useEffect, useState } from 'react';
import { useVersionedRead, RECORDS_CHANGED } from '../../api/versionedRead';
import { useFinanceSession } from '../../auth/session';
import { Link } from '../../router';
import { withFrom } from '../../returnContext';
import { hrefFor } from '../../routes';
import { Refused, Updating } from '../../ui/controls';
import { Arrow } from '../../ui/parts';
import { useRevealFocus } from '../../ui/revealFocus';
import { PrintedName } from '../payments/printedName';
import { mediaPath, plural } from './shared';
interface SimilarAgency {
  key: string;
  label: string;
  file_count: number;
  stations: string[];
  unchecked: boolean;
}
interface Page {
  key: string;
  name: string;
  version: string;
  offset: number;
  has_more: boolean;
  rows: SimilarAgency[];
}
const SIZE = 3;
export function AgencySimilarNames({ agencyKey, here }: { agencyKey: string; here: string }) {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const auth = `${apiBaseUrl}|${accessToken}`,
    scope = `${auth}|${agencyKey}`;
  const [wanted, setWanted] = useState({ scope, page: 1 });
  useEffect(() => {
    if (wanted.scope !== scope) setWanted({ scope, page: 1 });
  }, [wanted.scope, scope]);
  const page = wanted.scope === scope ? wanted.page : 1,
    offset = (page - 1) * SIZE;
  const read = useVersionedRead<Page>(
    mediaPath(['agencies', agencyKey, 'similar-names'], { limit: SIZE, offset }),
    {
      page,
      onRestart: () => setWanted({ scope, page: 1 }),
      acceptData: (data) => Array.isArray(data.rows) && typeof data.name === 'string',
    },
  );
  const [held, setHeld] = useState<{ key: string; auth: string; pages: Page[] } | null>(null);
  const arrived =
    read.data && !read.pending && !read.failed && read.data.offset === offset ? read.data : null;
  useEffect(() => {
    if (!arrived) return;
    setHeld((previous) => {
      const pages = previous?.key === read.listKey ? previous.pages.slice(0, page - 1) : [];
      return pages.length === page - 1
        ? { key: read.listKey, auth, pages: [...pages, arrived] }
        : previous;
    });
  }, [arrived, read.listKey, auth, page]);
  useEffect(() => {
    if (read.accessDenied) setHeld(null);
  }, [read.accessDenied]);
  const safe = held?.auth === auth && !read.accessDenied ? held : null;
  const rows = safe?.pages.flatMap((p) => p.rows) ?? [];
  const more = safe?.key === read.listKey && safe.pages.at(-1)?.has_more;
  const reveal = useRevealFocus<HTMLUListElement>(scope);
  return (
    <section className="mb-card" aria-labelledby="agency-similar-h">
      <h2 id="agency-similar-h">Similar agency names</h2>
      {read.pending &&
        (safe ? (
          <Updating />
        ) : (
          <p className="mb-card-line" role="status" aria-busy="true">
            Loading similar agency names…
          </p>
        ))}
      {read.failed && (
        <Refused onRetry={read.retry} retrying={read.pending}>
          {read.changed
            ? RECORDS_CHANGED
            : `We couldn’t load similar agency names${safe ? '. Previous results are shown.' : ''}`}
        </Refused>
      )}
      {safe && (
        <>
          {safe.pages[0].key !== agencyKey && (
            <p className="mb-card-line">
              Similar to <PrintedName name={safe.pages[0].name} />
            </p>
          )}
          {rows.length > 0 && (
            <p className="mb-card-line">
              Each name keeps its own records and may belong to a different person or organization
            </p>
          )}
          {rows.length === 0 && !read.pending && !read.failed && (
            <p role="status" className="mb-card-line">
              <span className="f-visually-hidden">Similar agency names: </span>None found
            </p>
          )}
          <ul key={safe.key} ref={reveal.list} className="mb-link-list mb-agency-similar-list">
            {rows.map((row) => (
              <li key={row.key}>
                <Link
                  className="mb-link-row"
                  to={withFrom(hrefFor('printed-agency-name', { name: row.key }), here)}
                >
                  <span>
                    <span className="mb-link-name">
                      <PrintedName name={row.label} />
                    </span>
                    <span className="mb-agency-similar-meta f-num">
                      {[
                        plural(row.file_count, 'file', 'files'),
                        row.stations.join(', '),
                        row.unchecked ? 'Not checked' : 'Checked',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <Arrow />
                </Link>
              </li>
            ))}
          </ul>
          {more && (
            <button
              type="button"
              className="f-btn f-btn-secondary"
              disabled={read.pending || read.failed}
              onClick={() => {
                reveal.mark();
                setWanted({ scope, page: page + 1 });
              }}
            >
              Show more
            </button>
          )}
        </>
      )}
    </section>
  );
}
