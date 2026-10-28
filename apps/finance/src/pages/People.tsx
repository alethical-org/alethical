import { useEffect, useRef, useState, type FormEvent } from 'react';

import { currentChamber, legislatorDistrictLine } from '@alethical/shared/legislatorProfile';

import { useRead } from '../api/read';
import { copyDate, type ServedCounts } from '../landing/counts';
import { Link, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { ClearAll, Chips, Dropdown, LoadingRows, Refused, Updating, Empty } from '../ui/controls';
import { RecordMark } from '../ui/marks';
import { Arrow, BackLink, SourcesAndUpdates } from '../ui/parts';
import './people.css';

export const PAGE_SIZE = 10;
/** The list route's own maximum; above the sitting Legislature's 200 seats. */
const LIST_LIMIT = 250;

interface LegislatorRow {
  id: string;
  slug: string;
  full_name: string;
  current_service?: {
    chamber?: string | null;
    district?: { code?: string | null } | null;
  } | null;
}

/** "{n} service record(s)", with "matching “q”" when a name was searched. */
export function countLine(total: number, query: string): string {
  const noun = total === 1 ? 'service record' : 'service records';
  return `${total.toLocaleString('en-US')} ${noun}${query ? ` matching “${query}”` : ''}`;
}

/** "House District 45B · Currently serving". The directory lists the sitting
 * Legislature only, so every row is a current service record. */
export function rowNote(row: LegislatorRow): string {
  const chamber = currentChamber(row.current_service?.chamber);
  const district = legislatorDistrictLine(chamber, row.current_service?.district?.code);
  return [district, 'Currently serving'].filter(Boolean).join(' · ');
}

const RECORD_TYPES = [
  { value: 'all', label: 'All records' },
  { value: 'legislators', label: 'Legislators' },
] as const;

/**
 * People (People drawing): name search over the held service records, the
 * Legislators filter with Service, Sort by and paging, each choice in the
 * address. the shared Alethical API serves no list of candidate or person records, so
 * those rows and their filters are not offered (grounded-answers rule 2).
 */
export function People(_props: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const [state, setState] = useAddressState({ q: '', type: 'all', service: '', page: '1' });
  const type = state.type === 'legislators' ? 'legislators' : 'all';
  const service = type === 'legislators' && state.service === 'current' ? 'current' : '';
  const query = state.q.trim();
  const [typed, setTyped] = useState(state.q);
  useEffect(() => setTyped(state.q), [state.q]);
  // The sitting Legislature holds 200 seats, so 1 read returns every matching
  // service record and the page counts and pages them exactly.
  const params = new URLSearchParams({ limit: String(LIST_LIMIT) });
  if (query) params.set('q', query);
  const read = useRead<LegislatorRow[]>(`legislators?${params.toString()}`, {
    keepPrevious: true,
  });
  const counts = useRead<ServedCounts>('finance/landing/counts');
  const updated = counts.data ? copyDate(counts.data, 'current_legislature_bills') : null;

  const all = read.data ?? [];
  const total = read.data ? all.length : null;
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(state.page) || 1), pages);
  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const list = useRef<HTMLElement>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    setState({ q: typed.trim(), page: '1' });
  }
  function goPage(next: number) {
    setState({ page: String(next) });
    window.setTimeout(() => {
      list.current?.scrollIntoView?.({ block: 'start' });
      list.current?.querySelector<HTMLAnchorElement>('li a')?.focus({ preventScroll: true });
    }, 0);
  }

  const filtered = type !== 'all' || service !== '';
  const empty = read.data !== null && !read.updating && all.length === 0;

  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        <header>
          <h1 tabIndex={-1} className="f-page-title">
            People
          </h1>
          <p className="pp-lead">
            Candidate and legislative service records stay distinct, with confirmed links to the
            same person. Minnesota records; candidate lookup is not a complete national directory.
          </p>
        </header>
        <form role="search" onSubmit={submit} className="pp-search">
          <label htmlFor="people-name" className="f-visually-hidden">
            Search by name
          </label>
          <input
            id="people-name"
            type="search"
            className="f-field pp-field"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Search by name"
            autoComplete="off"
          />
          <button type="submit" className="f-btn pp-submit">
            Search
          </button>
        </form>

        <div className="pp-controls">
          <Chips
            label="Record type"
            value={type}
            options={RECORD_TYPES}
            onChange={(value) => setState({ type: value, service: '', page: '1' })}
          />
          {type === 'legislators' && (
            <div role="group" aria-label="Service" className="pp-chip-row">
              <span className="pp-row-label">Service</span>
              <button
                type="button"
                aria-pressed={service === 'current'}
                className="f-chip"
                onClick={() =>
                  setState({ service: service === 'current' ? '' : 'current', page: '1' })
                }
              >
                Current
              </button>
            </div>
          )}
          <div className="pp-control-row">
            <Dropdown
              name="Sort by"
              value="name"
              options={[{ value: 'name', label: 'Name A–Z' }]}
              onChange={() => {}}
            />
            {filtered && (
              <ClearAll onClick={() => setState({ type: 'all', service: '', page: '1' })} />
            )}
          </div>
        </div>

        <div className="pp-layout">
          <section ref={list} className="pp-results" aria-label="Results">
            {read.loading && <LoadingRows />}
            {read.failed && !read.data && (
              <Refused onRetry={read.retry} retrying={read.pending}>
                We couldn’t load these results. This is a problem on our side.
              </Refused>
            )}
            {read.data && (
              <>
                {read.updating && <Updating />}
                {read.failed && (
                  <Refused onRetry={read.retry} retrying={read.pending}>
                    We couldn’t load these results. This is a problem on our side.
                  </Refused>
                )}
                {total !== null && (
                  <div aria-live="polite" className="pp-count f-num">
                    {countLine(total, query)}
                  </div>
                )}
                {empty && (
                  <Empty title="No matching records" next="Try another name or bill number" />
                )}
                {rows.length > 0 && (
                  <>
                    <ul className="pp-list">
                      {rows.map((row) => (
                        <li key={row.id}>
                          <Link
                            to={withFrom(hrefFor('legislator', { id: row.slug }), here)}
                            className="pp-row"
                          >
                            <span className="f-marked pp-who">
                              <RecordMark kind="person" />
                              <span className="pp-name">{row.full_name}</span>
                              <span className="pp-note f-num">{rowNote(row)}</span>
                            </span>
                            <span className="pp-kind">LEGISLATOR</span>
                            <span className="pp-end f-num">
                              Minnesota Legislature
                              <Arrow />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {pages > 1 && (
                      <nav aria-label="Pages" className="pp-pages">
                        <button
                          type="button"
                          className="f-btn f-btn-secondary pp-page-btn"
                          aria-disabled={page <= 1 || undefined}
                          onClick={() => page > 1 && goPage(page - 1)}
                        >
                          Previous
                        </button>
                        <span aria-live="polite" className="pp-page-line f-num">
                          Page {page} of {pages}
                        </span>
                        <button
                          type="button"
                          className="f-btn f-btn-secondary pp-page-btn"
                          aria-disabled={page >= pages || undefined}
                          onClick={() => page < pages && goPage(page + 1)}
                        >
                          Next
                        </button>
                      </nav>
                    )}
                    <p className="lg2-note">
                      Candidacy or an election result does not prove current service.
                    </p>
                  </>
                )}
              </>
            )}
          </section>
          <aside className="pp-aside">
            <section className="f-card pp-types">
              <h2 className="f-label">RECORD TYPES</h2>
              <dl>
                <div>
                  <dt>Candidate</dt>
                  <dd>
                    A filing for one election and office, from the Minnesota Secretary of State
                  </dd>
                </div>
                <div>
                  <dt>Legislator</dt>
                  <dd>
                    A service record from the Minnesota Legislature: chamber, district, committees,
                    authored bills
                  </dd>
                </div>
                <div>
                  <dt>Person</dt>
                  <dd>
                    Elections and service over time, linked to candidate and legislative service
                    records
                  </dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>
      </div>
      <SourcesAndUpdates
        groups={[
          {
            source: 'Minnesota Legislature',
            items: [updated ? `Service records · updated ${updated}` : 'Service records'],
          },
        ]}
      />
    </main>
  );
}
