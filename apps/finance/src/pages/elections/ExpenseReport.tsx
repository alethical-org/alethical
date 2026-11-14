import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useRead, type Read } from '../../api/read';
import { requestTimeoutMs } from '../../api/client';
import { useFinanceSession } from '../../auth/session';
import { useLocation } from '../../router';
import { useLiveSearch } from '../../search/useLiveSearch';
import { useAddressState } from '../../ui/addressState';
import { Caret, Refused, Updating } from '../../ui/controls';
import { BackLink, LoadingLine } from '../../ui/parts';
import { useBand } from '../../ui/band';
import { FieldMenu } from '../MoneyByRace';
import { RetainedEvidence, type ElectionEvidence } from './Evidence';
import { CoverageNotice } from './CoverageNotice';
import { electionSourcePath, electionSourceLinesPath } from './data';
import {
  count,
  dateLabel,
  lineLabel,
  moneyLabel,
  reportedMoneyLabel,
  pageNumber,
  periodLabel,
} from './format';
import * as d from './expenseReportData';
import { accountIdentity, externalSourcePath, coverageLabel } from './externalData';
import { AuthorityFigures, AuthorityComparisons, authorityEvidence } from './expenseExternal';
import './comparison.css';
import './expenseReport.css';

/** The race page owns navigation and election choice; this isolated view owns
 * only expense-prefixed address state. It never changes identity/source review. */
export interface ExpenseReportProps {
  electionKey: string;
  raceId?: string;
  raceLabel?: string;
  backHref: string;
  elections?: ReadonlyArray<{ value: string; label: string }>;
  onElectionChange?: (election: string) => void;
  onRemoveRace?: () => void;
}
const defaults = {
  expenseQuery: '',
  expenseReports: '',
  expenseExcluded: '',
  expenseCandidate: '',
  expenseCandidatePage: '1',
  expensePayeePage: '1',
  expensePaymentsPage: '1',
  expensePayeeQuery: '',
  expenseSearchPage: '1',
  expensePayee: '',
  expenseSource: '',
};
type Address = typeof defaults;
type SetAddress = (changes: Partial<Address>, options?: { replace?: boolean }) => void;
const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
const SOS = 'Minnesota Secretary of State';
const partyOrder: d.Party[] = ['R', 'DFL', 'NP', 'other', 'unknown'];
const paymentSourceKey = (payment: d.Payment, data: d.ExpenseAnswer) =>
  `payment:${data.version}:${payment.report_key}:${payment.record_id}`;
const payeeSourceKey = (payee: d.Payee, data: d.ExpenseAnswer) =>
  `payee:${data.version}:${payee.payee_id ?? payee.report_keys.join(',')}`;
const partySourceKey = (account: d.AccountReport, claim: d.Claim, source: d.PartySource) =>
  `party:${account.report_key}:${d.claimKey(claim)}:${source.source_sha256}:${source.row_number ?? ''}`;
const EvidenceRestore = createContext<{
  sourceKey: string;
  rememberPayee: (payee: d.Payee, data: d.ExpenseAnswer) => void;
  rememberPayment: (payment: d.Payment, data: d.ExpenseAnswer) => void;
}>({ sourceKey: '', rememberPayee: () => {}, rememberPayment: () => {} });
const pins = (answer: d.ExpenseAnswer | null) =>
  answer ? { snapshot_id: answer.snapshot_id, version: answer.version } : null;
const position = (value: string) => (pageNumber(value) - 1) * d.PAGE_SIZE;
const byName = (a: d.Claim, b: d.Claim) =>
  a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()) ||
  a.name.localeCompare(b.name) ||
  d.claimKey(a).localeCompare(d.claimKey(b));

function Notice({
  read,
  message,
  reload,
}: {
  read: Read<d.ExpenseAnswer>;
  message: string;
  reload: () => void;
}) {
  return (
    <>
      {read.loading && <LoadingLine>Loading…</LoadingLine>}
      {read.updating && <Updating />}
      {read.changed ? (
        <div className="ec-notice" role="status">
          These records changed{' '}
          <button className="ec-link" onClick={reload}>
            Reload comparison
          </button>
        </div>
      ) : (
        read.failed && (
          <Refused onRetry={read.retry} retrying={read.pending}>
            {read.busy ? 'Records are busy' : read.data ? 'Couldn’t update results' : message}
          </Refused>
        )
      )}
      {read.notFound && <p className="ec-empty">These records are not held</p>}
    </>
  );
}
function Scope({ read, path }: { read: Read<d.ExpenseAnswer>; path: string | null }) {
  if (!read.data || read.dataPath === path) return null;
  return (
    <p className="ex-retained" role="status">
      Showing previous report scope · {dateLabel(read.data.election_date)}
      {read.data.filters.candidate_query
        ? ` · Candidates matching “${read.data.filters.candidate_query}”`
        : ''}
      {read.data.filters.payee_query ? ` · Payees matching “${read.data.filters.payee_query}”` : ''}{' '}
      ·{' '}
      {read.data.filters.selected_only || read.data.filters.report_keys?.length
        ? 'Selected reports'
        : 'Latest available reports'}
    </p>
  );
}
function Pager({ page, move }: { page: d.ExpenseAnswer['page']; move: (value: string) => void }) {
  if (page.total <= page.limit && page.offset === 0) return null;
  return (
    <nav className="ec-pager" aria-label="Result pages">
      <button
        className="ec-button"
        disabled={!page.offset}
        onClick={(event) => {
          move(String(Math.max(1, Math.floor(page.offset / page.limit))));
          focusList(event.currentTarget);
        }}
      >
        Previous
      </button>
      <span>
        Page {Math.floor(page.offset / page.limit) + 1} of{' '}
        {Math.max(1, Math.ceil(page.total / page.limit))}
      </span>
      <button
        className="ec-button"
        disabled={page.offset + page.limit >= page.total}
        onClick={(event) => {
          move(String(Math.floor(page.offset / page.limit) + 2));
          focusList(event.currentTarget);
        }}
      >
        Next
      </button>
    </nav>
  );
}
function focusList(button: HTMLButtonElement) {
  const heading = button.closest('section')?.querySelector<HTMLElement>('h2,h3,h4,h5');
  heading?.focus({ preventScroll: true });
  heading?.scrollIntoView?.({ block: 'start' });
}
function Search({
  label,
  value,
  commit,
  here,
  placeholder = 'Name',
}: {
  label: string;
  value: string;
  commit: (value: string) => void;
  here: string;
  placeholder?: string;
}) {
  const id = useId();
  const [draft, setDraft, apply] = useLiveSearch(value, here, commit, (text) => text);
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
          maxLength={200}
          value={draft}
          autoComplete="off"
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="ec-search-button" type="submit">
          Search
        </button>
      </div>
    </form>
  );
}
function Money({
  value,
  covered,
  total,
  unit = 'accounts',
  accountCoverage,
  note,
}: {
  value: string | null | undefined;
  covered?: number;
  total?: number;
  unit?: 'accounts' | 'candidates';
  accountCoverage?: { covered: number; total: number };
  note?: ReactNode;
}) {
  return (
    <span className="ex-figure">
      <strong>{moneyLabel(value)}</strong>
      {note && <small>{note}</small>}
      {value != null &&
        ((covered != null && total != null && covered < total) ||
          (accountCoverage && accountCoverage.covered < accountCoverage.total)) && (
          <small>
            Known subtotal
            <br />
            {covered != null && total != null && covered < total && (
              <>
                Covers {count(covered)} of {count(total)} {unit}
                <br />
              </>
            )}
            {accountCoverage && accountCoverage.covered < accountCoverage.total && (
              <>
                Covers {count(accountCoverage.covered)} of {count(accountCoverage.total)} accounts
              </>
            )}
          </small>
        )}
    </span>
  );
}
function Metrics({ values }: { values: Array<[string, ReactNode]> }) {
  return (
    <dl className="ex-metrics">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function sourceLocation(source: d.SourceLocation) {
  return source.locator
    ? Object.entries(source.locator)
        .map(([key, value]) => `${key.replaceAll('_', ' ')} ${value}`)
        .join(' · ')
    : `${source.page ? `Page ${source.page}` : 'Page not held'}${source.line ? `, line ${source.line}` : ''}`;
}
function amountEntries(
  amounts: d.Amounts | null,
  reported?: d.ReportedAmount[],
): Array<[string, ReactNode]> {
  return amounts
    ? [
        ['Amount', <Money value={amounts.total} />],
        ['Paid', <Money value={amounts.paid} />],
        ['Unpaid', <Money value={amounts.unpaid} />],
        ['In-kind', <Money value={amounts.in_kind} />],
      ]
    : (reported ?? []).map((item) => [
        `${item.label} · ${periodLabel(item.period_start, item.period_end)}`,
        <span className="ex-number">{reportedMoneyLabel(item.amount, item.currency)}</span>,
      ]);
}
function paymentEntries(payment: d.Payment): Array<[string, ReactNode]> {
  return payment.amounts
    ? amountEntries(payment.amounts)
    : [
        [
          payment.measure_label ?? 'Reported amount',
          <span className="ex-number">
            {reportedMoneyLabel(payment.reported_amount, payment.currency)}
          </span>,
        ],
        ['Filing authority', payment.authority_name ?? 'Unavailable'],
        ['Reporting period', periodLabel(payment.period_start, payment.period_end)],
        ...(payment.nonadditive
          ? [['Status', 'Supplemental memo, not added to spending'] as [string, ReactNode]]
          : []),
      ];
}
function ReportedValues({ values }: { values?: d.ReportedAmount[] }) {
  return values?.length ? (
    <span className="ex-reported-values">
      {values.map((item, index) => (
        <span key={`${item.report_key}:${item.measure}:${item.basis}:${index}`}>
          <strong>{reportedMoneyLabel(item.amount, item.currency)}</strong>
          <small>
            {item.label} · {periodLabel(item.period_start, item.period_end)}
          </small>
        </span>
      ))}
    </span>
  ) : (
    <>Unavailable</>
  );
}

export function ExpenseReport({
  electionKey,
  raceId,
  raceLabel,
  backHref,
  elections,
  onElectionChange,
  onRemoveRace,
}: ExpenseReportProps) {
  const location = useLocation();
  const [address, setAddress] = useAddressState(defaults);
  const [revision, setRevision] = useState(0);
  const [copy, setCopy] = useState<'ready' | 'copying' | 'done' | 'failed'>('ready');
  const reports = d.exactKeys(address.expenseReports, 500);
  const exclusions = d.exactKeys(address.expenseExcluded, 200);
  const valid =
    reports !== null &&
    exclusions !== null &&
    d.validQuery(address.expenseQuery) &&
    d.validQuery(address.expensePayeeQuery);
  const query: d.ExpenseQuery = {
    race_id: raceId,
    report_keys: reports ?? [],
    selected_only: !!reports?.length,
    excluded_payee_ids: exclusions ?? [],
  };
  const baselinePath = valid ? d.expensePath(electionKey, '', query) : null;
  const report = useRead<d.ExpenseAnswer>(baselinePath, {
    keepPrevious: true,
    revision,
  });
  const baseline = report.data;
  const externalReportCount =
    baseline?.coverage.external_selected_account_reports ??
    baseline?.authority_reports?.length ??
    0;
  const current =
    !!baseline &&
    report.dataPath === baselinePath &&
    !report.failed &&
    !report.changed &&
    !report.pending;
  const queryText = address.expenseQuery;
  const matchingKeys = baseline
    ? d.scopedReportKeys(baseline, reports ?? [], (claim) =>
        claim.name.toLocaleLowerCase().includes(queryText.toLocaleLowerCase()),
      )
    : [];
  const candidateQuery: d.ExpenseQuery = {
    race_id: raceId,
    report_keys: matchingKeys,
    selected_only: !!reports?.length,
    candidate_query: queryText,
  };
  const candidateSeedPath =
    current && queryText ? d.expensePath(electionKey, '', candidateQuery) : null;
  const candidateSeed = useRead<d.ExpenseAnswer>(candidateSeedPath, {
    keepPrevious: true,
    revision,
  });
  const candidateSeedCurrent =
    candidateSeed.dataPath === candidateSeedPath && !candidateSeed.failed && !candidateSeed.pending;
  const candidatePage = position(address.expenseCandidatePage);
  const candidatePins = queryText
    ? candidateSeedCurrent
      ? pins(candidateSeed.data)
      : null
    : current
      ? pins(baseline)
      : null;
  const candidatePagePath =
    candidatePage && candidatePins
      ? d.expensePath(
          electionKey,
          '',
          queryText ? candidateQuery : query,
          candidatePins,
          candidatePage,
        )
      : null;
  const candidatePageRead = useRead<d.ExpenseAnswer>(candidatePagePath, {
    keepPrevious: true,
    revision,
  });
  const candidates = candidatePage ? candidatePageRead : queryText ? candidateSeed : report;
  const candidatesPath = candidatePage
    ? candidatePagePath
    : queryText
      ? candidateSeedPath
      : baselinePath;
  const payeeSearchPath =
    current && queryText
      ? d.expensePath(
          electionKey,
          'payees',
          { ...query, excluded_payee_ids: [], payee_query: queryText },
          pins(baseline),
          position(address.expenseSearchPage),
        )
      : null;
  const payeeSearch = useRead<d.ExpenseAnswer>(payeeSearchPath, {
    keepPrevious: true,
    revision,
  });
  const [paymentSource, setPaymentSource] = useState<{
    key: string;
    payment: d.Payment;
    data: d.ExpenseAnswer;
  } | null>(null);
  const [openReport, setOpenReport] = useState<string | null>(null);
  const sourceKey = address.expenseSource;
  const [payeeSource, setPayeeSource] = useState<{
    key: string;
    evidence: ElectionEvidence;
  } | null>(null);
  const rememberPayment = useCallback((payment: d.Payment, data: d.ExpenseAnswer) => {
    const key = paymentSourceKey(payment, data);
    setPaymentSource((previous) => (previous?.key === key ? previous : { key, payment, data }));
  }, []);
  const rememberPayee = useCallback(
    (payee: d.Payee, data: d.ExpenseAnswer) => {
      const key = payeeSourceKey(payee, data);
      setPayeeSource((previous) =>
        previous?.key === key
          ? previous
          : {
              key,
              evidence: {
                ...payeeEvidence(data, payee),
                children: (
                  <div className="ex-source-reports">
                    {data.account_reports
                      .filter((account) => payee.report_keys.includes(account.report_key))
                      .map((account) => (
                        <button
                          className="ec-link"
                          key={account.report_key}
                          onClick={() =>
                            setAddress({
                              expenseSource: `report:${account.report_key}`,
                            })
                          }
                        >
                          View report · Account {account.registration_number} ·{' '}
                          {account.filing.report_name}
                        </button>
                      ))}
                  </div>
                ),
              },
            },
      );
    },
    [setAddress],
  );
  useEffect(() => {
    setPaymentSource(null);
    setPayeeSource(null);
  }, [baseline?.election_key, baseline?.snapshot_id, baseline?.collection_id, baseline?.version]);
  const sourceAccount = baseline?.account_reports.find(
    (account) => sourceKey === `report:${account.report_key}`,
  );
  const subsidyOverview = baseline?.account_reports.find(
    (account) =>
      sourceKey === `subsidy-overview:${account.report_key}` && account.public_subsidy_comparison,
  );
  const externalSource = baseline?.authority_reports?.find((account) =>
    sourceKey.startsWith(`external-report:${account.report_key}:`),
  );
  const partySource = baseline?.account_reports
    .flatMap((account) =>
      account.claims.flatMap((claim) =>
        (claim.party_sources ?? []).map((source) => ({
          account,
          claim,
          source,
        })),
      ),
    )
    .find(({ account, claim, source }) => sourceKey === partySourceKey(account, claim, source));
  const selection =
    current && baseline
      ? sourceAccount
        ? reportEvidence(
            baseline,
            sourceAccount,
            (claim, source) =>
              setAddress({
                expenseSource: partySourceKey(sourceAccount, claim, source),
              }),
            () => setAddress({ expenseSource: `subsidy-overview:${sourceAccount.report_key}` }),
          )
        : subsidyOverview
          ? subsidyOverviewEvidence(baseline, subsidyOverview)
          : partySource
            ? partyEvidence(baseline, partySource.claim, partySource.source)
            : externalSource
              ? authorityEvidence(baseline, externalSource, sourceKey)
              : paymentSource?.key === sourceKey
                ? paymentEvidence(paymentSource.data, paymentSource.payment)
                : payeeSource?.key === sourceKey
                  ? payeeSource.evidence
                  : null
      : null;
  const reload = useCallback(() => {
    setRevision((value) => value + 1);
    setAddress({ expenseSource: '' });
    setPaymentSource(null);
  }, [setAddress]);
  useEffect(() => {
    setCopy('ready');
    setOpenReport(null);
  }, [location.href]);
  const download = useCsvDownload(
    current && baseline
      ? d.expensePath(electionKey, 'export', { ...query, search_query: queryText }, pins(baseline))
      : null,
  );
  async function copyLink() {
    setCopy('copying');
    const href = d.copyExpenseLink(location);
    try {
      await navigator.clipboard.writeText(href);
      if (window.location.href === location.href) setCopy('done');
    } catch {
      if (window.location.href === location.href) setCopy('failed');
    }
  }
  const groups = baseline ? d.optionGroups(baseline) : [];
  const selectedReports = reports?.join(',') || '';
  const periodChoice = selectedReports
    ? (groups.find(
        (group) => [...group.keys].sort().join(',') === [...(reports ?? [])].sort().join(','),
      )?.label ?? 'Selected reports')
    : 'Latest available reports';
  const changeScope = (changes: Partial<Address>) =>
    setAddress({
      ...changes,
      expenseCandidate: '',
      expenseCandidatePage: '1',
      expensePayeePage: '1',
      expensePaymentsPage: '1',
      expenseSearchPage: '1',
      expensePayee: '',
      expenseSource: '',
    });
  const showPayment = (payment: d.Payment, data: d.ExpenseAnswer) => {
    rememberPayment(payment, data);
    setAddress({ expenseSource: paymentSourceKey(payment, data) });
  };
  const showPayee = (payee: d.Payee, data: d.ExpenseAnswer) => {
    rememberPayee(payee, data);
    setAddress({ expenseSource: payeeSourceKey(payee, data) });
  };
  return (
    <EvidenceRestore.Provider value={{ sourceKey, rememberPayee, rememberPayment }}>
      <main className="f-page ec-page ex-page">
        <div className="f-content">
          <BackLink to={backHref} name="race comparison" />
          <header className="ex-heading">
            <h1>Campaign expense report</h1>
            <p>Compare candidate spending, public subsidies and reported payee locations</p>
          </header>
          <CoverageNotice detailsId="ex-about" />
          <div className="ec-finder ex-finder">
            {elections && onElectionChange ? (
              <FieldMenu
                name="Election"
                value={electionKey}
                current={
                  elections.find((election) => election.value === electionKey)?.label ?? electionKey
                }
                options={elections}
                onChange={(key) => {
                  changeScope({
                    expenseReports: '',
                    expenseExcluded: '',
                    expenseQuery: '',
                  });
                  onElectionChange(key);
                }}
              />
            ) : (
              <div className="ex-static-field">
                <span>Election</span>
                <strong>
                  {baseline
                    ? `${baseline.election_date.slice(0, 4)} general election · ${dateLabel(baseline.election_date)}`
                    : 'Election records'}
                </strong>
              </div>
            )}
            <FieldMenu
              name="Reporting period"
              value={selectedReports}
              current={periodChoice}
              options={[
                { value: '', label: 'Latest available reports' },
                ...groups.map((group) => ({
                  value: group.keys.join(','),
                  label: group.label,
                })),
              ]}
              onChange={(value) => changeScope({ expenseReports: value, expenseExcluded: '' })}
            />
            <Search
              label="Search candidates or payees"
              value={queryText}
              here={location.href}
              commit={(value) => changeScope({ expenseQuery: value })}
            />
          </div>
          {raceId && (
            <div className="ex-scope">
              <h2>{raceLabel || 'Selected race'}</h2>
              {onRemoveRace && (
                <button
                  className="ec-link"
                  onClick={() => {
                    changeScope({ expenseReports: '', expenseExcluded: '' });
                    onRemoveRace();
                  }}
                >
                  Remove race filter
                </button>
              )}
            </div>
          )}
          {!valid && (
            <p role="alert" className="ec-notice">
              This report link has an invalid search or selection{' '}
              <button
                className="ec-link"
                onClick={() =>
                  changeScope({
                    expenseQuery: '',
                    expensePayeeQuery: '',
                    expenseReports: '',
                    expenseExcluded: '',
                  })
                }
              >
                Clear filters
              </button>
            </p>
          )}
          <div className="ex-actions">
            <div>
              <button
                className="ec-button"
                data-done={copy === 'done' || undefined}
                disabled={copy === 'copying'}
                onClick={() => void copyLink()}
              >
                {copy === 'done' ? 'Link copied' : copy === 'failed' ? 'Try again' : 'Copy link'}
              </button>
              <p role="status">
                {copy === 'done' ? (
                  <span className="ex-sr-only">Link copied</span>
                ) : copy === 'failed' ? (
                  'Couldn’t copy link'
                ) : copy === 'copying' ? (
                  <span className="ex-sr-only">Copying…</span>
                ) : (
                  ''
                )}
              </p>
            </div>
            <div>
              <button
                className="ec-button"
                disabled={!current || download.pending}
                onClick={download.run}
              >
                {download.pending
                  ? 'Preparing download…'
                  : download.failed
                    ? 'Try again'
                    : 'Download CSV'}
              </button>
              <p role="status">
                {download.changed ? (
                  <span>
                    These records changed{' '}
                    <button className="ec-link" onClick={reload}>
                      Reload comparison
                    </button>
                  </span>
                ) : download.failed ? (
                  'Couldn’t download report'
                ) : download.done ? (
                  <span className="ex-sr-only">Download started</span>
                ) : (
                  ''
                )}
              </p>
            </div>
          </div>
          <Scope read={report} path={baselinePath} />
          <Notice read={report} message="Couldn’t load party comparison" reload={reload} />
          {baseline && (
            <>
              <PartyComparison
                data={baseline}
                enabled={current}
                showReport={(key) => setAddress({ expenseSource: `report:${key}` })}
              />
              <section className="ec-section ex-locations">
                <h2>Payee locations</h2>
                <Exclusions
                  data={baseline}
                  query={query}
                  enabled={current}
                  applyRead={report}
                  address={address}
                  setAddress={changeScope}
                  revision={revision}
                  reload={reload}
                />
                <LocationComparison data={baseline} />
              </section>
            </>
          )}
          {!baseline && (
            <>
              <section className="ec-section">
                <h2>Party comparison</h2>
              </section>
              <section className="ec-section ex-locations">
                <h2>Payee locations</h2>
                <Notice read={report} message="Couldn’t load payee locations" reload={reload} />
              </section>
            </>
          )}
          {baseline && <AuthorityComparisons data={baseline} />}
          <section className="ec-section ex-candidates">
            <h2 tabIndex={-1}>
              Candidates
              {candidates.data ? ` (${count(candidates.data.page.total)})` : ''}
            </h2>
            <Scope read={candidates} path={candidatesPath} />
            {(candidates !== report || !baseline) && (
              <Notice read={candidates} message="Couldn’t load candidates" reload={reload} />
            )}
            {candidates.data && (
              <>
                {candidates.data.candidates?.length ? (
                  <div
                    className={`ex-candidate-list${candidates.data.authority_reports?.length ? ' ex-mixed-authorities' : ''}`}
                  >
                    <div className="ex-candidate-columns" aria-hidden="true">
                      <span>Candidate</span>
                      <span>Reporting period</span>
                      <span>Reported public subsidy</span>
                      <span>Cash</span>
                      <span>In-kind</span>
                      <span>Unpaid</span>
                      <span>Report total</span>
                      <span>After exclusions</span>
                    </div>
                    {candidates.data.candidates.map((candidate) => (
                      <CandidateRow
                        key={d.claimKey(candidate)}
                        candidate={candidate}
                        baseline={baseline ?? candidates.data!}
                        queryText={queryText}
                        selectedReports={reports ?? []}
                        enabled={
                          current &&
                          candidates.dataPath === candidatesPath &&
                          !candidates.failed &&
                          !candidates.updating
                        }
                        address={address}
                        setAddress={setAddress}
                        revision={revision}
                        reload={reload}
                        showReport={(key) => {
                          setOpenReport(key);
                          setAddress({ expenseSource: `report:${key}` });
                        }}
                        showExternalSource={(value) => setAddress({ expenseSource: value })}
                        showPayment={showPayment}
                        showPayee={showPayee}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="ec-empty">
                    {queryText ? 'No matching candidates' : 'No candidates held'}
                  </p>
                )}
                <Pager
                  page={candidates.data.page}
                  move={(value) => setAddress({ expenseCandidatePage: value })}
                />
              </>
            )}
          </section>
          {queryText && (
            <section className="ec-section ex-search-payees">
              <h2 tabIndex={-1}>
                Payees
                {payeeSearch.data ? ` (${count(payeeSearch.data.page.total)})` : ''}
              </h2>
              <Scope read={payeeSearch} path={payeeSearchPath} />
              <Notice read={payeeSearch} message="Couldn’t load payees" reload={reload} />
              {payeeSearch.data && (
                <>
                  <PayeeList
                    data={payeeSearch.data}
                    enabled={
                      current && payeeSearch.dataPath === payeeSearchPath && !payeeSearch.failed
                    }
                    excluded={exclusions ?? []}
                    query={{
                      ...query,
                      excluded_payee_ids: [],
                      payee_query: queryText,
                    }}
                    selected={
                      address.expensePayee.startsWith('search:')
                        ? address.expensePayee.slice(7)
                        : ''
                    }
                    choose={(id) =>
                      setAddress({
                        expensePayee: id ? `search:${id}` : '',
                        expensePaymentsPage: '1',
                      })
                    }
                    paymentPage={address.expensePaymentsPage}
                    setPaymentPage={(value) => setAddress({ expensePaymentsPage: value })}
                    showPayment={showPayment}
                    showPayee={showPayee}
                    revision={revision}
                    reload={reload}
                  />
                  <Pager
                    page={payeeSearch.data.page}
                    move={(value) => setAddress({ expenseSearchPage: value })}
                  />
                </>
              )}
            </section>
          )}
          <section className="ec-section ex-about">
            <h2 id="ex-about">About these records</h2>
            <p>Payee locations use addresses in the filings, not where work took place.</p>
            <p>
              Reported public subsidy and campaign spending are separate figures. These records do
              not trace subsidy dollars to individual payees.
            </p>
            <p>Non-itemized spending has no named payee and is shown separately.</p>
            {baseline && (
              <p>
                {count(baseline.coverage.named_candidacies)}{' '}
                {baseline.coverage.named_candidacies === 1 ? 'candidate' : 'candidates'} in the
                election record · {count(baseline.coverage.scoped_candidacies)} in this report scope
                · {count(baseline.coverage.selected_account_reports)} Minnesota Board{' '}
                {baseline.coverage.selected_account_reports === 1 ? 'report' : 'reports'} ·{' '}
                {count(baseline.coverage.checked_detail_account_reports)} with checked detail
                {baseline.external_status === 'published' && (
                  <>
                    {' · '}
                    {count(externalReportCount)} federal or local{' '}
                    {externalReportCount === 1 ? 'report' : 'reports'}
                  </>
                )}
              </p>
            )}
            <p>
              Account money is counted once. These figures do not cover every candidate’s spending.
            </p>
          </section>
          <section className="ex-sources">
            <h2>Sources and updates</h2>
            <p>
              <strong>{BOARD}</strong>
              <br />
              Campaign reports
            </p>
            <p>
              <strong>{SOS}</strong>
              <br />
              Candidate records
            </p>
            {[
              ...new Set(baseline?.authority_reports?.map((report) => report.authority_name) ?? []),
            ].map((name) => (
              <p key={name}>
                <strong>{name}</strong>
                <br />
                Campaign reports
              </p>
            ))}
          </section>
          {selection && (
            <RetainedEvidence
              selection={selection}
              onClose={() => {
                setAddress({ expenseSource: '' });
                setOpenReport(null);
              }}
              onReload={reload}
            />
          )}
          {openReport && !selection && current && (
            <p className="ec-notice" role="status">
              This report source is not held
            </p>
          )}
        </div>
      </main>
    </EvidenceRestore.Provider>
  );
}

function PartyComparison({
  data,
  enabled,
  showReport,
}: {
  data: d.ExpenseAnswer;
  enabled: boolean;
  showReport: (key: string) => void;
}) {
  const band = useBand();
  const categories: Array<{
    key: string;
    name: string;
    accounts: d.AccountReport[];
    candidates: number | null;
  }> = partyOrder.map((party) => ({
    key: party,
    name: d.PARTY_LABELS[party],
    candidates: data.summary.candidacy_counts_by_ballot_party[party],
    accounts: data.account_reports.filter(
      (account) =>
        account.party_group === party &&
        (party !== 'unknown' ||
          account.party_classification_state === 'ballot_party_not_in_source'),
    ),
  }));
  const mixed = data.account_reports.filter(
    (account) =>
      account.party_group === 'unknown' &&
      account.party_classification_state !== 'ballot_party_not_in_source',
  );
  if (mixed.length)
    categories.push({
      key: 'unassigned',
      name: 'Party cannot be assigned',
      candidates: null,
      accounts: mixed,
    });
  const rows = categories.filter((row) => row.candidates || row.accounts.length);
  const total = {
    key: 'total',
    name: 'Total',
    candidates: data.coverage.scoped_candidacies,
    accounts: data.account_reports,
  };
  const values = (row: typeof total | (typeof categories)[number]) => {
    const coverage = (accept: (account: d.AccountReport) => boolean) => {
      const available = row.accounts.filter(accept);
      if (row.candidates === null)
        return {
          covered: available.length,
          total: row.accounts.length,
          unit: 'accounts' as const,
        };
      const candidates = new Set(
        available.flatMap((account) =>
          account.display_claims
            .filter((claim) => row.key === 'total' || claim.party_group === row.key)
            .map(d.claimKey),
        ),
      );
      return {
        covered: candidates.size,
        total: row.candidates,
        unit: 'candidates' as const,
        accountCoverage: {
          covered: available.length,
          total: row.accounts.length,
        },
      };
    };
    const subsidy = row.accounts
      .map((account) => account.public_subsidy?.total)
      .filter((value): value is string => value != null);
    const before = row.accounts
      .map((account) => account.campaign_expenses?.total)
      .filter((value): value is string => value != null);
    const after = row.accounts
      .map(d.adjustedReportTotal)
      .filter((value): value is string => value != null);
    return [
      row.candidates === null ? (
        <span className="ex-not-applicable" aria-label="Not applicable" />
      ) : (
        count(row.candidates)
      ),
      <Money
        value={d.sumMoney(subsidy)}
        {...coverage((account) => account.public_subsidy !== null)}
        note={subsidyDifferenceLabel(row.accounts)}
      />,
      <Money
        value={d.sumMoney(before)}
        {...coverage((account) => account.campaign_expenses !== null)}
      />,
      <Money
        value={d.sumMoney(after)}
        {...coverage((account) => d.adjustedReportTotal(account) !== null)}
      />,
    ];
  };
  const periods = new Set(data.summary.periods.map((period) => `${period.start}:${period.end}`));
  const omitted = data.account_reports.filter(
    (account) => account.campaign_expenses !== null && d.adjustedReportTotal(account) === null,
  );
  return (
    <section className="ec-section">
      <h2>Party comparison</h2>
      <p className="ec-muted">Spending and subsidies: {data.summary.authority_name ?? BOARD}</p>
      {periods.size > 1 && <p className="ec-muted">Periods vary</p>}
      {band === 'phone' ? (
        <ul className="ex-summary-cards">
          {[...rows, total].map((row) => (
            <li key={row.key}>
              <h3>{row.name}</h3>
              <Metrics
                values={[
                  'Candidates',
                  'Reported public subsidy',
                  'Before exclusions',
                  'After exclusions',
                ].map((name, index) => [name, values(row)[index]])}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="ex-table-wrap">
          <table className="ex-table ex-party">
            <thead>
              <tr>
                <th rowSpan={2}>Party</th>
                <th rowSpan={2}>Candidates</th>
                <th rowSpan={2}>Reported public subsidy</th>
                <th colSpan={2}>Campaign spending</th>
              </tr>
              <tr>
                <th>Before exclusions</th>
                <th>After exclusions</th>
              </tr>
            </thead>
            <tbody>
              {[...rows, total].map((row) => (
                <tr key={row.key} className={row.key === 'total' ? 'ex-total' : ''}>
                  <th scope="row">{row.name}</th>
                  {values(row).map((value, index) => (
                    <td key={index}>{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.account_reports.some((account) => account.public_subsidy_comparison) && (
        <ul className="ex-source-reports">
          {data.account_reports
            .filter((account) => account.public_subsidy_comparison)
            .map((account) => (
              <li key={account.report_key}>
                <button
                  className="ec-link"
                  disabled={!enabled}
                  onClick={() => showReport(account.report_key)}
                >
                  View report · {account.display_claims.map((claim) => claim.name).join(' / ')}
                </button>
              </li>
            ))}
        </ul>
      )}
      {omitted.length > 0 && (
        <div className="ec-muted">
          <p>After exclusions omits reports with unavailable expense details</p>
          <ul>
            {omitted.map((account) => (
              <li key={account.report_key}>
                <button
                  className="ec-link"
                  disabled={!enabled}
                  onClick={() => showReport(account.report_key)}
                >
                  {account.display_claims.map((claim) => claim.name).join(' / ')}
                  {' · '}
                  {moneyLabel(account.campaign_expenses?.total)}
                  {' · View report'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {mixed.map((account) => (
        <p className="ec-muted" key={account.report_key}>
          Shared campaign account {account.registration_number} ·{' '}
          {account.party_classification_state === 'mixed_ballot_parties'
            ? 'Shared account, different ballot parties'
            : 'Party evidence unavailable'}
          <br />
          {account.claims
            .map((claim) => `${claim.name} (${d.partyLabel(claim.filed_party)})`)
            .join(' · ')}
        </p>
      ))}
    </section>
  );
}

function LocationComparison({ data }: { data: d.ExpenseAnswer }) {
  const band = useBand();
  const before = data.summary.baseline_checked_itemized_detail;
  const after = data.summary.adjusted_checked_itemized_detail;
  const rows: Array<[string, string | null | undefined, string | null | undefined]> = [
    ['Minnesota', before.by_filed_address.MN?.total, after.by_filed_address.MN?.total],
    [
      'Out of state',
      before.by_filed_address.out_of_state?.total,
      after.by_filed_address.out_of_state?.total,
    ],
    [
      'Location unavailable',
      before.by_filed_address.unknown?.total,
      after.by_filed_address.unknown?.total,
    ],
    ['Itemized total', before.amounts?.total, after.amounts?.total],
  ];
  const nonItemized = data.summary.non_itemized_on_checked_detail_reports?.total;
  const coveredCandidates = new Set(
    data.account_reports
      .filter((account) => account.detail_status === 'checked')
      .flatMap((account) => account.display_claims.map(d.claimKey)),
  ).size;
  return (
    <>
      <p className="ec-muted">{data.summary.authority_name ?? BOARD}</p>
      {band === 'phone' ? (
        <ul className="ex-summary-cards">
          {rows.map(([name, first, last]) => (
            <li key={name}>
              <h3>{name}</h3>
              <Metrics
                values={[
                  ['Before exclusions', <Money value={first} />],
                  ['After exclusions', <Money value={last} />],
                ]}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="ex-table-wrap">
          <table className="ex-table">
            <thead>
              <tr>
                <th>Location</th>
                <th>Before exclusions</th>
                <th>After exclusions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([name, first, last]) => (
                <tr key={name} className={name === 'Itemized total' ? 'ex-total' : ''}>
                  <th scope="row">{name}</th>
                  <td>
                    <Money value={first} />
                  </td>
                  <td>
                    <Money value={last} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(data.summary.withheld_detail_accounts > 0 ||
        coveredCandidates < data.coverage.scoped_candidacies) && (
        <p className="ec-muted">
          Known subtotal · Covers {count(coveredCandidates)} of{' '}
          {count(data.coverage.scoped_candidacies)} candidates ·{' '}
          {count(before.available_account_reports)} checked account reports
        </p>
      )}
      <div className="ex-nonitemized">
        <Metrics values={[['Non-itemized spending', <Money value={nonItemized} />]]} />
      </div>
    </>
  );
}

function CandidateRow({
  candidate,
  baseline,
  queryText,
  selectedReports,
  enabled,
  address,
  setAddress,
  revision,
  reload,
  showReport,
  showExternalSource,
  showPayment,
  showPayee,
}: {
  candidate: d.Candidate;
  baseline: d.ExpenseAnswer;
  queryText: string;
  selectedReports: string[];
  enabled: boolean;
  address: Address;
  setAddress: SetAddress;
  revision: number;
  reload: () => void;
  showReport: (key: string) => void;
  showExternalSource: (value: string) => void;
  showPayment: (payment: d.Payment, data: d.ExpenseAnswer) => void;
  showPayee: (payee: d.Payee, data: d.ExpenseAnswer) => void;
}) {
  const key = d.claimKey(candidate);
  const open = address.expenseCandidate === key;
  const accounts = baseline.account_reports.filter((account) =>
    candidate.accounts.some((entry) => entry.report_key === account.report_key),
  );
  const externalAccounts = (baseline.authority_reports ?? []).filter((account) =>
    account.display_claims.some((claim) => d.claimKey(claim) === key),
  );
  const ownMoney = (account: Pick<d.AccountReport, 'display_claims'>) =>
    [...account.display_claims]
      .filter(
        (claim) =>
          !queryText || claim.name.toLocaleLowerCase().includes(queryText.toLocaleLowerCase()),
      )
      .sort(byName)[0];
  const rows = accounts.filter(
    (account) => !ownMoney(account) || d.claimKey(ownMoney(account)!) === key,
  );
  const references = accounts.filter((account) => !rows.includes(account));
  return (
    <article className="ex-candidate">
      <div className="ex-candidate-name">
        <h3>{candidate.name}</h3>
        <p>Party {d.partyLabel(candidate.filed_party)}</p>
        <p>
          {[candidate.office, candidate.district, candidate.jurisdiction]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <button
          className="ec-link"
          disabled={!enabled || (!accounts.length && !externalAccounts.length)}
          aria-expanded={open}
          onClick={() =>
            setAddress({
              expenseCandidate: open ? '' : key,
              expensePayeePage: '1',
              expensePayee: '',
              expensePaymentsPage: '1',
              expenseSource: '',
            })
          }
        >
          <Caret up={open} />
          View payees
        </button>
      </div>
      <div className="ex-account-list">
        {rows.map((account) => (
          <AccountFigures
            key={account.report_key}
            account={account}
            candidate={candidate}
            enabled={enabled}
            showReport={showReport}
          />
        ))}
        {references.map((account) => (
          <div className="ex-account ex-account-reference" key={account.report_key}>
            <p>
              <strong>Shared campaign account {account.registration_number}</strong>
              <br />
              Account figures shown with {ownMoney(account)?.name}
            </p>
            <button
              className="ec-link"
              disabled={!enabled}
              onClick={() => showReport(account.report_key)}
            >
              View report
            </button>
          </div>
        ))}
        {externalAccounts.map((account) =>
          !ownMoney(account) || d.claimKey(ownMoney(account)!) === key ? (
            <AuthorityFigures
              key={account.report_key}
              account={account}
              enabled={enabled}
              showSource={showExternalSource}
            />
          ) : (
            <div className="ex-account ex-account-reference" key={account.report_key}>
              <strong>
                {account.account_id_kind === 'physical_section' && account.issued_id === false
                  ? `Shared report section · ${accountIdentity(account).value}`
                  : `Shared campaign account ${account.account_id}`}
              </strong>
              <p>Account figures shown with {ownMoney(account)?.name}</p>
              <button
                className="ec-link"
                disabled={!enabled}
                onClick={() => showExternalSource(`external-report:${account.report_key}:report:0`)}
              >
                View report
              </button>
            </div>
          ),
        )}
        {!accounts.length && !externalAccounts.length && (
          <div className="ex-account">
            <p>Report figures not held</p>
            <p className="ec-muted">
              {candidate.gaps.some((gap) => gap.state === 'amendment_status_not_established')
                ? 'Amendments not established; excluded from totals'
                : candidate.gaps.some((gap) => gap.state === 'selected_report_not_associated')
                  ? 'Selected report not linked to this candidate'
                  : candidate.external_coverage
                    ? coverageLabel(candidate.external_coverage.status)
                    : candidate.filing_authority === 'fec'
                      ? 'Federal campaign records'
                      : candidate.filing_authority === 'local'
                        ? 'Local campaign records'
                        : candidate.confirmed_account_count
                          ? 'Selected report unavailable'
                          : 'No confirmed campaign account'}
            </p>
          </div>
        )}
        {candidate.gaps.length > 0 && accounts.length > 0 && (
          <p className="ec-muted">Some account or report figures are not held</p>
        )}
      </div>
      {open && enabled && (
        <CandidatePayees
          candidate={candidate}
          baseline={baseline}
          selectedReports={selectedReports}
          excluded={d.exactKeys(address.expenseExcluded, 200) ?? []}
          address={address}
          setAddress={setAddress}
          revision={revision}
          reload={reload}
          showPayment={showPayment}
          showPayee={showPayee}
        />
      )}
    </article>
  );
}
function AccountFigures({
  account,
  candidate,
  enabled,
  showReport,
}: {
  account: d.AccountReport;
  candidate: d.Candidate;
  enabled: boolean;
  showReport: (key: string) => void;
}) {
  const shared = account.claims.length > 1;
  const link = candidate.accounts.find((entry) => entry.report_key === account.report_key);
  return (
    <div className="ex-account">
      <div className="ex-account-title">
        <strong>
          {shared ? 'Shared campaign account' : link?.committee_name || 'Campaign account'}{' '}
          {account.registration_number}
        </strong>
        <span>{account.filing.report_name || account.filing.report_type}</span>
        <span>{periodLabel(account.period_start, account.period_end)}</span>
        <span>Received {dateLabel(account.received_date)}</span>
        {(account.filing.effective_amendment_index ?? 0) > 0 && (
          <span>Amended report {account.filing.effective_amendment_index}</span>
        )}
        {shared && (
          <p>
            {account.party_classification_state === 'mixed_ballot_parties'
              ? 'Shared account, different ballot parties'
              : 'Account money counted once'}
            <br />
            {account.claims
              .map((claim) => `${claim.name} (${d.partyLabel(claim.filed_party)})`)
              .join(' · ')}
          </p>
        )}
        <button
          className="ec-link"
          disabled={!enabled}
          onClick={() => showReport(account.report_key)}
        >
          View report
        </button>
      </div>
      <Metrics
        values={[
          [
            'Reported public subsidy',
            <Money
              value={account.public_subsidy?.total}
              note={
                account.public_subsidy_comparison
                  ? 'Filed report and online overview differ'
                  : undefined
              }
            />,
          ],
          ['Cash', <Money value={account.campaign_expenses?.paid} />],
          ['In-kind', <Money value={account.campaign_expenses?.in_kind} />],
          ['Unpaid', <Money value={account.campaign_expenses?.unpaid} />],
          ['Report total', <Money value={account.campaign_expenses?.total} />],
          ['After exclusions', <Money value={d.adjustedReportTotal(account)} />],
        ]}
      />
      {account.detail_gap === 'expense_detail_unreconciled' && (
        <p className="ex-gap">
          <strong>Amounts do not match</strong>
          <br />
          Itemized total · Unavailable
          <br />
          The expense rows do not match the report total
        </p>
      )}
      {account.detail_status !== 'checked' &&
        account.detail_gap !== 'expense_detail_unreconciled' && (
          <p className="ex-gap">Itemized detail unavailable</p>
        )}
    </div>
  );
}

function CandidatePayees({
  candidate,
  baseline,
  selectedReports,
  excluded,
  address,
  setAddress,
  revision,
  reload,
  showPayment,
  showPayee,
}: {
  candidate: d.Candidate;
  baseline: d.ExpenseAnswer;
  selectedReports: string[];
  excluded: string[];
  address: Address;
  setAddress: SetAddress;
  revision: number;
  reload: () => void;
  showPayment: (payment: d.Payment, data: d.ExpenseAnswer) => void;
  showPayee: (payee: d.Payee, data: d.ExpenseAnswer) => void;
}) {
  // Discovery uses its own scoped pin. Global exclusions are marked in rows;
  // unrelated excluded IDs must never be sent into another account's scope.
  const query: d.ExpenseQuery = {
    race_id: candidate.race_id,
    candidate_id: candidate.candidate_id,
    selected_only: selectedReports.length > 0,
    report_keys: d.scopedReportKeys(
      baseline,
      selectedReports,
      (claim) => d.claimKey(claim) === d.claimKey(candidate),
    ),
  };
  // The first payee page establishes this candidate's own version in one read.
  // Keep that version across search and paging; the whole-report version has
  // another scope and cannot pin this candidate's detail.
  const session = useFinanceSession();
  const scopeKey = JSON.stringify([
    d.expensePath(baseline.election_key, '', query),
    revision,
    session.apiBaseUrl,
    session.accessToken,
  ]);
  const [scope, setScope] = useState<{
    key: string;
    initialQuery: string;
    initialActive: boolean;
    pins: d.Pins | null;
  }>({
    key: scopeKey,
    initialQuery: address.expensePayeeQuery,
    initialActive: true,
    pins: null,
  });
  const currentScope =
    scope.key === scopeKey
      ? scope
      : {
          key: scopeKey,
          initialQuery: address.expensePayeeQuery,
          initialActive: true,
          pins: null,
        };
  if (scope.key !== scopeKey) setScope(currentScope);
  const initialPath = d.expensePath(baseline.election_key, 'payees-start', {
    ...query,
    payee_query: currentScope.initialQuery,
  });
  const offset = position(address.expensePayeePage);
  const initialPage = offset === 0 && address.expensePayeeQuery === currentScope.initialQuery;
  if (currentScope.pins && !initialPage && currentScope.initialActive)
    setScope({ ...currentScope, initialActive: false });
  const path =
    !currentScope.pins || (initialPage && currentScope.initialActive)
      ? initialPath
      : d.expensePath(
          baseline.election_key,
          'payees',
          { ...query, payee_query: address.expensePayeeQuery },
          currentScope.pins,
          offset,
        );
  const read = useRead<d.ExpenseAnswer>(path, { keepPrevious: true, revision });
  // Reset before committing a view of a changed query/page. Late or retained
  // answers cannot establish the next scope's pin. An older API ignores view
  // and returns candidates: use its scoped pin for the existing payees route.
  if (
    !currentScope.pins &&
    read.data &&
    read.dataPath === initialPath &&
    !read.failed &&
    !read.updating
  ) {
    setScope({
      ...currentScope,
      pins: pins(read.data),
      initialActive: Array.isArray(read.data.payees),
    });
  }
  const payees =
    read.data && !Array.isArray(read.data.payees)
      ? { ...read, data: null, loading: read.loading || read.updating, updating: false }
      : read;
  const payeePrefix = `candidate:${d.claimKey(candidate)}:`;
  return (
    <section className="ex-payees">
      <h4 tabIndex={-1}>Payees · {candidate.name}</h4>
      <Search
        label="Search payees"
        value={address.expensePayeeQuery}
        here={useLocation().href}
        commit={(value) =>
          setAddress({
            expensePayeeQuery: value,
            expensePayeePage: '1',
            expensePayee: '',
            expensePaymentsPage: '1',
          })
        }
      />
      <Scope read={payees} path={path} />
      <Notice read={payees} message="Couldn’t load payees" reload={reload} />
      {payees.data && (
        <>
          <PayeeList
            data={payees.data}
            enabled={payees.dataPath === path && !payees.failed && !payees.updating}
            excluded={excluded}
            query={{ ...query, payee_query: address.expensePayeeQuery }}
            selected={
              address.expensePayee.startsWith(payeePrefix)
                ? address.expensePayee.slice(payeePrefix.length)
                : ''
            }
            choose={(id) =>
              setAddress({
                expensePayee: id ? `${payeePrefix}${id}` : '',
                expensePaymentsPage: '1',
              })
            }
            paymentPage={address.expensePaymentsPage}
            setPaymentPage={(value) => setAddress({ expensePaymentsPage: value })}
            showPayment={showPayment}
            showPayee={showPayee}
            revision={revision}
            reload={reload}
          />
          <Pager
            page={payees.data.page}
            move={(value) => setAddress({ expensePayeePage: value, expensePayee: '' })}
          />
        </>
      )}
    </section>
  );
}

function PayeeList({
  data,
  enabled,
  excluded,
  query,
  selected,
  choose,
  paymentPage,
  setPaymentPage,
  showPayment,
  showPayee,
  revision,
  reload,
}: {
  data: d.ExpenseAnswer;
  enabled: boolean;
  excluded: string[];
  query: d.ExpenseQuery;
  selected: string;
  choose: (id: string) => void;
  paymentPage: string;
  setPaymentPage: (value: string) => void;
  showPayment: (payment: d.Payment, data: d.ExpenseAnswer) => void;
  showPayee: (payee: d.Payee, data: d.ExpenseAnswer) => void;
  revision: number;
  reload: () => void;
}) {
  const { sourceKey, rememberPayee } = useContext(EvidenceRestore);
  useEffect(() => {
    const selected = data.payees?.find((payee) => payeeSourceKey(payee, data) === sourceKey);
    if (selected && enabled) rememberPayee(selected, data);
  }, [data, sourceKey, rememberPayee, enabled]);
  if (!data.payees?.length) return <p className="ec-empty">No matching payees</p>;
  return (
    <ul className="ex-payee-list">
      {data.payees.map((payee) => {
        const id = payee.payee_id ?? `unknown:${payee.report_keys.join(',')}`;
        return (
          <li key={id}>
            <div className="ex-payee-main">
              <div>
                <h5>{payee.payee?.name || 'Payee not shown'}</h5>
                {d.addressLines(payee.payee).map((line, index) => (
                  <p className="ec-filed-address" key={index}>
                    {line}
                  </p>
                ))}
                {payee.geography === 'unknown' && <p>Location unavailable</p>}
                {payee.payee_id && excluded.includes(payee.payee_id) && (
                  <p>
                    <strong>Excluded</strong>
                  </p>
                )}
              </div>
              <Metrics
                values={[
                  ['Purpose', payee.purposes.filter(Boolean).join(' · ') || 'Not reported'],
                  ...amountEntries(payee.amounts, payee.reported_amounts),
                ]}
              />
              <div className="ex-payee-actions">
                <button
                  className="ec-link"
                  disabled={!enabled || (!payee.payee_id && payee.report_keys.length !== 1)}
                  aria-expanded={selected === id}
                  onClick={() => choose(selected === id ? '' : id)}
                >
                  <Caret up={selected === id} />
                  View payments ({count(payee.payment_count)})
                </button>
                <button
                  className="ec-link"
                  disabled={!enabled}
                  onClick={() => showPayee(payee, data)}
                >
                  View source
                </button>
              </div>
            </div>
            {selected === id && enabled && (
              <Payments
                data={data}
                query={query}
                payee={payee}
                page={paymentPage}
                move={setPaymentPage}
                showPayment={showPayment}
                revision={revision}
                reload={reload}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
function Payments({
  data,
  query,
  payee,
  page,
  move,
  showPayment,
  revision,
  reload,
}: {
  data: d.ExpenseAnswer;
  query: d.ExpenseQuery;
  payee: d.Payee;
  page: string;
  move: (page: string) => void;
  showPayment: (payment: d.Payment, data: d.ExpenseAnswer) => void;
  revision: number;
  reload: () => void;
}) {
  // Unnamed rows belong to an exact report group, never a synthetic payee identity.
  const unnamedReportKey =
    !payee.payee_id && payee.report_keys.length === 1 ? payee.report_keys[0] : undefined;
  const path =
    payee.payee_id || unnamedReportKey
      ? d.expensePath(
          data.election_key,
          'payments',
          query,
          pins(data),
          position(page),
          payee.payee_id ?? undefined,
          unnamedReportKey,
        )
      : null;
  const read = useRead<d.ExpenseAnswer>(path, { keepPrevious: true, revision });
  const { sourceKey, rememberPayment } = useContext(EvidenceRestore);
  useEffect(() => {
    const selected = read.data?.payments?.find(
      (payment) => paymentSourceKey(payment, read.data!) === sourceKey,
    );
    if (selected && read.data && read.dataPath === path && !read.failed)
      rememberPayment(selected, read.data);
  }, [read.data, read.dataPath, read.failed, path, sourceKey, rememberPayment]);
  return (
    <section className="ex-payments">
      <h5 tabIndex={-1}>Payments</h5>
      {!path ? (
        <p>Payment identity unavailable</p>
      ) : (
        <>
          <Scope read={read} path={path} />
          <Notice read={read} message="Couldn’t load payments" reload={reload} />
          {read.data && (
            <>
              <ul>
                {read.data.payments?.map((payment) => (
                  <li key={`${payment.report_key}:${payment.record_id}`}>
                    <Metrics
                      values={[
                        ['Date', payment.date ? dateLabel(payment.date) : 'Date not shown'],
                        ['Purpose', payment.purpose || 'Not reported'],
                        ...paymentEntries(payment),
                      ]}
                    />
                    {payment.underlying_vendor && (
                      <p>
                        Underlying vendor: {payment.underlying_vendor.name || 'Name not shown'} ·{' '}
                        {payment.relationship}
                      </p>
                    )}
                    <button
                      className="ec-link"
                      disabled={read.dataPath !== path || read.failed || read.updating}
                      onClick={() => showPayment(payment, read.data!)}
                    >
                      View source
                    </button>
                  </li>
                ))}
              </ul>
              <Pager page={read.data.page} move={move} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function Exclusions({
  data,
  query,
  enabled,
  applyRead,
  address,
  setAddress,
  revision,
  reload,
}: {
  data: d.ExpenseAnswer;
  query: d.ExpenseQuery;
  enabled: boolean;
  applyRead: Read<d.ExpenseAnswer>;
  address: Address;
  setAddress: SetAddress;
  revision: number;
  reload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState('1');
  const [applyTarget, setApplyTarget] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const here = useLocation().href;
  const path =
    open && (enabled || applyTarget !== null)
      ? d.expensePath(
          data.election_key,
          'payees',
          { ...query, excluded_payee_ids: [], payee_query: search },
          pins(data),
          position(page),
        )
      : null;
  const read = useRead<d.ExpenseAnswer>(path, { keepPrevious: true, revision });
  useEffect(() => {
    if (!enabled && applyTarget === null) setOpen(false);
  }, [enabled, applyTarget]);
  useEffect(() => {
    if (
      applyTarget !== null &&
      enabled &&
      [...(data.filters.excluded_payee_ids ?? [])].sort().join(',') === applyTarget
    ) {
      setApplyTarget(null);
      setOpen(false);
      trigger.current?.focus();
    }
  }, [applyTarget, enabled, data.filters.excluded_payee_ids]);
  const applying = applyTarget !== null && (applyRead.pending || applyRead.updating);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    const close = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) {
        setOpen(false);
        setApplyTarget(null);
        trigger.current?.focus({ preventScroll: true });
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        setApplyTarget(null);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const selected = data.filters.excluded_payee_ids ?? [];
  const before = data.summary.baseline_checked_itemized_detail.amounts?.total;
  const after = data.summary.adjusted_checked_itemized_detail.amounts?.total;
  const removed =
    before != null && after != null
      ? d.sumMoney([before, after.startsWith('-') ? after.slice(1) : `-${after}`])
      : null;
  return (
    <div className="ex-exclusions" ref={wrapper} data-open={open || undefined}>
      <div className="ex-exclusion-heading">
        <h3>Exclusions</h3>
        <button
          ref={trigger}
          className="ec-button"
          disabled={!enabled}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            setDraft(d.exactKeys(address.expenseExcluded, 200) ?? []);
            setSearch('');
            setPage('1');
            setOpen(!open);
          }}
        >
          Exclude selected payees <Caret up={open} />
        </button>
        {selected.length > 0 && (
          <button
            className="ec-link"
            disabled={!enabled}
            onClick={() => setAddress({ expenseExcluded: '' })}
          >
            Clear exclusions
          </button>
        )}
      </div>
      {open && (
        <div
          id={panelId}
          ref={panel}
          className="ex-exclusion-panel"
          role="region"
          aria-label="Exclude selected payees"
        >
          <Search
            label="Search payees"
            value={search}
            here={here}
            commit={(value) => {
              setSearch(value);
              setPage('1');
            }}
          />
          {applyTarget !== null && applyRead.failed && !applyRead.changed && (
            <Refused onRetry={applyRead.retry} retrying={applyRead.pending}>
              {applyRead.busy ? 'Records are busy' : 'Couldn’t update results'}
            </Refused>
          )}
          {applyTarget !== null && applyRead.changed && (
            <div className="ec-notice" role="status">
              These records changed{' '}
              <button className="ec-link" onClick={reload}>
                Reload comparison
              </button>
            </div>
          )}
          <Scope read={read} path={path} />
          <Notice read={read} message="Couldn’t load payees" reload={reload} />
          {read.data && (
            <>
              <ul>
                {read.data.payees?.map((payee) => (
                  <li key={payee.payee_id ?? payee.report_keys.join(',')}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={
                          !payee.excludable ||
                          read.dataPath !== path ||
                          read.updating ||
                          read.failed ||
                          (!draft.includes(payee.payee_id ?? '') && draft.length >= 200)
                        }
                        checked={!!payee.payee_id && draft.includes(payee.payee_id)}
                        onChange={(event) => {
                          const id = payee.payee_id;
                          if (id)
                            setDraft((prior) =>
                              event.target.checked
                                ? [...prior, id]
                                : prior.filter((value) => value !== id),
                            );
                        }}
                      />
                      <span>
                        <strong>{payee.payee?.name || 'Payee not shown'}</strong>
                        <small className="ec-filed-address">{d.addressText(payee.payee)}</small>
                      </span>
                      <strong className="ex-number">
                        {payee.amounts ? (
                          moneyLabel(payee.amounts.total)
                        ) : (
                          <ReportedValues values={payee.reported_amounts} />
                        )}
                      </strong>
                    </label>
                  </li>
                ))}
              </ul>
              {!read.data.payees?.length && <p>No matches</p>}
              <Pager page={read.data.page} move={setPage} />
            </>
          )}
          {search && (
            <button
              className="ec-link"
              onClick={() => {
                setSearch('');
                setPage('1');
              }}
            >
              Clear search
            </button>
          )}
          <button
            className="ec-search-button"
            disabled={
              applying ||
              applyRead.changed ||
              !read.data ||
              read.failed ||
              read.updating ||
              draft.length > 200
            }
            onClick={() => {
              const next = [...new Set(draft)].sort().join(',');
              if (next === [...selected].sort().join(',')) {
                setOpen(false);
                trigger.current?.focus();
                return;
              }
              setApplyTarget(next);
              setAddress({ expenseExcluded: next });
            }}
          >
            {applying ? 'Applying exclusions…' : 'Apply exclusions'}
          </button>
        </div>
      )}
      {selected.length ? (
        <div className="ex-excluded">
          <ul>
            {data.excluded_payees?.map((payee) => (
              <li key={payee.payee_id}>
                <Metrics
                  values={[
                    [
                      payee.payee.name || 'Payee not shown',
                      payee.amounts ? (
                        <Money value={payee.amounts.total} />
                      ) : (
                        <ReportedValues values={payee.reported_amounts} />
                      ),
                    ],
                  ]}
                />
                <span className="ec-muted ec-filed-address">{d.addressText(payee.payee)}</span>
                {payee.account_reports.map((account) => {
                  const external = data.authority_reports?.find(
                    (report) => report.report_key === account.report_key,
                  );
                  const identity = external
                    ? accountIdentity(external)
                    : {
                        label: 'Account',
                        value: account.account_id ?? account.registration_number,
                      };
                  return (
                    <div className="ex-part" key={account.report_key}>
                      <span>
                        {account.claims.map((claim) => claim.name).join(' / ')} · {identity.label}{' '}
                        {identity.value}
                      </span>
                      <strong className="ex-number">
                        {account.amounts ? (
                          moneyLabel(account.amounts.total)
                        ) : (
                          <ReportedValues values={account.reported_amounts} />
                        )}
                      </strong>
                    </div>
                  );
                })}
              </li>
            ))}
          </ul>
          <Metrics values={[['Excluded spending · Minnesota Board', <Money value={removed} />]]} />
        </div>
      ) : (
        <p className="ec-muted">No exclusions applied</p>
      )}
    </div>
  );
}
function payeeEvidence(data: d.ExpenseAnswer, payee: d.Payee): ElectionEvidence {
  const first = payee.source[0];
  return {
    evidence: {
      title: `${payee.payee?.name || 'Payee not shown'}${payee.amounts ? ` · ${moneyLabel(payee.amounts.total)}` : ''}`,
      authority: payee.authority_name ?? BOARD,
      checked: 'Checked',
      rows: [
        { label: 'Payee', value: payee.payee?.name || 'Payee not shown' },
        {
          label: 'Address as shown',
          value: d.addressText(payee.payee),
          preserveWhitespace: true,
        },
        {
          label: 'Purpose',
          value: payee.purposes.filter(Boolean).join(' · ') || 'Not reported',
        },
        { label: 'Payments', value: count(payee.payment_count) },
        ...(!payee.amounts
          ? (payee.reported_amounts ?? []).map((item) => ({
              label: `${item.label} · ${periodLabel(item.period_start, item.period_end)}`,
              value: reportedMoneyLabel(item.amount, item.currency),
            }))
          : []),
        ...payee.source.map((source) => ({
          label: 'Source location',
          value: sourceLocation(source),
        })),
      ],
      quote:
        payee.source
          .map((source) => source.text ?? source.quote)
          .filter(Boolean)
          .join('\n') || undefined,
      quoteLabel: 'SOURCE TEXT',
    },
    attachment: first ? expenseSourcePath(data, first.source_sha256, payee.authority) : null,
    pdfPage: first?.page,
  };
}

function reportEvidence(
  data: d.ExpenseAnswer,
  account: d.AccountReport,
  showPartySource: (claim: d.Claim, source: d.PartySource) => void,
  showSubsidyOverview: () => void,
): ElectionEvidence {
  const document = account.source.document;
  const location = (page: number | undefined, lines: number[] | undefined) =>
    page
      ? `Page ${page}${lines?.length ? `, summary ${lines.length === 1 ? 'row' : 'rows'} ${lines.join(', ')}` : ''}`
      : 'Source location not held';
  return {
    evidence: {
      title: `${account.claims.map((claim) => claim.name).join(' / ')} · ${account.filing.report_name}`,
      authority: BOARD,
      checked: account.figure_status === 'checked' ? 'Checked' : 'Not checked',
      rows: [
        { label: 'Source', value: document.file || 'Retained campaign report' },
        {
          label: 'Copied',
          value: dateLabel(document.fetched_at || document.copied_at || document.held_at),
        },
        { label: 'Campaign account', value: account.registration_number },
        {
          label: 'Report',
          value: account.filing.report_name || account.filing.report_type,
        },
        {
          label: 'Reporting period',
          value: periodLabel(account.period_start, account.period_end),
        },
        {
          label: 'Effective amendment',
          value:
            account.filing.effective_amendment_index == null
              ? 'Not shown'
              : String(account.filing.effective_amendment_index),
        },
        { label: 'Received', value: dateLabel(account.received_date) },
        {
          label: 'Reported public subsidy',
          value: moneyLabel(account.public_subsidy?.total),
        },
        {
          label: 'Subsidy source location',
          value: account.public_subsidy
            ? location(account.public_subsidy.source_page, account.public_subsidy.source_lines)
            : 'Unavailable',
        },
        ...(account.public_subsidy_comparison
          ? [
              { label: 'Source difference', value: 'Filed report and online overview differ' },
              {
                label: 'Online overview',
                value: moneyLabel(account.public_subsidy_comparison.overview.amount),
              },
              {
                label: 'Included in total',
                value: account.public_subsidy_comparison.included_in_total
                  ? 'Filed amount'
                  : 'No · Receipt detail unavailable',
              },
            ]
          : []),
        {
          label: 'Campaign spending · Report total',
          value: moneyLabel(account.campaign_expenses?.total),
        },
        {
          label: 'Expense source location',
          value: account.campaign_expenses
            ? location(account.expense_source.page, account.expense_source.summary_lines)
            : 'Unavailable',
        },
        ...account.claims.map((claim) => ({
          label: `Ballot party · ${claim.name}`,
          value: `${d.partyLabel(claim.filed_party)}${claim.filed_party ? ` (${claim.filed_party})` : ''}`,
        })),
        ...account.claims.flatMap((claim) =>
          (claim.party_sources ?? []).map((source) => ({
            label: `Official party source · ${claim.name}`,
            value: `${source.kind === 'official_result' ? 'Official result' : 'Candidate record'}${source.row_number == null ? '' : `, row ${source.row_number}`} · ${source.party_value}${source.availability === 'available' ? '' : source.availability === 'not_checked' ? ' · Source not checked' : ' · Source unavailable'}`,
          })),
        ),
        { label: 'Source version', value: account.source.sha256 },
      ],
    },
    attachment: retainedReportPath(data, account.source.sha256),
    pdfPage: account.campaign_expenses ? account.expense_source.page : undefined,
    children: (
      <div className="ex-source-reports">
        {account.public_subsidy_comparison && (
          <button className="ec-link" onClick={showSubsidyOverview}>
            View online overview
          </button>
        )}
        {account.claims.flatMap((claim) =>
          (claim.party_sources ?? []).map((source) => (
            <button
              key={partySourceKey(account, claim, source)}
              className="ec-link"
              disabled={source.availability !== 'available'}
              onClick={() => showPartySource(claim, source)}
            >
              View party source · {claim.name}
            </button>
          )),
        )}
      </div>
    ),
  };
}

function subsidyDifferenceLabel(accounts: d.AccountReport[]) {
  const conflicts = accounts.filter((account) => account.public_subsidy_comparison);
  if (!conflicts.length) return undefined;
  const included = conflicts.flatMap((account) =>
    account.public_subsidy ? [account.public_subsidy.total] : [],
  );
  const reports = `${count(conflicts.length)} ${conflicts.length === 1 ? 'report' : 'reports'}`;
  if (included.length && included.length < conflicts.length) {
    const includedReports = `${count(included.length)} ${included.length === 1 ? 'report' : 'reports'}`;
    return `Sources differ: ${moneyLabel(d.sumMoney(included))} from ${includedReports}; ${count(conflicts.length - included.length)} unavailable`;
  }
  return included.length
    ? `Sources differ: ${moneyLabel(d.sumMoney(included))} in ${reports}`
    : `Sources differ in ${reports}`;
}

function subsidyOverviewEvidence(
  data: d.ExpenseAnswer,
  account: d.AccountReport,
): ElectionEvidence {
  const comparison = account.public_subsidy_comparison!;
  const source = comparison.overview.source;
  return {
    evidence: {
      title: 'Subsidy · Online overview',
      authority: BOARD,
      checked: 'Checked',
      rows: [
        { label: 'Candidate', value: account.claims.map((claim) => claim.name).join(' / ') },
        { label: 'Campaign account', value: account.registration_number },
        {
          label: 'Reporting period',
          value: periodLabel(comparison.overview.period_start, comparison.overview.period_end),
        },
        { label: 'Copied', value: dateLabel(source.copied_at || source.held_at) },
        { label: 'Online overview', value: moneyLabel(comparison.overview.amount) },
        { label: 'Filed report', value: moneyLabel(comparison.filed.total) },
        { label: 'Source difference', value: 'Filed report and online overview differ' },
      ],
    },
    attachment: retainedReportPath(data, source.sha256, true),
  };
}

function partyEvidence(
  data: d.ExpenseAnswer,
  claim: d.Claim,
  source: d.PartySource,
): ElectionEvidence {
  const row = source.row_number;
  const available = source.availability === 'available';
  return {
    evidence: {
      title: `Party · ${claim.name}`,
      authority: SOS,
      checked: null,
      rows: [
        { label: 'Candidate', value: claim.name },
        { label: 'Party as filed', value: source.party_value },
        { label: 'Candidate ID', value: source.candidate_id },
        {
          label: 'Source row',
          value: row == null ? 'Unavailable' : String(row),
        },
        ...(!available
          ? [
              {
                label: 'Original source',
                value: source.availability === 'not_checked' ? 'Not checked' : 'Unavailable',
              },
            ]
          : []),
      ],
    },
    attachment: available
      ? electionSourcePath(data.election_key, source.source_sha256, data.snapshot_id)
      : null,
    lines:
      available && row != null
        ? electionSourceLinesPath(data.election_key, source.source_sha256, data.snapshot_id, {
            start: row,
            limit: 1,
          })
        : null,
  };
}
function paymentEvidence(data: d.ExpenseAnswer, payment: d.Payment): ElectionEvidence {
  const first = payment.source[0];
  return {
    evidence: {
      title: `${payment.payee?.name || 'Payee not shown'} · ${payment.amounts ? moneyLabel(payment.amounts.total) : reportedMoneyLabel(payment.reported_amount, payment.currency)}`,
      authority: payment.authority_name ?? BOARD,
      checked: 'Checked',
      rows: [
        { label: 'Payee', value: payment.payee?.name || 'Payee not shown' },
        {
          label: 'Address as shown',
          value: d.addressText(payment.payee),
          preserveWhitespace: true,
        },
        { label: 'Purpose', value: payment.purpose || 'Not reported' },
        {
          label: 'Date',
          value: payment.date ? dateLabel(payment.date) : 'Date not shown',
        },
        ...(payment.amounts
          ? [
              { label: 'Amount', value: moneyLabel(payment.amounts.total) },
              { label: 'Paid', value: moneyLabel(payment.amounts.paid) },
              { label: 'Unpaid', value: moneyLabel(payment.amounts.unpaid) },
              { label: 'In-kind', value: moneyLabel(payment.amounts.in_kind) },
            ]
          : [
              {
                label: payment.measure_label ?? 'Reported amount',
                value: reportedMoneyLabel(payment.reported_amount, payment.currency),
              },
              ...(payment.nonadditive
                ? [
                    {
                      label: 'Status',
                      value: 'Supplemental memo, not added to spending',
                    },
                  ]
                : []),
            ]),
        ...(payment.underlying_vendor
          ? [
              {
                label: 'Underlying vendor',
                value: payment.underlying_vendor.name || 'Name not shown',
              },
              { label: 'Relationship as shown', value: payment.relationship },
            ]
          : []),
        {
          label: 'Reporting period',
          value: periodLabel(payment.period_start, payment.period_end),
        },
        ...payment.source.map((source) => ({
          label: 'Source location',
          value: sourceLocation(source),
        })),
      ],
      quote:
        payment.source
          .map((source) => source.text ?? source.quote)
          .filter(Boolean)
          .join('\n') || undefined,
      quoteLabel: 'SOURCE TEXT',
    },
    attachment: first ? expenseSourcePath(data, first.source_sha256, payment.authority) : null,
    pdfPage: first?.page,
  };
}
function expenseSourcePath(data: d.ExpenseAnswer, hash: string, authority?: string) {
  return authority && authority !== 'mn_cfb'
    ? data.external_generation_id
      ? externalSourcePath(
          {
            election_key: data.election_key,
            generation_id: data.external_generation_id,
          },
          hash,
        )
      : null
    : retainedReportPath(data, hash);
}
function retainedReportPath(data: d.ExpenseAnswer, hash: string, raw = false) {
  return (
    [
      'finance',
      'elections',
      encodeURIComponent(data.election_key),
      'finance',
      'sources',
      encodeURIComponent(hash),
    ].join('/') + `${raw ? '/raw' : ''}?collection_id=${encodeURIComponent(data.collection_id)}`
  );
}

/** A private CSV is fetched only on request. Abort on scope/account changes;
 * ignore obsolete completions and revoke the blob after starting the download. */
function useCsvDownload(path: string | null) {
  const session = useFinanceSession();
  const [state, setState] = useState<{
    key: string;
    pending?: boolean;
    failed?: boolean;
    changed?: boolean;
    done?: boolean;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const running = useRef<string | null>(null);
  const allowed = session.status === 'granted' && !session.revoked && !!session.accessToken;
  const key = [path, session.accessToken, allowed, session.apiBaseUrl].join('|');
  const latest = useRef(key);
  latest.current = key;
  useEffect(
    () => () => {
      generation.current += 1;
      controller.current?.abort();
      running.current = null;
    },
    [key],
  );
  async function run() {
    if (!path || !allowed || running.current === key) return;
    running.current = key;
    const request = ++generation.current;
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    const timer = setTimeout(() => requestController.abort(), requestTimeoutMs(path));
    setState({ key, pending: true });
    try {
      const response = await fetch(`${session.apiBaseUrl.replace(/\/+$/, '')}/api/v1/${path}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        cache: 'no-store',
        redirect: 'error',
        signal: requestController.signal,
      });
      if (response.status === 401 || response.status === 403) {
        session.retry?.();
        throw new Error('Access unavailable');
      }
      if (response.status === 409) {
        const problem = await response.json().catch(() => null);
        if (
          problem?.type === 'https://api.alethical.com/problems/records-changed' &&
          latest.current === key &&
          request === generation.current
        ) {
          setState({ key, changed: true });
          return;
        }
      }
      if (
        !response.ok ||
        response.redirected ||
        !response.headers.get('content-type')?.startsWith('text/csv')
      )
        throw new Error('CSV unavailable');
      const blob = await response.blob();
      if (
        latest.current !== key ||
        request !== generation.current ||
        requestController.signal.aborted
      )
        return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const filename = response.headers
        .get('Content-Disposition')
        ?.match(/filename="([a-zA-Z0-9._-]+\.csv)"/)?.[1];
      anchor.download = filename || 'campaign-expenses.csv';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setState({ key, done: true });
    } catch {
      if (latest.current === key && request === generation.current) setState({ key, failed: true });
    } finally {
      clearTimeout(timer);
      if (request === generation.current) running.current = null;
    }
  }
  const current = state?.key === key ? state : null;
  return {
    pending: current?.pending === true,
    failed: current?.failed === true,
    changed: current?.changed === true,
    done: current?.done === true,
    run: () => void run(),
  };
}
