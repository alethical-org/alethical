import { describe, expect, it } from 'vitest';
import {
  combineOutsideSpenders,
  outsideSpenderFigures,
  outsideSpenderIdentity,
  outsideSpenderKey,
  paymentsForOutsideSpender,
  type OutsideDirection,
  type OutsideSpenderGroup,
} from '../groupedOutsideSpending';

function group(
  about: string,
  registration: string | null,
  name: string,
  direction: OutsideDirection,
  amount: string | null,
  count = 1,
): OutsideSpenderGroup {
  const identity = outsideSpenderIdentity(registration, name);
  return {
    identity,
    key: outsideSpenderKey(identity, direction),
    name,
    registrationNumber: registration,
    linkable: registration !== null,
    groupingBasis: registration ? 'registration_number' : 'exact_name',
    direction,
    amount,
    paymentCount: count,
    aboutRegistrationNumbers: [about],
  };
}

describe('outside spending identities and exact amounts', () => {
  it('adds one spender across confirmed committees while keeping directions separate', () => {
    const rows = combineOutsideSpenders([
      group('1', '900', 'Old name', 'For', '0.1', 2),
      group('2', '900', 'New name', 'For', '0.2', 3),
      group('2', '900', 'New name', 'Against', '0.05'),
    ]);
    expect(rows.map((row) => [row.amount, row.paymentCount])).toEqual([
      ['0.30', 5],
      ['0.05', 1],
    ]);
    expect(rows[0].aboutRegistrationNumbers).toEqual(['1', '2']);
    expect(outsideSpenderFigures(rows)).toMatchObject([
      { direction: 'For', amount: '0.30', paymentCount: 5, spenderCount: 1 },
      { direction: 'Against', amount: '0.05', paymentCount: 1, spenderCount: 1 },
      { direction: 'not recorded', amount: '0.00', paymentCount: 0, spenderCount: 0 },
    ]);
  });

  it('does not join different registrations, approximate spellings, or a name that looks like a registration', () => {
    const rows = combineOutsideSpenders([
      group('1', '900', 'Shared', 'For', '1'),
      group('1', '901', 'Shared', 'For', '1'),
      group('1', null, '900', 'For', '1'),
      group('1', null, 'Shared', 'For', '1'),
      group('1', null, 'shared', 'For', '1'),
    ]);
    expect(rows).toHaveLength(5);
    expect(outsideSpenderFigures(rows)[0].spenderCount).toBe(5);
  });

  it('keeps missing sums missing, negative amounts separate, and precise values in order', () => {
    const rows = combineOutsideSpenders([
      group('1', '1', 'A', 'For', '9007199254740992.0001'),
      group('1', '2', 'B', 'For', '9007199254740992.0002'),
      group('1', '3', 'C', 'For', null),
      group('2', '3', 'C', 'For', '25'),
      group('1', '4', 'D', 'Against', '-25.1234'),
    ]);
    expect(rows.map((row) => row.registrationNumber)).toEqual(['2', '1', '4', '3']);
    expect(outsideSpenderFigures(rows)[0].amount).toBeNull();
    expect(outsideSpenderFigures(rows)[1].amount).toBe('-25.1234');
  });

  it('keeps repeated payments and filters details by registration, direction and confirmed scope', () => {
    const row = {
      aboutRegistrationNumber: '1',
      spenderRegistrationNumber: '900',
      spender: 'As filed',
      direction: 'For' as const,
      amount: '5',
      paidOn: '2025-03-01',
      purpose: null,
      vendorName: null,
      recordNumber: 1,
    };
    const payments = [
      row,
      { ...row, recordNumber: 2 },
      { ...row, direction: 'Against' as const },
      { ...row, aboutRegistrationNumber: '9' },
    ];
    const selected = paymentsForOutsideSpender(
      payments,
      group('1', '900', 'New name', 'For', '10', 2),
    );
    expect(selected.map((payment) => payment.recordNumber)).toEqual([2, 1]);
  });
});
