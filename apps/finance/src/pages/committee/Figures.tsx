import { EMPTY_YEAR_VALUE } from '@alethical/shared/committeeMoney';
import {
  MONEY_OUT_OFFICIAL_MISSING,
  MONEY_OUT_ZERO_NOTE,
} from '@alethical/shared/committeeMoneyShared';
import { reportPeriodLine } from '@alethical/shared/committeePaymentsPage';
import { formatDay, formatMoney } from '@alethical/shared/moneyFormat';

import { Dropdown } from '../../ui/controls';
import { reportOptions } from './data';
import type { CommitteeFinance, Filing } from './types';

interface Figure {
  label: string;
  value: string;
  note: string | null;
}

/** The period a report's figures cover: the Board calendar's start where one is
 * printed, never an assumed 1 January. */
function periodLine(end: string, start: string | null): string | null {
  const last = formatDay(end);
  const first = formatDay(start);
  if (!last) return null;
  return first ? `Period ${first} to ${last}` : reportPeriodLine(end, null);
}

/**
 * Official report figures (Committee drawing): the filer's own totals, as filed in
 * the selected report. A figure we do not hold for that report reads as missing
 * ("Report total unavailable", or the line saying we hold no official spending
 * total), never as $0.
 */
export function Figures({
  finance,
  filings,
  report,
  onReport,
}: {
  finance: CommitteeFinance;
  filings: readonly Filing[];
  report: string;
  onReport: (value: string) => void;
}) {
  const year = finance.year;
  const moneyIn = finance.money_in;
  const moneyOut = finance.money_out;
  const options = reportOptions(
    year,
    [
      moneyIn.reported_total !== null ? moneyIn.reported_through : null,
      moneyOut.reported_total !== null ? moneyOut.reported_through : null,
    ],
    filings,
  );
  const chosen = options.find((option) => option.value === report) ?? options[0] ?? null;
  const figures: Figure[] = [];
  const inValue =
    chosen && moneyIn.reported_through === chosen.periodEnd
      ? formatMoney(moneyIn.reported_total)
      : null;
  const outValue =
    chosen && moneyOut.reported_through === chosen.periodEnd
      ? formatMoney(moneyOut.reported_total)
      : null;
  // Rule 12 (.claude/rules/grounded-answers.md): a figure the selected report
  // does not give us is said to be missing, never left out or shown as $0.
  if (inValue || outValue) {
    figures.push({ label: 'Contributions', value: inValue ?? EMPTY_YEAR_VALUE, note: null });
    if (outValue) {
      figures.push({
        label: 'Expenditures',
        value: outValue,
        note: outValue === '$0' ? MONEY_OUT_ZERO_NOTE : null,
      });
    }
  }
  const spendingMissing = Boolean(inValue) && !outValue;
  const start =
    chosen && moneyIn.reported_through === chosen.periodEnd
      ? (moneyIn.reported_period_start ?? chosen.filing?.period_start ?? null)
      : (chosen?.filing?.period_start ?? null);
  const period = chosen ? periodLine(chosen.periodEnd, start) : null;
  const menu = options.filter((option) => option.label);
  return (
    <section aria-labelledby="cmt-official-h" className="f-card cmt-card cmt-official">
      <div className="cmt-official-head">
        <h3 id="cmt-official-h" className="cmt-mono-label">
          OFFICIAL REPORT FIGURES
        </h3>
        {chosen && menu.length === options.length && (
          <div className="cmt-report">
            <Dropdown
              name="Report"
              value={chosen.value}
              options={menu.map((option) => ({ value: option.value, label: option.label }))}
              onChange={onReport}
            />
          </div>
        )}
      </div>
      {figures.length > 0 ? (
        <>
          <dl className="cmt-figures">
            {figures.map((figure) => (
              <div key={figure.label} className="cmt-figure-box">
                <dt>{figure.label}</dt>
                <dd className="cmt-figure">{figure.value}</dd>
                {figure.note && <dd className="cmt-figure-note">{figure.note}</dd>}
              </div>
            ))}
          </dl>
          {spendingMissing && <p className="cmt-note">{MONEY_OUT_OFFICIAL_MISSING}</p>}
          <p className="cmt-note">
            {period ? `${period}. ` : ''}Figures are as filed in the selected report. Itemized rows
            below follow the year, not the report.
          </p>
        </>
      ) : (
        <p className="cmt-none">
          No official report figures are held for {year}. Itemized rows below come from the state’s
          payment files and are shown by year.
        </p>
      )}
    </section>
  );
}
