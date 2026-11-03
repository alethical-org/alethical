import { useEffect, useRef, useState, type FormEvent } from 'react';
import { currentChamber, legislatorDistrictLine } from '@alethical/shared/legislatorProfile';
import { apiPath, useRead } from '../api/read';
import { copyDate, type ServedCounts } from '../landing/counts';
import { Link, useLocation } from '../router';
import { withFrom } from '../returnContext';
import { hrefFor, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { useBand } from '../ui/band';
import { Chips, ClearAll, Dropdown, Empty, LoadingRows, Refused, Updating } from '../ui/controls';
import { RecordMark } from '../ui/marks';
import { Arrow, Chevron, SourcesAndUpdates } from '../ui/parts';
import { candidateSeat } from './seat';
import './people.css';
export { candidateSeat };
export const PAGE_SIZE = 10;
export interface PersonDirectoryRow {
  kind: 'person' | 'candidate' | 'legislator';
  id: string;
  name: string;
  slug?: string;
  year?: number;
  /** The candidacy's election as the record holds it (`{ type: 'general' }`). */
  election?: { type?: string | null; label?: string | null; date?: string | null } | string | null;
  office?: string;
  voting_area?: string;
  party?: string | null;
  source?: { authority?: string; checkedDate?: string };
  service_status?: 'current' | 'former' | 'unknown';
  periods?: Array<{
    chamber: string;
    district: string | null;
    party: string | null;
    start_date: string | null;
    end_date: string | null;
    session: string | null;
    source_url: string | null;
  }>;
}
export interface PeoplePage {
  state: string;
  rows: PersonDirectoryRow[];
  total: number;
  counts: { person: number; candidate: number; legislator: number };
  years: number[];
  limit: number;
  offset: number;
  has_more: boolean;
  q?: string;
  type?: string;
  scope?: string;
  year?: number | null;
  service?: string | null;
  sort?: string;
}
const TYPES = [
  { value: 'all', label: 'All records' },
  { value: 'candidates', label: 'Candidates' },
  { value: 'legislators', label: 'Legislators' },
];
const SERVICE = [
  { value: '', label: 'Current and former' },
  { value: 'current', label: 'Current' },
  { value: 'former', label: 'Former' },
];
const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
export function countLine(total: number, query: string, type = 'legislators') {
  return `${plural(total, ...((type === 'candidates' ? ['candidacy', 'candidacies'] : type === 'legislators' ? ['service record', 'service records'] : ['record', 'records']) as [string, string]))}${query ? ` matching “${query}”` : ''}`;
}
/** "2026 general · State Representative, District 45B · {party}": the drawing's
 * candidacy line, each seat fact once, with the party where the server holds it. A
 * legislator's party prints only where the Legislature record holds it. */
export function rowNote(row: PersonDirectoryRow) {
  if (row.kind === 'candidate') {
    const type = typeof row.election === 'string' ? row.election : row.election?.type;
    const election = [row.year, type].filter(Boolean).join(' ');
    return [election, candidateSeat(row.office, row.voting_area), row.party]
      .filter(Boolean)
      .join(' · ');
  }
  if (row.kind === 'person') return '';
  const period = row.periods?.[0];
  const seat = period
    ? legislatorDistrictLine(currentChamber(period.chamber), period.district)
    : '';
  const status =
    row.service_status === 'current'
      ? 'Serving'
      : row.service_status === 'former'
        ? 'Formerly served'
        : 'Current service not confirmed';
  return [seat, period?.party, status].filter(Boolean).join(' · ');
}
/** The row's source, at its end. */
export function rowEnd(row: PersonDirectoryRow) {
  return row.kind === 'legislator'
    ? 'Minnesota Legislature'
    : row.kind === 'candidate'
      ? 'Minnesota Secretary of State'
      : '';
}
export function peopleLink(row: PersonDirectoryRow) {
  return hrefFor(
    row.kind === 'legislator' ? 'legislator' : row.kind === 'candidate' ? 'candidate' : 'person',
    { id: row.kind === 'legislator' ? (row.slug ?? row.id) : row.id },
  );
}
export function People(_props: { match: RouteMatch }) {
  const location = useLocation(),
    here = location.pathname + location.search;
  const band = useBand();
  const [state, setState] = useAddressState({
    q: '',
    type: 'all',
    service: '',
    scope: 'all',
    year: '',
    sort: 'name',
    page: '1',
  });
  const type = TYPES.some((t) => t.value === state.type) ? state.type : 'all';
  const page = Math.max(1, Math.trunc(Number(state.page) || 1)),
    query = state.q.trim().slice(0, 200);
  const [typed, setTyped] = useState(state.q);
  useEffect(() => setTyped(state.q), [state.q]);
  const sort = type === 'candidates' && state.sort === 'election_year' ? 'election_year' : 'name';
  // Only values the server accepts reach it, so a hand-edited address reads as
  // the unfiltered view rather than as a failure on our side.
  const service = SERVICE.some((s) => s.value === state.service) ? state.service : '';
  const scope = state.scope === 'past' ? 'past' : 'all';
  const year =
    /^\d{4}$/.test(state.year) && Number(state.year) >= 1900 && Number(state.year) <= 2200
      ? state.year
      : '';
  const read = useRead<PeoplePage>(
    apiPath(['finance', 'people'], {
      q: query,
      type,
      service: type === 'legislators' ? service : '',
      scope: type === 'candidates' ? scope : 'all',
      year: type === 'candidates' ? year : '',
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    { keepPrevious: true },
  );
  const data = read.data,
    rows = data?.rows ?? [],
    pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const list = useRef<HTMLElement>(null);
  function submit(e: FormEvent) {
    e.preventDefault();
    setState({ q: typed.trim(), page: '1' });
  }
  function goPage(next: number) {
    setState({ page: String(next) });
    list.current?.focus({ preventScroll: true });
    list.current?.scrollIntoView?.({ block: 'start' });
  }
  const filtered =
    type !== 'all' ||
    service !== '' ||
    state.scope !== 'all' ||
    state.year !== '' ||
    sort !== 'name';
  const counts = data?.counts;
  const count =
    data && data.type === 'all' && counts
      ? `${plural(counts.person, 'person', 'people')} · ${plural(counts.candidate, 'candidacy', 'candidacies')} · ${plural(counts.legislator, 'service record', 'service records')}${data.q ? ` matching “${data.q}”` : ''}`
      : data
        ? countLine(data.total, data.q ?? query, data.type ?? type)
        : '';
  const electionYear = state.scope === 'past' ? 'past' : state.year;
  const served = useRead<ServedCounts>('finance/landing/counts');
  const legislatureDate = served.data ? copyDate(served.data, 'current_legislature_bills') : null;
  return (
    <main id="main" className="f-page">
      <div className="f-content">
        <h1 tabIndex={-1} className="f-page-title">
          People
        </h1>
        <p className="pp-lead">
          Candidate and legislative service records stay distinct, with confirmed links to the same
          person
        </p>
        <form role="search" className="pp-search" onSubmit={submit}>
          <label className="pp-search-label" htmlFor="people-name">
            Search by name
          </label>
          <input
            id="people-name"
            type="search"
            className="f-field pp-field"
            value={typed}
            maxLength={200}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={band === 'phone' ? 'Name' : 'Search by name'}
            autoComplete="off"
          />
          <button className="f-btn pp-submit">Search</button>
        </form>
        <div className="pp-controls">
          <Chips
            label="Record type"
            value={type}
            options={TYPES}
            onChange={(type) =>
              setState({ type, service: '', scope: 'all', year: '', sort: 'name', page: '1' })
            }
          />
          <div className="pp-control-row">
            {type === 'candidates' && (
              <Dropdown
                name="Election year"
                value={electionYear}
                options={[
                  { value: '', label: 'All years' },
                  { value: 'past', label: 'Past candidates' },
                  ...(data?.years ?? []).map((y) => ({ value: String(y), label: String(y) })),
                ]}
                onChange={(value) =>
                  setState(
                    value === 'past'
                      ? { scope: 'past', year: '', page: '1' }
                      : { scope: 'all', year: value, page: '1' },
                  )
                }
              />
            )}
            {type === 'legislators' && (
              <Dropdown
                name="Service"
                value={service}
                options={SERVICE}
                onChange={(service) => setState({ service, page: '1' })}
              />
            )}
            <Dropdown
              name="Sort by"
              value={sort}
              options={[
                { value: 'name', label: 'Name A–Z' },
                ...(type === 'candidates'
                  ? [{ value: 'election_year', label: 'Election year' }]
                  : []),
              ]}
              onChange={(sort) => setState({ sort, page: '1' })}
            />
            {filtered && (
              <ClearAll
                onClick={() =>
                  setState({
                    type: 'all',
                    service: '',
                    scope: 'all',
                    year: '',
                    sort: 'name',
                    page: '1',
                  })
                }
              />
            )}
          </div>
        </div>
        <section ref={list} tabIndex={-1} className="pp-results" aria-label="Results">
          {read.loading && <LoadingRows />}
          {read.updating && <Updating />}
          {read.failed && (
            <Refused onRetry={read.retry} retrying={read.pending}>
              We couldn’t load these results. This is a problem on our side.
              {data ? ' Previous results are shown.' : ''}
            </Refused>
          )}
          {data && (
            <>
              <div aria-live="polite" className="f-count-line pp-count">
                {count}
              </div>
              {!rows.length && !read.updating ? (
                // "Try another name" only answers a typed name; a filter alone gets the
                // drawn first line.
                <Empty title="No matching records" next={query ? 'Try another name' : undefined} />
              ) : (
                <ul className="pp-list">
                  {rows.map((row) => {
                    const note = rowNote(row);
                    return (
                      <li key={`${row.kind}|${row.id}`}>
                        <Link className="pp-row" to={withFrom(peopleLink(row), here)}>
                          <span className="f-marked pp-who">
                            <RecordMark kind="person" />
                            <span className="pp-name">{row.name}</span>
                            {note && <span className="pp-note f-num">{note}</span>}
                          </span>
                          <span className="pp-kind">{row.kind.toUpperCase()}</span>
                          <span className="pp-end f-num">
                            {rowEnd(row)}
                            <Arrow />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              {pages > 1 && (
                <nav aria-label="Pages" className="pp-pages">
                  <button
                    className="f-btn f-btn-secondary pp-page-btn pp-page-prev"
                    disabled={read.pending || page <= 1}
                    onClick={() => goPage(page - 1)}
                  >
                    <Chevron />
                    Previous
                  </button>
                  <span className="pp-page-line f-num" aria-live="polite">
                    Page {Math.floor(data.offset / PAGE_SIZE) + 1} of {pages}
                  </span>
                  <button
                    className="f-btn f-btn-secondary pp-page-btn pp-page-next"
                    disabled={read.pending || !data.has_more}
                    onClick={() => goPage(page + 1)}
                  >
                    Next
                    <Chevron />
                  </button>
                </nav>
              )}
              {rows.length > 0 && (
                <p className="lg2-note">
                  Candidacy or an election result does not prove current service
                </p>
              )}
            </>
          )}
        </section>
        <section aria-labelledby="about-h" className="pp-about">
          <h2 id="about-h">About these records</h2>
          <dl>
            <div>
              <dt>Candidate</dt>
              <dd>A filing for one election and office, from the Minnesota Secretary of State</dd>
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
                Elections and service over time, linked to candidate and legislative service records
              </dd>
            </div>
          </dl>
          <p>Minnesota records only; candidate lookup is not a complete national directory</p>
        </section>
      </div>
      <SourcesAndUpdates
        groups={[
          { source: 'Minnesota Secretary of State', items: ['Candidate records'] },
          {
            source: 'Minnesota Legislature',
            items: [
              legislatureDate ? `Service records updated ${legislatureDate}` : 'Service records',
            ],
          },
        ]}
      />
    </main>
  );
}
