import React, { type CSSProperties } from 'react';

import { useResponsive } from '../../hooks/useResponsive';
import { formatMoney } from '../../lib/legislatorCampaignMoney';
import {
  lobbyingPrincipalCopy as copy,
  spendingRowHasFullKinds,
  spendingRowIsBlank,
} from '../../lib/lobbyingRecordCopy';
import type { LobbyingSpendingRow } from '../../lib/lobbyingTypes';
import { theme } from '../../theme/tokens';

export function LobbyingSpendingTable({ rows }: { rows: readonly LobbyingSpendingRow[] }) {
  const { isMobile, isTablet } = useResponsive();
  const bodySize = isMobile ? 16 : isTablet ? 16 : 17;
  const noteSize = isMobile ? 15 : 15;

  if (isMobile) {
    return (
      <>
        <table style={{ ...table, marginTop: 18 }}>
          <caption style={invisible}>{copy.spendingCaption}</caption>
          <thead>
            <tr>
              <th scope="col" style={{ ...head, width: '22%', textAlign: 'left' }}>
                Year
              </th>
              <th scope="col" style={{ ...head, width: '78%', textAlign: 'left' }}>
                Reported spending
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const blank = spendingRowIsBlank(row);
              const fullKinds = spendingRowHasFullKinds(row);
              return (
                <tr key={row.record_number}>
                  <th scope="row" style={{ ...phoneYear, fontSize: bodySize }}>
                    {row.year ?? 'Year not reported'}
                  </th>
                  <td style={{ ...phoneCell, fontSize: noteSize }}>
                    {blank ? (
                      <div style={{ fontSize: bodySize, fontWeight: 700 }}>Not reported</div>
                    ) : (
                      <>
                        <div style={{ fontSize: bodySize, fontWeight: 800, color: colors.text }}>
                          {amount(row.total_spent)}{' '}
                          <span style={{ fontWeight: 400, color: colors.secondary }}>total</span>
                        </div>
                        <div style={{ marginTop: 4 }}>
                          PUC <strong style={phoneAmount}>{amount(row.puc_lobbying_amount)}</strong>
                          {' · '}General{' '}
                          <strong style={phoneAmount}>{amount(row.general_lobbying_amount)}</strong>
                        </div>
                        {fullKinds ? (
                          <div style={{ marginTop: 3 }}>
                            Legislative{' '}
                            <strong style={phoneAmount}>
                              {amount(row.legislative_lobbying_amount)}
                            </strong>
                            {' · '}Administrative{' '}
                            <strong style={phoneAmount}>
                              {amount(row.administrative_lobbying_amount)}
                            </strong>
                            {' · '}Metropolitan{' '}
                            <strong style={phoneAmount}>{amount(row.mgu_lobbying_amount)}</strong>
                          </div>
                        ) : null}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.some((row) => !spendingRowIsBlank(row) && !spendingRowHasFullKinds(row)) ? (
          <p style={{ ...note, margin: '14px 0 0', fontSize: noteSize }}>{copy.oldKindsPhone}</p>
        ) : null}
        <p style={{ ...note, margin: '16px 0 0', color: colors.secondary, fontSize: noteSize }}>
          {copy.kindsNote}
        </p>
      </>
    );
  }

  const collapsedRuns = collapsedRowRuns(rows);
  return (
    <>
      <table style={{ ...table, marginTop: 20, fontSize: bodySize }}>
        <caption style={invisible}>{copy.spendingCaption}</caption>
        <colgroup>
          {['8%', '16%', '12%', '16%', '16%', '16%', '16%'].map((width, index) => (
            <col key={index} style={{ width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {[
              'Year',
              'Total spent',
              'PUC',
              'General',
              'Legislative',
              'Administrative',
              'Metropolitan',
            ].map((label, index) => (
              <th
                key={label}
                scope="col"
                style={{
                  ...head,
                  textAlign: index === 0 ? 'left' : 'right',
                  paddingRight: index === 3 ? (isTablet ? 20 : 24) : 0,
                }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const blank = spendingRowIsBlank(row);
            const fullKinds = spendingRowHasFullKinds(row);
            const run = collapsedRuns.get(index);
            return (
              <tr key={row.record_number}>
                <th scope="row" style={{ ...cell, textAlign: 'left', fontWeight: 800 }}>
                  {row.year ?? 'Year not reported'}
                </th>
                {blank ? (
                  <td colSpan={6} style={{ ...cell, textAlign: 'right', color: colors.secondary }}>
                    Not reported
                  </td>
                ) : (
                  <>
                    <MoneyCell value={row.total_spent} />
                    <MoneyCell value={row.puc_lobbying_amount} />
                    <MoneyCell
                      value={row.general_lobbying_amount}
                      style={{ paddingRight: isTablet ? 20 : 24 }}
                    />
                    {fullKinds ? (
                      <>
                        <MoneyCell value={row.legislative_lobbying_amount} />
                        <MoneyCell value={row.administrative_lobbying_amount} />
                        <MoneyCell value={row.mgu_lobbying_amount} />
                      </>
                    ) : run ? (
                      <td
                        rowSpan={run}
                        colSpan={3}
                        style={{
                          ...cell,
                          height: 'auto',
                          padding: '0 20px',
                          textAlign: 'center',
                          background: '#f7f8fa',
                          color: colors.muted,
                          fontSize: noteSize,
                          fontWeight: 400,
                          lineHeight: 1.5,
                        }}
                      >
                        {copy.oldKindsWide}
                      </td>
                    ) : null}
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ ...note, margin: '16px 0 0', color: colors.secondary, fontSize: noteSize }}>
        {copy.kindsNote}
      </p>
    </>
  );
}

function MoneyCell({ value, style }: { value: string | null; style?: CSSProperties }) {
  return <td style={{ ...cell, ...style }}>{amount(value)}</td>;
}

function amount(value: string | null): string {
  return formatMoney(value) ?? 'Not reported';
}

/** The first row in each uninterrupted collapsed block maps to its row span. */
function collapsedRowRuns(rows: readonly LobbyingSpendingRow[]): Map<number, number> {
  const starts = new Map<number, number>();
  let index = 0;
  while (index < rows.length) {
    if (spendingRowIsBlank(rows[index]) || spendingRowHasFullKinds(rows[index])) {
      index += 1;
      continue;
    }
    const start = index;
    while (
      index < rows.length &&
      !spendingRowIsBlank(rows[index]) &&
      !spendingRowHasFullKinds(rows[index])
    ) {
      index += 1;
    }
    starts.set(start, index - start);
  }
  return starts;
}

const colors = {
  text: '#11150f',
  secondary: '#4f5651',
  muted: '#6b716b',
};

const invisible: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};

const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  tableLayout: 'fixed',
  color: colors.text,
  fontFamily: theme.typography.body,
  fontVariantNumeric: 'tabular-nums',
};

const head: CSSProperties = {
  padding: '0 0 10px',
  borderBottom: '1px solid rgba(17,21,15,0.16)',
  verticalAlign: 'bottom',
  fontFamily: theme.typography.mono,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: colors.secondary,
};

const cell: CSSProperties = {
  padding: '13px 0',
  borderBottom: '1px solid rgba(17,21,15,0.08)',
  textAlign: 'right',
  verticalAlign: 'middle',
  fontWeight: 700,
  lineHeight: 1.35,
};

const phoneYear: CSSProperties = {
  padding: '12px 0',
  borderBottom: '1px solid rgba(17,21,15,0.08)',
  textAlign: 'left',
  verticalAlign: 'top',
  color: colors.text,
  fontWeight: 800,
  lineHeight: 1.35,
};

const phoneCell: CSSProperties = {
  padding: '12px 0',
  borderBottom: '1px solid rgba(17,21,15,0.08)',
  verticalAlign: 'top',
  lineHeight: 1.45,
  color: colors.secondary,
};

const phoneAmount: CSSProperties = { color: colors.text, fontWeight: 700 };
const note: CSSProperties = {
  maxWidth: 820,
  lineHeight: 1.5,
  color: colors.muted,
  fontFamily: theme.typography.body,
  fontVariantNumeric: 'tabular-nums',
};
