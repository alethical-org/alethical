import { paymentFileCopyLine } from '@alethical/shared/paymentCopyDates';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { apiPath } from '../../api/read';
import { RECORDS_CHANGED, useVersionedRead } from '../../api/versionedRead';
import { useFinanceSession } from '../../auth/session';
import { Link, useLocation } from '../../router';
import { safeFrom, withFrom } from '../../returnContext';
import { hrefFor, matchRoute } from '../../routes';
import { Refused, Updating } from '../../ui/controls';
import { Arrow } from '../../ui/parts';
import type { Role } from '../PaymentsUnderName';
import { PrintedName, quotedSpelling } from './printedName';
import './similarNames.css';

interface SimilarRow {
  name: string;
  records: number;
  identities: Array<{
    id: string;
    name: string;
    kind: string;
    records: number;
    reference: string;
  }>;
}
interface SimilarPage {
  name: string;
  role: Role;
  year: number | null;
  version: string;
  filer?: string | null;
  dataset?: string | null;
  offset: number;
  rows: SimilarRow[];
  excluded_names?: string[];
  release_id?: string;
  has_more: boolean;
  sources?: Array<{ dataset: string; copied_at: string | null }>;
}
const SIZE = 3;
const validStart = (address: string | null) => {
  const safe = safeFrom(address);
  return safe && matchRoute(safe.split(/[?#]/)[0])?.route.name === 'payments-under-name'
    ? safe
    : null;
};
export function similarBack(search: string) {
  const from = validStart(new URLSearchParams(search).get('from'));
  if (!from || !from.endsWith('#similar-names')) return null;
  const name = matchRoute(from.split(/[?#]/)[0])?.params.query;
  return name ? { to: from, name: `payments under ${quotedSpelling(name)}` } : null;
}
export function SimilarNames({
  name,
  role,
  year,
  here,
  filer,
  dataset,
  copyDates,
  excludedNames = [],
  sourceReleaseId,
  onRefreshSource,
}: {
  name: string;
  role: Role;
  year: number | null;
  here: string;
  filer: string | null;
  dataset: string | null;
  copyDates: Record<string, string | null>;
  excludedNames?: readonly string[];
  sourceReleaseId?: string | null;
  onRefreshSource?: () => void;
}) {
  const location = useLocation();
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const auth = `${apiBaseUrl}|${accessToken}`;
  const exclusions = sourceReleaseId ? [...new Set(excludedNames)].sort() : [];
  const exclusionsKey = JSON.stringify(exclusions);
  const exclusionsQuery = new URLSearchParams(
    exclusions.map((value) => ['exclude_name', value]),
  ).toString();
  const scope = JSON.stringify([
    auth,
    name,
    role,
    year,
    filer,
    dataset,
    exclusionsKey,
    sourceReleaseId,
  ]);
  const [wanted, setWanted] = useState({ scope, page: 1 });
  useEffect(() => {
    if (wanted.scope !== scope) setWanted({ scope, page: 1 });
  }, [wanted.scope, scope]);
  const page = wanted.scope === scope ? wanted.page : 1;
  const offset = (page - 1) * SIZE;
  const read = useVersionedRead<SimilarPage>(
    name
      ? apiPath(['finance', 'similar-names'], {
          name,
          role,
          year,
          filer,
          dataset,
          release_id: sourceReleaseId,
          limit: SIZE,
          offset,
        }) + (exclusionsQuery ? `&${exclusionsQuery}` : '')
      : null,
    {
      page,
      onRestart: () => setWanted({ scope, page: 1 }),
      acceptData: (data) =>
        Array.isArray(data.rows) &&
        typeof data.name === 'string' &&
        ['payee', 'donor', 'employer'].includes(data.role),
    },
  );
  const [held, setHeld] = useState<{
    key: string;
    auth: string;
    expanded: boolean;
    pages: SimilarPage[];
  } | null>(null);
  const arrived =
    read.data &&
    !read.pending &&
    !read.failed &&
    read.data.offset === offset &&
    read.data.name === name &&
    read.data.role === role &&
    read.data.year === year &&
    (read.data.filer ?? null) === filer &&
    (read.data.dataset ?? null) === dataset &&
    (!sourceReleaseId || read.data.release_id === sourceReleaseId) &&
    JSON.stringify([...(read.data.excluded_names ?? [])].sort()) === exclusionsKey
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
  const shown = safe?.pages[0];
  const rows = (safe?.pages.flatMap((p) => p.rows) ?? []).filter(
    (row) => !exclusions.includes(row.name),
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
  const heading = useRef<HTMLHeadingElement>(null);
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (
      !shown ||
      safe?.key !== read.listKey ||
      read.pending ||
      window.location.hash !== '#similar-names' ||
      focused.current === here
    )
      return;
    focused.current = here;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start' });
  }, [shown, safe?.key, read.listKey, read.pending, here]);
  const start = validStart(location.searchParams.get('similarStart')) ?? `${here}#similar-names`;
  const href = (row: SimilarRow) => {
    if (matchRoute(start.split(/[?#]/)[0])?.params.query === row.name) return start;
    return withFrom(
      hrefFor(
        'payments-under-name',
        { query: row.name },
        {
          role: shown!.role,
          year: shown!.year === null ? null : String(shown!.year),
          similarStart: start,
          filer: shown!.filer ?? null,
          dataset: shown!.dataset ?? null,
        },
      ),
      start,
    );
  };
  const sourceLines = (shown?.sources ?? [])
    .filter((source) => !source.copied_at || source.copied_at !== copyDates[source.dataset])
    .flatMap((source) => {
      const file =
        source.dataset === 'independent_expenditures'
          ? 'independentExpenditures'
          : source.dataset === 'contributions' || source.dataset === 'expenditures'
            ? source.dataset
            : null;
      return file ? [paymentFileCopyLine(file, source.copied_at)] : [];
    });
  const title = `Similar ${shown?.role ?? role} names`;
  return (
    <section id="similar-names" aria-labelledby="sim-h" className="pn-similar pn-narrow">
      <h2 id="sim-h" ref={heading} tabIndex={-1}>
        {title}
      </h2>
      {read.pending &&
        (shown ? (
          <Updating />
        ) : (
          <p role="status" aria-busy="true">
            Loading similar names…
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
            ? shown
              ? RECORDS_CHANGED
              : 'These records changed. Reload the list.'
            : `We couldn’t load similar names${year === null ? '' : ` for ${year}`}${shown ? '. Previous results are shown.' : ''}`}
        </Refused>
      )}
      {shown && (
        <>
          {((shown.filer ?? null) !== filer || (shown.dataset ?? null) !== dataset) && (
            <p className="pn-similar-scope">
              {shown.filer ? `Filed by committee ${shown.filer}` : 'All committees'} ·{' '}
              {shown.dataset === 'independent'
                ? 'Outside spending file'
                : shown.dataset === 'expenditures'
                  ? 'Campaign payments file'
                  : shown.dataset === 'contributions'
                    ? 'Contributions file'
                    : 'All files for this record type'}
            </p>
          )}
          {(shown.year !== null ||
            read.pending ||
            read.failed ||
            shown.name !== name ||
            shown.role !== role) && (
            <p className="pn-similar-scope f-num">
              {shown.year === null ? 'All years' : `In ${shown.year}`}
              {shown.name !== name ? ` · Names similar to ${quotedSpelling(shown.name)}` : ''}
            </p>
          )}
          {rows.length === 0 && !more && !read.pending && !read.failed && (
            <p role="status">
              <span className="f-visually-hidden">{title}: </span>None found
            </p>
          )}
          <ul key={safe.key} ref={list} id="similar-list" className="pn-similar-list">
            {visibleRows.map((row) => (
              <li key={row.name}>
                <Link to={href(row)} className="pn-similar-link">
                  <span>
                    <span className="pn-similar-name">
                      <PrintedName name={row.name} />
                    </span>
                    <span className="pn-similar-meta f-num">
                      {row.records === 0
                        ? 'No records'
                        : `${row.records.toLocaleString('en-US')} ${row.records === 1 ? 'record' : 'records'}`}
                    </span>
                  </span>
                  <Arrow />
                </Link>
              </li>
            ))}
          </ul>
          {sourceLines.map((line) => (
            <p className="pn-similar-note" key={line}>
              {line}
            </p>
          ))}
          {(more || visibleRows.length < rows.length) && (
            <button
              type="button"
              className="f-btn f-btn-secondary pn-similar-more"
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
