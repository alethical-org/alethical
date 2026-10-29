import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatDay } from '@alethical/shared/moneyFormat';
import { currentChamber, legislatorDistrictLine } from '@alethical/shared/legislatorProfile';
import { apiPath, useRead } from '../api/read';
import { Link, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { Chips, ClearAll, Dropdown, Empty, LoadingRows, Refused, Updating } from '../ui/controls';
import { RecordMark } from '../ui/marks';
import { Arrow, BackLink, SourcesAndUpdates } from '../ui/parts';
import './people.css';
export const PAGE_SIZE = 10;
export interface PersonDirectoryRow {
  kind: 'person' | 'candidate' | 'legislator';
  id: string;
  name: string;
  slug?: string;
  year?: number;
  election?: string;
  office?: string;
  voting_area?: string;
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
const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
export function countLine(total: number, query: string, type = 'legislators') {
  return `${plural(total, ...((type === 'candidates' ? ['candidacy', 'candidacies'] : type === 'legislators' ? ['service record', 'service records'] : ['record', 'records']) as [string, string]))}${query ? ` matching “${query}”` : ''}`;
}
export function rowNote(row: PersonDirectoryRow) {
  if (row.kind === 'candidate')
    return [row.year, row.election, row.office, row.voting_area].filter(Boolean).join(' · ');
  if (row.kind === 'person') return 'Elections and service over time';
  const period = row.periods?.[0];
  const seat = period
    ? legislatorDistrictLine(currentChamber(period.chamber), period.district)
    : '';
  const status =
    row.service_status === 'current'
      ? 'Currently serving'
      : row.service_status === 'former'
        ? 'Formerly served'
        : 'Current service not confirmed';
  return [
    seat,
    status,
    row.service_status === 'former' && period?.end_date
      ? `Ended ${formatDay(period.end_date) ?? period.end_date}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
export function peopleLink(row: PersonDirectoryRow) {
  return hrefFor(
    row.kind === 'legislator' ? 'legislator' : row.kind === 'candidate' ? 'candidate' : 'person',
    { id: row.kind === 'legislator' ? (row.slug ?? row.id) : row.id },
  );
}
export function People(_props: { match: RouteMatch }) {
  const location = useLocation(),
    here = location.pathname + location.search,
    back = returnTarget(location.search);
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
  const read = useRead<PeoplePage>(
    apiPath(['finance', 'people'], {
      q: query,
      type,
      service: type === 'legislators' ? state.service : '',
      scope: type === 'candidates' ? state.scope : 'all',
      year: type === 'candidates' ? state.year : '',
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
    state.service !== '' ||
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
  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        <h1 tabIndex={-1} className="f-page-title">
          People
        </h1>
        <p className="pp-lead">
          Candidate and legislative service records stay distinct, with confirmed links to the same
          person. Minnesota records; candidate lookup is not a complete national directory.
        </p>
        <form role="search" className="pp-search" onSubmit={submit}>
          <label className="f-visually-hidden" htmlFor="people-name">
            Search by name
          </label>
          <input
            id="people-name"
            type="search"
            className="f-field pp-field"
            value={typed}
            maxLength={200}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Search by name"
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
          {type === 'candidates' && (
            <>
              <Chips
                label="Candidates"
                value={state.scope === 'past' ? 'past' : 'all'}
                options={[
                  { value: 'all', label: 'All candidates' },
                  { value: 'past', label: 'Past candidates' },
                ]}
                onChange={(scope) => setState({ scope, year: '', page: '1' })}
              />
              <Chips
                label="Election year"
                value={state.year}
                options={[
                  { value: '', label: 'All years' },
                  ...(data?.years ?? []).map((y) => ({ value: String(y), label: String(y) })),
                ]}
                onChange={(year) => setState({ year, page: '1' })}
              />
            </>
          )}
          {type === 'legislators' && (
            <div role="group" aria-label="Service" className="pp-chip-row">
              <span className="pp-row-label">Service</span>
              {[
                { value: 'current', label: 'Current' },
                { value: 'former', label: 'Former' },
              ].map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className="f-chip"
                  aria-pressed={state.service === s.value}
                  onClick={() =>
                    setState({ service: state.service === s.value ? '' : s.value, page: '1' })
                  }
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <div className="pp-control-row">
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
        <div className="pp-layout">
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
                <div aria-live="polite" className="pp-count f-num">
                  {count}
                </div>
                {!rows.length && !read.updating ? (
                  <Empty title="No matching records" next="Try another name" />
                ) : (
                  <ul className="pp-list">
                    {rows.map((row) => (
                      <li key={`${row.kind}|${row.id}`}>
                        <Link className="pp-row" to={withFrom(peopleLink(row), here)}>
                          <span className="f-marked pp-who">
                            <RecordMark kind="person" />
                            <span className="pp-name">{row.name}</span>
                            <span className="pp-note f-num">{rowNote(row)}</span>
                          </span>
                          <span className="pp-kind">{row.kind.toUpperCase()}</span>
                          <span className="pp-end f-num">
                            {row.kind === 'legislator'
                              ? 'Minnesota Legislature'
                              : row.kind === 'candidate'
                                ? 'Minnesota Secretary of State'
                                : ''}
                            <Arrow />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {pages > 1 && (
                  <nav aria-label="Pages" className="pp-pages">
                    <button
                      className="f-btn f-btn-secondary pp-page-btn"
                      disabled={read.pending || page <= 1}
                      onClick={() => goPage(page - 1)}
                    >
                      Previous
                    </button>
                    <span className="pp-page-line f-num" aria-live="polite">
                      Page {Math.floor(data.offset / PAGE_SIZE) + 1} of {pages}
                    </span>
                    <button
                      className="f-btn f-btn-secondary pp-page-btn"
                      disabled={read.pending || !data.has_more}
                      onClick={() => goPage(page + 1)}
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
          </section>
          <aside className="pp-aside">
            <section className="f-card pp-types">
              <h2 className="f-label">Record types</h2>
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
          { source: 'Minnesota Legislature', items: ['Service records'] },
          { source: 'Minnesota Secretary of State', items: ['Candidate records'] },
        ]}
      />
    </main>
  );
}
