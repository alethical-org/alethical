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

/** One row of a centred chart: For to the right, Against to the left of a
 * centre line (Money by race, outside spending). */
export interface SplitBarRow {
  key: string;
  label: ReactNode;
  /** The signed net: positive for, negative against, null unavailable. */
  amount: number | null;
  value: string;
  note?: ReactNode;
}

export function SplitBarList({ label, rows }: { label: string; rows: ReadonlyArray<SplitBarRow> }) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.amount ?? 0)));
  return (
    <div className="f-split-bars">
      <div aria-hidden="true" className="f-split-ends">
        <span>Against</span>
        <span>For</span>
      </div>
      <ul aria-label={label} className="f-bars f-bars-split">
        {rows.map((row) => {
          const amount = row.amount;
          const width =
            amount !== null && amount !== 0 ? `${(Math.abs(amount) / max) * 50}%` : '0%';
          return (
            <li key={row.key} className="f-bar-row">
              <span className="f-bar-label">{row.label}</span>
              <span aria-hidden="true" className="f-bar-track f-bar-track-split">
                <span className="f-split-centre" />
                {amount !== null && amount !== 0 && (
                  <span
                    className="f-bar-fill"
                    style={amount > 0 ? { left: '50%', width } : { right: '50%', width }}
                  />
                )}
              </span>
              <span className="f-bar-value" data-figure={amount !== null ? '' : undefined}>
                {row.value}
              </span>
              {row.note && <span className="f-bar-note">{row.note}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
