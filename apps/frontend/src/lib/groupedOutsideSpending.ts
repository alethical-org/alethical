import { sumMoneyAmounts } from './campaignMoneyDetails';
import { OUTSIDE_GROUP_COPY } from './groupedOutsideSpendingCopy';

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

export { OUTSIDE_GROUP_COPY } from './groupedOutsideSpendingCopy';

/**
 * The one sentence a checked zero prints, in the year the reader is looking at.
 *
 * `anything` is gone: "reported spending to support or oppose" already carries it.
 *
 * The closing clause draws only where we hold that this year's ballot did not carry
 * them, and it is the whole reason the sentence earns its space. A zero in an off year
 * is the ordinary state rather than a finding, and a reader meeting a bare zero cannot
 * tell nothing-spent from nothing-held. The filing-schedule note carries the ballot
 * fact too, but it sits at the top of the tab while this card is well below it.
 *
 * `when` places the 2 facts in the same year and claims nothing about why the total is
 * zero (#2186, and `.claude/rules/grounded-answers.md` rule 3).
 */
export function outsideCheckedZeroLabel(
  year: number,
  subject: 'legislator' | 'committee' = 'legislator',
  notOnTheBallot = false,
): string {
  const ballot = notOnTheBallot
    ? `, when ${subject === 'committee' ? 'it was' : 'they were'} not on the ballot`
    : '';
  return `No outside group reported spending to support or oppose this ${subject} in ${year}${ballot}`;
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

/**
 * The filing's own `For` and `Against`, in the words the rest of the card uses.
 *
 * The 2 figures above the list read "Spent supporting them" and "Spent opposing them",
 * so a chip switching to a second vocabulary 3 rows later described the same
 * distinction twice. One function, so the chip and the row's spoken label can never
 * say different words (#2186).
 */
export function outsideDirectionLabel(direction: OutsideDirection): string {
  if (direction === 'For') return 'Supporting';
  if (direction === 'Against') return 'Opposing';
  return 'Not stated';
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
