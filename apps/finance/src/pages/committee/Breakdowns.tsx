import { useState } from 'react';
import { donorStateNames } from '@alethical/shared/contributionFigures';

import { Link } from '../../router';
import { withFrom } from '../../returnContext';
import { hrefFor, isBuilt } from '../../routes';
import { useBand } from '../../ui/band';
import { formatDay, formatMoney } from '../../ui/money';
import { useView, ViewSwitch } from '../../ui/view';
import type { DonorStates, NameConnections, StatedByKind } from './types';

/**
 * The 3 breakdowns the committee finance read serves (Committee drawing, Rounds 30
 * and 31): contributions by type as filed in 1 report, individual contributions by
 * state and donor names also at other candidate committees for the calendar year.
 * A block the server leaves out or cannot read says so in its own words; nothing
 * missing becomes $0, and no figure is added across committees
 * (`.claude/rules/grounded-answers.md` rule 12).
 */

function count(value: number): string {
  return value.toLocaleString('en-US');
}

/** A served decimal as a number for a bar's length, or null when unreadable. */
function amount(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pct(value: number, max: number): string {
  return value > 0 ? `${(value / max) * 100}%` : '0%';
}

// --- Contributions by type, as filed --------------------------------------------------

export interface KindRow {
  key: string;
  label: string;
  filed: string;
  itemized: string;
  diff: string;
  filedAmount: number;
  itemizedAmount: number;
}

export type KindView =
  | { state: 'reported'; rows: KindRow[]; through: string }
  | { state: 'disagree' }
  | { state: 'unavailable' };

/**
 * The type breakdown for the selected report. The server proves 1 comparison per
 * committee-year, for the filing whose period ends `reported_through`; any other
 * report of the year shows no numbers. A negative difference, or a figure we
 * cannot read, is never printed as a breakdown.
 */
export function kindView(block: StatedByKind | undefined, cutOff: string | null): KindView {
  if (!block || !cutOff || block.reported_through !== cutOff) return { state: 'unavailable' };
  if (block.state === 'sources_disagree') return { state: 'disagree' };
  if (block.state !== 'reported' || block.lines.length === 0) return { state: 'unavailable' };
  const rows: KindRow[] = [];
  for (const line of block.lines) {
    const filedAmount = amount(line.stated_total);
    const itemizedAmount = amount(line.itemized_cash_total);
    const difference = amount(line.difference);
    if (
      filedAmount === null ||
      itemizedAmount === null ||
      difference === null ||
      !line.label_as_filed
    ) {
      return { state: 'unavailable' };
    }
    if (difference < 0) return { state: 'disagree' };
    rows.push({
      key: line.line_key,
      label: line.label_as_filed,
      filed: formatMoney(line.stated_total) ?? '',
      itemized: formatMoney(line.itemized_cash_total) ?? '',
      diff: formatMoney(line.difference) ?? '',
      filedAmount,
      itemizedAmount,
    });
  }
  const day = formatDay(block.reported_through);
  if (!day) return { state: 'unavailable' };
  return {
    state: 'reported',
    rows,
    through: `Filed totals and itemized cash through ${day.replace(/ /g, ' ')}`,
  };
}

function KindValues({ row }: { row: KindRow }) {
  return (
    <>
      <span className="cmt-bk-value">
        Filed total <strong>{row.filed}</strong>
      </span>
      <span className="cmt-bk-value">
        Itemized cash <strong>{row.itemized}</strong>
      </span>
      <span className="cmt-bk-value">
        Difference <strong>{row.diff}</strong>
      </span>
    </>
  );
}

/** "Contributions by type, as filed", inside the Official report figures card. */
export function KindBreakdown({
  block,
  cutOff,
}: {
  block: StatedByKind | undefined;
  cutOff: string | null;
}) {
  const band = useBand();
  const [view, setView] = useView('typeView');
  const shown = kindView(block, cutOff);
  const max =
    shown.state === 'reported' ? Math.max(1, ...shown.rows.map((row) => row.filedAmount)) : 1;
  return (
    <div className="cmt-bk-kind">
      <div className="cmt-bk-head">
        <h4 className="cmt-bk-kind-title">Contributions by type, as filed</h4>
        {shown.state === 'reported' && <ViewSwitch value={view} onChange={setView} />}
      </div>
      {shown.state === 'reported' && (
        <>
          {view === 'chart' && (
            <>
              <div aria-hidden="true" className="cmt-bk-legend">
                <span>
                  <span className="cmt-bk-swatch" />
                  Filed total
                </span>
                <span>
                  <span className="cmt-bk-tick" />
                  Itemized cash
                </span>
              </div>
              <ul aria-label="Contributions by type, as filed" className="f-bars cmt-bk-bars">
                {shown.rows.map((row) => (
                  <li key={row.key} className="f-bar-row">
                    <span className="f-bar-label cmt-bk-label">{row.label}</span>
                    <span aria-hidden="true" className="f-bar-track">
                      {row.filedAmount > 0 && (
                        <span className="f-bar-fill" style={{ width: pct(row.filedAmount, max) }} />
                      )}
                      {row.itemizedAmount > 0 && (
                        <span
                          className="f-bar-marker cmt-bk-marker"
                          style={{ left: pct(row.itemizedAmount, max) }}
                        />
                      )}
                    </span>
                    <span className="f-bar-note cmt-bk-values">
                      <KindValues row={row} />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {view === 'table' && band === 'phone' && (
            <dl className="cmt-bk-list">
              {shown.rows.map((row) => (
                <div key={row.key}>
                  <dt>{row.label}</dt>
                  <dd className="cmt-bk-values">
                    <KindValues row={row} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {view === 'table' && band !== 'phone' && (
            <table className="cmt-bk-table">
              <thead>
                <tr>
                  <th scope="col">TYPE</th>
                  <th scope="col">FILED TOTAL</th>
                  <th scope="col">ITEMIZED CASH</th>
                  <th scope="col">DIFFERENCE</th>
                </tr>
              </thead>
              <tbody>
                {shown.rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td>{row.filed}</td>
                    <td>{row.itemized}</td>
                    <td className="cmt-bk-muted">{row.diff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="cmt-bk-end">{shown.through}</p>
        </>
      )}
      {shown.state === 'disagree' && <p className="cmt-none">The sources disagree</p>}
      {shown.state === 'unavailable' && (
        <p className="cmt-none">A type breakdown isn’t available for this report</p>
      )}
    </div>
  );
}

// --- Individual contributions by state ------------------------------------------------

export interface StateRow {
  key: string;
  label: string;
  cash: string;
  cashAmount: number;
  names: string;
  sub: boolean;
}

/**
 * Minnesota, Other states and Unknown; opened, each other state follows Other
 * states, largest cash first. A state code the name list does not know is printed
 * as served. A value we cannot read withholds the whole block.
 */
export function stateRows(block: DonorStates, open: boolean): StateRow[] | null {
  const row = (
    key: string,
    label: string,
    cash: string | null,
    names: number | null,
    sub: boolean,
  ): StateRow | null => {
    const cashAmount = amount(cash);
    if (cashAmount === null || names === null || names === undefined) return null;
    return { key, label, cash: formatMoney(cash) ?? '', cashAmount, names: count(names), sub };
  };
  const { minnesota, other_states: otherStates, unknown } = block.summary;
  const summary = [
    row('minnesota', 'Minnesota', minnesota.cash_total, minnesota.names, false),
    row('other_states', 'Other states', otherStates.cash_total, otherStates.names, false),
    row('unknown', 'Unknown', unknown.cash_total, unknown.names, false),
  ];
  const detail = block.rows
    .filter((item) => item.state !== 'MN' && item.state !== 'unknown')
    .map((item) =>
      row(
        `state-${item.state}`,
        donorStateNames[item.state] ?? item.state,
        item.cash_total,
        item.names,
        true,
      ),
    );
  if (summary.some((item) => item === null) || detail.some((item) => item === null)) return null;
  const [mn, others, unknownRow] = summary as StateRow[];
  const each = (detail as StateRow[]).sort(
    (a, b) => b.cashAmount - a.cashAmount || a.label.localeCompare(b.label),
  );
  return open ? [mn, others, ...each, unknownRow] : [mn, others, unknownRow];
}

function StatesBlock({ block, year }: { block: DonorStates | undefined; year: number }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useView('stateView');
  const title = `Individual contributions by state, ${year}`;
  const held = block && block.state === 'reported' && block.year === year ? block : null;
  const reference = held?.reference.as_of
    ? (formatDay(held.reference.as_of) ?? held.reference.as_of)
    : null;
  const rows = held && reference ? stateRows(held, open) : null;
  const max = rows ? Math.max(1, ...rows.map((row) => row.cashAmount)) : 1;
  return (
    <section aria-labelledby="cmt-states-h" className="f-card cmt-card cmt-bk-card">
      <div className="cmt-bk-head">
        <h2 id="cmt-states-h" className="cmt-bk-title">
          {title}
        </h2>
        {rows && <ViewSwitch value={view} onChange={setView} />}
      </div>
      {rows && (
        <>
          {view === 'chart' && (
            <ul aria-label={title} className="f-bars cmt-bk-bars cmt-bk-stacked">
              {rows.map((row) => (
                <li key={row.key} className="f-bar-row" data-sub={row.sub || undefined}>
                  <span className="f-bar-label cmt-bk-label">{row.label}</span>
                  <span aria-hidden="true" className="f-bar-track">
                    {row.cashAmount > 0 && (
                      <span className="f-bar-fill" style={{ width: pct(row.cashAmount, max) }} />
                    )}
                  </span>
                  <span className="f-bar-note">
                    <strong className="cmt-bk-strong">{row.cash}</strong> · Printed names{' '}
                    {row.names}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {view === 'table' && (
            <table className="cmt-bk-table cmt-bk-states">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="f-visually-hidden">State</span>
                  </th>
                  <th scope="col">CASH</th>
                  <th scope="col">PRINTED NAMES</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} data-sub={row.sub || undefined}>
                    <th scope="row">{row.label}</th>
                    <td>{row.cash}</td>
                    <td>{row.names}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="cmt-bk-toggle">
            <button
              type="button"
              aria-expanded={open}
              className="f-btn f-btn-secondary f-btn-small"
              onClick={() => setOpen((value) => !value)}
            >
              {open ? 'Hide each state' : 'Show each state'}
            </button>
          </div>
          <p className="cmt-bk-end">
            Cash excludes donated goods or services; printed-name counts include them. States are
            assigned from filed ZIP codes using the reference dated {reference}, not proof of
            residence. The same name may appear in more than one state or summary group.
          </p>
        </>
      )}
      {!rows && <p className="cmt-none">{`A state breakdown isn’t available for ${year}`}</p>}
    </section>
  );
}

// --- Donor names also at other candidate committees ----------------------------------

/** The served distribution's last bucket ("4+") in the drawing's words. */
function bucketLabel(value: string): string {
  return value === '4+' ? '4 or more' : value;
}

export function namesNoneLine(block: NameConnections | undefined, year: number): string {
  return block?.state === 'not_reported'
    ? `No individual contribution names are held for ${year}`
    : `Name connections are unavailable for ${year}`;
}

function NamesBlock({
  block,
  year,
  here,
}: {
  block: NameConnections | undefined;
  year: number;
  here: string;
}) {
  const held =
    block &&
    block.state === 'reported' &&
    block.year === year &&
    typeof block.numerator === 'number' &&
    typeof block.denominator === 'number'
      ? { ...block, numerator: block.numerator, denominator: block.denominator }
      : null;
  const nameHref = (name: string) =>
    isBuilt('payments-under-name')
      ? withFrom(
          hrefFor('payments-under-name', { query: name }, { role: 'donor', year: String(year) }),
          here,
        )
      : null;
  return (
    <section aria-labelledby="cmt-names-h" className="f-card cmt-card cmt-bk-card">
      <h2 id="cmt-names-h" className="cmt-bk-title">
        {`Donor names also at other candidate committees, ${year}`}
      </h2>
      {held && (
        <>
          <p className="cmt-bk-summary">
            {`${count(held.denominator)} printed individual donor names · ${count(held.numerator)} also appear at another candidate committee`}
          </p>
          <table className="cmt-bk-table cmt-bk-dist">
            <thead>
              <tr>
                <th scope="col">OTHER CANDIDATE COMMITTEES</th>
                <th scope="col">NAMES</th>
              </tr>
            </thead>
            <tbody>
              {held.distribution.map((bucket) => (
                <tr key={bucket.other_committees}>
                  <th scope="row">{bucketLabel(bucket.other_committees)}</th>
                  <td>{count(bucket.names)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {held.top_names.length > 0 && (
            <>
              <h3 className="cmt-bk-sub">Names by number of other candidate committees</h3>
              <ul className="cmt-bk-ranked">
                {held.top_names.map((item) => {
                  const href = nameHref(item.name);
                  const n = `${count(item.other_committees)} other ${
                    item.other_committees === 1 ? 'committee' : 'committees'
                  }`;
                  const inner = (
                    <>
                      <span className="cmt-bk-rank-name">{item.name}</span>
                      <span className="cmt-bk-rank-n">{n}</span>
                    </>
                  );
                  return (
                    <li key={item.name}>
                      {href ? (
                        <Link to={href} className="cmt-bk-rank">
                          {inner}
                        </Link>
                      ) : (
                        <span className="cmt-bk-rank">{inner}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <p className="cmt-bk-end">
            Exact printed names in the same year’s copy. A shared name does not show the same
            person.
          </p>
        </>
      )}
      {!held && <p className="cmt-none">{namesNoneLine(block, year)}</p>}
    </section>
  );
}

/** The calendar-year blocks under the payments: by state for a candidate
 * committee only, beside name connections at computer. */
export function YearBlocks({
  donorStates,
  nameConnections,
  candidate,
  year,
  here,
}: {
  donorStates: DonorStates | undefined;
  nameConnections: NameConnections | undefined;
  candidate: boolean;
  year: number;
  here: string;
}) {
  return (
    <div className="cmt-bk-grid" data-pair={candidate || undefined}>
      {candidate && <StatesBlock block={donorStates} year={year} />}
      <NamesBlock block={nameConnections} year={year} here={here} />
    </div>
  );
}
