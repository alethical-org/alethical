import { afterEach, describe, expect, it } from 'vitest';

import { formatMoney, setNegativeSign } from '@alethical/shared/moneyFormat';
import { receivedPaymentRow } from '@alethical/shared/committeePaymentsPage';

afterEach(() => setNegativeSign('hyphen'));

describe('Finance’s negative sign', () => {
  it('prints a true minus sign from every shared helper once Finance starts', async () => {
    expect(formatMoney(-150)).toBe('-$150');
    await import('../moneySign');
    expect(formatMoney(-150)).toBe('−$150');
    // A shared helper that formats money itself follows the same setting.
    const row = receivedPaymentRow(
      {
        contributor: 'Example Donor',
        contributorRegistrationNumber: null,
        contributorType: 'Individual',
        amount: '-150',
        receivedOn: '2026-03-04',
        receiptType: 'Contribution',
        inKind: null,
      },
      new Set(),
    );
    expect(row.amount).toBe('−$150');
  });
});
