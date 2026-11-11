import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { useRead, type Read } from '../../api/read';
import { Link, useLocation } from '../../router';
import { returnTarget } from '../../returnContext';
import { hrefFor } from '../../routes';
import { useLiveSearch } from '../../search/useLiveSearch';
import { useAddressState } from '../../ui/addressState';
import { Caret, Refused, Updating } from '../../ui/controls';
import { BackLink, LoadingLine } from '../../ui/parts';
import { formatMoney } from '../../ui/money';
import { useBand } from '../../ui/band';
import { useView, ViewSwitch } from '../../ui/view';
import { FieldMenu } from '../MoneyByRace';
import * as d from './data';
import { RetainedEvidence, type ElectionEvidence } from './Evidence';
import { count, dateLabel, exactMoney, lineLabel, pageNumber, periodLabel } from './format';
import './comparison.css';

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
const SOS = 'Minnesota Secretary of State';
const SIZE = 50;
const defaults = {
  election: '',
  race: '',
  q: '',
  list: '',
  page: '1',
  pq: '',
  ppage: '1',
  pay: '',
  paypage: '1',
  source: '',
};
type Address = typeof defaults;
type PaymentSourceState = {
  source: string;
  version: string;
  state: 'loading' | 'failed' | 'changed' | 'missing' | 'ready';
};
type SetAddress = (changes: Partial<Address>, options?: { replace?: boolean }) => void;
const byVotes = (a: d.ResultCandidate, b: d.ResultCandidate) => (b.votes ?? -1) - (a.votes ?? -1);
const candidateLabel = (candidate: d.ResultCandidate) =>
  candidate.is_write_in_aggregate ? 'Write-in votes' : candidate.name;
const named = (candidate: d.ResultCandidate) => !candidate.is_write_in_aggregate;
const raceName = (race: d.Race) =>
  race.county_name ? `${race.label} · ${race.county_name} County` : race.label;
const electionLabel = (election: d.ElectionSummary) =>
  `${election.election_date.slice(0, 4)} ${election.stage} election · ${dateLabel(election.election_date)}`;
const statusLabel = (status: string) =>
  status === 'unofficial'
    ? 'Unofficial results'
    : status === 'certified'
      ? 'Certified results'
      : 'Result status not available';

function Notice<T>({
  read,
  message,
  reload,
}: {
  read: Read<T>;
  message: string;
  reload?: () => void;
}) {
  if (read.changed)
    return (
      <div className="ec-notice" role="status">
        These records changed
        <button className="ec-button" onClick={reload ?? read.retry}>
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
          {read.data ? 'We couldn’t update these results' : message}
        </Refused>
      )}
      {read.notFound && <p className="ec-empty">This record is not held</p>}
    </>
  );
}

function Pager({
  page,
  onChange,
  disabled = false,
  label,
}: {
  page: d.Page;
  onChange: (page: number) => void;
  disabled?: boolean;
  label: string;
}) {
  if (page.total <= page.limit && page.offset === 0) return null;
  const current = Math.floor(page.offset / page.limit) + 1;
  function move(button: HTMLButtonElement, next: number) {
    onChange(next);
    const scope = button.closest('.ec-payments') ?? button.closest('section');
    const heading = scope?.querySelector<HTMLElement>('h2, h3, h5');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView?.({ block: 'start' });
    }
  }

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

function SearchField({
  label,
  placeholder,
  query,
  here,
  commit,
}: {
  label: string;
  placeholder: string;
  query: string;
  here: string;
  commit: (value: string) => void;
}) {
  const id = useId();
  const [draft, setDraft, apply] = useLiveSearch(query, here, commit);
  return (
    <form
      className="ec-search"
      role="search"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div>
        <input
          id={id}
          type="search"
          autoComplete="off"
          placeholder={placeholder}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="ec-search-button" type="submit">
          Search
        </button>
      </div>
    </form>
  );
}

export function ElectionComparison() {
  const location = useLocation();
  const [address, setAddress] = useAddressState(defaults);
  const elections = useRead<d.ElectionsAnswer>(d.electionsPath(), {
    keepPrevious: true,
  });
  const selected = elections.data?.elections.find((item) => item.election_key === address.election);
  const back = returnTarget(location.search) ?? {
    to: hrefFor('campaign-money'),
    name: 'Campaign money',
  };
  const yearParams = new URLSearchParams(location.search);
  for (const key of [...Object.keys(defaults), 'votesView', 'outView']) yearParams.delete(key);
  const yearHref = `${location.pathname}${yearParams.size ? `?${yearParams}` : ''}`;
  return (
    <main id="main" className="f-page ec-page">
      <div className="f-content">
        <div className="mr-back">
          <BackLink to={back.to} name={back.name} />
        </div>
        <header className="mr-header">
          <h1 tabIndex={-1} className="f-page-title">
            Money by race
          </h1>
          <p className="mr-dek">Compare reported votes with campaign money for the same race</p>
          <Link to={yearHref} className="ec-link">
            View campaign money by year →
          </Link>
        </header>
        <Notice read={elections} message="We couldn’t load elections" />
        {elections.data && (
          <>
            <div className="ec-finder">
              <FieldMenu
                name="Election"
                value={address.election}
                current={selected ? electionLabel(selected) : 'Not held'}
                options={elections.data.elections.map((item) => ({
                  value: item.election_key,
                  label: electionLabel(item),
                }))}
                onChange={(election) =>
                  setAddress(
                    {
                      election,
                      race: '',
                      page: '1',
                      pq: '',
                      ppage: '1',
                      pay: '',
                      paypage: '1',
                      source: '',
                      list: '1',
                    },
                    { replace: false },
                  )
                }
              />
              <SearchField
                label="Search races"
                placeholder="Office or district"
                query={address.q}
                here={location.pathname + location.search}
                commit={(q) => setAddress({ q, page: '1', list: '1' })}
              />
            </div>
            {!selected && <p className="ec-empty">This election is not held</p>}
            {selected && (
              <ElectionBody
                key={selected.election_key}
                election={selected}
                address={address}
                setAddress={setAddress}
                refreshResults={elections.retry}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}

function ElectionBody({
  election,
  address,
  setAddress,
  refreshResults,
}: {
  election: d.ElectionSummary;
  address: Address;
  setAddress: SetAddress;
  refreshResults: () => void;
}) {
  const location = useLocation();
  const showList = !address.race || address.list === '1';
  const races = useRead<d.RacesAnswer>(
    showList
      ? d.electionRacesPath(election.election_key, {
          snapshotId: election.snapshot_id,
          query: address.q,
          offset: (pageNumber(address.page) - 1) * SIZE,
          limit: SIZE,
        })
      : null,
    { keepPrevious: true },
  );
  const selectedRead = useRead<d.RaceAnswer>(
    address.race
      ? d.electionRacePath(election.election_key, address.race, election.snapshot_id)
      : null,
  );
  const reloadResults = () => {
    refreshResults();
    races.retry();
    selectedRead.retry();
  };
  function raceHref(id: string) {
    const params = new URLSearchParams(location.search);
    params.set('race', id);
    for (const key of ['list', 'pq', 'ppage', 'pay', 'paypage', 'source']) params.delete(key);
    return `${location.pathname}?${params}`;
  }
  const list = showList && (
    <section className="ec-section" aria-labelledby="ec-races-heading">
      <h2 id="ec-races-heading">Races{races.data ? ` (${count(races.data.page.total)})` : ''}</h2>
      <Notice read={races} message="We couldn’t load races" />
      {races.data && (
        <>
          {races.data.query !== address.q && (
            <p className="ec-muted">
              Showing results for {races.data.query || 'all races'} while the search updates
            </p>
          )}
          {races.data.races.length === 0 && <p className="ec-empty">No matches</p>}
          <ul className="ec-races">
            {races.data.races.map((race) => (
              <li key={race.id}>
                <Link
                  to={raceHref(race.id)}
                  aria-current={race.id === address.race ? 'page' : undefined}
                >
                  {raceName(race)}
                </Link>
              </li>
            ))}
          </ul>
          <Pager
            label="Race pages"
            page={races.data.page}
            disabled={races.pending || races.failed}
            onChange={(page) => setAddress({ page: String(page) })}
          />
        </>
      )}
    </section>
  );
  return (
    <>
      {list}
      {address.race && (
        <Notice
          read={selectedRead}
          message="We couldn’t load election results"
          reload={reloadResults}
        />
      )}
      {selectedRead.data && (
        <RaceComparison
          key={`${election.election_key}:${address.race}:${selectedRead.data.snapshot_id}`}
          detail={selectedRead.data}
          address={address}
          setAddress={setAddress}
          refreshResults={reloadResults}
        />
      )}
    </>
  );
}

function RaceComparison({
  detail,
  address,
  setAddress,
  refreshResults,
}: {
  detail: d.RaceAnswer;
  address: Address;
  setAddress: SetAddress;
  refreshResults: () => void;
}) {
  const { race } = detail;
  const location = useLocation();
  const [revision, setRevision] = useState(0);
  const finance = useRead<d.ElectionFinanceAnswer>(
    d.electionFinancePath(detail.election_key, race.id, {
      snapshotId: detail.snapshot_id,
    }),
    { revision, keepPrevious: true },
  );
  const precincts = useRead<d.PrecinctsAnswer>(
    d.electionPrecinctsPath(detail.election_key, race.id, {
      snapshotId: detail.snapshot_id,
      query: address.pq,
      offset: (pageNumber(address.ppage) - 1) * SIZE,
      limit: SIZE,
    }),
    { revision, keepPrevious: true },
  );
  const [votesView, setVotesView] = useView('votesView');
  const [outView, setOutView] = useView('outView');
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle');
  const [paymentEvidence, setPaymentEvidence] = useState<{
    version: string;
    row: d.PaymentRecord;
  } | null>(null);
  const [paymentSourceState, setPaymentSourceState] = useState<PaymentSourceState | null>(null);
  const closeEvidence = useCallback(() => setAddress({ source: '' }), [setAddress]);
  const reload = () => {
    setRevision((value) => value + 1);
    setPaymentEvidence(null);
    setPaymentSourceState(null);
    refreshResults();
  };
  const data = finance.data;
  const restorePayment = useCallback(
    (row: d.PaymentRecord) => {
      if (!data) return;
      setPaymentEvidence((previous) =>
        previous?.version === data.version && previous.row.row_number === row.row_number
          ? previous
          : { version: data.version, row },
      );
    },
    [data],
  );
  const campaignOK = data?.report_availability.state === 'available';
  const outsideOK = data?.outside_spending_availability.state === 'available';
  const candidates = data?.candidates.filter(named).sort(byVotes) ?? [];
  const latestReports = candidates
    .flatMap((c) =>
      c.accounts.map((a) => a.reports?.find((r) => r.report_key === a.latest_report.report_key)),
    )
    .filter((r): r is d.FinancialReport => !!r);
  const periodLines = new Set(latestReports.map(reportPeriod));
  const sharedPeriod =
    latestReports.length > 0 && periodLines.size === 1 ? [...periodLines][0] : null;
  const voteTotal = race.total_votes;
  const sortedCandidates = [...race.candidates].sort(byVotes);
  const selectSource = (source: string) => setAddress({ source });
  const selection = evidenceFor(
    address.source,
    detail,
    data,
    precincts.data,
    paymentEvidence && paymentEvidence.version === data?.version ? paymentEvidence.row : null,
    selectSource,
  );
  async function copyLink() {
    const params = new URLSearchParams(location.search);
    for (const key of [...params.keys()])
      if (![...Object.keys(defaults), 'votesView', 'outView'].includes(key)) params.delete(key);
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${location.pathname}?${params}`,
      );
      setCopy('done');
    } catch {
      setCopy('failed');
    }
  }
  return (
    <>
      <div className="ec-race-heading">
        <div>
          <h2>{raceName(race)}</h2>
          <p>
            {detail.stage[0].toUpperCase() + detail.stage.slice(1)} election ·{' '}
            {dateLabel(detail.election_date)}
          </p>
          <strong>{statusLabel(race.result_status)}</strong>
        </div>
        <div className="ec-copy">
          <button className="ec-button" onClick={() => void copyLink()}>
            {copy === 'done' ? 'Link copied' : copy === 'failed' ? 'Try again' : 'Copy link'}
          </button>
          <span
            className={copy === 'done' ? 'ec-sr-only' : undefined}
            role={copy === 'failed' ? 'alert' : 'status'}
          >
            {copy === 'failed' ? 'Couldn’t copy link' : copy === 'done' ? 'Link copied' : ''}
          </span>
        </div>
      </div>
      <section className="ec-section" aria-labelledby="ec-votes">
        <div className="ec-section-heading">
          <h3 id="ec-votes">Reported votes</h3>
          <div className="ec-actions">
            <button className="ec-link" onClick={() => selectSource('votes')}>
              View source
            </button>
            <ViewSwitch label="Reported votes view" value={votesView} onChange={setVotesView} />
          </div>
        </div>
        {votesView === 'chart' ? (
          <div className="ec-card">
            <ul className="ec-votes">
              {sortedCandidates.map((c, i) => (
                <li key={c.candidate_id ?? i}>
                  <div>
                    <span>
                      <strong>{candidateLabel(c)}</strong>
                      {c.party && !c.is_write_in_aggregate && (
                        <span className="ec-muted"> · {c.party}</span>
                      )}
                    </span>
                    <span className="ec-number">
                      <strong>{count(c.votes)}</strong>
                      {c.votes != null && voteTotal != null && voteTotal > 0 && (
                        <span className="ec-muted">
                          {' '}
                          · {((100 * c.votes) / voteTotal).toFixed(2)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="ec-vote-track" aria-hidden="true">
                    <span
                      style={{
                        width: `${c.votes != null && voteTotal != null && voteTotal > 0 ? Math.max(0, Math.min(100, (c.votes / voteTotal) * 100)) : 0}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <div className="ec-total">
              <strong>Total</strong>
              <strong className="ec-number">{count(voteTotal)}</strong>
            </div>
          </div>
        ) : (
          <div className="ec-table-wrap">
            <table className="ec-table">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Party</th>
                  <th>Votes</th>
                  <th>Share of votes</th>
                </tr>
              </thead>
              <tbody>
                {sortedCandidates.map((c, i) => (
                  <tr key={c.candidate_id ?? i}>
                    <th scope="row">{candidateLabel(c)}</th>
                    <td>{c.is_write_in_aggregate ? '' : (c.party ?? 'Not reported')}</td>
                    <td className="ec-number">{count(c.votes)}</td>
                    <td className="ec-number">
                      {c.votes != null && voteTotal != null && voteTotal > 0
                        ? `${((100 * c.votes) / voteTotal).toFixed(2)}%`
                        : 'Not available'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>
                    Total
                  </th>
                  <td className="ec-number">{count(voteTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {race.seats_to_elect && race.seats_to_elect > 1 && (
          <p className="ec-muted">
            {!/\bElect\s+\d+\b/i.test(race.label) && <>Elect {race.seats_to_elect} · </>}
            Shares use votes cast for candidates, not the number of voters
          </p>
        )}
        {race.diagnostics.length > 0 && (
          <p className="ec-warning">
            In {count(race.diagnostics.length)} precinct records, votes for this race exceed the
            separately reported number of voters. The reported figures are preserved; affected
            precincts are marked.
          </p>
        )}
      </section>
      <section className="ec-section" aria-labelledby="ec-campaign">
        <div className="ec-section-heading">
          <h3 id="ec-campaign">Campaign money</h3>
          {sharedPeriod && <span className="ec-muted ec-period">{sharedPeriod}</span>}
        </div>
        <Notice read={finance} message="We couldn’t load campaign money" reload={reload} />
        {data && !campaignOK && (
          <Refused onRetry={finance.retry} retrying={finance.pending}>
            We couldn’t load campaign money
          </Refused>
        )}
        {campaignOK && (
          <div className="ec-candidates">
            {candidates.map((candidate) => (
              <article className="ec-card" key={candidate.candidate_id}>
                <h4>{candidate.name}</h4>
                {!candidate.accounts.length && (
                  <p className="ec-muted">
                    {candidate.report_state === 'not_collected'
                      ? candidate.finance_coverage.authority === 'federal'
                        ? 'Federal campaign reports have not been collected'
                        : 'Local campaign reports have not been collected'
                      : 'No confirmed campaign account for this candidacy'}
                  </p>
                )}
                {candidate.account_gaps.length > 0 && (
                  <p className="ec-muted">
                    {count(candidate.account_gaps.length)} account relationship
                    {candidate.account_gaps.length === 1 ? '' : 's'} excluded from this comparison
                    because the identity, sources or period is not confirmed
                  </p>
                )}
                {candidate.accounts.map((account) => (
                  <AccountCard
                    key={account.decision_id}
                    account={account}
                    sharedPeriod={sharedPeriod}
                    onSource={selectSource}
                  />
                ))}
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="ec-section" aria-labelledby="ec-outside">
        <div className="ec-section-heading">
          <h3 id="ec-outside">Spending by outside groups</h3>
          <div className="ec-actions">
            <span className="ec-muted">Independent expenditures for this contest</span>
            <ViewSwitch label="Outside spending view" value={outView} onChange={setOutView} />
          </div>
        </div>
        {finance.loading && <LoadingLine>Loading…</LoadingLine>}
        {(finance.failed || (data && !outsideOK)) && (
          <Refused onRetry={finance.retry} retrying={finance.pending}>
            We couldn’t load outside spending
          </Refused>
        )}
        {outsideOK && data && (
          <>
            {candidates
              .filter((c) => !c.accounts.length)
              .map((c) => (
                <p key={c.candidate_id} className="ec-empty">
                  <strong>{candidateLabel(c)}</strong> · No confirmed outside-spending records for
                  this candidacy
                </p>
              ))}
            {candidates.map((c) => {
              const missingDate = c.outside_spending.excluded_missing_date?.record_count ?? 0;
              const missingYear = c.outside_spending.excluded_missing_year?.record_count ?? 0;
              return missingDate || missingYear ? (
                <p key={c.candidate_id} className="ec-muted">
                  {c.name}: {count(missingDate)} payment records with no date and{' '}
                  {count(missingYear)} with no reported year are excluded because their reporting
                  period cannot be confirmed
                </p>
              ) : null;
            })}
            {(['PCF', 'PTU', 'other'] as const).map((category) => (
              <OutsideGroup
                key={category}
                category={category}
                revision={revision}
                data={data}
                detail={detail}
                view={outView}
                address={address}
                setAddress={setAddress}
                onRestore={restorePayment}
                onSourceState={setPaymentSourceState}
                onRecord={(row) => {
                  setPaymentEvidence({ version: data.version, row });
                  selectSource(`payment:${row.row_number}`);
                }}
                reload={reload}
              />
            ))}
            {candidates.some(
              (candidate) =>
                candidate.outside_spending.excluded_outside_reviewed_period?.record_count,
            ) && (
              <section className="ec-outside-group" aria-labelledby="ec-excluded">
                <h4 id="ec-excluded">Payments outside checked dates</h4>
                {candidates.map((candidate) => {
                  const excluded = candidate.outside_spending.excluded_outside_reviewed_period;
                  if (!excluded?.record_count || !candidate.candidate_id) return null;
                  const key = `${candidate.candidate_id}:excluded`;
                  const open = address.pay === key;
                  return (
                    <article className="ec-card" key={key}>
                      <h5>{candidate.name}</h5>
                      <p className="ec-muted">
                        {count(excluded.record_count)}{' '}
                        {excluded.record_count === 1
                          ? 'payment record names'
                          : 'payment records name'}{' '}
                        the linked account.{' '}
                        {excluded.record_count === 1 ? 'This payment is' : 'These payments are'}{' '}
                        excluded from this candidate’s totals.
                      </p>
                      <button
                        className="ec-link"
                        aria-expanded={open}
                        onClick={() =>
                          setAddress({
                            pay: open ? '' : key,
                            paypage: '1',
                            source: '',
                          })
                        }
                      >
                        <Caret up={open} />
                        View excluded payments · {count(excluded.record_count)}
                      </button>
                      {open && (
                        <Payments
                          key={`${key}:${data.version}`}
                          detail={detail}
                          data={data}
                          candidateId={candidate.candidate_id}
                          scope="outside_reviewed_period"
                          revision={revision}
                          page={pageNumber(address.paypage)}
                          onPage={(page) => setAddress({ paypage: String(page), source: '' })}
                          onRecord={(row) => {
                            setPaymentEvidence({ version: data.version, row });
                            selectSource(`payment:${row.row_number}`);
                          }}
                          source={address.source}
                          onRestore={restorePayment}
                          onSourceState={setPaymentSourceState}
                          reload={reload}
                        />
                      )}
                    </article>
                  );
                })}
              </section>
            )}
            <p className="ec-footnote">
              Outside spending is reported by the spender. For and Against preserve the position in
              that filing.
            </p>
          </>
        )}
      </section>
      <section className="ec-section" aria-labelledby="ec-precincts">
        <h3 id="ec-precincts">
          Results by precinct
          {precincts.data ? ` (${count(precincts.data.page.total)})` : ''}
        </h3>
        <SearchField
          label="Search precincts"
          placeholder="Precinct name"
          query={address.pq}
          here={location.pathname + location.search}
          commit={(pq) => setAddress({ pq, ppage: '1' })}
        />
        <Notice read={precincts} message="We couldn’t load precinct results" />
        {precincts.data && (
          <>
            {precincts.data.query !== address.pq && (
              <p className="ec-muted">
                Showing results for {precincts.data.query || 'all precincts'} while the search
                updates
              </p>
            )}
            {precincts.data.precincts.length === 0 && <p className="ec-empty">No matches</p>}
            <PrecinctResults
              race={race}
              precincts={precincts.data.precincts}
              onSource={selectSource}
            />
            <Pager
              label="Precinct pages"
              page={precincts.data.page}
              disabled={precincts.pending || precincts.failed}
              onChange={(page) => setAddress({ ppage: String(page) })}
            />
          </>
        )}
      </section>
      <section className="ec-section ec-about" aria-labelledby="ec-about">
        <h3 id="ec-about">About these records</h3>
        <p>
          Results and campaign reports can cover different periods. Read the dates beside each
          figure before comparing.
        </p>
        <p>
          Spending and election outcomes are shown together. These records alone do not show whether
          spending changed an outcome.
        </p>
        <p>
          Outside spending shown here comes from itemized reports to the Minnesota Campaign Finance
          and Public Disclosure Board. Candidate campaign reports may be filed with a different
          authority.
        </p>
      </section>
      <section className="ec-sources">
        <h3>Sources and updates</h3>
        <p>
          <strong>{SOS}</strong> · Copied {dateLabel(detail.copied_at)}
        </p>
        <ul>
          {detail.sources
            .filter((source) =>
              [
                race.source_sha256,
                race.summary_source_sha256,
                race.candidate_source_sha256,
              ].includes(source.sha256),
            )
            .map((source) => (
              <li key={source.sha256}>
                <button
                  className="ec-link"
                  onClick={() => selectSource(`result-file:${source.sha256}`)}
                >
                  {source.file ?? 'Election source'}
                </button>
              </li>
            ))}
        </ul>
        {(data?.copied_at || data?.payment_source) && (
          <p>
            <strong>{BOARD}</strong>
          </p>
        )}
        {data?.copied_at && <p>Campaign reports · Copied {dateLabel(data.copied_at)}</p>}
        {data?.payment_source?.copied_at && (
          <p>Outside spending · Copied {dateLabel(data.payment_source.copied_at)}</p>
        )}
        {data?.payment_source && (
          <button className="ec-link" onClick={() => selectSource('outside-file')}>
            All - Itemized Independent Expenditures Of Over $200 - Campaign Finance.csv
          </button>
        )}
      </section>
      {address.source && (
        <RetainedEvidence
          key={`${address.source}:${data?.version ?? ''}`}
          selection={
            selection ?? {
              evidence: {
                title: 'Source evidence',
                authority: '',
                rows: [
                  {
                    label: 'Availability',
                    value:
                      finance.loading || precincts.loading
                        ? 'Loading source evidence…'
                        : address.source.startsWith('payment:') && address.pay
                          ? paymentSourceState?.source !== address.source ||
                            paymentSourceState.version !== data?.version ||
                            paymentSourceState.state === 'loading'
                            ? 'Loading payment evidence…'
                            : paymentSourceState.state === 'failed'
                              ? 'We couldn’t load this payment source'
                              : paymentSourceState.state === 'changed'
                                ? 'These records changed'
                                : 'This payment is not held on the selected page'
                          : 'This source is not held in the current comparison',
                  },
                ],
              },
              attachment: null,
              children:
                address.source.startsWith('payment:') &&
                paymentSourceState?.source === address.source &&
                (paymentSourceState.state === 'failed' ||
                  paymentSourceState.state === 'changed') ? (
                  <button className="ec-button" onClick={reload}>
                    Reload comparison
                  </button>
                ) : undefined,
            }
          }
          onClose={closeEvidence}
          onReload={reload}
        />
      )}
    </>
  );
}

function reportPeriod(report: d.FinancialReport) {
  return `${report.filing.report_name} · ${periodLabel(report.period_start, report.period_end)}${report.received_date ? ` · Received ${dateLabel(report.received_date)}` : ''}`;
}

function emptyPosition(
  category: d.SpenderType,
  direction: d.SpendingDirection,
): d.CategorySpending {
  return {
    category,
    direction,
    state: 'no_records',
    record_count: 0,
    amount: null,
    known_amount_subtotal: null,
    missing_amount_count: 0,
    included_unpaid_amount: null,
    known_unpaid_subtotal: null,
    missing_unpaid_count: 0,
    missing_date_count: 0,
    missing_year_count: 0,
    date_year_conflict_count: 0,
    date_coverage: 'no_records',
    first_known_date: null,
    last_known_date: null,
  };
}

function PrecinctResults({
  race,
  precincts,
  onSource,
}: {
  race: d.Race;
  precincts: d.Precinct[];
  onSource: (value: string) => void;
}) {
  const band = useBand();
  const [scrolled, setScrolled] = useState(false);
  const total = (precinct: d.Precinct) =>
    precinct.rows.length && precinct.rows.every((r) => r.votes != null)
      ? precinct.rows.reduce((sum, r) => sum + r.votes!, 0)
      : null;
  const note = (precinct: d.Precinct) =>
    precinct.diagnostics.length > 0 && (
      <p className="ec-warning">Reported votes exceed the separately reported voter count</p>
    );
  const source = (precinct: d.Precinct) => (
    <button className="ec-link" onClick={() => onSource(`precinct:${precinct.key}`)}>
      View source<span className="ec-sr-only"> for {precinct.name}</span>
    </button>
  );
  if (band === 'phone')
    return (
      <div className="ec-precincts">
        {precincts.map((precinct) => (
          <article className="ec-precinct" key={precinct.key}>
            <div>
              <h4>{precinct.name}</h4>
              <p className="ec-muted">
                {precinct.county_name ?? precinct.county} County · Precinct {precinct.key}
              </p>
              {note(precinct)}
            </div>
            <dl>
              {precinct.rows.map((row) => (
                <div key={row.row_number}>
                  <dt>{row.candidate_name}</dt>
                  <dd className="ec-number">{count(row.votes)}</dd>
                </div>
              ))}
              <div>
                <dt>Total votes</dt>
                <dd className="ec-number">{count(total(precinct))}</dd>
              </div>
            </dl>
            {source(precinct)}
          </article>
        ))}
      </div>
    );
  return (
    <div
      className="ec-table-wrap"
      tabIndex={0}
      role="region"
      aria-label="Precinct results"
      data-scrolled={scrolled || undefined}
      onScroll={(event) => setScrolled(event.currentTarget.scrollLeft > 0)}
    >
      <table className="ec-table ec-precinct-table">
        <thead>
          <tr>
            <th scope="col">Precinct</th>
            <th scope="col">County</th>
            {race.candidates.map((c, i) => (
              <th scope="col" key={c.candidate_order_code ?? i}>
                <span className={c.is_write_in_aggregate ? 'ec-number' : undefined}>{c.name}</span>
              </th>
            ))}
            <th scope="col">Total votes</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {precincts.map((precinct) => (
            <tr key={precinct.key}>
              <th scope="row">
                <span className="ec-precinct-name">{precinct.name}</span>
                <span className="ec-muted ec-precinct-id">{precinct.key}</span>
                {note(precinct)}
              </th>
              <td>{precinct.county_name ?? precinct.county}</td>
              {race.candidates.map((candidate, i) => {
                const matches = precinct.rows.filter(
                  (r) =>
                    candidate.candidate_order_code != null &&
                    r.candidate_order_code === candidate.candidate_order_code,
                );
                return (
                  <td className="ec-number" key={candidate.candidate_order_code ?? i}>
                    {count(matches.length === 1 ? matches[0].votes : null)}
                  </td>
                );
              })}
              <td className="ec-number">{count(total(precinct))}</td>
              <td>{source(precinct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function AccountCard({
  account,
  sharedPeriod,
  onSource,
}: {
  account: d.CheckedAccount;
  sharedPeriod: string | null;
  onSource: (source: string) => void;
}) {
  const [filingsOpen, setFilingsOpen] = useState(false);
  const filingsId = useId();
  const report = account.reports?.find(
    (item) => item.report_key === account.latest_report.report_key,
  );
  const figures = account.latest_report.figures;
  return (
    <div className="ec-account">
      <strong>{account.committee_name ?? 'Campaign account'}</strong>
      <p className="ec-muted">
        Registration number {account.registration_number} · Checked {dateLabel(account.checked_on)}
      </p>
      <button
        className="ec-link"
        onClick={() => onSource(`account:${account.registration_number}:0`)}
      >
        View account sources
      </button>
      {report && !sharedPeriod && <p className="ec-period ec-muted">{reportPeriod(report)}</p>}
      {!figures && (
        <p className="ec-empty">
          {account.latest_report.state === 'ambiguous_latest_report'
            ? 'The latest report is not resolved'
            : 'No report figures held for this account and period'}
        </p>
      )}
      {figures && report && (
        <div className="ec-measures">
          {(
            [
              ['Contributions received', figures.contributions_received],
              ['Campaign spending', figures.campaign_expenditures],
            ] as const
          ).map(([label, measure]) => (
            <div key={label}>
              <h5>{label}</h5>
              <dl className="ec-amounts">
                <dt>Cash</dt>
                <dd>{exactMoney(measure.cash)}</dd>
                <dt>In-kind</dt>
                <dd>{exactMoney(measure.in_kind)}</dd>
                {'unpaid' in measure && (
                  <>
                    <dt>Unpaid</dt>
                    <dd>{exactMoney(measure.unpaid)}</dd>
                  </>
                )}
                <dt className="ec-sum">Total</dt>
                <dd className="ec-sum">{exactMoney(measure.total)}</dd>
              </dl>
              <button
                className="ec-link"
                onClick={() =>
                  onSource(`report:${account.registration_number}:${report.report_key}`)
                }
              >
                View report <span className="ec-muted">· Page {measure.source_page}</span>
              </button>
            </div>
          ))}
        </div>
      )}
      {(account.reports?.length ?? 0) > 1 && (
        <div className="ec-report-history">
          <button
            className="ec-link"
            aria-expanded={filingsOpen}
            aria-controls={filingsId}
            onClick={() => setFilingsOpen(!filingsOpen)}
          >
            <Caret up={filingsOpen} />
            Available filings ({account.reports!.length})
          </button>
          <ul id={filingsId} hidden={!filingsOpen}>
            {account.reports!.map((r) => (
              <li key={r.report_key}>
                <button
                  className="ec-link"
                  onClick={() => onSource(`report:${account.registration_number}:${r.report_key}`)}
                >
                  {r.filing.report_name} · Through {dateLabel(r.filing.cut_off_date)}
                </button>
                <p className="ec-muted">
                  {r.figures ? 'Report figures available' : 'Report figures not held'}
                  {r.filing.amendment_count != null
                    ? ` · ${r.filing.amendment_count} filed version${r.filing.amendment_count === 1 ? '' : 's'}`
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function OutsideGroup({
  revision,
  category,
  data,
  detail,
  view,
  address,
  setAddress,
  onRecord,
  onRestore,
  onSourceState,
  reload,
}: {
  category: d.SpenderType;
  revision: number;
  data: d.ElectionFinanceAnswer;
  detail: d.RaceAnswer;
  view: 'chart' | 'table';
  address: Address;
  setAddress: SetAddress;
  onRecord: (row: d.PaymentRecord) => void;
  onRestore: (row: d.PaymentRecord) => void;
  onSourceState: (state: PaymentSourceState) => void;
  reload: () => void;
}) {
  const rows = data.candidates
    .filter((candidate) => named(candidate) && candidate.accounts.length)
    .sort(byVotes)
    .flatMap((candidate) => {
      const groups = candidate.outside_spending.groups ?? [];
      const directions: d.SpendingDirection[] =
        category === 'other'
          ? groups.filter((g) => g.category === category).map((g) => g.direction)
          : [
              'For',
              'Against',
              ...(groups.some((g) => g.category === category && g.direction === 'unknown')
                ? ['unknown' as const]
                : []),
            ];
      return directions.map((direction) => ({
        candidate,
        group:
          groups.find((g) => g.category === category && g.direction === direction) ??
          emptyPosition(category, direction),
        key: `${candidate.candidate_id}:${category}:${direction}`,
      }));
    });
  const firstBar = rows.find((row) => row.group.state !== 'no_records')?.key;
  const maximum = Math.max(
    1,
    ...rows.map(({ group }) => Math.max(0, Number(d.reportedAmount(group) ?? 0))),
  );
  if (!rows.length || (category === 'other' && !rows.some((r) => r.group.record_count)))
    return null;
  const title =
    category === 'PCF'
      ? 'Political committees and funds'
      : category === 'PTU'
        ? 'Party units'
        : 'Other filed spender types';
  return (
    <div className="ec-outside-group">
      <h4>{title}</h4>
      <div className="ec-outside-card">
        {rows.map(({ candidate, group, key }) => {
          const position = `${group.direction === 'unknown' ? 'Position not specified' : group.direction} ${candidate.name}`;
          const amount = d.reportedAmount(group);
          const open = address.pay === key;
          const info: ReactNode = (
            <>
              <span className="ec-number">
                {amount == null
                  ? group.state === 'no_records'
                    ? 'No payments within the checked account dates'
                    : 'Amount not available'
                  : formatMoney(amount)}
              </span>
              {amount != null && Number(amount) < 0 && (
                <span className="ec-muted">Net amount is negative</span>
              )}
              {group.first_known_date && (
                <span className="ec-muted">
                  Payments dated{' '}
                  <span className="ec-date">{dateLabel(group.first_known_date)}</span> to{' '}
                  <span className="ec-date">{dateLabel(group.last_known_date)}</span>
                </span>
              )}
              {group.date_coverage === 'incomplete' && (
                <span className="ec-muted">
                  Some payment dates are missing or differ from the reported year
                </span>
              )}
              {group.included_unpaid_amount != null &&
                Number(group.included_unpaid_amount) !== 0 && (
                  <span className="ec-muted">
                    Includes {formatMoney(group.included_unpaid_amount)} unpaid
                  </span>
                )}
            </>
          );
          return (
            <div className="ec-outside-row" key={key}>
              {group.state === 'no_records' ? (
                <p>
                  <strong>{position}</strong> ·{' '}
                  {category === 'PTU'
                    ? 'No party-unit payments within the checked account dates'
                    : 'No payments within the checked account dates'}
                </p>
              ) : (
                <>
                  {view === 'chart' ? (
                    <div>
                      <strong>{position}</strong>
                      <div className="ec-outside-chart">
                        <div>
                          {key === firstBar && (
                            <div className="ec-split-labels" aria-hidden="true">
                              <span>Against</span>
                              <span>For</span>
                            </div>
                          )}
                          <div className="ec-split" aria-hidden="true">
                            <span>
                              <i
                                style={{
                                  width:
                                    group.direction === 'Against'
                                      ? `${(Math.max(0, Number(amount ?? 0)) / maximum) * 100}%`
                                      : '0%',
                                }}
                              />
                            </span>
                            <b />
                            <span>
                              <i
                                style={{
                                  width:
                                    group.direction === 'For'
                                      ? `${(Math.max(0, Number(amount ?? 0)) / maximum) * 100}%`
                                      : '0%',
                                }}
                              />
                            </span>
                          </div>
                        </div>
                        <span className="ec-outside-meta">{info}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="ec-outside-table">
                      <strong>{position}</strong>
                      <span className="ec-outside-meta">{info}</span>
                    </div>
                  )}
                  <button
                    className="ec-link"
                    aria-expanded={open}
                    onClick={() =>
                      setAddress({
                        pay: open ? '' : key,
                        paypage: '1',
                        source: '',
                      })
                    }
                  >
                    <Caret up={open} />
                    View payments · {count(group.record_count)}{' '}
                    {group.record_count === 1 ? 'payment' : 'payments'}
                  </button>
                  {open && candidate.candidate_id && (
                    <Payments
                      key={`${key}:${data.version}`}
                      detail={detail}
                      data={data}
                      candidateId={candidate.candidate_id}
                      category={category}
                      revision={revision}
                      direction={group.direction}
                      page={pageNumber(address.paypage)}
                      onPage={(page) => setAddress({ paypage: String(page), source: '' })}
                      onRecord={onRecord}
                      source={address.source}
                      onRestore={onRestore}
                      onSourceState={onSourceState}
                      reload={reload}
                    />
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Payments({
  revision,
  scope = 'attributed',
  detail,
  data,
  candidateId,
  category,
  direction,
  page,
  onPage,
  onRecord,
  source,
  onRestore,
  onSourceState,
  reload,
}: {
  detail: d.RaceAnswer;
  data: d.ElectionFinanceAnswer;
  candidateId: string;
  category?: d.SpenderType;
  direction?: d.SpendingDirection;
  scope?: 'attributed' | 'outside_reviewed_period';
  revision: number;
  page: number;
  onPage: (page: number) => void;
  onRecord: (record: d.PaymentRecord) => void;
  source: string;
  onRestore: (record: d.PaymentRecord) => void;
  onSourceState: (state: PaymentSourceState) => void;
  reload: () => void;
}) {
  const read = useRead<d.CandidateOutsideRecordsAnswer>(
    d.candidateOutsideRecordsPath(detail.election_key, detail.race.id, candidateId, {
      snapshotId: detail.snapshot_id,
      version: data.version,
      spenderType: category,
      direction,
      scope,
      limit: SIZE,
      offset: (page - 1) * SIZE,
    }),
    { revision },
  );
  useEffect(() => {
    const row = read.data?.rows.find((item) => source === `payment:${item.row_number}`);
    if (row) onRestore(row);
    if (source.startsWith('payment:'))
      onSourceState({
        source,
        version: data.version,
        state: read.changed
          ? 'changed'
          : read.failed
            ? 'failed'
            : read.loading
              ? 'loading'
              : row
                ? 'ready'
                : 'missing',
      });
  }, [
    read.data,
    read.changed,
    read.failed,
    read.loading,
    source,
    data.version,
    onRestore,
    onSourceState,
  ]);
  return (
    <div className="ec-payments">
      <h5>Payments</h5>
      <Notice read={read} message="We couldn’t load payments" reload={reload} />
      {read.data && (
        <>
          <ul>
            {read.data.rows.map((row) => (
              <li key={row.row_number}>
                <span>
                  <span className="ec-date">{dateLabel(row.fields.Date)}</span> ·{' '}
                  <strong>{row.fields.Spender ?? 'Spender not reported'}</strong> ·{' '}
                  <span className="ec-number">{exactMoney(row.fields.Amount)}</span>
                  {scope === 'outside_reviewed_period' && (
                    <span className="ec-muted">
                      {' '}
                      ·{' '}
                      {row.fields['Spender type'] === 'PTU'
                        ? 'Party unit'
                        : row.fields['Spender type'] === 'PCF'
                          ? 'Political committee or fund'
                          : (row.fields['Spender type'] ?? 'Filer type not reported')}{' '}
                      · {row.fields['For /Against'] ?? 'Position not reported'}
                    </span>
                  )}
                </span>
                <button className="ec-link" onClick={() => onRecord(row)}>
                  View source
                </button>
              </li>
            ))}
          </ul>
          <Pager
            label="Payment pages"
            page={read.data.page}
            onChange={onPage}
            disabled={read.pending || read.failed}
          />
        </>
      )}
    </div>
  );
}

const PAYMENT_LABELS: Record<string, string> = {
  Spender: 'Filer',
  'Spender Reg Num': 'Filer registration number',
  'Spender type': 'Filer type',
  'Spender sub-type': 'Filer subtype',
  'Affected Comte Name': 'Candidate account as filed',
  'Affected Cmte Reg Num': 'Candidate account registration number',
  'For /Against': 'Position',
  Year: 'Reported year',
  'Unpaid amount': 'Included unpaid amount',
  'In kind?': 'In-kind',
  'In kind descr': 'In-kind description',
  'Vendor name': 'Vendor',
  'Vendor city': 'Vendor city',
  'Vendor State': 'Vendor state',
  'Vendor zip': 'Vendor ZIP',
};

function evidenceFor(
  source: string,
  detail: d.RaceAnswer,
  finance: d.ElectionFinanceAnswer | null,
  precincts: d.PrecinctsAnswer | null,
  payment: d.PaymentRecord | null,
  onSource: (source: string) => void,
): ElectionEvidence | null {
  if (!source) return null;
  if (source === 'votes') {
    const hash = detail.race.summary_source_sha256 ?? detail.race.source_sha256;
    if (!hash) return null;
    return {
      evidence: {
        title: 'Reported votes',
        authority: SOS,
        rows: [
          { label: 'Race', value: raceName(detail.race) },
          {
            label: 'Election',
            value: `${dateLabel(detail.election_date)} · ${detail.stage}`,
          },
          { label: 'Office ID', value: detail.race.office_id },
          {
            label: 'Result status',
            value: statusLabel(detail.race.result_status),
          },
          { label: 'Copied', value: dateLabel(detail.copied_at) },
        ],
        quote: detail.race.candidates.map((c) => `${c.name}: ${count(c.votes)}`).join('\n'),
        quoteLabel: 'REPORTED VOTES',
        checked: 'Not checked',
      },
      attachment: d.electionSourcePath(detail.election_key, hash, detail.snapshot_id),
    };
  }
  if (source.startsWith('precinct:')) {
    const precinct = precincts?.precincts.find((p) => p.key === source.slice(9));
    if (!precinct) return null;
    const numbers = precinct.rows.map((r) => r.row_number);
    const start = Math.min(...numbers),
      end = Math.max(...numbers);
    return {
      evidence: {
        title: precinct.name,
        authority: SOS,
        rows: [
          { label: 'Race', value: raceName(detail.race) },
          { label: 'County', value: precinct.county_name ?? precinct.county },
          { label: 'County ID', value: precinct.county },
          { label: 'Precinct ID', value: precinct.key.split(':').at(-1)! },
          { label: 'Source location', value: lineLabel(numbers) },
          {
            label: 'Result status',
            value: statusLabel(detail.race.result_status),
          },
        ],
        checked: 'Not checked',
      },
      attachment: d.electionSourcePath(
        detail.election_key,
        precinct.source_sha256,
        detail.snapshot_id,
      ),
      lines: d.electionSourceLinesPath(
        detail.election_key,
        precinct.source_sha256,
        detail.snapshot_id,
        { start, limit: Math.min(100, end - start + 1) },
      ),
      selectedLines: numbers,
    };
  }
  if (source.startsWith('result-file:')) {
    const item = detail.sources.find((item) => item.sha256 === source.slice(12));
    return item
      ? {
          evidence: {
            title: item.file ?? 'Election source',
            authority: SOS,
            rows: [
              {
                label: 'Copied',
                value: dateLabel(item.fetched_at ?? detail.copied_at),
              },
            ],
          },
          attachment: d.electionSourcePath(detail.election_key, item.sha256, detail.snapshot_id),
        }
      : null;
  }
  if (!finance) return null;
  if (source === 'outside-file')
    return {
      evidence: {
        title: 'Itemized independent expenditures',
        authority: BOARD,
        rows: [
          {
            label: 'Copied',
            value: dateLabel(finance.payment_source?.copied_at),
          },
          {
            label: 'Record numbering',
            value: 'Logical records, header excluded',
          },
        ],
      },
      attachment: finance.payment_release_id
        ? d.spendingSourcePath(
            detail.election_key,
            detail.snapshot_id,
            finance.payment_version,
            finance.payment_release_id,
          )
        : null,
    };
  if (source.startsWith('payment:') && payment && source === `payment:${payment.row_number}`) {
    const fields = payment.fields;
    return {
      evidence: {
        title: 'Outside spending payment',
        authority: BOARD,
        rows: Object.entries(fields).map(([label, value]) => ({
          label: PAYMENT_LABELS[label] ?? label,
          value: value == null ? 'Not reported' : String(value),
        })),
        quoteLabel: 'SOURCE RECORD',
        quote: `Record ${payment.row_number}`,
        checked:
          payment.resolution === 'outside_checked_period'
            ? 'Outside checked account dates; excluded from candidate totals'
            : 'Account relationship and reporting period checked',
      },
      attachment: finance.payment_release_id
        ? d.spendingSourcePath(
            detail.election_key,
            detail.snapshot_id,
            finance.payment_version,
            finance.payment_release_id,
          )
        : null,
    };
  }
  const [kind, registration, key] = source.split(':');
  const account = finance.candidates
    .flatMap((c) => c.accounts)
    .find((a) => a.registration_number === registration);
  if (!account) return null;
  if (kind === 'report') {
    const [filingsOpen, setFilingsOpen] = useState(false);
    const filingsId = useId();
    const report = account.reports?.find((r) => r.report_key === key);
    if (!report) return null;
    return {
      evidence: {
        title: report.filing.report_name,
        authority: BOARD,
        rows: [
          {
            label: 'Committee',
            value: account.committee_name ?? `Registration ${registration}`,
          },
          { label: 'Registration number', value: registration },
          {
            label: 'Reporting period',
            value: periodLabel(report.period_start, report.period_end),
          },
          { label: 'Received', value: dateLabel(report.received_date) },
          {
            label: 'Filed versions',
            value: count(report.filing.amendment_count),
          },
          {
            label: 'Effective amendment',
            value: count(report.filing.effective_amendment_index),
          },
          {
            label: 'Availability',
            value: report.document_hash
              ? report.figures
                ? 'Report and figures held'
                : 'Report held; figures not attributed to this candidacy and period'
              : 'Report listed; original document not held',
          },
        ],
        page: '2',
        checked: `Checked ${dateLabel(account.checked_on)}`,
      },
      attachment:
        report.document_hash && finance.collection_id
          ? d.financeReportSourcePath(
              detail.election_key,
              report.document_hash,
              finance.collection_id,
            )
          : null,
      pdfPage: 2,
    };
  }
  if (kind === 'account') {
    const item = account.evidence[Number(key)];
    if (!item) return null;
    const attachment =
      item.kind === 'ballot'
        ? d.electionSourcePath(detail.election_key, item.sha256, detail.snapshot_id)
        : item.kind === 'report_cover' && finance.collection_id
          ? d.financeReportSourcePath(detail.election_key, item.sha256, finance.collection_id)
          : d.accountEvidencePath(item);
    return {
      evidence: {
        title: 'Campaign account sources',
        authority: item.kind === 'ballot' ? SOS : BOARD,
        rows: [
          { label: 'Registration number', value: registration },
          { label: 'Source', value: item.kind.replaceAll('_', ' ') },
          {
            label: 'Location',
            value:
              item.locator ??
              (item.page
                ? `Page ${item.page}`
                : item.row_number
                  ? `Line ${item.row_number}`
                  : 'Original source'),
          },
          {
            label: 'Checked period',
            value: periodLabel(account.period_start, account.period_end),
          },
        ],
        checked: `Checked ${dateLabel(account.checked_on)}`,
      },
      attachment,
      pdfPage: item.kind === 'report_cover' ? 1 : undefined,
      children: (
        <div className="ec-evidence-choices">
          {account.evidence.map((e, i) => (
            <button
              key={i}
              className="ec-link"
              aria-pressed={i === Number(key)}
              onClick={() => onSource(`account:${registration}:${i}`)}
            >
              {e.kind.replaceAll('_', ' ')}
              {e.kind === 'candidate_identity' ? ` ${i + 1}` : ''}
            </button>
          ))}
        </div>
      ),
    };
  }
  return null;
}
