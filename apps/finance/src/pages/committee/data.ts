import { formatDay, formatMoney } from '@alethical/shared/moneyFormat';
import { isInKind } from '@alethical/shared/committeeMoneyShared';
import { madePaymentRow, receivedPaymentRow } from '@alethical/shared/committeePaymentsPage';

import type { AttachedStatementRow, Filing, MadePayment, ReceivedPayment } from './types';

/** The 6 tabs (Committee drawing, build notes Round 20). */
export type TabKey =
  'individuals' | 'lobbyists' | 'committees' | 'party' | 'other' | 'expenditures';
export type ContributionTab = Exclude<TabKey, 'expenditures'>;

export const TABS: ReadonlyArray<{ value: TabKey; label: string }> = [
  { value: 'individuals', label: 'Individuals' },
  { value: 'lobbyists', label: 'Lobbyists' },
  { value: 'committees', label: 'Committees & Funds' },
  { value: 'party', label: 'Party Units' },
  { value: 'other', label: 'Other kinds' },
  { value: 'expenditures', label: 'Expenditures' },
];

export function isTab(value: string): value is TabKey {
  return TABS.some((tab) => tab.value === value);
}

export function tabLabel(tab: TabKey): string {
  return TABS.find((item) => item.value === tab)?.label ?? '';
}

/** The filed contributor kind to its tab: Individual*, *lobbyist*, political committee
 * or fund, party unit, everything else Other kinds (build notes Round 20). */
export function tabOfKind(kind: string | null | undefined): ContributionTab {
  const text = kind ?? '';
  if (/^individual/i.test(text)) return 'individuals';
  if (/lobbyist/i.test(text)) return 'lobbyists';
  if (/political committee|political fund|committee\/fund/i.test(text)) return 'committees';
  if (/party unit/i.test(text)) return 'party';
  return 'other';
}

/** Only rows the file types `Contribution` are contributions; loans and other
 * receipts are real money on their own schedules and never join a contribution
 * figure (rule 12; `money_in.itemized_contribution_total` counts the same rows). */
export function isContribution(payment: ReceivedPayment): boolean {
  return payment.receipt_type === 'Contribution';
}

// --- Exact sums -------------------------------------------------------------------

/** A served decimal ("1171.5800") as whole ten-thousandths, or null when unreadable. */
function units(amount: string | null): bigint | null {
  if (amount === null) return null;
  const match = /^(-)?(\d+)(?:\.(\d{1,4}))?$/.exec(amount.trim());
  if (!match) return null;
  const value = BigInt(match[2]) * 10000n + BigInt((match[3] ?? '').padEnd(4, '0'));
  return match[1] ? -value : value;
}

function decimal(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / 10000n;
  const part = (magnitude % 10000n).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole}.${part}`;
}

/** The sum of every amount, or null when any one is missing: a group's total is
 * shown only when every amount is present (RULE Design system §07). */
export function sumAmounts(amounts: ReadonlyArray<string | null>): string | null {
  let total = 0n;
  for (const amount of amounts) {
    const value = units(amount);
    if (value === null) return null;
    total += value;
  }
  return decimal(total);
}

export const AMOUNT_MISSING = 'Amount not given';
export const TOTAL_WITHHELD = 'Unavailable because a payment amount is missing';
export const DATE_MISSING = 'Date not given in the public file';

// --- Rows and groups ----------------------------------------------------------------

export interface Row {
  /** Unique on the page: the payment's place in the loaded list. */
  id: string;
  recordNumber: number;
  date: string | null;
  amount: string | null;
  kind: string;
  statement: AttachedStatementRow | null;
}

export interface Group {
  key: string;
  name: string;
  /** The committee's own registration number when the name is a registered filer
   * this release holds, otherwise null. */
  committeeNumber: string | null;
  /** The printed spelling and its column, for a name that is no filer. */
  printed: { name: string; role: 'donor' | 'payee' } | null;
  kind: string;
  inKind: boolean;
  rows: Row[];
  total: string | null;
}

function distinct(values: string[]): string {
  return [...new Set(values.filter(Boolean))].join(' · ');
}

function addTo(
  groups: Map<string, Group>,
  key: string,
  start: () => Omit<Group, 'rows' | 'total' | 'kind' | 'inKind'>,
  row: Row,
  inKind: boolean,
) {
  let group = groups.get(key);
  if (!group) {
    group = { ...start(), kind: '', inKind: false, rows: [], total: null };
    groups.set(key, group);
  }
  group.rows.push(row);
  group.inKind ||= inKind;
}

function finish(groups: Map<string, Group>): Group[] {
  return [...groups.values()].map((group) => ({
    ...group,
    kind: distinct(group.rows.map((row) => row.kind)),
    total: sumAmounts(group.rows.map((row) => row.amount)),
  }));
}

/** The year's contributions grouped by printed name, per tab. Rows keep the list's
 * order (newest first), so a group's first row is its latest payment. */
export function contributionGroups(
  payments: readonly ReceivedPayment[],
  linkable: ReadonlySet<string>,
  statements: readonly AttachedStatementRow[],
): Record<ContributionTab, Group[]> {
  const byRecord = new Map<number, AttachedStatementRow>();
  for (const statement of statements) byRecord.set(statement.record_number, statement);
  const maps: Record<ContributionTab, Map<string, Group>> = {
    individuals: new Map(),
    lobbyists: new Map(),
    committees: new Map(),
    party: new Map(),
    other: new Map(),
  };
  payments.forEach((payment, index) => {
    if (!isContribution(payment)) return;
    const shown = receivedPaymentRow(
      {
        contributor: payment.contributor,
        contributorRegistrationNumber: payment.contributor_registration_number,
        contributorType: payment.contributor_type,
        amount: payment.amount,
        receivedOn: payment.received_on,
        receiptType: payment.receipt_type,
        inKind: payment.in_kind,
      },
      linkable,
    );
    const tab = tabOfKind(payment.contributor_type);
    addTo(
      maps[tab],
      `${payment.contributor_registration_number ?? ''}|${shown.name}`,
      () => ({
        key: `${tab}|${payment.contributor_registration_number ?? ''}|${shown.name}`,
        name: shown.name,
        committeeNumber: shown.linkNumber,
        printed: shown.nameLink ? { name: shown.nameLink.name, role: 'donor' } : null,
      }),
      {
        id: `cmt-pay-r${index}`,
        recordNumber: payment.record_number,
        date: payment.received_on,
        amount: payment.amount,
        kind: payment.contributor_type ?? '',
        statement: byRecord.get(payment.record_number) ?? null,
      },
      isInKind(payment.in_kind),
    );
  });
  return {
    individuals: finish(maps.individuals),
    lobbyists: finish(maps.lobbyists),
    committees: finish(maps.committees),
    party: finish(maps.party),
    other: finish(maps.other),
  };
}

/** What a payment out was, in the file's words: money given to another campaign
 * says so (the shared payments wording), everything else its filed purpose. */
export function madeKind(payment: MadePayment): string {
  if (payment.expenditure_type === 'Contribution') return 'Money given to another campaign';
  return payment.purpose ?? payment.expenditure_type ?? '';
}

export function expenditureGroups(
  payments: readonly MadePayment[],
  linkable: ReadonlySet<string>,
): Group[] {
  const groups = new Map<string, Group>();
  payments.forEach((payment, index) => {
    const shown = madePaymentRow(
      {
        vendorName: payment.vendor_name,
        vendorCity: payment.vendor_city,
        vendorState: payment.vendor_state,
        affectedCommitteeName: payment.affected_committee_name,
        affectedCommitteeRegistrationNumber: payment.affected_committee_registration_number,
        amount: payment.amount,
        paidOn: payment.paid_on,
        expenditureType: payment.expenditure_type,
        purpose: payment.purpose,
        inKind: payment.in_kind,
      },
      linkable,
    );
    const number =
      payment.expenditure_type === 'Contribution'
        ? (payment.affected_committee_registration_number ?? '')
        : '';
    addTo(
      groups,
      `${number}|${shown.name}`,
      () => ({
        key: `expenditures|${number}|${shown.name}`,
        name: shown.name,
        committeeNumber: shown.linkNumber,
        printed: shown.nameLink ? { name: shown.nameLink.name, role: 'payee' } : null,
      }),
      {
        id: `cmt-pay-m${index}`,
        recordNumber: payment.record_number,
        date: payment.paid_on,
        amount: payment.amount,
        kind: madeKind(payment),
        statement: null,
      },
      isInKind(payment.in_kind),
    );
  });
  return finish(groups);
}

// --- Sorting, filtering, counting ----------------------------------------------------

export type SortKey = 'total' | 'name' | 'records';
export const SORTS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: 'total', label: 'Largest total first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'records', label: 'Most records' },
];

export function isSort(value: string): value is SortKey {
  return SORTS.some((sort) => sort.value === value);
}

/** A withheld total sorts after every known one; it is never read as 0. */
export function sortGroups(groups: readonly Group[], sort: SortKey): Group[] {
  const sorted = [...groups];
  if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'records') sorted.sort((a, b) => b.rows.length - a.rows.length);
  else {
    sorted.sort((a, b) => {
      if (a.total === null || b.total === null) {
        return a.total === null ? (b.total === null ? 0 : 1) : -1;
      }
      const left = units(a.total)!;
      const right = units(b.total)!;
      return left === right ? 0 : left > right ? -1 : 1;
    });
  }
  return sorted;
}

export function matchName(groups: readonly Group[], query: string): Group[] {
  const wanted = query.trim().toLowerCase();
  return wanted ? groups.filter((group) => group.name.toLowerCase().includes(wanted)) : [...groups];
}

export function recordCount(groups: readonly Group[]): number {
  return groups.reduce((sum, group) => sum + group.rows.length, 0);
}

function count(value: number): string {
  return value.toLocaleString('en-US');
}

/** "{n} names · {n} payment records" above the table. */
export function countsLine(groups: readonly Group[]): string {
  const names = groups.length;
  const records = recordCount(groups);
  return `${count(names)} ${names === 1 ? 'name' : 'names'} · ${count(records)} ${
    records === 1 ? 'payment record' : 'payment records'
  }`;
}

/** The table's total: every group's sum, or withheld when any amount is missing. */
export function tableTotal(groups: readonly Group[]): string {
  const sum = sumAmounts(groups.map((group) => group.total));
  return sum === null ? TOTAL_WITHHELD : (formatMoney(sum) ?? TOTAL_WITHHELD);
}

/** "{n} payment records" plus the disclosure statement fragment (Committee drawing). */
export function groupCountLabel(group: Group): string {
  const n = group.rows.length;
  const withStatement = group.rows.filter((row) => row.statement !== null).length;
  const fragment = !withStatement
    ? ''
    : n === 1
      ? ' with a disclosure statement'
      : withStatement === n
        ? n === 2
          ? ', both with a disclosure statement'
          : `, all ${count(n)} with a disclosure statement`
        : `, ${count(withStatement)} with a disclosure statement`;
  return `${count(n)} ${n === 1 ? 'payment record' : 'payment records'}${fragment}`;
}

export function dayOrMissing(value: string | null): string {
  return formatDay(value) ?? DATE_MISSING;
}

export function amountOrMissing(value: string | null): string {
  return formatMoney(value) ?? AMOUNT_MISSING;
}

export function totalOrWithheld(value: string | null): string {
  return value === null ? TOTAL_WITHHELD : (formatMoney(value) ?? TOTAL_WITHHELD);
}

// --- Report figures ------------------------------------------------------------------

export interface ReportOption {
  value: string;
  label: string;
  filing: Filing | null;
  periodEnd: string;
}

/** "2026 Pre-Primary Report · Amendment 1" or "… · as filed", the Board's report
 * name with the version our copy holds (copy proposal C7's shape). */
export function reportLabel(filing: Filing): string | null {
  if (!filing.report_name) return null;
  const index = filing.effective_amendment_index;
  if (index === null || index === undefined) return filing.report_name;
  return `${filing.report_name} · ${index > 0 ? `Amendment ${index}` : 'as filed'}`;
}

/**
 * The selected year's reports whose figures we hold. The server holds the filer's
 * own totals for 1 report per direction (`reported_through`), so the menu offers
 * those reports and no other: a report offered with nothing under it would read as
 * a report whose figures are blank.
 */
export function reportOptions(
  year: number,
  ends: ReadonlyArray<string | null>,
  filings: readonly Filing[],
): ReportOption[] {
  const options: ReportOption[] = [];
  for (const end of ends) {
    if (!end || options.some((option) => option.periodEnd === end)) continue;
    const filing =
      filings.find((item) => item.filing_year === year && item.period_end === end) ?? null;
    options.push({
      value: end,
      label: (filing && reportLabel(filing)) ?? '',
      filing,
      periodEnd: end,
    });
  }
  return options;
}
