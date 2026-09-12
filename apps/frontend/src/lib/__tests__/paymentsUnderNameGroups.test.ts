import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});
import { paymentUnderName } from '../../data/api';
import {
  paymentsUnderNameYears,
  paymentsUnderNameYearCount,
  paymentsUnderNameFilerKind,
  type PaymentUnderName,
} from '../paymentsUnderName';
import source from './fixtures/payments-under-name-nystrom.json';

export const nystromPayments = source.data.payments.map((row) =>
  paymentUnderName(row, 'contributor'),
);
const p = (changes: Partial<PaymentUnderName> = {}): PaymentUnderName => ({
  ...nystromPayments[0],
  year: 2025,
  paidOn: '2025-02-01',
  amount: '10.1250',
  ...changes,
});

describe('payments grouped by filing year and filer', () => {
  it('keeps all 29 real Nystrom rows and their exact within-filer/year subtotals', () => {
    const years = paymentsUnderNameYears(nystromPayments, false);
    expect(years.map((y) => y.year)).toEqual([
      2026, 2025, 2024, 2023, 2022, 2021, 2020, 2018, 2017, 2016,
    ]);
    expect(years.flatMap((y) => y.groups.flatMap((g) => g.payments))).toHaveLength(29);
    expect(
      years.flatMap((y) =>
        y.groups
          .filter((g) => g.subtotal !== null)
          .map((g) => [y.year, g.newest.filerRegistrationNumber, g.payments.length, g.subtotal]),
      ),
    ).toEqual([
      [2025, '41413', 2, '25000.0000'],
      [2025, '19205', 2, '2000.0000'],
      [2022, '18732', 3, '1641.0200'],
      [2022, '18960', 2, '520.5100'],
    ]);
    expect(nystromPayments.find((r) => r.recordNumber === 61068)?.employer).toBe(
      ' Nystrom & Associates, Ltd.',
    );
    expect(years.every((y) => !('subtotal' in y))).toBe(true);
  });
  it('uses filing year despite date differences and newest filed name within each group', () => {
    const years = paymentsUnderNameYears(
      [
        p({ filerName: 'Old name' }),
        p({ year: 2026, paidOn: null }),
        p({ filerName: 'Newest name', paidOn: '2025-08-02' }),
        p({ filerRegistrationNumber: '123', paidOn: '2025-09-01' }),
        p({ year: 2024, paidOn: '2026-01-01' }),
      ],
      false,
    );
    expect(years.map((y) => y.year)).toEqual([2026, 2025, 2024]);
    expect(years[1].groups.map((g) => g.newest.filerName)).toEqual([p().filerName, 'Newest name']);
    expect(years[1].groups[1].payments.map((r) => r.filerName)).toEqual([
      'Newest name',
      'Old name',
    ]);
  });
  it('keeps identical gifts, exact decimals and goods rather than deduplicating or dropping them', () => {
    const duplicate = p({ inKind: 'Yes' });
    const group = paymentsUnderNameYears([duplicate, duplicate], false)[0].groups[0];
    expect(group.payments).toHaveLength(2);
    expect(group.subtotal).toBe('20.2500');
  });
  it('never adds across different years or different registrations, even with identical names', () => {
    const years = paymentsUnderNameYears(
      [p(), p({ year: 2024 }), p({ filerRegistrationNumber: '123' })],
      false,
    );
    expect(years.flatMap((y) => y.groups).every((g) => g.subtotal === null)).toBe(true);
  });
  it('withholds a subtotal for missing money or an unidentified filer/year', () => {
    for (const changes of [
      { amount: null },
      { amount: 'garbage' },
      { amount: '' },
      { amount: '1.00001' },
    ])
      expect(paymentsUnderNameYears([p(), p(changes)], false)[0].groups[0].subtotal).toBeNull();
    expect(
      paymentsUnderNameYears([p({ year: null }), p({ year: null })], false)[0].groups[0].subtotal,
    ).toBeNull();
    expect(
      paymentsUnderNameYears(
        [p({ filerRegistrationNumber: null }), p({ filerRegistrationNumber: null })],
        false,
      )[0].groups.every((g) => g.subtotal === null),
    ).toBe(true);
  });
  it('puts missing dates last within a group and preserves signed source amounts', () => {
    const g = paymentsUnderNameYears(
      [p({ paidOn: null, amount: '-1.0000' }), p({ amount: '1.0000' })],
      false,
    )[0].groups[0];
    expect(g.payments[1].paidOn).toBeNull();
    expect(g.subtotal).toBe('0.0000');
  });
  it('merges more pages into existing groups and marks only the last visible year partial', () => {
    const first = [p({ year: 2026 }), p()];
    const before = paymentsUnderNameYears(first, true);
    expect(before.map((y) => y.mayContinue)).toEqual([false, true]);
    expect(paymentsUnderNameYearCount(before[1], 'contributor')).toBe('1 payment so far');
    const after = paymentsUnderNameYears(
      [...first, p({ paidOn: '2025-01-01' }), p({ year: 2024 })],
      true,
    );
    expect(after.map((y) => y.mayContinue)).toEqual([false, false, true]);
    expect(after[1].groups[0].subtotal).toBe('20.2500');
    expect(
      paymentsUnderNameYears([...first, p({ year: 2024 })], false).every((y) => !y.mayContinue),
    ).toBe(true);
  });
  it('names direction and group counts for all 3 roles', () => {
    const year = paymentsUnderNameYears([p(), p({ filerRegistrationNumber: '123' })], false)[0];
    expect(paymentsUnderNameYearCount(year, 'contributor')).toBe('2 payments to 2 committees');
    expect(paymentsUnderNameYearCount(year, 'vendor')).toBe('2 payments from 2 committees');
    expect(paymentsUnderNameYearCount(year, 'independent_vendor')).toBe(
      '2 payments from 2 spenders',
    );
  });
  it('does not count unidentified rows as distinct filers', () => {
    const rows = [p(), p({ filerRegistrationNumber: null }), p({ filerRegistrationNumber: null })];
    const year = paymentsUnderNameYears(rows, false)[0];
    expect(year.groups).toHaveLength(3);
    for (const role of ['contributor', 'vendor', 'independent_vendor'] as const) {
      expect(paymentsUnderNameYearCount(year, role)).toBe('3 payments');
    }
    const partial = paymentsUnderNameYears(rows, true)[0];
    expect(paymentsUnderNameYearCount(partial, 'independent_vendor')).toBe('3 payments so far');
    expect(year.groups.slice(1).every((group) => group.subtotal === null)).toBe(true);
  });
  it('uses filed recipient type for donations and held register kinds for payees without guessing', () => {
    expect(paymentsUnderNameFilerKind(p({ filerEntityType: 'PTU' }), 'contributor')).toBe(
      'Party unit',
    );
    expect(paymentsUnderNameFilerKind(p({ filerKind: 'party_unit' }), 'independent_vendor')).toBe(
      'Party unit',
    );
    expect(paymentsUnderNameFilerKind(p({ filerKind: 'candidate_committee' }), 'vendor')).toBe(
      'Candidate committee',
    );
    expect(paymentsUnderNameFilerKind(p({ filerKind: null }), 'independent_vendor')).toBeNull();
    expect(paymentsUnderNameFilerKind(p({ filerKind: 'unknown' }), 'vendor')).toBeNull();
  });
});
