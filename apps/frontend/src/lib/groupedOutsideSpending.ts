import { sumMoneyAmounts } from './campaignMoneyDetails';

export type OutsideDirection = 'For' | 'Against' | 'not recorded';

export interface OutsideSpenderGroup {
  key: string;
  identity: string;
  name: string | null;
  registrationNumber: string | null;
  linkable: boolean;
  groupingBasis: 'registration_number' | 'exact_name';
  direction: OutsideDirection;
  amount: string | null;
  paymentCount: number;
  aboutRegistrationNumbers: string[];
}

export interface OutsideSpenderFigure {
  direction: OutsideDirection;
  label: string;
  amount: string | null;
  paymentCount: number;
  spenderCount: number;
}

export interface OutsideGroupPayment {
  aboutRegistrationNumber: string;
  spender: string | null;
  spenderRegistrationNumber: string | null;
  direction: OutsideDirection;
  amount: string | null;
  paidOn: string | null;
  purpose: string | null;
  vendorName: string | null;
  recordNumber: number;
}

// Reader-facing wording belongs to the layout, never to a downloaded payment.
export const OUTSIDE_GROUP_COPY = {
  explainer:
    "Money that groups other than this legislator's campaign have told the state they spent to support or oppose them. It does not go to their campaign and appears nowhere in the reports their campaign files, so reading only those reports leaves this money out.",
  heading: 'Who spent it',
  loading: 'Loading the list of outside spenders…',
  failed:
    'We could not load the list of outside spenders right now. The figures above still come from the saved state file.',
  detailsLoading: 'Loading all the payments…',
  detailsFailed:
    'We could not load the complete payment details from the same state file. The amount above still comes from the complete spender list.',
  retry: 'Try again',
  unknownName: 'Name not given in the filing',
  unknownAmount: 'Amount not given in the filing',
  unknownDate: 'Date not given in the filing',
  unknownPurpose: 'Purpose not given in the filing',
  unknownVendor: 'Vendor not given in the filing',
  exactName: 'Registration not given; grouped by name as filed',
  source: 'Minnesota Campaign Finance Board filings',
  paymentMade: 'Payment made',
  paymentsMade: 'Payments made',
} as const;

export function outsideCheckedZeroLabel(year: number): string {
  return `No outside group reported spending anything to support or oppose this legislator in ${year}.`;
}

export function outsideRegistrationLabel(registration: string | null): string {
  return registration ? `Registration ${registration}` : OUTSIDE_GROUP_COPY.exactName;
}

export function outsideVendorLabel(vendor: string | null): string {
  return vendor ? `Vendor: ${vendor}` : OUTSIDE_GROUP_COPY.unknownVendor;
}

export function outsideExpansionLabel(group: OutsideSpenderGroup, expanded: boolean): string {
  return `${expanded ? 'Hide' : 'Show'} ${outsidePaymentCountLabel(group.paymentCount)} from ${group.name ?? OUTSIDE_GROUP_COPY.unknownName}, ${outsideDirectionLabel(group.direction)}`;
}

export function outsideSpenderIdentity(registration: string | null, name: string | null): string {
  return JSON.stringify(
    registration ? ['registration_number', registration] : ['exact_name', name],
  );
}

export function outsideSpenderKey(identity: string, direction: OutsideDirection): string {
  return JSON.stringify([identity, direction]);
}

export function outsideDirectionLabel(direction: OutsideDirection): string {
  return direction === 'not recorded' ? 'Not stated' : direction;
}

/** Exact comparisons share the source's 4-decimal precision. Nulls sort last. */
function units(amount: string): bigint {
  const negative = amount.startsWith('-');
  const [whole, fraction = ''] = (negative ? amount.slice(1) : amount).split('.');
  const absolute = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
  return negative ? -absolute : absolute;
}

function largestFirst(a: OutsideSpenderGroup, b: OutsideSpenderGroup): number {
  if (a.amount === null && b.amount !== null) return 1;
  if (a.amount !== null && b.amount === null) return -1;
  if (a.amount !== null && b.amount !== null) {
    const left = units(a.amount);
    const right = units(b.amount);
    if (left !== right) return left > right ? -1 : 1;
  }
  return (a.name ?? '').localeCompare(b.name ?? '') || a.key.localeCompare(b.key);
}

/** Outside spending may span confirmed candidate committees; campaign receipts may not. */
export function combineOutsideSpenders(
  groups: readonly OutsideSpenderGroup[],
): OutsideSpenderGroup[] {
  const combined = new Map<string, OutsideSpenderGroup>();
  for (const group of groups) {
    const previous = combined.get(group.key);
    if (!previous) {
      combined.set(group.key, {
        ...group,
        aboutRegistrationNumbers: [...group.aboutRegistrationNumbers],
      });
      continue;
    }
    previous.amount = sumMoneyAmounts([previous.amount, group.amount]);
    previous.paymentCount += group.paymentCount;
    previous.linkable = previous.linkable && group.linkable;
    previous.aboutRegistrationNumbers = [
      ...new Set([...previous.aboutRegistrationNumbers, ...group.aboutRegistrationNumbers]),
    ].sort();
  }
  return [...combined.values()].sort(largestFirst);
}

export function outsideSpenderFigures(
  groups: readonly OutsideSpenderGroup[],
): OutsideSpenderFigure[] {
  const directions: { direction: OutsideDirection; label: string }[] = [
    { direction: 'For', label: 'Spent supporting them' },
    { direction: 'Against', label: 'Spent opposing them' },
    { direction: 'not recorded', label: 'Spent where the filing does not say which' },
  ];
  return directions.map(({ direction, label }) => {
    const matching = groups.filter((group) => group.direction === direction);
    return {
      direction,
      label,
      amount: sumMoneyAmounts(matching.map((group) => group.amount)),
      paymentCount: matching.reduce((count, group) => count + group.paymentCount, 0),
      spenderCount: new Set(matching.map((group) => group.identity)).size,
    };
  });
}

export function paymentsForOutsideSpender(
  payments: readonly OutsideGroupPayment[],
  group: OutsideSpenderGroup,
): OutsideGroupPayment[] {
  return payments
    .filter(
      (payment) =>
        group.aboutRegistrationNumbers.includes(payment.aboutRegistrationNumber) &&
        payment.direction === group.direction &&
        outsideSpenderIdentity(payment.spenderRegistrationNumber, payment.spender) ===
          group.identity,
    )
    .sort(
      (a, b) => (b.paidOn ?? '').localeCompare(a.paidOn ?? '') || b.recordNumber - a.recordNumber,
    );
}

export function outsidePaymentCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'payment' : 'payments'}`;
}

export function outsideSpenderCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'spender' : 'spenders'}`;
}
