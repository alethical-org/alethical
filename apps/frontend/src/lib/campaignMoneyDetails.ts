import type { CommitteeMadePayment, CommitteeReceivedPayment } from '../data/types';

export type MoneyDetailsTab =
  'individuals' | 'lobbyists' | 'committees' | 'partyUnits' | 'expenditures' | 'other';
export type MoneyDetailsSort = 'largest' | 'smallest' | 'name' | 'newest' | 'oldest';
export interface MoneyDetailsPreferences {
  tab: MoneyDetailsTab;
  sort: MoneyDetailsSort;
}
export const DEFAULT_MONEY_DETAILS_PREFERENCES: MoneyDetailsPreferences = {
  tab: 'individuals',
  sort: 'largest',
};
export const MONEY_DETAILS_TABS: readonly {
  id: MoneyDetailsTab;
  label: string;
  emptyWord: string;
}[] = [
  { id: 'individuals', label: 'Individuals', emptyWord: 'individuals' },
  { id: 'lobbyists', label: 'Lobbyists', emptyWord: 'lobbyists' },
  { id: 'committees', label: 'Committees & Funds', emptyWord: 'committees or funds' },
  { id: 'partyUnits', label: 'Party Units', emptyWord: 'party units' },
  { id: 'expenditures', label: 'Expenditures', emptyWord: 'payees' },
  { id: 'other', label: 'Other kinds', emptyWord: 'donors of other kinds' },
];
export const MONEY_DETAILS_SORTS: readonly { id: MoneyDetailsSort; label: string }[] = [
  { id: 'largest', label: 'Largest first' },
  { id: 'smallest', label: 'Smallest first' },
  { id: 'name', label: 'Name A to Z' },
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
];

export type DetailedReceivedPayment = CommitteeReceivedPayment & {
  recordNumber?: number;
  inKindDescription?: string | null;
};
export type DetailedMadePayment = CommitteeMadePayment & {
  recordNumber?: number;
  inKindDescription?: string | null;
  unpaidAmount?: string | null;
};
export type MoneyDetailsPayment = DetailedReceivedPayment | DetailedMadePayment;

/** Source amounts have at most 4 decimal places. Never sum through floating point. */
function moneyUnits(value: string | null): bigint | null {
  if (value === null || !/^-?\d+(?:\.\d{1,4})?$/.test(value)) return null;
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const result = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
  return negative ? -result : result;
}

function moneyString(units: bigint): string {
  const absolute = units < 0n ? -units : units;
  const fraction = String(absolute % 10000n).padStart(4, '0');
  const decimals = fraction.slice(2) === '00' ? fraction.slice(0, 2) : fraction;
  return `${units < 0n ? '-' : ''}${absolute / 10000n}.${decimals}`;
}

/** Caller supplies rows from ONE committee; no cross-committee interface exists here. */
export function sumMoneyAmounts(amounts: readonly (string | null)[]): string | null {
  let sum = 0n;
  for (const amount of amounts) {
    const units = moneyUnits(amount);
    if (units === null) return null;
    sum += units;
  }
  return moneyString(sum);
}

export function contributionTab(kind: string | null): MoneyDetailsTab {
  if (kind === 'Individual') return 'individuals';
  if (kind === 'Lobbyist') return 'lobbyists';
  if (kind === 'Political Committee/Fund' || kind === 'Candidate Committee') return 'committees';
  if (kind === 'Party Unit') return 'partyUnits';
  return 'other';
}

export interface MoneyDetailsGroup {
  key: string;
  name: string;
  printedName: string | null;
  tab: MoneyDetailsTab;
  types: (string | null)[];
  employers: string[];
  payments: MoneyDetailsPayment[];
  amount: string | null;
  inKindAmount: string | null;
  newestDate: string | null;
  oldestDate: string | null;
  linkableRegistrationNumber: string | null;
}

function dateOf(payment: MoneyDetailsPayment): string | null {
  return 'receivedOn' in payment ? payment.receivedOn : payment.paidOn;
}

function groupPayments(
  rows: readonly MoneyDetailsPayment[],
  linkable: readonly string[],
): MoneyDetailsGroup[] {
  const groups = new Map<string, MoneyDetailsGroup>();
  for (const payment of rows) {
    const received = 'receivedOn' in payment;
    if (received && payment.receiptType !== 'Contribution') continue;
    const sourceName = received ? payment.contributor : payment.vendorName;
    const printedName = sourceName === '' ? null : sourceName;
    const tab = received ? contributionTab(payment.contributorType) : 'expenditures';
    const key = JSON.stringify([tab, printedName]);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name: printedName ?? 'Name not given in the filing',
        printedName,
        tab,
        types: [],
        employers: [],
        payments: [],
        amount: null,
        inKindAmount: null,
        newestDate: null,
        oldestDate: null,
        linkableRegistrationNumber: null,
      };
      groups.set(key, group);
    }
    group.payments.push(payment);
    const kind = received ? payment.contributorType : payment.expenditureType;
    if (!group.types.includes(kind)) group.types.push(kind);
    if (received && payment.employer !== null && !group.employers.includes(payment.employer)) {
      group.employers.push(payment.employer);
    }
  }
  for (const group of groups.values()) {
    group.amount = sumMoneyAmounts(group.payments.map((row) => row.amount));
    group.inKindAmount = sumMoneyAmounts(
      group.payments.filter((row) => row.inKind === 'Yes').map((row) => row.amount),
    );
    const dates = group.payments
      .map(dateOf)
      .filter((date): date is string => date !== null)
      .sort();
    group.oldestDate = dates[0] ?? null;
    group.newestDate = dates[dates.length - 1] ?? null;
    // A printed name can refer to several registered committees. Do not choose one.
    const numbers = new Set(
      group.payments.map((row) =>
        'receivedOn' in row
          ? row.contributorRegistrationNumber
          : row.affectedCommitteeRegistrationNumber,
      ),
    );
    if (numbers.size === 1) {
      const [number] = numbers;
      if (number && linkable.includes(number)) group.linkableRegistrationNumber = number;
    }
  }
  return [...groups.values()];
}

export function groupContributionPayments(
  rows: readonly DetailedReceivedPayment[],
  linkable: readonly string[] = [],
): MoneyDetailsGroup[] {
  return groupPayments(rows, linkable);
}

export function groupExpenditurePayments(
  rows: readonly DetailedMadePayment[],
  linkable: readonly string[] = [],
): MoneyDetailsGroup[] {
  return groupPayments(rows, linkable);
}

export function tabDetails(groups: readonly MoneyDetailsGroup[], tab: MoneyDetailsTab) {
  const selected = groups.filter((group) => group.tab === tab);
  return {
    groups: selected,
    groupCount: selected.length,
    nameCount: selected.filter((group) => group.printedName !== null).length,
    unnamedNameGroups: selected.filter((group) => group.printedName === null).length,
    paymentCount: selected.reduce((count, group) => count + group.payments.length, 0),
    amount: sumMoneyAmounts(selected.map((group) => group.amount)),
    inKindAmount: sumMoneyAmounts(selected.map((group) => group.inKindAmount)),
  };
}

function compareNullable<T extends string | bigint>(a: T | null, b: T | null, descending: boolean) {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return (a < b ? -1 : a > b ? 1 : 0) * (descending ? -1 : 1);
}

export function sortMoneyGroups(
  groups: readonly MoneyDetailsGroup[],
  sort: MoneyDetailsSort,
  search = '',
): MoneyDetailsGroup[] {
  const needle = search.toLocaleLowerCase();
  return groups
    .filter((group) => !needle || (group.printedName ?? '').toLocaleLowerCase().includes(needle))
    .sort((a, b) => {
      let comparison = 0;
      if (sort === 'largest' || sort === 'smallest') {
        comparison = compareNullable(
          moneyUnits(a.amount),
          moneyUnits(b.amount),
          sort === 'largest',
        );
      } else if (sort === 'newest' || sort === 'oldest') {
        comparison = compareNullable(
          sort === 'newest' ? a.newestDate : a.oldestDate,
          sort === 'newest' ? b.newestDate : b.oldestDate,
          sort === 'newest',
        );
      }
      return comparison || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
    });
}

export function contributionChartSafety(rows: readonly DetailedReceivedPayment[]) {
  const contributions = rows.filter((row) => row.receiptType === 'Contribution');
  if (contributions.some((row) => row.inKind !== 'Yes' && row.inKind !== 'No')) {
    return 'unknown_in_kind' as const;
  }
  const cash = contributions.filter((row) => row.inKind === 'No');
  if (cash.some((row) => moneyUnits(row.amount) === null)) return 'missing_amount' as const;
  if (cash.some((row) => moneyUnits(row.amount)! < 0n)) return 'negative_amount' as const;
  if (!cash.some((row) => moneyUnits(row.amount)! > 0n)) return 'no_cash' as const;
  return 'ready' as const;
}

export function contributionKindSlices(rows: readonly DetailedReceivedPayment[]) {
  const kinds = new Map<string | null, DetailedReceivedPayment[]>();
  for (const row of rows) {
    if (row.receiptType !== 'Contribution' || row.inKind !== 'No') continue;
    const group = kinds.get(row.contributorType) ?? [];
    group.push(row);
    kinds.set(row.contributorType, group);
  }
  return [...kinds].map(([kind, payments]) => ({
    kind,
    tab: contributionTab(kind),
    amount: sumMoneyAmounts(payments.map((row) => row.amount)),
    nameCount: new Set(
      payments.map((row) => row.contributor).filter((name) => name !== null && name !== ''),
    ).size,
    safeForChart: payments.every((row) => {
      const amount = moneyUnits(row.amount);
      return amount !== null && amount >= 0n;
    }),
  }));
}

export interface ContributionChart {
  state: 'ready' | 'no_rows' | 'withheld' | 'unavailable';
  base: string | null;
  slices: {
    kind: string | null;
    tab: MoneyDetailsTab | null;
    amount: string;
    nameCount?: number;
    share: number;
  }[];
  reason?: string;
}

export function prepareContributionChart(
  rows: readonly DetailedReceivedPayment[],
  split: {
    state: string;
    reportedTotal: string | null;
    namedCashTotal: string | null;
    unnamedTotal: string | null;
  },
): ContributionChart {
  const absent = (state: ContributionChart['state'], reason?: string): ContributionChart => ({
    state,
    base: null,
    slices: [],
    reason,
  });
  const contributions = rows.filter((row) => row.receiptType === 'Contribution');
  if (contributions.length === 0) return absent('no_rows');
  if (split.state !== 'shown' && split.state !== 'no_reported_total') {
    return absent('withheld', split.state);
  }
  const safety = contributionChartSafety(contributions);
  // An official cash total may be entirely unnamed while named gifts are goods.
  if (safety !== 'ready' && safety !== 'no_cash') return absent('unavailable', safety);
  const slices = contributionKindSlices(contributions);
  const cash = moneyUnits(sumMoneyAmounts(slices.map((slice) => slice.amount)));
  const base =
    split.state === 'shown'
      ? moneyUnits(split.reportedTotal)
      : split.namedCashTotal === null
        ? cash
        : moneyUnits(split.namedCashTotal);
  const unnamed = split.state === 'shown' ? moneyUnits(split.unnamedTotal) : 0n;
  if (base === null || base <= 0n || cash === null || unnamed === null || unnamed < 0n) {
    return absent('unavailable', 'invalid_total');
  }
  if (cash + unnamed !== base) return absent('unavailable', 'totals_do_not_match');
  // Amount arithmetic stays exact. Only a dimensionless display ratio becomes Number.
  const share = (amount: bigint) => Number((amount * 1000000000n) / base) / 1000000000;
  const result: ContributionChart['slices'] = slices.map((slice) => ({
    kind: slice.kind,
    tab: slice.tab,
    amount: slice.amount!,
    nameCount: slice.nameCount,
    share: share(moneyUnits(slice.amount)!),
  }));
  if (split.state === 'shown' && unnamed > 0n) {
    result.push({
      kind: 'Non-itemized contributions',
      tab: null,
      amount: moneyString(unnamed),
      share: share(unnamed),
    });
  }
  return { state: 'ready', base: moneyString(base), slices: result };
}
