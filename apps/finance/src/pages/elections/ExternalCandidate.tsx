import { useEffect, useId, useState } from 'react';
import { useRead } from '../../api/read';
import { Caret, Refused, Updating } from '../../ui/controls';
import { LoadingLine } from '../../ui/parts';
import { RetainedEvidence, type ElectionEvidence } from './Evidence';
import type { RaceAnswer, ResultCandidate } from './data';
import { count, dateLabel, reportedFigureLabel, reportedMoneyLabel, periodLabel } from './format';
import * as x from './externalData';
import { SourceFieldGaps } from './sourceFieldGaps';

export interface ExternalStatus {
  state: 'loading' | 'failed' | 'changed' | 'missing' | 'ready';
  generation?: string;
  version?: string;
  selectedReports?: string[];
}
const position = (value: string) =>
  ({
    direct_contribution: 'Direct contribution',
    independent_for: 'Independent spending for',
    independent_against: 'Independent spending against',
    coordinated_party: 'Coordinated party spending',
    communication_cost: 'Communication cost',
    electioneering: 'Electioneering communication',
    other: 'Other transaction',
    unknown: 'Position not stated',
  })[value] ?? 'Position not stated';

/** Same campaign-card and source-panel patterns, with each authority's own
 * measures. A Board read is never a prerequisite for an external filing. */
export function ExternalCandidate({
  detail,
  candidate,
  revision,
  selected,
  source,
  onSelect,
  onSource,
  onStatus,
  reload,
}: {
  detail: RaceAnswer;
  candidate: ResultCandidate & { candidate_id: string };
  revision: number;
  selected: string;
  source: string;
  onSelect: (value: string) => void;
  onSource: (value: string) => void;
  onStatus: (candidate: string, value: ExternalStatus) => void;
  reload: () => void;
}) {
  const path = x.externalCandidatePath(detail.election_key, detail.race.id, candidate.candidate_id);
  const read = useRead<x.ExternalCandidate>(path, {
    revision,
    keepPrevious: true,
  });
  const data = read.data;
  const choices = x.reportSelections(selected);
  const snapshotChanged = !!data && data.snapshot_id !== detail.snapshot_id;
  const selectedKeys =
    data?.accounts.flatMap((account) => {
      const reports = data.reports.filter(
        (r) => r.authority === account.authority && r.account_id === account.account_id,
      );
      const report = choices && x.chosenReport(reports, choices.get(x.accountKey(account)) ?? null);
      return report?.effective === true ? [report.report_key] : [];
    }) ?? [];
  const state: ExternalStatus['state'] =
    read.changed || snapshotChanged
      ? 'changed'
      : read.failed
        ? 'failed'
        : read.pending
          ? 'loading'
          : read.notFound
            ? 'missing'
            : data
              ? 'ready'
              : 'loading';
  const selectionStamp = selectedKeys.join(',');
  useEffect(() => {
    onStatus(candidate.candidate_id, {
      state,
      generation: data?.generation_id,
      version: data?.version,
      selectedReports: selectionStamp ? selectionStamp.split(',') : [],
    });
  }, [candidate.candidate_id, state, data?.generation_id, data?.version, selectionStamp, onStatus]);
  const [page, setPage] = useState(1);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  useEffect(() => {
    setPage(1);
  }, [data?.version]);
  const payments = data?.payments.filter((p) => p.effective === true) ?? [];
  const prefix = `external:${encodeURIComponent(candidate.candidate_id)}:`;
  function open(kind: string, key: string, index = 0) {
    onSource(`${prefix}${kind}:${key}:${index}`);
  }
  const authority = (key: string) =>
    data?.authorities.find((a) => a.key === key)?.name ?? 'Filing authority unavailable';
  const sourceParts = source.startsWith(prefix) ? source.slice(prefix.length).split(':') : [];
  let evidence: ElectionEvidence | null = null;
  if (data && !snapshotChanged && !read.changed && sourceParts.length === 3) {
    const [kind, key, index] = sourceParts;
    const [reportKey, figureIndex] = key.split('.');
    const report =
      kind === 'report' || kind === 'figure' || kind === 'gap'
        ? data.reports.find((r) => r.report_key === reportKey)
        : undefined;
    const figure =
      kind === 'figure' && /^\d+$/.test(figureIndex ?? '')
        ? report?.figures?.[Number(figureIndex)]
        : undefined;
    const gap =
      kind === 'gap' && /^\d+$/.test(figureIndex ?? '')
        ? report?.source_field_gaps?.[Number(figureIndex)]
        : undefined;
    const payment =
      kind === 'payment' ? data.payments.find((p) => p.payment_key === key) : undefined;
    const bindings =
      figure?.sources ??
      gap?.sources ??
      (kind === 'report' ? report?.sources : undefined) ??
      payment?.sources ??
      (kind === 'coverage' ? data.coverage.sources : undefined);
    const binding = bindings?.[Number(index)];
    if (binding && /^\d+$/.test(index)) {
      evidence = {
        pdfPage: typeof binding.locator.page === 'number' ? binding.locator.page : undefined,
        attachment: x.externalSourcePath(data, binding.source_sha256),
        evidence: {
          title: gap
            ? gap.label
            : figure
              ? `${figure.label} · ${reportedFigureLabel(figure)}`
              : payment
                ? `${position(payment.direction)} · ${candidate.name}`
                : report
                  ? `Report ${report.source_report_id ?? report.report_type ?? ''}`
                  : candidate.name,
          authority: authority(
            report?.authority ?? payment?.authority ?? data.coverage.authority ?? '',
          ),
          quote: binding.quote || undefined,
          checked: 'Checked',
          rows: [
            ...(gap ? [{ label: 'Amount', value: x.fieldGapLabel(gap.state) }] : []),
            ...(report && x.unknownAmendments(report)
              ? [{ label: 'Amendments', value: 'Not established; excluded from totals' }]
              : []),
            {
              label: 'Source',
              value: Object.entries(binding.locator)
                .map(([k, v]) => `${k.replaceAll('_', ' ')} ${v}`)
                .join(' · '),
            },
            ...(report || payment
              ? [
                  {
                    label: 'Reporting period',
                    value: periodLabel(
                      (report ?? payment)!.period_start,
                      (report ?? payment)!.period_end,
                    ),
                  },
                ]
              : []),
            ...(report?.received_date
              ? [{ label: 'Received', value: dateLabel(report.received_date) }]
              : []),
            ...(payment
              ? [
                  { label: 'Filing account', value: payment.account_id },
                  { label: 'Date', value: dateLabel(payment.date) },
                  {
                    label: 'Amount',
                    value: reportedMoneyLabel(payment.amount, payment.currency),
                  },
                  {
                    label: 'Payee',
                    value: x.payeeName(payment.payee) ?? 'Not reported',
                  },
                  {
                    label: 'Filed address',
                    value: x.paymentAddress(payment) || 'Unavailable',
                  },
                  {
                    label: 'Purpose',
                    value: payment.purpose ?? 'Not reported',
                  },
                  { label: 'Type', value: payment.transaction_type },
                  ...(payment.nonadditive
                    ? [
                        {
                          label: 'Status',
                          value: 'Supplemental memo, not added to spending',
                        },
                      ]
                    : []),
                ]
              : []),
            ...(binding.source_copied_at
              ? [
                  {
                    label: 'Copied',
                    value: dateLabel(binding.source_copied_at),
                  },
                ]
              : []),
          ],
        },
      };
    }
  }
  return (
    <article className="ec-card ec-external-candidate">
      <h4>{candidate.name}</h4>
      {read.loading && <LoadingLine>Loading campaign reports…</LoadingLine>}
      {read.updating && <Updating />}
      {state === 'changed' && (
        <div className="ec-notice" role="status">
          These records changed{' '}
          <button className="ec-button" onClick={reload}>
            Reload comparison
          </button>
        </div>
      )}
      {read.failed && (
        <Refused onRetry={read.retry} retrying={read.pending}>
          {data ? 'Couldn’t update campaign reports' : 'Couldn’t load campaign reports'}
        </Refused>
      )}
      {read.notFound && <p className="ec-muted">Campaign reports unavailable</p>}
      {data && !snapshotChanged && (
        <>
          {(read.failed || read.updating) && <p className="ec-muted">Showing previous records</p>}
          {!data.accounts.length && (
            <p className="ec-muted">{x.coverageLabel(data.coverage.status)}</p>
          )}
          {data.account_gaps.length > 0 && (
            <p className="ec-muted">
              {count(data.account_gaps.length)} account relationship
              {data.account_gaps.length === 1 ? '' : 's'} not confirmed
            </p>
          )}
          {data.coverage.sources?.map((_, i) => (
            <button key={i} className="ec-link" onClick={() => open('coverage', 'record', i)}>
              View filing status source
              {data.coverage.sources!.length > 1 ? ` ${i + 1}` : ''}
            </button>
          ))}
          {data.accounts.map((account) => (
            <ExternalAccount
              key={x.accountKey(account)}
              account={account}
              reports={data.reports.filter(
                (r) => r.authority === account.authority && r.account_id === account.account_id,
              )}
              chosen={choices ? (choices.get(x.accountKey(account)) ?? null) : 'invalid'}
              authority={authority(account.authority)}
              onSelect={(key) => onSelect(x.selectReport(selected, account, key))}
              onSource={(key, index, kind) => open(kind ?? 'report', key, index)}
            />
          ))}
          <div className="ec-report-history">
            <button
              className="ec-link"
              aria-expanded={paymentsOpen}
              onClick={() => setPaymentsOpen(!paymentsOpen)}
            >
              <Caret up={paymentsOpen} />
              Spending and support ({count(payments.length)})
            </button>
            {paymentsOpen && (
              <section
                className="ec-payments"
                aria-label={`Spending and support for ${candidate.name}`}
              >
                <h5>Spending and support</h5>
                {!payments.length && <p className="ec-muted">No checked payment records</p>}
                <ul className="ec-external-payments">
                  {payments.slice((page - 1) * 50, page * 50).map((payment) => (
                    <li key={payment.payment_key}>
                      <strong>
                        {position(payment.direction)} ·{' '}
                        {reportedMoneyLabel(payment.amount, payment.currency)}
                      </strong>
                      <p>
                        {dateLabel(payment.date)} · Filing account {payment.account_id}
                      </p>
                      {x.payeeName(payment.payee) && <p>{x.payeeName(payment.payee)}</p>}
                      {x.paymentAddress(payment) && <p>{x.paymentAddress(payment)}</p>}
                      {payment.purpose && <p>{payment.purpose}</p>}
                      <p className="ec-muted">
                        {authority(payment.authority)} · {payment.transaction_type}
                      </p>
                      <p className="ec-muted">
                        {periodLabel(payment.period_start, payment.period_end)}
                      </p>
                      {payment.nonadditive && (
                        <p className="ec-muted">Supplemental memo, not added to spending</p>
                      )}
                      {payment.sources.map((_, i) => (
                        <button
                          key={i}
                          className="ec-link"
                          onClick={() => open('payment', payment.payment_key, i)}
                        >
                          View source
                          {payment.sources.length > 1 ? ` ${i + 1}` : ''}
                        </button>
                      ))}
                    </li>
                  ))}
                </ul>
                {payments.length > 50 && (
                  <nav className="ec-pager" aria-label={`Payment pages for ${candidate.name}`}>
                    <button
                      className="ec-button"
                      disabled={page === 1}
                      onClick={(e) => {
                        setPage(page - 1);
                        const h = e.currentTarget.closest('section')?.querySelector('h5');
                        if (h) {
                          h.tabIndex = -1;
                          h.focus();
                          h.scrollIntoView?.({ block: 'start' });
                        }
                      }}
                    >
                      Previous
                    </button>
                    <span>
                      Page {page} of {Math.ceil(payments.length / 50)}
                    </span>
                    <button
                      className="ec-button"
                      disabled={page * 50 >= payments.length}
                      onClick={(e) => {
                        setPage(page + 1);
                        const h = e.currentTarget.closest('section')?.querySelector('h5');
                        if (h) {
                          h.tabIndex = -1;
                          h.focus();
                          h.scrollIntoView?.({ block: 'start' });
                        }
                      }}
                    >
                      Next
                    </button>
                  </nav>
                )}
              </section>
            )}
          </div>
          <p className="ec-muted">
            Each report keeps its own measures and dates. Overlapping reports and supplemental memos
            are not added.
          </p>
          <p className="ec-muted">Copied {dateLabel(data.copied_at)}</p>
        </>
      )}
      {source.startsWith(prefix) && (
        <RetainedEvidence
          selection={
            evidence ?? {
              attachment: null,
              evidence: {
                title: 'Source evidence',
                authority: '',
                rows: [
                  {
                    label: 'Availability',
                    value: read.pending ? 'Loading…' : 'Source unavailable',
                  },
                ],
              },
            }
          }
          onClose={() => onSource('')}
          onReload={reload}
        />
      )}
    </article>
  );
}

function ExternalAccount({
  account,
  reports,
  chosen,
  authority,
  onSelect,
  onSource,
}: {
  account: x.ExternalAccount;
  reports: x.ExternalReport[];
  chosen: string | null;
  authority: string;
  onSelect: (key: string) => void;
  onSource: (key: string, index?: number, kind?: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const report = x.chosenReport(reports, chosen);
  const effective = reports.filter((r) => r.effective === true);
  return (
    <div className="ec-account">
      <strong>{account.name}</strong>
      <p className="ec-muted">
        {authority} · {account.account_id} · Checked {dateLabel(account.checked_on)}
      </p>
      {report ? (
        <>
          <p className="ec-period ec-muted">
            {report.report_type} · {periodLabel(report.period_start, report.period_end)}
            {report.received_date ? ` · Received ${dateLabel(report.received_date)}` : ''}
          </p>
          {x.unknownAmendments(report) && (
            <p className="ec-muted">Amendments not established; excluded from totals</p>
          )}
          {report.figures?.length || report.source_field_gaps?.length ? (
            <dl className="ec-external-figures">
              {report.figures?.map((figure, i) => (
                <div key={`${figure.measure}:${i}`}>
                  <dt>
                    {figure.label}
                    <span className="ec-filing-period ec-muted">
                      {periodLabel(figure.period_start, figure.period_end)}
                    </span>
                  </dt>
                  <dd className="ec-number">
                    {reportedFigureLabel(figure)}
                    {figure.sources.map((_, sourceIndex) => (
                      <button
                        className="ec-link ec-filing-period"
                        key={sourceIndex}
                        onClick={() => onSource(`${report.report_key}.${i}`, sourceIndex, 'figure')}
                      >
                        View source
                        <span className="ec-sr-only"> for {figure.label}</span>
                      </button>
                    ))}
                  </dd>
                </div>
              ))}
              <SourceFieldGaps
                gaps={report.source_field_gaps}
                onSource={(gap, index) => onSource(`${report.report_key}.${gap}`, index, 'gap')}
              />
            </dl>
          ) : (
            <p className="ec-muted">{x.coverageLabel(report.check_status)}</p>
          )}
          {!!report.withheld_measures?.length && (
            <p className="ec-muted">Some figures fall outside the checked account dates</p>
          )}
          {!!report.unavailable_measures?.length && (
            <p className="ec-muted">Some figure sources are unavailable</p>
          )}
          {report.sources.map((_, i) => (
            <button className="ec-link" key={i} onClick={() => onSource(report.report_key, i)}>
              View report{report.sources.length > 1 ? ` ${i + 1}` : ''}
            </button>
          ))}
        </>
      ) : (
        <p className="ec-muted">
          {chosen
            ? 'Selected report is unavailable'
            : effective.length
              ? 'The latest report is not resolved'
              : reports.some(x.unknownAmendments)
                ? 'Choose a filing to inspect; amendments not established'
                : 'Report figures not held'}
        </p>
      )}
      {reports.length > 0 && (
        <div className="ec-report-history">
          <button
            className="ec-link"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
          >
            <Caret up={open} />
            Available filings ({reports.length})
          </button>
          <ul id={id} hidden={!open}>
            {reports.map((r) => (
              <li key={r.report_key}>
                {x.inspectableReport(r) ? (
                  <label className="ec-filing-choice">
                    <input
                      type="radio"
                      name={id}
                      checked={report?.report_key === r.report_key}
                      onChange={() => onSelect(r.report_key)}
                    />
                    <span>
                      {r.report_type ?? 'Report'} {r.source_report_id}
                      <span className="ec-filing-period">
                        {periodLabel(r.period_start, r.period_end)}
                      </span>
                      <span className="ec-filing-period ec-muted">
                        {r.received_date
                          ? `Received ${dateLabel(r.received_date)}`
                          : 'Received date unavailable'}
                      </span>
                      {x.unknownAmendments(r) && (
                        <span className="ec-filing-period ec-muted">
                          Amendments not established
                        </span>
                      )}
                    </span>
                  </label>
                ) : (
                  <p>
                    {r.report_type ?? 'Report'} {r.source_report_id} ·{' '}
                    {r.effective === false ? 'Earlier version' : 'Version unavailable'}
                  </p>
                )}
                <p className="ec-muted">
                  {r.check_status === 'checked'
                    ? 'Report figures available'
                    : x.coverageLabel(r.check_status)}
                </p>
                {r.sources.map((_, i) => (
                  <button key={i} className="ec-link" onClick={() => onSource(r.report_key, i)}>
                    View report{r.sources.length > 1 ? ` ${i + 1}` : ''}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
