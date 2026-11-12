import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVersionedRead, RECORDS_CHANGED } from '../../api/versionedRead';
import { useFinanceSession } from '../../auth/session';
import { Link } from '../../router';
import { withFrom } from '../../returnContext';
import { hrefFor } from '../../routes';
import { Refused, Updating } from '../../ui/controls';
import { Arrow } from '../../ui/parts';
import { PrintedName } from '../payments/printedName';
import { day, mediaPath, plural } from './shared';
interface SimilarAgency {
  key: string;
  label: string;
  file_count: number;
  stations: string[];
  unchecked: boolean;
  checked_on?: string | null;
}
interface Page {
  key: string;
  name: string;
  version: string;
  offset: number;
  has_more: boolean;
  rows: SimilarAgency[];
  excluded_keys?: string[];
}
const SIZE = 3;
export function AgencySimilarNames({
  agencyKey,
  here,
  excludedKeys = [],
  sourceVersion,
  onRefreshSource,
}: {
  agencyKey: string;
  here: string;
  excludedKeys?: readonly string[];
  sourceVersion?: string | null;
  onRefreshSource?: () => void;
}) {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const exclusions = sourceVersion ? [...new Set(excludedKeys)].sort() : [];
  const exclusionsKey = JSON.stringify(exclusions);
  const exclusionsQuery = new URLSearchParams(
    exclusions.map((value) => ['exclude_key', value]),
  ).toString();
  const auth = `${apiBaseUrl}|${accessToken}`,
    scope = `${auth}|${agencyKey}|${exclusionsKey}|${sourceVersion ?? ''}`;
  const [wanted, setWanted] = useState({ scope, page: 1 });
  useEffect(() => {
    if (wanted.scope !== scope) setWanted({ scope, page: 1 });
  }, [wanted.scope, scope]);
  const page = wanted.scope === scope ? wanted.page : 1,
    offset = (page - 1) * SIZE;
  const read = useVersionedRead<Page>(
    mediaPath(['agencies', agencyKey, 'similar-names'], {
      limit: SIZE,
      offset,
      version: sourceVersion,
    }) + (exclusionsQuery ? `&${exclusionsQuery}` : ''),
    {
      page,
      onRestart: () => setWanted({ scope, page: 1 }),
      acceptData: (data) => Array.isArray(data.rows) && typeof data.name === 'string',
    },
  );
  const [held, setHeld] = useState<{
    key: string;
    auth: string;
    expanded: boolean;
    pages: Page[];
  } | null>(null);
  const arrived =
    read.data &&
    !read.pending &&
    !read.failed &&
    read.data.offset === offset &&
    read.data.key === agencyKey &&
    (!sourceVersion || read.data.version === sourceVersion) &&
    JSON.stringify([...(read.data.excluded_keys ?? [])].sort()) === exclusionsKey
      ? read.data
      : null;
  useEffect(() => {
    if (!arrived) return;
    setHeld((previous) => {
      const pages = previous?.key === read.listKey ? previous.pages.slice(0, page - 1) : [];
      return pages.length === page - 1
        ? {
            key: read.listKey,
            auth,
            expanded: page > 1,
            pages: [...pages, arrived],
          }
        : previous;
    });
  }, [arrived, read.listKey, auth, page]);
  useEffect(() => {
    if (read.accessDenied) setHeld(null);
  }, [read.accessDenied]);
  const safe = held?.auth === auth && !read.accessDenied ? held : null;
  const rows = (safe?.pages.flatMap((p) => p.rows) ?? []).filter(
    (row) => !exclusions.includes(row.key),
  );
  const visibleRows = safe?.expanded ? rows : rows.slice(0, 1);
  const more = safe?.key === read.listKey && safe.pages.at(-1)?.has_more;
  const list = useRef<HTMLUListElement>(null);
  const focusAfterReveal = useRef<{
    scope: string;
    count: number;
    trigger: Element | null;
  } | null>(null);
  useLayoutEffect(() => {
    const pending = focusAfterReveal.current;
    if (!pending) return;
    if (pending.scope !== scope) {
      focusAfterReveal.current = null;
      return;
    }
    const links = list.current?.querySelectorAll<HTMLAnchorElement>('a[href]');
    if (!links || links.length <= pending.count) return;
    focusAfterReveal.current = null;
    if (document.activeElement === pending.trigger || document.activeElement === document.body)
      links[pending.count]?.focus();
  });
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
        <Refused
          onRetry={() => {
            if (read.changed) onRefreshSource?.();
            read.retry();
          }}
          retrying={read.pending}
        >
          {read.changed
            ? safe
              ? RECORDS_CHANGED
              : 'These records changed. Reload the list.'
            : `Couldn’t load similar agency names${safe ? '. Previous results are shown.' : ''}`}
        </Refused>
      )}
      {safe && (
        <>
          {safe.pages[0].key !== agencyKey && (
            <p className="mb-card-line">
              Similar to <PrintedName name={safe.pages[0].name} />
            </p>
          )}
          {rows.length === 0 && !more && !read.pending && !read.failed && (
            <p role="status" className="mb-card-line">
              <span className="f-visually-hidden">Similar agency names: </span>
              None found
            </p>
          )}
          <ul key={safe.key} ref={list} className="mb-link-list mb-agency-similar-list">
            {visibleRows.map((row) => (
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
                        row.unchecked
                          ? 'Not checked'
                          : day(row.checked_on) !== 'Unavailable'
                            ? `Checked on ${day(row.checked_on)}`
                            : 'Checked',
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
          {(more || visibleRows.length < rows.length) && (
            <button
              type="button"
              className="f-btn f-btn-secondary"
              disabled={read.pending || read.failed}
              onClick={() => {
                focusAfterReveal.current = {
                  scope,
                  count: visibleRows.length,
                  trigger: document.activeElement,
                };
                if (visibleRows.length < rows.length) {
                  setHeld((previous) => (previous ? { ...previous, expanded: true } : previous));
                } else {
                  setWanted({ scope, page: page + 1 });
                }
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
