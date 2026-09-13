import type { CommitteeMoney } from '../data/types';
import type { OutsideSpendingYear } from './outsideSpending';

/** The committee's ABOUT summary needs no ownership claim. Shape it only on
 * the route that uses it; no other page needs to download this adapter. */
export function committeeOutsideSpending(money: CommitteeMoney): OutsideSpendingYear {
  const source = money.independentSpendingSource;
  const amounts = [source?.supporting, source?.opposing, source?.direction_not_recorded].map(
    (value) =>
      typeof value === 'string' && value.trim() && Number.isFinite(Number(value))
        ? Number(value)
        : null,
  );
  const counts = [
    source?.supporting_payments,
    source?.opposing_payments,
    source?.direction_not_recorded_payments,
  ];
  const reported =
    source?.state === 'reported' &&
    amounts.every((amount) => amount !== null) &&
    counts.every((count) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0);
  return {
    year: money.year,
    state: reported ? 'reported' : 'unavailable',
    // The finance response has no download ID. The grouped read establishes it
    // under the finance release ID; those 2 identities are never interchangeable.
    snapshotId: null,
    committees: [
      {
        registrationNumber: money.registrationNumber,
        name: money.register.name ?? money.committeeName ?? `Committee ${money.registrationNumber}`,
        office: money.register.office,
      },
    ],
    supporting: amounts[0],
    opposing: amounts[1],
    directionNotRecorded: amounts[2],
    supportingPayments: source?.supporting_payments ?? null,
    opposingPayments: source?.opposing_payments ?? null,
    directionNotRecordedPayments: source?.direction_not_recorded_payments ?? null,
    firstPaymentOn: source?.first_payment_on ?? null,
    lastPaymentOn: source?.last_payment_on ?? null,
    sourceUrl: source?.source_url ?? null,
    fetchedAt: money.fetchedAt,
  };
}
