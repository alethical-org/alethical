import React, { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { View } from 'react-native';
import type {
  CampaignCommitteeMoney,
  CommitteeReceivedPayment,
  CommitteeStatedByKind,
  CommitteeDonorStates,
  CommitteeNameConnections,
} from '../../data/types';
import { useCampaignMoneyDetails } from '../../hooks/useCampaignMoneyDetails';
import { useResponsive } from '../../hooks/useResponsive';
import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import { sumMoneyAmounts } from '../../lib/campaignMoneyDetails';
import {
  donationCardsCopy as copy,
  donorStateNames as stateNames,
} from '../../lib/contributionFigures';
import { formatMoney } from '../../lib/moneyFormat';
import { theme as t } from '../../theme/tokens';
import { committeeCardStyles, useCampaignMoneyTypography } from './detailsStyles';

type Committee = Pick<
  CampaignCommitteeMoney,
  'registrationNumber' | 'split' | 'statedByKind' | 'donorStates' | 'nameConnections'
>;
export type DonationCardsProps = {
  committee: Committee;
  year: number;
  registerKind: string | null;
  releaseId?: string;
  expandedRows?: readonly number[];
  onExpandedRowsChange?: (rows: number[]) => void;
};

/** Reuses the complete selected-year read already used by the donor list. */
export function CommitteeDonationCards(props: DonationCardsProps) {
  const { received } = useCampaignMoneyDetails(props.committee.registrationNumber, props.year, {
    history: false,
  });
  const failed =
    (received.isError && !received.data) ||
    received.data?.state === 'unavailable' ||
    Boolean(props.releaseId && received.data && props.releaseId !== received.data.releaseId);
  return (
    <CommitteeDonationCardsView
      {...props}
      payments={received.data?.payments ?? []}
      loading={!received.data && !failed}
      failed={failed}
    />
  );
}

/** The filing compares cash through its coverage end, including undated rows. */
export function closingCommitteePayments(
  rows: readonly CommitteeReceivedPayment[],
  through: string,
) {
  const payments = rows.filter(
    (row) =>
      row.receiptType === 'Contribution' &&
      row.contributorType === 'Candidate Committee' &&
      row.inKind === 'No' &&
      (!row.receivedOn || row.receivedOn <= through),
  );
  return { payments: payments.length, amount: sumMoneyAmounts(payments.map((row) => row.amount)) };
}

export function CommitteeDonationCardsView({
  committee,
  year,
  registerKind,
  payments,
  loading = false,
  failed = false,
  expandedRows,
  onExpandedRowsChange,
}: DonationCardsProps & {
  payments: readonly CommitteeReceivedPayment[];
  loading?: boolean;
  failed?: boolean;
}) {
  const { isMobile, isTablet } = useResponsive();
  const type = useCampaignMoneyTypography();
  const panelId = useId();
  const disclosureProps = (index: number) => ({
    expanded: expandedRows?.includes(index),
    onExpandedChange: onExpandedRowsChange
      ? (open: boolean) =>
          onExpandedRowsChange(
            open
              ? [...(expandedRows ?? []), index]
              : (expandedRows ?? []).filter((row) => row !== index),
          )
      : undefined,
  });
  const checked = committee.split.statedSplitState === 'agrees';
  const hasIndividualDonations = payments.some(
    (row) => row.receiptType === 'Contribution' && row.contributorType === 'Individual',
  );
  const state = failed ? 'failed' : !checked ? 'held' : loading ? 'loading' : 'drawn';
  // The server supplies candidate-report lines only for candidate committees.
  const unsupportedComparison =
    registerKind === 'party_unit' || registerKind === 'political_committee_or_fund';
  return (
    <View
      role="region"
      aria-labelledby={`${panelId}-heading`}
      style={[
        committeeCardStyles.card,
        isTablet && committeeCardStyles.tablet,
        isMobile && committeeCardStyles.mobile,
        { gap: 0 },
      ]}
    >
      <h2
        id={`${panelId}-heading`}
        style={{
          margin: 0,
          fontFamily: t.typography.title,
          fontSize: type.h3,
          fontWeight: 800,
          letterSpacing: '-0.01em',
          color: c.text,
        }}
      >
        More on this year’s contributions
      </h2>
      <div style={{ marginTop: 14 }}>
        {!unsupportedComparison ? (
          <DonationCard
            key={`${committee.registrationNumber}-${year}-0`}
            {...disclosureProps(0)}
            index={0}
            registration={committee.registrationNumber}
          >
            {state !== 'drawn' ? (
              <CardState state={state} index={0} year={year} />
            ) : committee.statedByKind === null ||
              committee.statedByKind?.state === 'sources_disagree' ? (
              <CardState state="held" index={0} year={year} />
            ) : committee.statedByKind?.state === 'reported' ? (
              <FiledLines block={committee.statedByKind} payments={payments} />
            ) : (
              <CardState state="failed" index={0} year={year} />
            )}
          </DonationCard>
        ) : null}
        {registerKind === 'candidate_committee' ? (
          <DonationCard
            key={`${committee.registrationNumber}-${year}-1`}
            {...disclosureProps(1)}
            index={1}
            registration={committee.registrationNumber}
          >
            {state !== 'drawn' ? (
              <CardState state={state} index={1} year={year} />
            ) : committee.donorStates?.state === 'reported' &&
              committee.donorStates.year === year ? (
              <DonorLocations
                block={committee.donorStates}
                year={year}
                hasIndividualDonations={hasIndividualDonations}
              />
            ) : (
              <CardState state="failed" index={1} year={year} />
            )}
          </DonationCard>
        ) : null}
        <DonationCard
          key={`${committee.registrationNumber}-${year}-2`}
          {...disclosureProps(2)}
          index={2}
          registration={committee.registrationNumber}
        >
          {state !== 'drawn' ? (
            <CardState state={state} index={2} year={year} />
          ) : committee.nameConnections?.year !== year ? (
            <CardState state="failed" index={2} year={year} />
          ) : committee.nameConnections.state === 'not_reported' ? (
            hasIndividualDonations ? (
              <CardState state="failed" index={2} year={year} />
            ) : (
              <Paragraph>{copy.emptyConnections(year)}</Paragraph>
            )
          ) : committee.nameConnections.state === 'reported' ? (
            <ConnectedNames block={committee.nameConnections} year={year} />
          ) : (
            <CardState state="failed" index={2} year={year} />
          )}
        </DonationCard>
      </div>
    </View>
  );
}

const invisible: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};
const totalWash: CSSProperties = {
  display: 'inline-block',
  background: 'rgba(137,144,135,0.2)',
  borderRadius: 8,
  padding: '5px 10px',
  marginRight: -10,
};
function StackedHeader({ lines }: { lines: readonly string[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <React.Fragment key={line}>
          {index > 0 ? ' ' : null}
          <span style={{ display: 'block', whiteSpace: 'nowrap' }}>{line}</span>
        </React.Fragment>
      ))}
    </>
  );
}
const rule = '1px solid rgba(17,21,15,0.08)';
const tableBase: CSSProperties = {
  width: '100%',
  tableLayout: 'fixed',
  borderCollapse: 'collapse',
  color: c.text,
  fontFamily: t.typography.body,
  fontVariantNumeric: 'tabular-nums',
};
const head: CSSProperties = {
  textAlign: 'right',
  verticalAlign: 'bottom',
  lineHeight: 1.35,
  fontFamily: t.typography.mono,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: c.muted,
  padding: '0 0 8px',
  borderBottom: '1px solid rgba(17,21,15,0.12)',
};
const cell: CSSProperties = {
  textAlign: 'right',
  verticalAlign: 'middle',
  fontWeight: 700,
  height: 52,
  padding: '6px 0',
  boxSizing: 'border-box',
  borderBottom: rule,
};

function DonationCard({
  index,
  registration,
  children,
  expanded,
  onExpandedChange,
}: {
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  index: number;
  registration: string;
  children: ReactNode;
}) {
  const { isMobile, isTablet } = useResponsive();
  const [locallyOpen, setOpen] = useState(false);
  const open = expanded ?? locallyOpen;
  const [focused, setFocused] = useState(false);
  const instanceId = useId();
  const id = `committee-${registration}-donation-card-${index}`;
  return (
    <div data-testid={id} style={{ borderTop: rule }}>
      <h3 style={{ margin: 0 }}>
        <button
          data-arrow-focus="true"
          type="button"
          id={`${instanceId}-heading`}
          aria-expanded={open}
          aria-controls={`${instanceId}-content`}
          onClick={() => {
            setOpen(!open);
            onExpandedChange?.(!open);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            minHeight: isMobile ? 56 : isTablet ? 58 : 60,
            padding: '10px 0',
            background: 'transparent',
            border: 'none',
            borderRadius: 8,
            outline: 'none',
            cursor: 'pointer',
            fontFamily: t.typography.body,
            textAlign: 'left',
            fontSize: isMobile ? 16 : isTablet ? 17 : 18,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            lineHeight: 1.4,
            color: c.text,
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{copy.headings[index]}</span>
          <span
            aria-hidden="true"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              flexShrink: 0,
              boxSizing: 'border-box',
              borderRadius: 12,
              border: `1px solid ${focused ? c.fieldFocusBorder : 'transparent'}`,
              boxShadow: focused ? `0 0 0 3px ${c.fieldFocusRing}` : undefined,
            }}
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              style={{ transform: open ? 'rotate(180deg)' : undefined }}
            >
              <path
                d="M6 9 L12 15 L18 9"
                stroke={c.secondary}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>
      </h3>
      <div
        id={`${instanceId}-content`}
        role="region"
        aria-labelledby={`${instanceId}-heading`}
        hidden={!open}
        style={{ paddingBottom: 22 }}
      >
        {children}
      </div>
    </div>
  );
}

function Paragraph({
  children,
  small = false,
  muted = false,
  role,
}: {
  children: ReactNode;
  small?: boolean;
  muted?: boolean;
  role?: 'alert';
}) {
  const type = useCampaignMoneyTypography();
  return (
    <p
      role={role}
      style={{
        margin: '14px 0 0',
        maxWidth: small ? 680 : 900,
        fontFamily: t.typography.body,
        fontVariantNumeric: 'tabular-nums',
        fontSize: small ? type.small : type.body,
        lineHeight: small ? 1.5 : 1.55,
        color: role ? c.text : muted ? c.muted : c.secondary,
        textWrap: 'pretty',
      }}
    >
      {children}
    </p>
  );
}
function CardState({
  state,
  index,
  year,
}: {
  state: 'held' | 'loading' | 'failed';
  index: number;
  year: number;
}) {
  if (state === 'held') return <Paragraph>{copy.held[index](year)}</Paragraph>;
  if (state === 'failed')
    return (
      <Paragraph role="alert">
        {copy.failed[index]} {copy.retry}
      </Paragraph>
    );
  return (
    <div role="status" aria-busy="true" style={{ marginTop: 18, display: 'grid', gap: 12 }}>
      <span style={invisible}>{copy.loading}</span>
      <style>
        {
          '@keyframes donationCardPulse{0%,100%{opacity:.55}50%{opacity:1}}.donation-card-skeleton{animation:donationCardPulse 1.6s ease-in-out infinite}@media(prefers-reduced-motion:reduce){.donation-card-skeleton{animation:none}}'
        }
      </style>
      {[14, 52, ...(index === 1 ? [] : [52])].map((height, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="donation-card-skeleton"
          style={{
            display: 'block',
            height,
            width: i === 0 ? '60%' : '100%',
            borderRadius: 6,
            background: i ? '#f3f5f6' : '#eef0f1',
          }}
        />
      ))}
    </div>
  );
}

function FiledLines({
  block,
  payments,
}: {
  block: CommitteeStatedByKind;
  payments: readonly CommitteeReceivedPayment[];
}) {
  const { isMobile, isTablet } = useResponsive();
  const type = useCampaignMoneyTypography();
  const closing = closingCommitteePayments(payments, block.reported_through);
  const totals = ['stated_total', 'itemized_cash_total', 'difference'].map((key) =>
    sumMoneyAmounts(
      block.lines.map((line) => line[key as 'stated_total' | 'itemized_cash_total' | 'difference']),
    ),
  );
  // No partial table may turn a missing line or amount into a checked zero.
  if (
    block.lines.length !== 5 ||
    totals.some((value) => formatMoney(value) === null) ||
    closing.amount === null
  ) {
    return <CardState state="failed" index={0} year={0} />;
  }
  const rows = [
    ...block.lines.map((line) => ({
      key: line.line_key,
      label: line.label_as_filed,
      figures: [line.stated_total, line.itemized_cash_total, line.difference],
      note: line.line_key === 'party_unit_contributions' && closing.payments > 0,
      total: false,
    })),
    { key: 'total', label: copy.total, figures: totals, note: false, total: true },
  ];
  const note = (
    <>
      {copy.closingBefore(formatMoney(closing.amount)!, closing.payments)}
      <strong style={{ color: c.text, fontWeight: 700, whiteSpace: 'nowrap' }}>
        {copy.chartName}
      </strong>
      {copy.closingAfter}
    </>
  );
  const widths = isTablet ? [176, 186, 120] : [236, 246, 160];
  const gap = isTablet ? 14 : 18;
  return (
    <>
      <p
        style={{
          margin: '12px 0 0',
          maxWidth: 900,
          fontFamily: t.typography.body,
          fontSize: type.small,
          lineHeight: 1.5,
          color: c.secondary,
          textWrap: 'pretty',
        }}
      >
        {copy.introduction}
      </p>
      {isMobile ? (
        <div
          style={{
            marginTop: 14,
            fontFamily: t.typography.body,
            fontSize: type.body,
            color: c.text,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {rows.map((row, index) => (
            <div
              key={row.key}
              style={{
                padding: '14px 0',
                borderBottom: index < 4 ? rule : undefined,
                borderTop: row.total ? '1px solid rgba(17,21,15,0.28)' : undefined,
              }}
            >
              <div style={{ fontWeight: 800 }}>{row.label}</div>
              <dl style={{ margin: '8px 0 0', display: 'grid', gap: 6 }}>
                {row.figures.map((value, column) => (
                  <div key={column} style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                    <dt style={{ flex: 1, minWidth: 0, fontSize: type.small, color: c.secondary }}>
                      {copy.columns[column]}
                    </dt>
                    <dd style={{ margin: 0, fontWeight: row.total || column === 2 ? 800 : 700 }}>
                      {row.total && column === 2 ? (
                        <span style={totalWash}>{formatMoney(value)}</span>
                      ) : (
                        formatMoney(value)
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              {row.note ? <Paragraph small>{note}</Paragraph> : null}
            </div>
          ))}
        </div>
      ) : (
        <table style={{ ...tableBase, marginTop: 18, fontSize: type.body }}>
          <caption style={invisible}>{copy.headings[0]}</caption>
          <thead>
            <tr>
              <th
                aria-label={copy.contributionLine}
                scope="col"
                style={{ ...head, textAlign: 'left' }}
              />
              {copy.columns.map((label, index) => (
                <th
                  key={label}
                  scope="col"
                  style={{
                    ...head,
                    width: widths[index],
                    paddingLeft: gap,
                    boxSizing: 'border-box',
                  }}
                >
                  <StackedHeader lines={copy.columnLines[index]} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <React.Fragment key={row.key}>
                <tr style={row.total ? { borderTop: '1px solid rgba(17,21,15,0.28)' } : undefined}>
                  <th
                    scope="row"
                    style={{
                      ...cell,
                      textAlign: 'left',
                      fontWeight: row.total ? 800 : 700,
                      borderBottom: row.note || index >= 4 ? undefined : rule,
                    }}
                  >
                    {row.label}
                  </th>
                  {row.figures.map((value, column) => (
                    <td
                      key={column}
                      style={{
                        ...cell,
                        paddingLeft: gap,
                        fontWeight: row.total || column === 2 ? 800 : 700,
                        borderBottom: row.note || index >= 4 ? undefined : rule,
                      }}
                    >
                      {row.total && column === 2 ? (
                        <span style={totalWash}>{formatMoney(value)}</span>
                      ) : (
                        formatMoney(value)
                      )}
                    </td>
                  ))}
                </tr>
                {row.note ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '0 0 14px', borderBottom: rule }}>
                      <div
                        style={{
                          maxWidth: 680,
                          color: c.secondary,
                          fontSize: type.small,
                          lineHeight: 1.5,
                          textWrap: 'pretty',
                        }}
                      >
                        {note}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
      <Paragraph small muted>
        {copy.difference.split(/ = | − /).map((part, index) => (
          <React.Fragment key={index}>
            {index > 0 ? ' ' : null}
            <span style={{ whiteSpace: 'nowrap' }}>
              {part}
              {index === 0 ? ' =' : index === 1 ? ' −' : ''}
            </span>
          </React.Fragment>
        ))}
      </Paragraph>
    </>
  );
}

function DonorLocations({
  block,
  year,
  hasIndividualDonations,
}: {
  block: CommitteeDonorStates;
  year: number;
  hasIndividualDonations: boolean;
}) {
  const { isMobile, isTablet } = useResponsive();
  const type = useCampaignMoneyTypography();
  const rows = [block.summary.minnesota, block.summary.other_states, block.summary.unknown];
  if (rows.every((row) => row.names === 0 && /^0(?:\.0+)?$/.test(row.cash_total)))
    return hasIndividualDonations ? (
      <CardState state="failed" index={1} year={year} />
    ) : (
      <Paragraph>{copy.emptyLocations(year)}</Paragraph>
    );
  const others = block.rows.filter((row) => row.state !== 'MN' && row.state !== 'unknown');
  if (
    rows.some((row) => formatMoney(row.cash_total) === null) ||
    others.some((row) => !stateNames[row.state] || formatMoney(row.cash_total) === null)
  ) {
    return <CardState state="failed" index={1} year={year} />;
  }
  const [count, amount, gap] = isMobile ? [104, 96, 6] : isTablet ? [216, 158, 18] : [236, 168, 18];
  return (
    <>
      <table style={{ ...tableBase, marginTop: 18, fontSize: type.body }}>
        <caption style={invisible}>{copy.headings[1]}</caption>
        <thead>
          <tr>
            <th scope="col" aria-label={copy.state} style={{ ...head, textAlign: 'left' }} />
            <th
              scope="col"
              style={{ ...head, width: count, paddingLeft: gap, boxSizing: 'border-box' }}
            >
              {copy.names}
            </th>
            <th
              scope="col"
              style={{ ...head, width: amount, paddingLeft: gap, boxSizing: 'border-box' }}
            >
              {copy.amount}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <React.Fragment key={copy.places[index]}>
              <tr>
                <th scope="row" style={{ ...cell, textAlign: 'left' }}>
                  {copy.places[index]}
                </th>
                <td style={cell}>{row.names.toLocaleString('en-US')}</td>
                <td style={{ ...cell, fontWeight: 800 }}>{formatMoney(row.cash_total)}</td>
              </tr>
              {index === 1
                ? others.map((other, i) => (
                    <React.Fragment key={other.state}>
                      {isMobile ? (
                        <tr>
                          <th
                            scope="row"
                            colSpan={3}
                            style={{
                              ...cell,
                              borderBottom: 'none',
                              textAlign: 'left',
                              paddingLeft: 18,
                              height: 'auto',
                              paddingTop: 14,
                            }}
                          >
                            {stateNames[other.state]}
                          </th>
                        </tr>
                      ) : null}
                      <tr
                        style={{
                          borderBottom:
                            i === others.length - 1 ? rule : '1px dashed rgba(17,21,15,0.16)',
                        }}
                      >
                        {isMobile ? (
                          <th scope="row" style={{ ...cell, borderBottom: 'none' }}>
                            <span style={invisible}>{stateNames[other.state]}</span>
                          </th>
                        ) : (
                          <th
                            scope="row"
                            style={{
                              ...cell,
                              textAlign: 'left',
                              paddingLeft: 18,
                              borderBottom: 'none',
                            }}
                          >
                            {stateNames[other.state]}
                          </th>
                        )}
                        <td style={{ ...cell, borderBottom: 'none' }}>
                          {other.names.toLocaleString('en-US')}
                        </td>
                        <td style={{ ...cell, borderBottom: 'none', fontWeight: 800 }}>
                          {formatMoney(other.cash_total)}
                        </td>
                      </tr>
                    </React.Fragment>
                  ))
                : null}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
        {copy.locationNotes.map((text) => (
          <p
            key={text}
            style={{
              margin: 0,
              maxWidth: 680,
              fontFamily: t.typography.body,
              fontSize: type.small,
              lineHeight: 1.5,
              color: c.muted,
              textWrap: 'pretty',
            }}
          >
            {text}
          </p>
        ))}
      </div>
    </>
  );
}

export const CONNECTION_COLORS = ['#8a918b', '#6b736c', '#4d574f', '#2f3a31', '#11150f'] as const;
function ConnectedNames({ block, year }: { block: CommitteeNameConnections; year: number }) {
  const { isMobile, isTablet } = useResponsive();
  const type = useCampaignMoneyTypography();
  if (block.denominator === 0) return <Paragraph>{copy.emptyConnections(year)}</Paragraph>;
  if (
    block.matching !== 'exact_printed_name' ||
    block.denominator == null ||
    block.numerator == null ||
    block.distribution.length !== 5 ||
    block.distribution.reduce((sum, row) => sum + row.names, 0) !== block.denominator
  ) {
    return <CardState state="failed" index={2} year={year} />;
  }
  const topNames = block.top_names.filter((row) => row.other_committees > 0).slice(0, 5);
  const headline = copy.connectionsHeadline(block.numerator, block.denominator);
  const columns: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'minmax(0,1fr) minmax(0,1fr)',
    columnGap: 36,
    rowGap: 24,
  };
  const numbers = (n: number) => n.toLocaleString('en-US');
  return (
    <div
      style={{
        fontFamily: t.typography.body,
        fontSize: type.body,
        fontVariantNumeric: 'tabular-nums',
        color: c.text,
      }}
    >
      <div style={{ ...columns, marginTop: 14, rowGap: 14 }}>
        <div
          style={{
            fontSize: type.figure,
            fontWeight: 800,
            letterSpacing: '-0.015em',
            lineHeight: 1.1,
          }}
        >
          {headline}
        </div>
        <p
          style={{
            margin: 0,
            fontSize: type.small,
            lineHeight: 1.5,
            color: c.secondary,
            textWrap: 'pretty',
          }}
        >
          {copy.caveat}
        </p>
      </div>
      <div
        role="img"
        aria-label={copy.connectionsBar(headline, block.distribution)}
        style={{ display: 'flex', marginTop: 20, height: 22, borderRadius: 6, overflow: 'hidden' }}
      >
        {block.distribution.map((row, i) => (
          <span
            key={row.other_committees}
            style={{
              width: `${(100 * row.names) / block.denominator!}%`,
              height: '100%',
              background: CONNECTION_COLORS[i],
              boxShadow: 'inset -2px 0 0 #ffffff',
            }}
          />
        ))}
      </div>
      <div style={{ ...columns, marginTop: 20 }}>
        {[false, true].map((top) => (
          <table key={String(top)} style={tableBase}>
            <caption style={invisible}>
              {top ? copy.highestHeading : copy.distributionHeading}
            </caption>
            <thead>
              <tr>
                <th scope="col" style={{ ...head, textAlign: 'left' }}>
                  <StackedHeader lines={top ? copy.highestLines : copy.otherCandidateLines} />
                </th>
                <th
                  scope="col"
                  style={{
                    ...head,
                    width: top
                      ? isMobile
                        ? 130
                        : isTablet
                          ? 150
                          : 160
                      : isMobile
                        ? 52
                        : isTablet
                          ? 60
                          : 64,
                  }}
                >
                  {top ? <StackedHeader lines={copy.otherCandidateLines} /> : copy.names}
                </th>
              </tr>
            </thead>
            <tbody>
              {(top ? topNames : block.distribution).map((row, i) => (
                <tr key={i}>
                  <th
                    scope="row"
                    style={{
                      ...cell,
                      textAlign: 'left',
                      height: 48,
                      padding: '4px 12px 4px 0',
                      borderBottom:
                        i === (top ? topNames.length : block.distribution.length) - 1
                          ? 'none'
                          : rule,
                    }}
                  >
                    <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      {!top ? (
                        <span
                          aria-hidden="true"
                          style={{
                            flexShrink: 0,
                            width: 14,
                            height: 14,
                            borderRadius: 3,
                            background: CONNECTION_COLORS[i],
                          }}
                        />
                      ) : null}
                      <span style={{ overflowWrap: 'anywhere' }}>
                        {'name' in row ? row.name : copy.buckets[i]}
                      </span>
                    </span>
                  </th>
                  <td
                    style={{
                      ...cell,
                      height: 48,
                      padding: '4px 0',
                      fontWeight: 800,
                      borderBottom:
                        i === (top ? topNames.length : block.distribution.length) - 1
                          ? 'none'
                          : rule,
                    }}
                  >
                    {numbers('name' in row ? row.other_committees : row.names)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}
