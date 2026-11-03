import { EMPTY_YEAR_VALUE } from '@alethical/shared/committeeMoney';
import {
  MONEY_OUT_OFFICIAL_MISSING,
  MONEY_OUT_ZERO_NOTE,
} from '@alethical/shared/committeeMoneyShared';
import { REPORT_LOAD_ERROR, reportPeriodLine } from '@alethical/shared/committeePaymentsPage';
import { formatDay, formatMoney } from '../../ui/money';

import type { Read } from '../../api/read';
import { Dropdown, Refused } from '../../ui/controls';
import { LoadingLine } from '../../ui/parts';
import { KindBreakdown } from './Breakdowns';
import type { ReportFigureRow, ReportFigures, StatedByKind } from './types';

interface Figure {
  label: string;
  value: string;
  missing: boolean;
  note: string | null;
}

/** "2026 Pre-Primary Report · Amendment 1" or "… · as filed": the Board's report
 * name with the version our copy holds. */
export function reportFigureLabel(row: ReportFigureRow): string | null {
  if (!row.report_name) return null;
  const index = row.effective_amendment_index;
  if (index === null || index === undefined) return row.report_name;
  return `${row.report_name} · ${index > 0 ? `Amendment ${index}` : 'as filed'}`;
}

/** The period a report's figures cover: the Board calendar's start where one is
 * printed, never an assumed 1 January. */
function periodLine(end: string | null, start: string | null): string | null {
  const last = formatDay(end);
  const first = formatDay(start);
  if (!last || !end) return null;
  return first ? `Period ${first} to ${last}` : reportPeriodLine(end, null);
}

/**
 * The 5 official figures of 1 report, as filed (Committee drawing; Round 37 names
 * "Total expenditures"). A figure the report does not give us reads "Report total
 * unavailable", never $0. A missing spending total is said in its own sentence and
 * a filed $0 carries the filing's own-zero note (grounded-answers rule 12).
 */
export function reportFigures(row: ReportFigureRow): { figures: Figure[]; notes: string[] } {
  const box = (label: string, amount: string | null, note: string | null = null): Figure => {
    const value = formatMoney(amount);
    return { label, value: value ?? EMPTY_YEAR_VALUE, missing: value === null, note };
  };
  const spending = formatMoney(row.total_expenditures);
  const figures = [
    box('Beginning balance', row.beginning_cash_balance),
    box('Total receipts', row.total_receipts),
    box('Contributions', row.contributions),
    ...(spending
      ? [
          box(
            'Total expenditures',
            row.total_expenditures,
            spending === '$0' ? MONEY_OUT_ZERO_NOTE : null,
          ),
        ]
      : []),
    box('Ending balance', row.ending_cash_balance),
  ];
  return { figures, notes: spending ? [] : [MONEY_OUT_OFFICIAL_MISSING] };
}

/**
 * Official report figures (Committee drawing): the filer's own totals as filed in
 * the selected report, read from the report-figures route. The menu offers the
 * year's reports whose figures we hold; the chosen one rides in the address as
 * `report` (Round 37).
 */
export function Figures({
  read,
  year,
  report,
  onReport,
  byKind,
}: {
  read: Read<ReportFigures>;
  year: number;
  report: string;
  onReport: (value: string) => void;
  /** The committee-year's filed contribution lines, for the report they match. */
  byKind?: StatedByKind;
}) {
  const data = read.data && read.data.year === year ? read.data : null;
  const held = data ? data.reports.filter((row) => row.figures_state === 'reported') : [];
  const options = held.map((row) => ({
    value: String(row.record_number),
    label: reportFigureLabel(row) ?? '',
  }));
  const chosen = held.find((row) => String(row.record_number) === report) ?? held[0] ?? null;
  const shown = chosen ? reportFigures(chosen) : null;
  const period = chosen ? periodLine(chosen.cut_off_date, chosen.period_start) : null;
  const menu = options.every((option) => option.label) ? options : [];
  return (
    <section aria-labelledby="cmt-official-h" className="f-card cmt-card cmt-official">
      <div className="cmt-official-head">
        <h3 id="cmt-official-h" className="cmt-mono-label">
          OFFICIAL REPORT FIGURES
        </h3>
        {chosen && menu.length > 0 && (
          <div className="cmt-report">
            <Dropdown
              name="Report"
              value={String(chosen.record_number)}
              options={menu}
              onChange={onReport}
            />
          </div>
        )}
      </div>
      {!data && read.loading && (
        <div className="cmt-inline-status">
          <LoadingLine>Loading…</LoadingLine>
        </div>
      )}
      {!data && read.failed && (
        <div className="cmt-gap">
          <Refused onRetry={read.retry} retrying={read.pending}>
            {REPORT_LOAD_ERROR}
          </Refused>
        </div>
      )}
      {data && shown && (
        <>
          <dl className="cmt-figures">
            {shown.figures.map((figure) => (
              <div key={figure.label} className="cmt-figure-box">
                <dt>{figure.label}</dt>
                <dd className="cmt-figure" data-missing={figure.missing || undefined}>
                  {figure.value}
                </dd>
                {figure.note && <dd className="cmt-figure-note">{figure.note}</dd>}
              </div>
            ))}
          </dl>
          {shown.notes.map((note) => (
            <p key={note} className="cmt-note">
              {note}
            </p>
          ))}
          <KindBreakdown block={byKind} cutOff={chosen?.cut_off_date ?? null} />
          <p className="cmt-note">
            {period ? `${period}. ` : ''}Figures are as filed in the selected report. Itemized rows
            below follow the year, not the report.
          </p>
        </>
      )}
      {((data && !shown) || (!data && read.notFound)) && (
        <p className="cmt-none">
          No official report figures are held for {year}. Itemized rows below come from the state’s
          payment files and are shown by year.
        </p>
      )}
    </section>
  );
}
