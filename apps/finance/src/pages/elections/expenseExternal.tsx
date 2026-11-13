import type { ElectionEvidence } from './Evidence';
import type {
  AuthorityReport,
  ExpenseAnswer,
  ReportedAmount,
  AuthoritySummary,
} from './expenseReportData';
import { PARTY_LABELS, sumMoney } from './expenseReportData';
import { useBand } from '../../ui/band';
import {
  accountIdentity,
  externalSourcePath,
  fieldGapLabel,
  sourceLocator,
  sourceLocationLabel,
} from './externalData';
import { SourceFieldGaps } from './sourceFieldGaps';
import { count, dateLabel, reportedFigureLabel, reportedMoneyLabel, periodLabel } from './format';

/** Reuses the expense account treatment. Native measures retain their scope;
 * neither cover figures nor memorandum details are blended into Board totals. */
export function AuthorityFigures({
  account,
  enabled,
  showSource,
}: {
  account: AuthorityReport;
  enabled: boolean;
  showSource: (key: string) => void;
}) {
  const source = (kind: string, index: number) =>
    showSource(`external-report:${account.report_key}:${kind}:${index}`);
  const after = account.reported_itemized_after_exclusions ?? [];
  const identity = accountIdentity(account);
  return (
    <section className="ex-account ex-authority-account">
      <h4>{account.account_name || identity.summary}</h4>
      <p className="ec-muted">
        {account.authority_name} · {identity.summary}
      </p>
      <p>
        {account.report_type} · {periodLabel(account.period_start, account.period_end)}
      </p>
      {account.received_date && (
        <p className="ec-muted">Received {dateLabel(account.received_date)}</p>
      )}
      <dl className="ex-metrics">
        {(account.reported_measures ?? []).map((figure, index) => (
          <div key={`${figure.measure}:${figure.basis}:${index}`}>
            <dt>
              {figure.label}
              {(figure.period_start !== account.period_start ||
                figure.period_end !== account.period_end) && (
                <small className="ec-filing-period">
                  {periodLabel(figure.period_start, figure.period_end)}
                </small>
              )}
            </dt>
            <dd>
              <strong>{reportedFigureLabel(figure)}</strong>
              {figure.sources.map((_, i) => (
                <button
                  key={i}
                  className="ec-link ec-filing-period"
                  disabled={!enabled}
                  onClick={() => source(`figure.${index}`, i)}
                >
                  View source
                  <span className="ec-sr-only"> for {figure.label}</span>
                </button>
              ))}
            </dd>
          </div>
        ))}
        <SourceFieldGaps
          gaps={account.source_field_gaps}
          enabled={enabled}
          onSource={(gap, index) => source(`gap.${gap}`, index)}
        />
      </dl>
      {!account.reported_measures?.length && !account.source_field_gaps?.length && (
        <p>Report figures unavailable</p>
      )}
      {!!account.unavailable_measures?.length && (
        <p className="ec-muted">Some figure sources are unavailable</p>
      )}
      {!!account.withheld_measures?.length && (
        <p className="ec-muted">Some figures fall outside the checked account dates</p>
      )}
      <p className="ec-muted">Public subsidy unavailable</p>
      {(account.reported_itemized_before_exclusions ?? []).map((item, index) => {
        const adjusted = after.find((row) => sameMeasure(row, item));
        return (
          <div className="ex-itemized-measure" key={`${item.measure}:${item.basis}:${index}`}>
            <h5>{item.label}</h5>
            {(item.period_start !== account.period_start ||
              item.period_end !== account.period_end) && (
              <p className="ec-muted">{periodLabel(item.period_start, item.period_end)}</p>
            )}
            <dl className="ex-metrics">
              <div>
                <dt>Before exclusions</dt>
                <dd>{reportedMoneyLabel(item.amount, item.currency)}</dd>
              </div>
              <div>
                <dt>After exclusions</dt>
                <dd>{reportedMoneyLabel(adjusted?.amount, item.currency)}</dd>
              </div>
            </dl>
          </div>
        );
      })}
      <p className="ec-muted">
        Itemized records may be partial; their sum is separate from the report total
      </p>
      {account.memo_detail_count > 0 && (
        <p className="ec-muted">
          {count(account.memo_detail_count)} supplemental memo{' '}
          {account.memo_detail_count === 1 ? 'record' : 'records'}, not added to spending
        </p>
      )}
      {account.sources.map((_, i) => (
        <button key={i} className="ec-link" disabled={!enabled} onClick={() => source('report', i)}>
          View report{account.sources.length > 1 ? ` ${i + 1}` : ''}
        </button>
      ))}
    </section>
  );
}
const sameMeasure = (a: ReportedAmount, b: ReportedAmount) =>
  a.authority === b.authority &&
  a.currency === b.currency &&
  a.report_key === b.report_key &&
  a.measure === b.measure &&
  a.basis === b.basis &&
  a.period_start === b.period_start &&
  a.period_end === b.period_end;

export function authorityEvidence(
  data: ExpenseAnswer,
  account: AuthorityReport,
  key: string,
): ElectionEvidence | null {
  const [prefix, reportKey, kind, rawIndex] = key.split(':');
  if (
    prefix !== 'external-report' ||
    reportKey !== account.report_key ||
    !/^\d+$/.test(rawIndex ?? '')
  )
    return null;
  const figureIndex = /^figure\.(\d+)$/.exec(kind)?.[1];
  const figure =
    figureIndex === undefined ? undefined : account.reported_measures?.[Number(figureIndex)];
  const gapIndex = /^gap\.(\d+)$/.exec(kind)?.[1];
  const gap = gapIndex === undefined ? undefined : account.source_field_gaps?.[Number(gapIndex)];
  if (kind !== 'report' && !figure && !gap) return null;
  const binding = (figure?.sources ?? gap?.sources ?? account.sources)[Number(rawIndex)];
  if (!binding) return null;
  const locator = sourceLocator(binding, account);
  const location = sourceLocationLabel(locator, account);
  const identity = accountIdentity(account);
  return {
    attachment: data.external_generation_id
      ? externalSourcePath(
          {
            election_key: data.election_key,
            generation_id: data.external_generation_id,
          },
          binding.source_sha256,
        )
      : null,
    pdfPage: typeof locator.page === 'number' ? locator.page : undefined,
    evidence: {
      title:
        figure?.label ??
        gap?.label ??
        `${account.account_name || identity.summary} · ${account.report_type}`,
      authority: account.authority_name,
      checked: 'Checked',
      quote: binding.quote || undefined,
      rows: [
        { label: identity.label, value: identity.value },
        ...(account.source_report_id ? [{ label: 'Report', value: account.source_report_id }] : []),
        ...(gap ? [{ label: 'Status', value: fieldGapLabel(gap.state) }] : []),
        {
          label: 'Reporting period',
          value: periodLabel(
            figure?.period_start ?? account.period_start,
            figure?.period_end ?? account.period_end,
          ),
        },
        ...(account.received_date
          ? [{ label: 'Received', value: dateLabel(account.received_date) }]
          : []),
        ...(figure
          ? [
              {
                label: figure.label,
                value: reportedFigureLabel(figure),
              },
            ]
          : []),
        ...(location ? [{ label: 'Source location', value: location }] : []),
        ...(binding.source_copied_at
          ? [{ label: 'Copied', value: dateLabel(binding.source_copied_at) }]
          : []),
      ],
    },
  };
}

/** Only matching authority, measure, basis, currency and period can be combined. */
export function authorityGroups(rows: AuthoritySummary[]) {
  const groups = new Map<string, AuthoritySummary[]>();
  for (const row of rows) {
    const key = JSON.stringify([
      row.authority,
      row.measure,
      row.basis,
      row.currency,
      row.period_start,
      row.period_end,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()];
}
export function AuthorityComparisons({ data }: { data: ExpenseAnswer }) {
  const band = useBand();
  const groups = authorityGroups(data.authority_summary ?? []);
  if (!groups.length) return null;
  return (
    <section className="ec-section">
      <h2>Other filing authorities</h2>
      <p className="ec-muted">
        Itemized spending by party and filed payee address; separate totals for each measure and
        reporting period
      </p>
      {groups.map(([key, rows]) => {
        const first = rows[0];
        const unassigned = (row: AuthoritySummary) => {
          const report = data.authority_reports?.find(
            (item) => item.authority === row.authority && item.report_key === row.report_key,
          );
          return (
            report?.party_group === 'unknown' &&
            report.party_classification_state !== 'ballot_party_not_in_source'
          );
        };
        const partyRows = Object.entries(PARTY_LABELS).map(([party, label]) => ({
          label,
          before: sumMoney(
            rows
              .filter((row) => party !== 'unknown' || !unassigned(row))
              .map((row) => row.by_party[party as keyof typeof PARTY_LABELS]?.baseline),
          ),
          after: sumMoney(
            rows
              .filter((row) => party !== 'unknown' || !unassigned(row))
              .map((row) => row.by_party[party as keyof typeof PARTY_LABELS]?.adjusted),
          ),
        }));
        if (rows.some(unassigned)) {
          partyRows.push({
            label: 'Party cannot be assigned',
            before: sumMoney(rows.filter(unassigned).map((row) => row.by_party.unknown?.baseline)),
            after: sumMoney(rows.filter(unassigned).map((row) => row.by_party.unknown?.adjusted)),
          });
        }
        const geographyRows = [
          ['MN', 'Minnesota'],
          ['out_of_state', 'Out of state'],
          ['unknown', 'Location unavailable'],
        ].map(([geo, label]) => ({
          label,
          before: sumMoney(
            rows.map(
              (row) =>
                row.by_filed_address[geo as keyof AuthoritySummary['by_filed_address']]?.baseline,
            ),
          ),
          after: sumMoney(
            rows.map(
              (row) =>
                row.by_filed_address[geo as keyof AuthoritySummary['by_filed_address']]?.adjusted,
            ),
          ),
        }));
        const total = {
          label: 'Itemized total',
          before: sumMoney(rows.map((row) => row.baseline)),
          after: sumMoney(rows.map((row) => row.adjusted)),
        };
        const sections: Array<[string, typeof partyRows]> = [
          ['Party', partyRows],
          ['Payee location', geographyRows],
        ];
        return (
          <article className="ex-authority-comparison" key={key}>
            <h3>
              {first.authority_name} · {first.label}
            </h3>
            <p>
              {periodLabel(first.period_start, first.period_end)} · {count(rows.length)} account
              reports
            </p>
            <p className="ec-muted">Known itemized subtotal; unavailable detail is not zero</p>
            {sections.map(([title, values]) => {
              const items = [...values, total];
              return (
                <div key={title} className="ex-native-summary">
                  <h4>{title}</h4>
                  {band === 'phone' ? (
                    <ul className="ex-summary-cards">
                      {items.map((row) => (
                        <li key={row.label}>
                          <h5>{row.label}</h5>
                          <dl className="ex-metrics">
                            <div>
                              <dt>Before exclusions</dt>
                              <dd>{reportedMoneyLabel(row.before, first.currency)}</dd>
                            </div>
                            <div>
                              <dt>After exclusions</dt>
                              <dd>{reportedMoneyLabel(row.after, first.currency)}</dd>
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
                            <th scope="col">{title}</th>
                            <th scope="col">Before exclusions</th>
                            <th scope="col">After exclusions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((row) => (
                            <tr key={row.label}>
                              <th scope="row">{row.label}</th>
                              <td className="ex-number">
                                {reportedMoneyLabel(row.before, first.currency)}
                              </td>
                              <td className="ex-number">
                                {reportedMoneyLabel(row.after, first.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </article>
        );
      })}
    </section>
  );
}
