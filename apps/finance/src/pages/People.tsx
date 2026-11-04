import { RECORDS_CHANGED, useVersionedRead } from '../api/versionedRead';
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
import { candidateSeat, seatParts } from './seat';
import { dayLabel } from './legislationRecords';
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
  /** Validated candidacy, service and lobbying links, never payment coverage. */
  confirmed_record_count?: number;
  record_notes?: {
    candidacy_years: number[];
    services: Array<{
      office: string | null;
      voting_area: string | null;
      status: string;
      current_service_confirmed?: boolean;
      expected_start_passed?: boolean;
    }>;
    lobbyist: boolean;
  };
  /** Presence is a cue; the row still opens its own candidacy or service record. */
  person_links?: Array<{ id: string; name: string }>;
  source?: { authority?: string; checkedDate?: string };
  service_status?: 'current' | 'former' | 'unknown';
  matching_periods?: PersonDirectoryRow['periods'];
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
  version?: string;
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
  parties?: string[];
  offices?: string[];
  chambers?: string[];
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
  if (row.kind === 'person') {
    const notes = row.record_notes;
    if (!notes) return '';
    // The drawing keeps one newest candidacy and first held service, not a
    // count of roles. Their details never come from confirmed_record_count.
    const year = notes.candidacy_years[0];
    const service = notes.services[0];
    let serviceNote = '';
    if (service) {
      const parts = seatParts(service.office ?? undefined, service.voting_area ?? undefined);
      const seat = parts.join(', ');
      if (seat) {
        if (service.status === 'former') serviceNote = `Formerly served as ${seat}`;
        else if (service.status === 'elected') {
          serviceNote = `Elected to ${seat}${service.current_service_confirmed === false || service.expected_start_passed ? ' · Current service not confirmed' : ''}`;
        } else if (service.status === 'current' && service.current_service_confirmed !== false) {
          serviceNote = [
            'State Representative',
            'State Senator',
            'Representative',
            'Senator',
            'House',
            'Senate',
          ].includes(parts[0])
            ? ['Legislator', ...parts.slice(1)].join(', ')
            : `Serving as ${seat}`;
        } else serviceNote = `${seat} · Current service not confirmed`;
      }
    }
    return [year ? `Candidate ${year}` : '', serviceNote, notes.lobbyist ? 'Lobbyist' : '']
      .filter(Boolean)
      .join(' · ');
  }
  const matched = row.matching_periods?.[0];
  const period = matched ?? row.periods?.[0];
  const seat = period
    ? legislatorDistrictLine(currentChamber(period.chamber), period.district)
    : '';
  if (matched) {
    const start = dayLabel(matched.start_date),
      end = dayLabel(matched.end_date);
    const dates =
      start && end
        ? `${start} – ${end}`
        : start
          ? `Started ${start}`
          : end
            ? `Ended ${end}`
            : matched.session
              ? `Session ${matched.session}`
              : 'Service dates unavailable';
    return ['Matched service', seat, period?.party, dates].filter(Boolean).join(' · ');
  }
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
  if (row.kind === 'person') {
    const count = row.confirmed_record_count;
    return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
      ? plural(count, 'confirmed record', 'confirmed records')
      : '';
  }
  if (row.person_links?.length) return 'Linked to person profile';
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
    party: '',
    office: '',
    chamber: '',
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
  const party =
    type !== 'all' && state.party.length <= 100 && !state.party.includes('\0') ? state.party : '';
  const office =
    type === 'candidates' && state.office.length <= 200 && !state.office.includes('\0')
      ? state.office
      : '';
  const chamber =
    type === 'legislators' && ['house', 'senate'].includes(state.chamber) ? state.chamber : '';
  const read = useVersionedRead<PeoplePage>(
    apiPath(['finance', 'people'], {
      q: query,
      type,
      party,
      office,
      chamber,
      service: type === 'legislators' ? service : '',
      scope: type === 'candidates' ? scope : 'all',
      year: type === 'candidates' ? year : '',
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    { page, onRestart: () => setState({ page: '1' }) },
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
    party !== '' ||
    office !== '' ||
    chamber !== '' ||
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
  const filterOptions = data?.type === type ? data : undefined;
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
            Search by name or district
          </label>
          <input
            id="people-name"
            type="search"
            className="f-field pp-field"
            value={typed}
            maxLength={200}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={band === 'phone' ? 'Name or district' : 'Search by name or district'}
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
              setState({
                type,
                service: '',
                party: '',
                office: '',
                chamber: '',
                scope: 'all',
                year: '',
                sort: 'name',
                page: '1',
              })
            }
          />
          <div className="pp-control-row">
            {type === 'legislators' && (
              <Dropdown
                name="Chamber"
                value={chamber}
                options={[
                  { value: '', label: 'All chambers' },
                  ...(filterOptions?.chambers ?? []).map((value) => ({
                    value,
                    label: value === 'house' ? 'House' : value === 'senate' ? 'Senate' : value,
                  })),
                ]}
                onChange={(chamber) => setState({ chamber, page: '1' })}
              />
            )}
            {type !== 'all' && (
              <Dropdown
                name={type === 'candidates' ? 'Party (as filed)' : 'Party (Legislature record)'}
                value={party}
                options={[
                  { value: '', label: 'All parties' },
                  ...(filterOptions?.parties ?? []).map((value) => ({ value, label: value })),
                ]}
                onChange={(party) => setState({ party, page: '1' })}
              />
            )}
            {type === 'candidates' && (
              <Dropdown
                name="Office"
                value={office}
                options={[
                  { value: '', label: 'All offices' },
                  ...(filterOptions?.offices ?? []).map((value) => ({ value, label: value })),
                ]}
                onChange={(office) => setState({ office, page: '1' })}
              />
            )}
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
                    party: '',
                    office: '',
                    chamber: '',
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
              {read.changed
                ? RECORDS_CHANGED
                : `We couldn’t load these results. This is a problem on our side.${data ? ' Previous results are shown.' : ''}`}
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
                <Empty
                  title="No matching records"
                  next={query ? 'Try another name or district' : undefined}
                />
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
