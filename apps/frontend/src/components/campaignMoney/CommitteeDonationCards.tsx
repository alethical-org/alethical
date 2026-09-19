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
import { moneyUnits, sumMoneyAmounts } from '../../lib/campaignMoneyDetails';
import {
  donationCardsCopy as copy,
  donorStateNames as stateNames,
  shareOfDollars,
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
    <View style={{ gap: 18 }}>
      {/* Its own card, above the panel and open from load, because where a campaign's
          money comes from is a finding rather than a footnote: behind an expander only
          the reader who already suspected it would ever see it. The aggregate is
          available for candidate committees alone, so a political fund or a party
          organisation gets no card at all rather than an empty one -- which would read
          as a claim that they have no individual contributions, and is only a limit of
          what this display covers. */}
      {registerKind === 'candidate_committee' ? (
        <ContributorLocations
          committee={committee}
          year={year}
          state={state}
          hasIndividualDonations={hasIndividualDonations}
        />
      ) : null}
      {/* The panel's 2 remaining rows are addressed 0 and 2, and the gap is deliberate.
          A shared link carries the rows a reader opened as
          `{registration}.{year}.{index}`, so renumbering the name matches from 2 to 1
          when the location row left would have made every saved link to it open the
          report comparison instead. The index names the row, not its position. */}
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
/** The location table's cell. Padding rather than a fixed height, so a row grows with a
 *  state name that wraps onto 2 lines instead of clipping it. */
const locationCell: CSSProperties = {
  textAlign: 'right',
  verticalAlign: 'middle',
  lineHeight: 1.35,
  paddingTop: 11,
  paddingBottom: 11,
  paddingRight: 0,
  boxSizing: 'border-box',
  color: c.text,
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

/** One neutral at 3 lightnesses, in the bar's fixed order. No hue, so no category can
 *  read as good or bad, and every figure the bar carries is also in the table below it. */
export const LOCATION_COLORS = ['#2f3a31', '#6b736c', '#9aa39c'] as const;

type LocationTableRow = {
  key: string;
  label: string;
  names: number;
  amount: string;
  share: string;
  child: boolean;
  color: string | null;
  filled: boolean;
  rule: string | undefined;
};

/**
 * Where one committee's itemized individual contributions came from, in one selected year.
 *
 * Its own card rather than a row inside `More on this year's contributions`, and open from
 * load. One committee and one year: 2 committees get 2 cards and neither bar is a share of
 * the other's dollars (#1663).
 *
 * The table **is** the bar's label set. Drawing the 3 categories' dollars and shares beside
 * the bar as well as in the table's first rows would print the same 6 figures twice, about
 * 120px apart, so the 3 category rows each carry a swatch in their segment's colour and the
 * figures appear once.
 */
function ContributorLocations({
  committee,
  year,
  state,
  hasIndividualDonations,
}: {
  committee: Committee;
  year: number;
  state: 'held' | 'loading' | 'failed' | 'drawn';
  hasIndividualDonations: boolean;
}) {
  const { isMobile, isTablet } = useResponsive();
  const type = useCampaignMoneyTypography();
  const headingId = useId();
  const block =
    committee.donorStates?.state === 'reported' && committee.donorStates.year === year
      ? committee.donorStates
      : null;
  return (
    <View
      role="region"
      aria-labelledby={`${headingId}-heading`}
      style={[
        committeeCardStyles.card,
        isTablet && committeeCardStyles.tablet,
        isMobile && committeeCardStyles.mobile,
        { gap: 0 },
      ]}
    >
      <h2
        id={`${headingId}-heading`}
        style={{
          margin: 0,
          fontFamily: t.typography.title,
          fontSize: type.h3,
          fontWeight: 800,
          letterSpacing: '-0.01em',
          color: c.text,
        }}
      >
        {copy.headings[1]}
      </h2>
      <p
        style={{
          margin: '10px 0 0',
          maxWidth: 680,
          fontFamily: t.typography.body,
          fontSize: type.small,
          lineHeight: 1.5,
          color: c.secondary,
          textWrap: 'pretty',
        }}
      >
        {copy.locationsIntro}
      </p>
      {state === 'loading' ? (
        <LocationsLoading barHeight={isMobile || isTablet ? 20 : 22} />
      ) : state === 'held' ? (
        <Paragraph>{copy.held[1](year)}</Paragraph>
      ) : state === 'failed' || block === null ? (
        <Paragraph role="alert">
          {copy.failed[1]} {copy.retry}
        </Paragraph>
      ) : (
        <LocationFigures
          block={block}
          year={year}
          hasIndividualDonations={hasIndividualDonations}
        />
      )}
    </View>
  );
}

/** Resting blocks in the shape of the bar and 2 rows. Static rather than pulsing: the
 *  word `Loading` already says a read is in flight, and the pulse said it a second time
 *  in motion. */
function LocationsLoading({ barHeight }: { barHeight: number }) {
  return (
    <div role="status" aria-busy="true" style={{ marginTop: 18, display: 'grid', gap: 12 }}>
      <span style={invisible}>{copy.loading}</span>
      {[barHeight, 46, 46].map((height, index) => (
        <span
          key={index}
          aria-hidden="true"
          style={{
            display: 'block',
            height,
            width: '100%',
            borderRadius: index === 0 ? 6 : 8,
            background: index === 0 ? '#eef0f1' : '#f3f5f6',
          }}
        />
      ))}
    </div>
  );
}

function LocationFigures({
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
  const refused = (
    <Paragraph role="alert">
      {copy.failed[1]} {copy.retry}
    </Paragraph>
  );
  const categories = [
    block.summary.minnesota,
    block.summary.other_states,
    block.summary.unknown,
  ].map((amounts, index) => ({
    key: copy.places[index],
    label: copy.places[index],
    names: amounts.names,
    units: moneyUnits(amounts.cash_total),
    cash: amounts.cash_total,
    color: LOCATION_COLORS[index],
  }));
  // Full state names, alphabetical, District of Columbia inline under D. A state whose
  // code this build does not know is a refusal rather than a row labelled with a code.
  const states = block.rows
    .filter((row) => row.state !== 'MN' && row.state !== 'unknown')
    .map((row) => ({
      key: row.state,
      label: stateNames[row.state] ?? '',
      names: row.names,
      units: moneyUnits(row.cash_total),
      cash: row.cash_total,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'en'));

  const denominatorUnits = categories.reduce<bigint | null>(
    (sum, row) => (sum === null || row.units === null ? null : sum + row.units),
    0n,
  );
  // Saying there are no rows is a claim about the whole year, so it needs the complete
  // received-payment read to prove it. These figures cannot: 0 names and $0 is equally
  // what an unnamed donation of goods with an unusable ZIP produces, and "nobody gave"
  // and "nobody who gave is nameable in dollars" are different facts. Where the rows do
  // exist and none of them carries cash, the zero-cash sentence below says so instead.
  if (denominatorUnits === 0n && !hasIndividualDonations) {
    return <Paragraph>{copy.emptyLocations(year)}</Paragraph>;
  }
  if (
    denominatorUnits === null ||
    denominatorUnits < 0n ||
    [...categories, ...states].some(
      (row) => row.units === null || row.units < 0n || !row.label || formatMoney(row.cash) === null,
    )
  ) {
    return refused;
  }
  // A lighter divider inside the nested group than between categories, so the states
  // read as one group hanging off Other states rather than as more categories.
  const soft = '1px solid rgba(17,21,15,0.045)';
  const share = (units: bigint) => shareOfDollars(units, denominatorUnits);
  if ([...categories, ...states].some((row) => share(row.units!) === null)) return refused;
  const rows: LocationTableRow[] = [];
  const push = (
    row: (typeof categories)[number] | (typeof states)[number],
    color: string | null,
    child: boolean,
    divider: string | undefined,
  ) =>
    rows.push({
      key: row.key,
      label: row.label,
      names: row.names,
      amount: formatMoney(row.cash)!,
      share: share(row.units!)!,
      child,
      color,
      filled: row.units! > 0n && denominatorUnits > 0n,
      rule: divider,
    });
  push(categories[0], categories[0].color, false, rule);
  push(categories[1], categories[1].color, false, states.length ? soft : rule);
  states.forEach((row, index) => push(row, null, true, index === states.length - 1 ? rule : soft));
  push(categories[2], categories[2].color, false, undefined);

  const segments = categories.filter((row) => row.units! > 0n);
  const barAria = copy.locationsBar(
    categories.map((row) =>
      copy.locationsBarPart(row.label, formatMoney(row.cash)!, share(row.units!)!),
    ),
  );
  const [names, amount, shareWidth, gap] = isMobile
    ? [40, 80, 66, 6]
    : isTablet
      ? [94, 134, 134, 16]
      : [108, 150, 150, 18];
  const numeric = [
    { label: copy.names, width: names },
    { label: copy.amount, width: amount },
    { label: copy.share, width: shareWidth },
  ];
  const indent = isMobile ? 14 : isTablet ? 26 : 28;
  return (
    <>
      {denominatorUnits > 0n ? (
        <div
          role="img"
          aria-label={barAria}
          style={{
            display: 'flex',
            marginTop: 18,
            height: isMobile || isTablet ? 20 : 22,
            borderRadius: 6,
            overflow: 'hidden',
            background: '#eef0f1',
          }}
        >
          {/* Proportions rather than computed widths: flex divides the track by each
              segment's own dollars at full precision, so the last one lands exactly on
              the edge. Rounded widths leave or overrun a sliver. A category with no
              dollars gets no segment, and a tiny one is never widened to be visible --
              its figures are in the table. */}
          {segments.map((row, index) => (
            <span
              key={row.key}
              style={{
                flexGrow: Number(row.units!),
                flexBasis: 0,
                minWidth: 0,
                height: '100%',
                background: row.color,
                boxShadow: index < segments.length - 1 ? 'inset -2px 0 0 #ffffff' : undefined,
              }}
            />
          ))}
        </div>
      ) : (
        <Paragraph>{copy.locationsNoCash(year)}</Paragraph>
      )}
      <table
        style={{
          ...tableBase,
          tableLayout: 'auto',
          marginTop: 16,
          fontSize: type.body,
        }}
      >
        <caption
          style={{
            captionSide: 'top',
            textAlign: 'left',
            padding: '0 0 12px',
            maxWidth: 680,
            fontFamily: t.typography.body,
            fontSize: type.small,
            fontWeight: 400,
            lineHeight: 1.5,
            color: c.secondary,
            textWrap: 'pretty',
          }}
        >
          {copy.locationsCaption(year, states.length > 0)}
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ ...head, textAlign: 'left' }}>
              {copy.state}
            </th>
            {numeric.map((column) => (
              <th
                key={column.label}
                scope="col"
                style={{
                  ...head,
                  width: column.width,
                  paddingLeft: gap,
                  boxSizing: 'border-box',
                }}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.child ? 'state' : 'category'}-${row.key}`}>
              <th
                scope="row"
                style={{
                  ...locationCell,
                  textAlign: 'left',
                  paddingLeft: row.child ? indent : 0,
                  fontWeight: row.child ? 500 : 800,
                  borderBottom: row.rule,
                }}
              >
                {row.color ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                    {/* Outlined where the bar has no segment: a filled swatch would
                        promise a segment that is not there. */}
                    <span
                      aria-hidden="true"
                      style={{
                        flex: 'none',
                        width: 14,
                        height: 14,
                        borderRadius: 3,
                        border: `2px solid ${row.color}`,
                        background: row.filled ? row.color : 'transparent',
                      }}
                    />
                    <span>{row.label}</span>
                  </span>
                ) : (
                  row.label
                )}
              </th>
              {[
                { value: row.names.toLocaleString('en-US'), weight: row.child ? 500 : 800 },
                { value: row.amount, weight: row.child ? 600 : 800 },
                { value: row.share, weight: row.child ? 500 : 800 },
              ].map((cellValue, column) => (
                <td
                  key={column}
                  style={{
                    ...locationCell,
                    paddingLeft: gap,
                    fontWeight: cellValue.weight,
                    color: column === 1 ? c.text : c.secondary,
                    borderBottom: row.rule,
                  }}
                >
                  {cellValue.value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 14, display: 'grid', gap: 5 }}>
        {copy.locationNotes.map((note) => (
          <p
            key={note}
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
            {note}
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
