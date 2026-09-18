import React, { type CSSProperties } from 'react';

import { useResponsive } from '../../hooks/useResponsive';
import { formatMoney } from '../../lib/moneyFormat';
import {
  lobbyingPrincipalCopy as copy,
  spendingRowsHaveMissingAmounts,
} from '../../lib/lobbyingRecordCopy';
import type { LobbyingSpendingRow } from '../../lib/lobbyingTypes';
import { theme } from '../../theme/tokens';

const categories = [
  ['PUC', 'puc_lobbying_amount'],
  ['General', 'general_lobbying_amount'],
  ['Legislative', 'legislative_lobbying_amount'],
  ['Administrative', 'administrative_lobbying_amount'],
  ['Metropolitan', 'mgu_lobbying_amount'],
] as const;

export function LobbyingSpendingTable({ rows }: { rows: readonly LobbyingSpendingRow[] }) {
  const { isMobile, isTablet } = useResponsive();
  const narrow = isMobile || isTablet;
  const hasMissingAmounts = spendingRowsHaveMissingAmounts(rows);

  return (
    <>
      {narrow ? (
        <NarrowYearBlocks rows={rows} mobile={isMobile} />
      ) : (
        <DesktopSpendingTable rows={rows} />
      )}
      <div style={notes}>
        <p style={note}>{copy.kindsNote}</p>
        <p style={{ ...note, marginTop: 12 }}>
          {copy.spendingValueNote}
          {hasMissingAmounts ? ` ${copy.spendingMissingValueNote}` : ''}
        </p>
        <p style={{ ...note, marginTop: 12 }}>{copy.oldKindsNote}</p>
      </div>
    </>
  );
}

function DesktopSpendingTable({ rows }: { rows: readonly LobbyingSpendingRow[] }) {
  return (
    <div role="table" aria-label={copy.spendingCaption} style={desktopTable}>
      <div role="rowgroup">
        <div role="row" style={{ ...desktopGrid, ...desktopHeadRow }}>
          <span role="columnheader" style={{ ...desktopHead, gridColumn: 1, textAlign: 'left' }}>
            Year
          </span>
          <span role="columnheader" style={{ ...desktopHead, gridColumn: 2 }}>
            Total spent
          </span>
          <span aria-hidden style={{ ...verticalRule, gridColumn: 4 }} />
          {categories.map(([label], index) => (
            <span key={label} role="columnheader" style={{ ...desktopHead, gridColumn: 6 + index }}>
              {label}
            </span>
          ))}
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((row) => (
          <div key={row.record_number} role="row" style={{ ...desktopGrid, ...desktopBodyRow }}>
            <span role="rowheader" style={{ ...desktopYear, gridColumn: 1 }}>
              {row.year ?? 'Year not reported'}
            </span>
            <MoneyValue cell value={row.total_spent} style={{ ...desktopTotal, gridColumn: 2 }} />
            <span aria-hidden style={{ ...verticalRule, gridColumn: 4 }} />
            {categories.map(([label, key], index) => (
              <MoneyValue
                key={label}
                cell
                value={row[key]}
                style={{ ...desktopAmount, gridColumn: 6 + index }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function NarrowYearBlocks({
  rows,
  mobile,
}: {
  rows: readonly LobbyingSpendingRow[];
  mobile: boolean;
}) {
  return (
    <div role="group" aria-label={copy.spendingCaption} style={narrowBlocks}>
      {rows.map((row, index) => {
        const headingId = `lobbying-spending-year-${row.record_number}`;
        return (
          <section
            key={row.record_number}
            aria-labelledby={headingId}
            style={{ ...yearBlock, marginTop: index === 0 ? 0 : 20 }}
          >
            <div style={yearBlockHead}>
              <h3 id={headingId} style={{ ...yearHeading, fontSize: mobile ? 23 : 26 }}>
                {row.year ?? 'Year not reported'}
              </h3>
              <div style={yearTotalGroup}>
                <span style={yearTotalLabel}>Reported spending</span>
                <MoneyValue
                  value={row.total_spent}
                  style={{ ...yearTotal, fontSize: mobile ? 24 : 26 }}
                />
              </div>
            </div>
            <dl style={categoryList}>
              {categories.map(([label, key]) => (
                <div key={label} style={categoryRow}>
                  <dt style={categoryLabel}>{label}</dt>
                  <dd style={categoryValue}>
                    <MoneyValue value={row[key]} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}

function MoneyValue({
  value,
  style,
  cell = false,
}: {
  value: string | null;
  style?: CSSProperties;
  cell?: boolean;
}) {
  const missing = value === null;
  return (
    <span role={cell ? 'cell' : undefined} style={{ ...style, ...(missing ? missingValue : null) }}>
      {formatMoney(value) ?? 'Not reported'}
    </span>
  );
}

const colors = {
  text: '#11150f',
  amount: '#2c322c',
  secondary: '#4f5651',
  muted: '#656c66',
};

const desktopTable: CSSProperties = {
  width: '100%',
  marginTop: 20,
  color: colors.text,
  fontFamily: theme.typography.body,
  fontVariantNumeric: 'tabular-nums',
};

const desktopGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '72px 126px 20px 1px 20px repeat(5, minmax(0, 1fr))',
  alignItems: 'center',
};

const desktopHeadRow: CSSProperties = {
  minHeight: 44,
  borderBottom: '1px solid rgba(17,21,15,0.22)',
};

const desktopHead: CSSProperties = {
  color: colors.amount,
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: '0.02em',
  lineHeight: 1.2,
  textAlign: 'right',
  whiteSpace: 'nowrap',
};

const desktopBodyRow: CSSProperties = {
  minHeight: 56,
  borderBottom: '1px solid rgba(17,21,15,0.07)',
};

const desktopYear: CSSProperties = {
  color: colors.amount,
  fontSize: 17,
  fontWeight: 800,
  lineHeight: 1.35,
  textAlign: 'left',
};

const desktopTotal: CSSProperties = {
  color: colors.amount,
  fontSize: 17,
  fontWeight: 800,
  lineHeight: 1.35,
  textAlign: 'right',
};

const desktopAmount: CSSProperties = {
  color: colors.amount,
  fontSize: 15.5,
  fontWeight: 600,
  lineHeight: 1.35,
  textAlign: 'right',
};

const verticalRule: CSSProperties = {
  width: 1,
  height: '100%',
  background: 'rgba(17,21,15,0.12)',
};

const narrowBlocks: CSSProperties = {
  marginTop: 20,
  color: colors.text,
  fontFamily: theme.typography.body,
  fontVariantNumeric: 'tabular-nums',
};

const yearBlock: CSSProperties = { width: '100%' };

const yearBlockHead: CSSProperties = {
  minHeight: 52,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 20,
  borderBottom: '1px solid rgba(17,21,15,0.22)',
};

const yearHeading: CSSProperties = {
  margin: 0,
  color: colors.amount,
  fontWeight: 800,
  letterSpacing: '-0.02em',
  lineHeight: 1.1,
};

const yearTotalGroup: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  textAlign: 'right',
};

const yearTotalLabel: CSSProperties = {
  color: colors.secondary,
  fontSize: 11.5,
  fontWeight: 800,
  letterSpacing: '0.1em',
  lineHeight: 1.2,
  textTransform: 'uppercase',
};

const yearTotal: CSSProperties = {
  color: colors.amount,
  fontWeight: 800,
  letterSpacing: '-0.02em',
  lineHeight: 1.1,
};

const categoryList: CSSProperties = { margin: 0 };

const categoryRow: CSSProperties = {
  minHeight: 44,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 20,
  borderBottom: '1px solid rgba(17,21,15,0.07)',
};

const categoryLabel: CSSProperties = {
  margin: 0,
  color: colors.secondary,
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1.35,
};

const categoryValue: CSSProperties = {
  margin: 0,
  color: colors.amount,
  fontSize: 16,
  fontWeight: 700,
  lineHeight: 1.35,
  textAlign: 'right',
};

const missingValue: CSSProperties = {
  color: colors.secondary,
  fontSize: 15,
  fontWeight: 600,
};

const notes: CSSProperties = {
  marginTop: 20,
  paddingTop: 18,
  borderTop: '1px solid rgba(17,21,15,0.1)',
};

const note: CSSProperties = {
  maxWidth: 820,
  margin: 0,
  color: colors.muted,
  fontFamily: theme.typography.body,
  fontSize: 15.5,
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.5,
};
