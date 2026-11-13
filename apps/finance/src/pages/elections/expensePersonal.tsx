import type {
  BoardCandidateRecord,
  ExpenseAnswer,
  PersonalField,
  PersonalReport,
} from './expenseReportData';
import { fieldStateLabel, partyLabel, personalReportTypeLabel } from './expenseReportData';
import type { ElectionEvidence } from './Evidence';
import { dateLabel, moneyLabel, periodLabel } from './format';
import { useBand } from '../../ui/band';

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
const labels = {
  cash: 'Cash',
  unpaid: 'Unpaid',
  in_kind: 'In-kind',
  total: 'Total',
};
const keys = ['cash', 'unpaid', 'in_kind', 'total'] as const;
const fieldStatus = (field: PersonalField) => fieldStateLabel(field.state);
const fieldMoney = (field: PersonalField) =>
  field.state === 'value' ? moneyLabel(field.normalized) : 'N/A';

export function PersonalFigures({
  report,
  enabled,
  showSource,
}: {
  report: PersonalReport;
  enabled: boolean;
  showSource: (key: string) => void;
}) {
  return (
    <section className="ex-account ex-authority-account">
      <h4>Personal expenditures</h4>
      <p className="ec-muted">Board candidate record {report.record_id}</p>
      <p>
        {personalReportTypeLabel(report.report_type)} ·{' '}
        {periodLabel(report.period.start, report.period.end)}
      </p>
      {report.received_date.normalized && (
        <p className="ec-muted">Received {dateLabel(report.received_date.normalized)}</p>
      )}
      <dl className="ex-metrics">
        {keys.map((key) => (
          <div key={key}>
            <dt>{labels[key]}</dt>
            <dd>
              <strong>{fieldMoney(report.measures[key])}</strong>
              <button
                className="ec-link ec-filing-period"
                disabled={!enabled}
                onClick={() => showSource(`board-report:${report.report_key}:measures.${key}`)}
              >
                View source
                <span className="ec-sr-only"> for personal expenditures {labels[key]}</span>
              </button>
            </dd>
          </div>
        ))}
      </dl>
      <p className="ec-muted">Public subsidy N/A</p>
      <button
        className="ec-link"
        disabled={!enabled}
        onClick={() => showSource(`board-report:${report.report_key}:report`)}
      >
        View report
      </button>
      <h5>Non-itemized spending</h5>
      <dl className="ex-metrics">
        {keys.map((key) => (
          <div key={key}>
            <dt>{labels[key]}</dt>
            <dd>
              {fieldMoney(report.nonitemized[key])}
              <button
                className="ec-link ec-filing-period"
                disabled={!enabled}
                onClick={() => showSource(`board-report:${report.report_key}:nonitemized.${key}`)}
              >
                View source
                <span className="ec-sr-only"> for non-itemized {labels[key]}</span>
              </button>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function BoardRecordNotice({
  record,
  enabled,
  showSource,
}: {
  record: BoardCandidateRecord;
  enabled: boolean;
  showSource: (key: string) => void;
}) {
  const source = record.sources?.catalogue;
  return (
    <div className="ex-account">
      <p>Board candidate record {record.record_id}</p>
      <p>
        {record.availability?.state === 'no_report_information_returned'
          ? 'No report information returned for this Board record'
          : 'Selected report unavailable'}
      </p>
      {source && (
        <>
          <p className="ec-muted">Source copied {dateLabel(source.copied_at)}</p>
          <button
            className="ec-link"
            disabled={!enabled}
            onClick={() => showSource(`board-record:${record.record_id}:catalogue`)}
          >
            View source
          </button>
        </>
      )}
    </div>
  );
}

export function personalEvidence(data: ExpenseAnswer, key: string): ElectionEvidence | null {
  const [prefix, id, kind] = key.split(':');
  if (prefix === 'board-record') {
    const record = data.board_candidate_records?.find((r) => r.record_id === id);
    const source = kind === 'catalogue' ? record?.sources?.catalogue : undefined;
    if (!source) return null;
    return {
      attachment: source.retained_source_url.replace(/^\/api\/v1\//, ''),
      evidence: {
        title: `Board candidate record ${id}`,
        authority: BOARD,
        checked: 'Checked',
        rows: [
          { label: 'Source copied', value: dateLabel(source.copied_at) },
          {
            label: 'Report information',
            value:
              record?.availability?.state === 'no_report_information_returned'
                ? 'None returned for this record'
                : 'Available',
          },
        ],
      },
    };
  }
  if (prefix !== 'board-report') return null;
  const report = data.personal_reports?.find((r) => r.report_key === id);
  if (!report) return null;
  const [family, fieldKey] = (kind ?? '').split('.');
  const field =
    (family === 'measures' || family === 'nonitemized') &&
    keys.includes(fieldKey as (typeof keys)[number])
      ? report[family][fieldKey as (typeof keys)[number]]
      : undefined;
  if (kind !== 'report' && !field) return null;
  const title = field
    ? `${family === 'nonitemized' ? 'Non-itemized' : 'Personal expenditures'} · ${labels[fieldKey as (typeof keys)[number]]}`
    : `${report.name} · ${personalReportTypeLabel(report.report_type)}`;
  return {
    attachment: report.source_url.replace(/^\/api\/v1\//, ''),
    pdfPage: field?.page,
    evidence: {
      title,
      authority: BOARD,
      checked: 'Checked',
      quote: field?.literal || undefined,
      rows: [
        { label: 'Board candidate record', value: report.record_id ?? 'N/A' },
        {
          label: 'Reporting period',
          value: periodLabel(report.period.start, report.period.end),
        },
        {
          label: 'Received',
          value: dateLabel(report.received_date.normalized),
        },
        {
          label: 'Signed',
          value: dateLabel(report.certification_date.normalized),
        },
        { label: 'Source copied', value: dateLabel(report.source.copied_at) },
        ...(field
          ? [
              { label: 'Amount', value: fieldMoney(field) },
              { label: 'Status', value: fieldStatus(field) },
              { label: 'Source location', value: `Page ${field.page}` },
            ]
          : []),
      ],
    },
  };
}

/** Different personal reports retain their own periods and native totals. */
export function PersonalComparisons({ data }: { data: ExpenseAnswer }) {
  const band = useBand();
  const reports = data.personal_reports ?? [];
  if (!reports.length) return null;
  return (
    <section className="ec-section">
      <h2>Personal expenditures</h2>
      <p className="ec-muted">
        Filed without a campaign committee; separate from campaign-account totals
      </p>
      {reports.map((report) => {
        const rows = report.by_filed_address
          ? ([
              ['Minnesota', report.by_filed_address.MN],
              ['Out of state', report.by_filed_address.out_of_state],
              ['Location N/A', report.by_filed_address.unknown],
              [
                'Itemized total',
                {
                  before: report.itemized_before_exclusions,
                  after: report.itemized_after_exclusions,
                },
              ],
            ] as const)
          : [];
        return (
          <article className="ex-authority-comparison" key={report.report_key}>
            <h3>
              {report.claim?.name ?? report.name} · {partyLabel(report.claim?.filed_party ?? null)}
            </h3>
            <p>{periodLabel(report.period.start, report.period.end)}</p>
            {rows.length ? (
              band === 'phone' ? (
                <ul className="ex-summary-cards">
                  {rows.map(([label, value]) => (
                    <li key={label}>
                      <h5>{label}</h5>
                      <dl className="ex-metrics">
                        <div>
                          <dt>Before exclusions</dt>
                          <dd>{value.before == null ? 'N/A' : moneyLabel(value.before)}</dd>
                        </div>
                        <div>
                          <dt>After exclusions</dt>
                          <dd>{value.after == null ? 'N/A' : moneyLabel(value.after)}</dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="ex-table-wrap">
                  <table className="ex-table">
                    <thead>
                      <tr>
                        <th scope="col">Payee location</th>
                        <th scope="col">Before exclusions</th>
                        <th scope="col">After exclusions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(([label, value]) => (
                        <tr key={label}>
                          <th scope="row">{label}</th>
                          <td className="ex-number">
                            {value.before == null ? 'N/A' : moneyLabel(value.before)}
                          </td>
                          <td className="ex-number">
                            {value.after == null ? 'N/A' : moneyLabel(value.after)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <p>No itemized payments in this report</p>
            )}
          </article>
        );
      })}
    </section>
  );
}
