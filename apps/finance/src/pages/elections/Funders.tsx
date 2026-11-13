import { CsvDownload } from './CsvDownload';
import { CoverageNotice } from './CoverageNotice';
import { useEffect, useId, useRef, useState } from 'react';
import { useRead, type Read } from '../../api/read';
import { Link, useLocation } from '../../router';
import { useLiveSearch } from '../../search/useLiveSearch';
import { useAddressState } from '../../ui/addressState';
import { useBand } from '../../ui/band';
import { Caret, Refused, Updating } from '../../ui/controls';
import { BackLink, LoadingLine } from '../../ui/parts';
import { FieldMenu } from '../MoneyByRace';
import { RetainedEvidence, type ElectionEvidence } from './Evidence';
import type { ElectionSummary, Page, RaceAnswer } from './data';
import * as results from './data';
import * as d from './funderData';
import {
  count,
  dateLabel,
  moneyLabel,
  reportedMoneyLabel,
  pageNumber,
  periodLabel,
} from './format';
import { externalSourcePath, inventoryVersionLabel } from './externalData';
import { reportHref } from './navigation';
import './comparison.css';
import './funders.css';

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
const addressDefaults = {
  fq: '',
  start: '',
  end: '',
  fpage: '1',
  funder: '',
  panel: '',
  fcpage: '1',
  fdpage: '1',
  ffpage: '1',
  fapage: '1',
  fupage: '1',
  fopage: '1',
};
type Address = typeof addressDefaults;
type SetAddress = (value: Partial<Address>) => void;
const paymentGroups: Array<{ metric: d.Metric; page: keyof Address }> = [
  { metric: 'direct_contributions', page: 'fdpage' },
  { metric: 'independent_For', page: 'ffpage' },
  { metric: 'independent_Against', page: 'fapage' },
  { metric: 'independent_unknown', page: 'fupage' },
  { metric: 'other_receipts', page: 'fopage' },
];
const resetPages = {
  fpage: '1',
  fcpage: '1',
  fdpage: '1',
  ffpage: '1',
  fapage: '1',
  fupage: '1',
  fopage: '1',
};
const pins = (value: d.Context): d.Pins => ({
  snapshot_id: value.snapshot_id,
  version: value.version,
});
const name = (funder: d.Funder) => funder.names.join(' / ') || 'Name not reported';
const typeLabel = (funder: d.Funder) =>
  funder.source_family === 'external'
    ? funder.recorded_classifications
        .map((value) => value.recorded_type)
        .filter(Boolean)
        .join(' · ') || 'Filing account'
    : [
        ...new Set(
          funder.recorded_classifications.map((value) =>
            [
              value.category === 'PCF'
                ? 'Political committees and funds'
                : value.category === 'PTU'
                  ? 'Party units'
                  : value.recorded_type,
              value.recorded_subtype,
            ]
              .filter(Boolean)
              .join(' · '),
          ),
        ),
      ].join('; ') || 'Type not reported';

function Notice<T>({
  read,
  children,
  reload,
}: {
  read: Read<T>;
  children: string;
  reload: () => void;
}) {
  if (read.changed)
    return (
      <div className="ec-notice" role="status">
        These records changed{' '}
        <button className="ec-button" onClick={reload}>
          Reload comparison
        </button>
      </div>
    );
  return (
    <>
      {read.loading && <LoadingLine>Loading…</LoadingLine>}
      {read.updating && <Updating />}
      {read.failed && (
        <Refused onRetry={read.retry} retrying={read.pending}>
          {read.busy ? 'Records are busy' : read.data ? 'Couldn’t update results' : children}
        </Refused>
      )}
      {read.notFound && <p>This record is not held</p>}
    </>
  );
}
function Pager({
  page,
  disabled,
  onChange,
  label,
}: {
  page: Page;
  disabled: boolean;
  onChange: (page: number) => void;
  label: string;
}) {
  if (page.total <= page.limit && page.offset === 0) return null;
  const current = Math.floor(page.offset / page.limit) + 1;
  const move = (button: HTMLButtonElement, next: number) => {
    onChange(next);
    const heading = button.closest('section')?.querySelector<HTMLElement>('h2,h3,h4,h5');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView?.({ block: 'start' });
    }
  };
  return (
    <nav className="ec-pager" aria-label={label}>
      <button
        className="ec-button"
        disabled={disabled || current <= 1}
        onClick={(event) => move(event.currentTarget, current - 1)}
      >
        Previous
      </button>
      <span aria-current="page">
        Page {current} of {Math.max(1, Math.ceil(page.total / page.limit))}
      </span>
      <button
        className="ec-button"
        disabled={disabled || !page.has_more}
        onClick={(event) => move(event.currentTarget, current + 1)}
      >
        Next
      </button>
    </nav>
  );
}

function PreviousScope({ context }: { context: d.Context }) {
  return (
    <p className="ec-muted" role="status">
      Showing previous results for {context.filters.q || 'all funders'}
      {' · '}
      {context.filters.start_date
        ? dateLabel(context.filters.start_date)
        : 'Any start date'} to{' '}
      {context.filters.end_date ? dateLabel(context.filters.end_date) : 'Any end date'}
    </p>
  );
}
function Amount({ value }: { value: d.Measure }) {
  const reason = value.withheld_reason
    ? {
        source_specific_reporting_periods: 'Separate report totals',
        source_currency_not_usd: 'Different or unknown currencies',
        overlapping_source_periods: 'Overlapping report periods',
      }[value.withheld_reason]
    : null;
  return (
    <span className="ef-amount">
      <span className="ec-number">
        {value.state === 'no_records' ? 'No records' : moneyLabel(value.amount)}
      </span>
      {reason && <small>{reason}</small>}
      {value.state === 'amount_unavailable' && value.known_amount_subtotal !== null && (
        <small>Known subtotal {moneyLabel(value.known_amount_subtotal)}</small>
      )}
      {value.amount !== null && Number(value.amount) < 0 && <small>Net amount is negative</small>}
    </span>
  );
}
function Counts({ label, value }: { label: string; value: d.OutcomeCounts }) {
  return (
    <div>
      <h4>
        {label} ({count(value.candidacies)})
      </h4>
      <dl className="ef-counts">
        <div>
          <dt>Elected</dt>
          <dd>{count(value.elected)}</dd>
        </div>
        <div>
          <dt>Not elected</dt>
          <dd>{count(value.not_elected)}</dd>
        </div>
        <div>
          <dt>Pending</dt>
          <dd>{count(value.pending)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function Funders({
  election,
  elections,
  raceId,
  backHref,
  onElectionChange,
  onRemoveRace,
}: {
  election: ElectionSummary;
  elections: ElectionSummary[];
  raceId?: string;
  backHref: string;
  onElectionChange: (value: string) => void;
  onRemoveRace: () => void;
}) {
  const location = useLocation();
  const band = useBand();
  const [address, setAddress] = useAddressState(addressDefaults);
  const [generation, setGeneration] = useState(0);
  const [selection, setSelection] = useState<ElectionEvidence | null>(null);
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle');
  const copyScope = useRef('');
  const copyAttempt = useRef(0);
  copyScope.current = location.pathname + location.search;
  useEffect(
    () => () => {
      copyAttempt.current += 1;
    },
    [],
  );
  const scope: d.Scope = {
    race_id: raceId || undefined,
    q: address.fq,
    start_date: address.start || undefined,
    end_date: address.end || undefined,
  };
  const valid =
    address.fq.length <= 200 &&
    !address.fq.includes('\0') &&
    (!address.start || d.inputDate(d.dateInput(address.start)) === address.start) &&
    (!address.end || d.inputDate(d.dateInput(address.end)) === address.end) &&
    !(address.start && address.end && address.start > address.end);
  const firstPath = valid ? d.analyticsPath(election.election_key, 'funders', scope) : null;
  const first = useRead<d.FundersAnswer>(firstPath, {
    keepPrevious: true,
    revision: generation,
  });
  const firstCurrent =
    first.dataPath === firstPath &&
    !first.changed &&
    !first.updating &&
    !first.pending &&
    !first.failed &&
    !first.notFound;
  const offset = (pageNumber(address.fpage) - 1) * d.PAGE_SIZE;
  const pagePath =
    offset && first.data
      ? d.analyticsPath(election.election_key, 'funders', scope, pins(first.data), offset)
      : null;
  const next = useRead<d.FundersAnswer>(pagePath, {
    keepPrevious: true,
    revision: generation,
    enabled: firstCurrent,
  });
  const shown = offset ? next : first;
  const data = shown.data;
  const current =
    !!data &&
    (offset ? shown.dataPath === pagePath : firstCurrent) &&
    !shown.changed &&
    !shown.pending &&
    !shown.failed &&
    firstCurrent;
  const race = useRead<RaceAnswer>(
    raceId ? results.electionRacePath(election.election_key, raceId, election.snapshot_id) : null,
    { revision: generation },
  );
  const [draft, setDraft, apply] = useLiveSearch(
    address.fq,
    location.pathname + location.search,
    (fq) => setAddress({ fq, fpage: '1' }),
  );
  const searchId = useId();
  const reload = () => {
    setSelection(null);
    setGeneration((n) => n + 1);
  };
  useEffect(() => {
    setSelection(null);
    setCopy('idle');
  }, [location.pathname, location.search]);
  const raceHref = (id: string) => {
    const query = new URLSearchParams(reportHref(location, 'comparison').split('?')[1]);
    if (query.get('race') !== id) {
      for (const key of ['reports', 'externalReports', 'pq', 'ppage', 'pay', 'paypage'])
        query.delete(key);
    }
    query.set('race', id);
    query.set('freturn', '?' + reportHref(location, 'funders').split('?')[1]);
    query.delete('source');
    query.delete('list');
    return `${location.pathname}?${query}`;
  };
  async function copyLink() {
    const scopeAtStart = copyScope.current;
    const attempt = ++copyAttempt.current;
    const url = new URL(location.pathname, window.location.origin);
    const keys = new Set([
      'election',
      'race',
      'q',
      'page',
      'list',
      'report',
      'from',
      'fromq',
      ...Object.keys(addressDefaults),
    ]);
    for (const [key, value] of location.searchParams)
      if (keys.has(key)) url.searchParams.append(key, value);
    try {
      await navigator.clipboard.writeText(url.href);
      if (copyScope.current === scopeAtStart && copyAttempt.current === attempt) setCopy('done');
    } catch {
      if (copyScope.current === scopeAtStart && copyAttempt.current === attempt) setCopy('failed');
    }
  }
  return (
    <main id="main" className="f-page ec-page">
      <div className="f-content">
        <div className="mr-back">
          <BackLink to={backHref} name="race comparison" />
        </div>
        <header className="mr-header">
          <h1 className="f-page-title" tabIndex={-1}>
            Funders and election outcomes
          </h1>
          <p className="mr-dek">Compare reported support, opposition and candidate outcomes</p>
        </header>
        <CoverageNotice detailsId="ef-about" />
        <div className="ec-finder">
          <FieldMenu
            name="Election"
            value={election.election_key}
            current={`${election.election_date.slice(0, 4)} ${election.stage} election · ${dateLabel(election.election_date)}`}
            options={elections.map((item) => ({
              value: item.election_key,
              label: `${item.election_date.slice(0, 4)} ${item.stage} election · ${dateLabel(item.election_date)}`,
            }))}
            onChange={onElectionChange}
          />
          <form
            className="ec-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              apply();
            }}
          >
            <label htmlFor={searchId}>Search funders</label>
            <div>
              <input
                id={searchId}
                type="search"
                value={draft}
                placeholder="Name"
                maxLength={200}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button className="ec-search-button">Search</button>
            </div>
          </form>
          <Dates
            start={address.start}
            end={address.end}
            onApply={(start, end) => setAddress({ start, end, ...resetPages })}
          />
        </div>
        {!valid && <p role="alert">Check the search and payment dates</p>}
        {raceId && (
          <section className="ec-section ef-scope">
            <Notice read={race} reload={reload}>
              Couldn’t load race
            </Notice>
            {race.data && (
              <div>
                <h2>{race.data.race.label}</h2>
                <p>{d.resultLabel(race.data.race.result_status)}</p>
              </div>
            )}
            <button className="ec-link" onClick={onRemoveRace}>
              Remove race filter
            </button>
          </section>
        )}
        <div className="ec-actions ef-actions">
          <button className="ec-button" onClick={copyLink}>
            {copy === 'done' ? 'Link copied' : copy === 'failed' ? 'Try again' : 'Copy link'}
          </button>
          {copy === 'failed' && <span role="status">Couldn’t copy link</span>}
          <CsvDownload
            path={
              current && data
                ? d.analyticsPath(election.election_key, 'export', data.filters, pins(data))
                : null
            }
            onChanged={reload}
          />
        </div>
        <section className="ec-section">
          <h2>Funders{data ? ` (${count(data.page.total)})` : ''}</h2>
          <Notice read={shown} reload={reload}>
            Couldn’t load funders
          </Notice>
          {offset > 0 && (
            <Notice read={first} reload={reload}>
              Couldn’t load funders
            </Notice>
          )}
          {data && (
            <>
              {!current && (
                <p className="ec-muted">
                  Showing previous results for {data.filters.q || 'all funders'}
                  {data.filters.start_date || data.filters.end_date
                    ? ` · ${data.filters.start_date ? dateLabel(data.filters.start_date) : 'Any start date'} to ${data.filters.end_date ? dateLabel(data.filters.end_date) : 'Any end date'}`
                    : ''}
                </p>
              )}
              {data.source_scopes && data.source_scopes.mn_cfb.status !== 'available' && (
                <p className="ec-notice">
                  Minnesota Board records unavailable; other filing authorities remain separate
                </p>
              )}
              {data.source_scopes &&
                !['available', 'not_published'].includes(data.source_scopes.external.status) && (
                  <p className="ec-notice">Other filing authority records unavailable</p>
                )}
              {!data.funders.length && <p className="ec-empty">No matches</p>}
              {band === 'computer' && data.funders.length > 0 && (
                <div className="ef-grid ef-head" aria-hidden="true">
                  <span>Funder</span>
                  <span>Type</span>
                  <span>Direct contributions</span>
                  <span>Independent spending for</span>
                  <span>Independent spending against</span>
                </div>
              )}
              <ul className="ef-funders">
                {data.funders.map((funder) => (
                  <li className="ef-funder" key={funder.funder_id}>
                    <div className="ef-grid">
                      <div>
                        <h3>
                          <button
                            className="ec-link"
                            onClick={() =>
                              setAddress({
                                funder: funder.funder_id,
                                panel:
                                  address.funder === funder.funder_id &&
                                  address.panel === 'candidates'
                                    ? ''
                                    : 'candidates',
                                ...resetPages,
                                fpage: address.fpage,
                              })
                            }
                          >
                            {name(funder)}
                          </button>
                        </h3>
                        {funder.registration_number && (
                          <p className="ec-muted">
                            Registration number {funder.registration_number}
                          </p>
                        )}
                      </div>
                      <p className="ef-type">{typeLabel(funder)}</p>
                      {(
                        ['direct_contributions', 'independent_For', 'independent_Against'] as const
                      ).map((metric) => (
                        <div className="ef-measure" key={metric}>
                          <span className={band === 'computer' ? 'f-visually-hidden' : ''}>
                            {d.metricLabels[metric]}
                          </span>
                          <Amount value={funder.amounts[metric]} />
                        </div>
                      ))}
                    </div>
                    <NativeMeasures rows={funder.source_measures ?? []} />
                    <div className="ef-outcomes">
                      <Counts label="Candidates supported" value={funder.supported_outcomes} />
                      <Counts label="Candidates opposed" value={funder.opposed_outcomes} />
                    </div>
                    {funder.support_count_review.state === 'review_negative_records' && (
                      <p className="ec-muted">
                        Positive records count as support even when negative adjustments also
                        appear. Check payments before describing net support.
                      </p>
                    )}
                    <div className="ec-actions">
                      {(['candidates', 'payments'] as const).map((panel) => (
                        <button
                          className="ec-link"
                          key={panel}
                          aria-expanded={
                            address.funder === funder.funder_id && address.panel === panel
                          }
                          onClick={() =>
                            setAddress({
                              funder: funder.funder_id,
                              panel:
                                address.funder === funder.funder_id && address.panel === panel
                                  ? ''
                                  : panel,
                              ...resetPages,
                              fpage: address.fpage,
                            })
                          }
                        >
                          <Caret
                            up={address.funder === funder.funder_id && address.panel === panel}
                          />
                          View {panel}
                        </button>
                      ))}
                    </div>
                    {address.funder === funder.funder_id && address.panel === 'candidates' && (
                      <CandidateList
                        revision={generation}
                        key={`${generation}:${data.version}`}
                        context={data}
                        funder={funder}
                        address={address}
                        setAddress={setAddress}
                        reload={reload}
                        raceHref={raceHref}
                        onEvidence={setSelection}
                      />
                    )}
                    {address.funder === funder.funder_id && address.panel === 'payments' && (
                      <div key={`${generation}:${data.version}`}>
                        {(funder.source_family === 'external'
                          ? [{ page: 'fdpage' as const, metric: undefined }]
                          : paymentGroups
                        ).map((group) => (
                          <Payments
                            revision={generation}
                            key={group.metric ?? 'native'}
                            context={data}
                            funder={funder}
                            group={group}
                            address={address}
                            setAddress={setAddress}
                            reload={reload}
                            onEvidence={setSelection}
                          />
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <Pager
                page={data.page}
                disabled={!current || shown.pending || shown.failed}
                label="Funder pages"
                onChange={(page) => setAddress({ fpage: String(page) })}
              />
            </>
          )}
        </section>
        <section className="ec-section">
          <h2 id="ef-about">About these records</h2>
          <p>
            Direct contributions and independent spending stay separate. For and Against preserve
            the position in the filing.
          </p>
          <p>
            A candidacy is 1 candidate in 1 race. Positive contributions or spending for a candidacy
            count it once as supported. Opposition is counted separately. Outcomes come from checked
            election records; other outcomes stay pending.
          </p>
          <p>
            Payment dates filter itemized payments. They don’t change vote dates or divide a report
            total.
          </p>
          <p>
            Spending and outcomes can be compared. Whether spending changed an outcome requires
            separate evidence.
          </p>
          {data && <p>{data.scope_note}</p>}
        </section>
        {data && (
          <section className="ec-section">
            <h2>Sources and updates</h2>
            {Object.keys(data.sources).length > 0 && <p>{BOARD}</p>}
            <ul className="ef-sources">
              {Object.entries(data.sources).map(([dataset, source]) => (
                <li key={dataset}>
                  <button
                    className="ec-link"
                    onClick={() => setSelection(sourceEvidence(data, dataset))}
                  >
                    {dataset === 'contributions'
                      ? 'Itemized contributions received of over $200'
                      : dataset === 'independent_expenditures'
                        ? 'Itemized independent expenditures of over $200'
                        : 'Committee expenditure records'}
                  </button>
                  {source.copied_at && <span> · Copied {dateLabel(source.copied_at)}</span>}
                </li>
              ))}
            </ul>
            {[...new Set(data.external_sources?.map((source) => source.authority) ?? [])].map(
              (authority) => (
                <p key={authority}>
                  {data.source_scopes?.external.authorities?.find((item) => item.key === authority)
                    ?.name ?? authority}{' '}
                  · Report sources are linked from each payment
                </p>
              ),
            )}
            <p>
              Minnesota Secretary of State · Candidate and election records · Copied{' '}
              {dateLabel(election.copied_at)}
            </p>
          </section>
        )}
        {selection && (
          <RetainedEvidence
            selection={selection}
            onClose={() => setSelection(null)}
            onReload={reload}
          />
        )}
      </div>
    </main>
  );
}

function NativeMeasures({ rows }: { rows: d.NativeMeasure[] }) {
  if (!rows.length) return null;
  return (
    <div className="ef-native-measures">
      <h4>Filing measures</h4>
      <ul>
        {rows.map((row, index) => (
          <li key={`${row.report_key}:${row.measure}:${index}`}>
            <strong>
              {row.label} · {reportedMoneyLabel(row.amount, row.currency)}
            </strong>
            <p className="ec-muted">
              Report {row.source_report_id} · {periodLabel(row.period_start, row.period_end)} ·{' '}
              {count(row.record_count)} records
            </p>
            {row.effective === null ? (
              <p className="ec-muted">Amendments not established; excluded from totals</p>
            ) : row.nonadditive ? (
              <p className="ec-muted">Supplemental memo, not added to spending</p>
            ) : row.effective === false ? (
              <p className="ec-muted">Earlier filing version</p>
            ) : row.attribution !== 'attributed' ? (
              <p className="ec-muted">Excluded from candidate totals; check filing records</p>
            ) : null}
            {inventoryVersionLabel(row) && <p className="ec-muted">{inventoryVersionLabel(row)}</p>}
          </li>
        ))}
      </ul>
      <p className="ec-muted">
        Each filing measure stays separate; overlapping reports are not added
      </p>
    </div>
  );
}

function Dates({
  start,
  end,
  onApply,
}: {
  start: string;
  end: string;
  onApply: (start: string, end: string) => void;
}) {
  const [first, setFirst] = useState(d.dateInput(start));
  const [last, setLast] = useState(d.dateInput(end));
  const [error, setError] = useState('');
  const id = useId();
  useEffect(() => {
    setFirst(d.dateInput(start));
    setLast(d.dateInput(end));
    setError('');
  }, [start, end]);
  return (
    <form
      className="ef-dates"
      onSubmit={(event) => {
        event.preventDefault();
        const a = d.inputDate(first),
          b = d.inputDate(last);
        if (a === null || b === null) {
          setError('Enter a date as MM/DD/YYYY');
          return;
        }
        if (a && b && a > b) {
          setError('Start date is after end date');
          return;
        }
        setError('');
        onApply(a, b);
      }}
    >
      <div className="ec-search">
        <label htmlFor={`${id}-start`}>Start date</label>
        <input
          id={`${id}-start`}
          value={first}
          inputMode="numeric"
          placeholder="MM/DD/YYYY"
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => setFirst(event.target.value)}
        />
      </div>
      <div className="ec-search">
        <label htmlFor={`${id}-end`}>End date</label>
        <input
          id={`${id}-end`}
          value={last}
          inputMode="numeric"
          placeholder="MM/DD/YYYY"
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => setLast(event.target.value)}
        />
      </div>
      <button className="ec-button" type="submit">
        Apply
      </button>
      <button
        className="ec-link"
        type="button"
        disabled={!start && !end}
        onClick={() => onApply('', '')}
      >
        Clear dates
      </button>
      {error && (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function CandidateList({
  revision,
  context,
  funder,
  address,
  setAddress,
  reload,
  raceHref,
  onEvidence,
}: {
  revision: number;
  context: d.Context;
  funder: d.Funder;
  address: Address;
  setAddress: SetAddress;
  reload: () => void;
  raceHref: (race: string) => string;
  onEvidence: (value: ElectionEvidence) => void;
}) {
  const path = d.analyticsPath(
    context.election_key,
    'candidates',
    { ...context.filters, funder_id: funder.funder_id },
    pins(context),
    (pageNumber(address.fcpage) - 1) * d.PAGE_SIZE,
  );
  const read = useRead<d.CandidatesAnswer>(path, {
    keepPrevious: true,
    revision,
  });
  return (
    <section className="ef-detail">
      <h4>Candidate outcomes</h4>
      <Notice read={read} reload={reload}>
        Couldn’t load candidate outcomes
      </Notice>
      {read.data && (
        <>
          {read.dataPath !== path && <PreviousScope context={read.data} />}
          {(['supported', 'opposed'] as const).map((kind) => (
            <div className="ef-candidates" key={kind}>
              <h5>Candidates {kind}</h5>
              <ul>
                {read
                  .data!.candidates.filter((candidate) => candidate[kind])
                  .map((candidate) => (
                    <li key={`${candidate.race_id}:${candidate.candidate_id}`}>
                      <div>
                        <strong>{candidate.name}</strong>
                        <p>
                          {candidate.race_label}
                          {candidate.district ? ` · ${candidate.district}` : ''}
                          {candidate.party ? ` · ${candidate.party}` : ''}
                        </p>
                        <p>
                          {candidate.outcome === 'elected'
                            ? 'Elected'
                            : candidate.outcome === 'not_elected'
                              ? 'Not elected'
                              : 'Pending'}{' '}
                          · {d.resultLabel(candidate.result_status)}
                        </p>
                        {candidate.result_status === 'certified' && !candidate.outcome && (
                          <p className="ec-muted">Outcome not confirmed</p>
                        )}
                      </div>
                      <div className="ec-actions">
                        <Link className="ec-link" to={raceHref(candidate.race_id)}>
                          View race
                        </Link>
                        {candidate.candidate_source_sha256 && (
                          <button
                            className="ec-link"
                            onClick={() =>
                              onEvidence({
                                evidence: {
                                  title: candidate.name,
                                  authority: 'Minnesota Secretary of State',
                                  checked: null,
                                  rows: [
                                    {
                                      label: 'Race',
                                      value: candidate.race_label,
                                    },
                                    ...(candidate.candidate_source_row
                                      ? [
                                          {
                                            label: 'Source',
                                            value: `Record ${candidate.candidate_source_row}`,
                                          },
                                        ]
                                      : []),
                                  ],
                                },
                                attachment: results.electionSourcePath(
                                  read.data!.election_key,
                                  candidate.candidate_source_sha256!,
                                  read.data!.snapshot_id,
                                ),
                              })
                            }
                          >
                            View source
                          </button>
                        )}
                        {candidate.evidence.length > 0 && (
                          <button
                            className="ec-link"
                            onClick={() => {
                              const source = candidate.evidence[0];
                              onEvidence({
                                evidence: {
                                  title: `${candidate.name} · ${candidate.race_label}`,
                                  authority: source.authority || 'Election authority',
                                  checked: null,
                                  rows: [
                                    {
                                      label: 'Election outcome',
                                      value:
                                        candidate.outcome === 'elected'
                                          ? 'Elected'
                                          : candidate.outcome === 'not_elected'
                                            ? 'Not elected'
                                            : 'Pending',
                                    },
                                    {
                                      label: 'Result status',
                                      value: d.resultLabel(candidate.result_status),
                                    },
                                    {
                                      label: 'Copied',
                                      value: dateLabel(source.fetched_at),
                                    },
                                    {
                                      label: 'Source',
                                      value: source.locator.page
                                        ? `Page ${source.locator.page}`
                                        : source.locator.line_start
                                          ? `Line ${source.locator.line_start}`
                                          : 'Retained election record',
                                    },
                                  ],
                                  quote: source.quote,
                                },
                                attachment: results.electionSourcePath(
                                  read.data!.election_key,
                                  source.sha256,
                                  read.data!.snapshot_id,
                                ),
                                pdfPage: source.locator.page,
                              });
                            }}
                          >
                            View outcome source
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
              {!read.data!.candidates.some((candidate) => candidate[kind]) && (
                <p className="ec-muted">No {kind} candidates on this page</p>
              )}
            </div>
          ))}
          <Pager
            page={read.data.page}
            disabled={read.pending || read.failed || read.dataPath !== path}
            onChange={(page) => setAddress({ fcpage: String(page) })}
            label="Candidate outcome pages"
          />
        </>
      )}
    </section>
  );
}

function sourceEvidence(
  context: d.Context,
  dataset: string,
  row?: d.Payment,
  sourceIndex = 0,
): ElectionEvidence {
  const source = context.sources[dataset];
  if (row?.source_family === 'external') {
    const binding = [...(row.source_bindings ?? []), ...(row.version_sources ?? [])][sourceIndex];
    const authority =
      context.source_scopes?.external.authorities?.find((item) => item.key === row.authority)
        ?.name ??
      row.authority ??
      'Filing authority unavailable';
    const copiedAt = binding?.source_copied_at ?? row.source.copied_at;
    return {
      attachment:
        binding && row.external_generation_id
          ? externalSourcePath(
              {
                election_key: context.election_key,
                generation_id: row.external_generation_id,
              },
              binding.source_sha256,
            )
          : null,
      pdfPage: typeof binding?.locator.page === 'number' ? binding.locator.page : undefined,
      evidence: {
        title: `${row.funder_name || row.source_account_id || 'Filing account'} · ${row.source_family === 'external' ? reportedMoneyLabel(row.amount, row.currency) : moneyLabel(row.amount)}`,
        authority,
        quote: binding?.quote,
        rows: [
          {
            label: 'Filing account',
            value: row.source_account_id ?? 'Unavailable',
          },
          { label: 'Report', value: row.source_report_id ?? 'Unavailable' },
          ...(inventoryVersionLabel(row)
            ? [{ label: 'Version', value: inventoryVersionLabel(row)! }]
            : []),
          { label: 'Type', value: row.transaction_type ?? 'Not reported' },
          { label: 'Date', value: dateLabel(row.date) },
          {
            label: 'Amount',
            value:
              row.source_family === 'external'
                ? reportedMoneyLabel(row.amount, row.currency)
                : moneyLabel(row.amount),
          },
          {
            label: 'Reporting period',
            value: periodLabel(row.period_start, row.period_end),
          },
          ...(binding
            ? [
                {
                  label: 'Source location',
                  value: Object.entries(binding.locator)
                    .map(([key, value]) => `${key.replaceAll('_', ' ')} ${value}`)
                    .join(' · '),
                },
              ]
            : []),
          ...(copiedAt ? [{ label: 'Copied', value: dateLabel(copiedAt) }] : []),
          ...(row.nonadditive
            ? [
                {
                  label: 'Status',
                  value: 'Supplemental memo, not added to spending',
                },
              ]
            : []),
        ],
      },
    };
  }
  return {
    evidence: {
      title: row
        ? `${row.funder_name || 'Name not reported'} · ${row.source_family === 'external' ? reportedMoneyLabel(row.amount, row.currency) : moneyLabel(row.amount)}`
        : dataset === 'contributions'
          ? 'Itemized contributions'
          : dataset === 'independent_expenditures'
            ? 'Independent expenditures'
            : 'Committee expenditures',
      authority: BOARD,
      checked: null,
      rows: row
        ? [
            { label: 'Source', value: `Record ${row.row_number}` },
            ...Object.entries(row.fields).map(([label, value]) => ({
              label,
              value:
                value == null || value === ''
                  ? 'Not reported'
                  : /^(amount|unpaid amount)$/i.test(label)
                    ? moneyLabel(String(value))
                    : /^(date|receipt date)$/i.test(label)
                      ? dateLabel(String(value))
                      : String(value),
            })),
          ]
        : [{ label: 'Copied', value: dateLabel(source?.copied_at) }],
    },
    attachment: d.sourcePath(context, dataset),
  };
}
function Payments({
  revision,
  context,
  funder,
  group,
  address,
  setAddress,
  reload,
  onEvidence,
}: {
  revision: number;
  context: d.Context;
  funder: d.Funder;
  group: { metric?: d.Metric; page: keyof Address };
  address: Address;
  setAddress: SetAddress;
  reload: () => void;
  onEvidence: (value: ElectionEvidence) => void;
}) {
  const label = group.metric ? d.metricLabels[group.metric] : 'Filing records';
  const path = d.analyticsPath(
    context.election_key,
    'records',
    { ...context.filters, funder_id: funder.funder_id },
    pins(context),
    (pageNumber(address[group.page]) - 1) * d.PAGE_SIZE,
    { metric: group.metric },
  );
  const read = useRead<d.RecordsAnswer>(path, { keepPrevious: true, revision });
  return (
    <section className="ef-detail">
      <h4>{label}</h4>
      <Notice read={read} reload={reload}>
        Couldn’t load payments
      </Notice>
      {read.data && (
        <>
          {read.dataPath !== path && <PreviousScope context={read.data} />}
          {!read.data.rows.length && <p className="ec-muted">No records</p>}
          <ul className="ef-payments">
            {read.data.rows.map((row) => (
              <li key={row.record_id ?? `${row.dataset}:${row.row_number}`}>
                <div className="ef-payment-heading">
                  <span>{dateLabel(row.date)}</span>
                  <strong className="ec-number">
                    {row.source_family === 'external'
                      ? reportedMoneyLabel(row.amount, row.currency)
                      : moneyLabel(row.amount)}
                  </strong>
                </div>
                <dl>
                  <div>
                    <dt>Candidate or account as filed</dt>
                    <dd>
                      {row.fields['Affected Comte Name'] ??
                        row.fields.Recipient ??
                        row.fields['Target candidate ID'] ??
                        'Not reported'}
                    </dd>
                  </div>
                  <div>
                    <dt>Vendor</dt>
                    <dd>{row.fields['Vendor name'] || 'Not reported'}</dd>
                  </div>
                  <div>
                    <dt>Purpose</dt>
                    <dd>{row.fields.Purpose || 'Not reported'}</dd>
                  </div>
                </dl>
                {row.source_family === 'external' && (
                  <p className="ec-muted">
                    {row.transaction_type} · {periodLabel(row.period_start, row.period_end)}
                  </p>
                )}
                {row.nonadditive && (
                  <p className="ec-muted">Supplemental memo, not added to spending</p>
                )}
                {row.effective === false && (
                  <p className="ec-muted">Earlier filing version, not added to totals</p>
                )}
                {row.effective === null && (
                  <p className="ec-muted">Amendments not established; excluded from totals</p>
                )}
                {row.resolution !== 'attributed' && (
                  <p className="ec-muted">
                    Excluded from candidate totals ·{' '}
                    {(
                      {
                        no_confirmed_account: 'Campaign account not confirmed',
                        missing_date: 'Date not reported',
                        outside_reviewed_period: 'Outside checked account dates',
                        outside_selected_period: 'Outside selected payment dates',
                        conflicting_claims: 'Account matches need checking',
                        amendment_status_not_established: 'Amendments not established',
                      } as Record<string, string>
                    )[row.resolution] || 'Attribution unavailable'}
                  </p>
                )}
                {(row.source_family === 'external'
                  ? [...(row.source_bindings ?? []), ...(row.version_sources ?? [])]
                  : [null]
                ).map((_, index, bindings) => (
                  <button
                    key={index}
                    className="ec-link"
                    onClick={() => onEvidence(sourceEvidence(read.data!, row.dataset, row, index))}
                  >
                    View source{bindings.length > 1 ? ` ${index + 1}` : ''}
                  </button>
                ))}
              </li>
            ))}
          </ul>
          <Pager
            page={read.data.page}
            disabled={read.pending || read.failed || read.dataPath !== path}
            onChange={(page) => setAddress({ [group.page]: String(page) })}
            label={`${label} pages`}
          />
        </>
      )}
    </section>
  );
}
