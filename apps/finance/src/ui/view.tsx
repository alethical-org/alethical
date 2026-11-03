import type { KeyboardEvent, ReactNode } from 'react';

import { useAddressState } from './addressState';

/**
 * Chart or Table per section (Design Round 31, rule eug-141): every section
 * with a chart opens on Chart at every band; Table is one click away and holds
 * the same data and scope. An explicit choice is kept in the address under the
 * section's own key (`typeView`, `stateView`, `osView`, `spendView`); the
 * default is left out of the address.
 */
export type View = 'chart' | 'table';

export function useView(key: string): [View, (view: View) => void] {
  const [values, set] = useAddressState({ [key]: 'chart' });
  const view: View = values[key] === 'table' ? 'table' : 'chart';
  return [view, (next) => set({ [key]: next })];
}

/** The "View" group: Chart and Table buttons with aria-pressed; Left and Right
 * arrows move between them; the chosen one is ink-filled; hover underlines. */
export function ViewSwitch({
  value,
  onChange,
  label = 'View',
}: {
  value: View;
  onChange: (view: View) => void;
  label?: string;
}) {
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    buttons[1 - at]?.focus();
  }
  const views: ReadonlyArray<{ value: View; label: string }> = [
    { value: 'chart', label: 'Chart' },
    { value: 'table', label: 'Table' },
  ];
  return (
    <div role="group" aria-label={label} className="f-view" onKeyDown={onKey}>
      {views.map((view) => (
        <button
          key={view.value}
          type="button"
          aria-pressed={value === view.value}
          className="f-view-button"
          onClick={() => value !== view.value && onChange(view.value)}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}

/** One row of a horizontal bar chart. A bar starts at zero; a zero, negative
 * or unavailable value has no bar, only its printed value (Round 31). */
export interface BarRow {
  key: string;
  label: ReactNode;
  /** The amount the bar's length is drawn from, or null for no bar. */
  amount: number | null;
  /** The printed value beside the bar: "$1,200", "Not reported", "Missing payment amount". */
  value: string;
  /** Lines under the value, such as "Payments dated Mar 4 to Jun 30, 2026". */
  note?: ReactNode;
  /** A labelled gap: a dashed track with no bar ("No spending report held"). */
  gap?: boolean;
  /** A marker drawn on the bar at this amount (Committee: itemized cash on the filed total). */
  marker?: number | null;
}

/**
 * Horizontal bars (RULE Design system; Round 31): a labelled list for screen
 * readers, bars not focusable and not links, every bar with its value printed
 * beside it, scaled to the largest positive amount in the list.
 */
export function BarList({
  label,
  rows,
  labelWidth,
}: {
  label: string;
  rows: ReadonlyArray<BarRow>;
  /** The row label column, such as "56px" for years; a fraction otherwise. */
  labelWidth?: string;
}) {
  const max = Math.max(
    1,
    ...rows.map((row) => (row.amount !== null && row.amount > 0 ? row.amount : 0)),
  );
  const pct = (amount: number | null | undefined) =>
    amount !== null && amount !== undefined && amount > 0 ? `${(amount / max) * 100}%` : '0%';
  return (
    <ul
      aria-label={label}
      className="f-bars"
      style={labelWidth ? { ['--bar-label' as string]: labelWidth } : undefined}
    >
      {rows.map((row) => (
        <li key={row.key} className="f-bar-row" data-gap={row.gap || undefined}>
          <span className="f-bar-label">{row.label}</span>
          <span aria-hidden="true" className="f-bar-track">
            {row.amount !== null && row.amount > 0 && (
              <span className="f-bar-fill" style={{ width: pct(row.amount) }} />
            )}
            {row.marker !== null && row.marker !== undefined && row.marker > 0 && (
              <span className="f-bar-marker" style={{ left: pct(row.marker) }} />
            )}
          </span>
          <span
            className="f-bar-value"
            data-figure={row.amount !== null && !row.gap ? '' : undefined}
          >
            {row.value}
          </span>
          {row.note && <span className="f-bar-note">{row.note}</span>}
        </li>
      ))}
    </ul>
  );
}

/** One row of the For/Against chart (Money by Race drawing, Rounds 31 and 35). */
export interface SplitBarRow {
  key: string;
  /** The spender, usually a link. */
  label: ReactNode;
  /** The position as filed, printed beside the spender. */
  position?: string;
  /** Which side the bar is drawn on, from the filed position, never from the
   * amount's sign; null when the filing names no direction. */
  side: 'for' | 'against' | null;
  /** The net amount. A bar is drawn only when it is above 0. */
  amount: number | null;
  /** The printed amount: "$1,500", "−$1,500", "Missing payment amount". */
  value: string;
  /** Regular-weight words after the amount: "Net amount is negative". */
  valueNote?: string;
  /** A line under the amount: "Payments dated Mar 4 to Jun 30, 2026". */
  note?: ReactNode;
}

/**
 * For to the right, Against to the left of a 2px centre bar. A row draws a bar
 * only for a positive net on the side its filed position names; a negative,
 * zero or unavailable net prints its value with no bar. At computer the bar and
 * the amount share 1 line with a 220px value column; tablet and phone stack them.
 */
export function SplitBarList({ label, rows }: { label: string; rows: ReadonlyArray<SplitBarRow> }) {
  const max = Math.max(
    1,
    ...rows.map((row) => (row.amount !== null && row.amount > 0 ? row.amount : 0)),
  );
  const width = (row: SplitBarRow, side: 'for' | 'against') =>
    row.side === side && row.amount !== null && row.amount > 0
      ? `${(row.amount / max) * 100}%`
      : '0%';
  return (
    <div className="f-split-bars">
      <div aria-hidden="true" className="f-split-ends">
        <span>Against</span>
        <span>For</span>
      </div>
      <ul aria-label={label} className="f-split-list">
        {rows.map((row) => (
          <li key={row.key} className="f-split-row">
            <span className="f-split-head">
              <span className="f-split-label">{row.label}</span>
              {row.position && <span className="f-split-position">{row.position}</span>}
            </span>
            <span className="f-split-line">
              <span aria-hidden="true" className="f-split-track">
                <span className="f-split-half f-split-against">
                  <span className="f-split-fill" style={{ width: width(row, 'against') }} />
                </span>
                <span className="f-split-centre" />
                <span className="f-split-half f-split-for">
                  <span className="f-split-fill" style={{ width: width(row, 'for') }} />
                </span>
              </span>
              <span className="f-split-value">
                <span className="f-split-amount">
                  {row.value}
                  {row.valueNote && <span className="f-split-value-note"> · {row.valueNote}</span>}
                </span>
                {row.note && <span className="f-split-note">{row.note}</span>}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
