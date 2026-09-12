// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MoneyOutBlock, type MoneyOutLike } from '../MoneyCards';

const missingOfficial =
  'We do not hold an official spending total for this committee for this year.';
const missingNamed = 'We do not hold a named-payments total for this committee for this year.';
const listedNote =
  'Payments listed in the state’s public file for this year, including goods and services.';
const base = {
  state: 'reported',
  itemizedPaymentTotal: '1234.5600',
  reportedTotal: null,
  reportedThrough: '2025-12-31',
} as MoneyOutLike;

for (const surface of ['profile', 'committee'] as const) {
  describe(`${surface} money out`, () => {
    function text(moneyOut: MoneyOutLike | null) {
      const host = document.createElement('div');
      host.innerHTML = renderToStaticMarkup(
        <MoneyOutBlock
          surface={surface}
          moneyOut={moneyOut}
          stampThrough={null}
          isMobile={false}
        />,
      );
      return host.textContent ?? '';
    }

    it('names the limited payments total when the official total is absent', () => {
      const result = text(base);
      expect(result).toContain('Total of named payments');
      expect(result).toContain('$1,234');
      expect(result).toContain(listedNote);
      expect(result).toContain(missingOfficial);
      expect(result).not.toContain('Expenditures');
      expect(result).not.toContain('Not reported');
      expect(result).not.toContain('covering through');
    });

    it.each(['0.0000', '2800.0000'])(
      'keeps the official total %s and its coverage',
      (reportedTotal) => {
        const result = text({ ...base, reportedTotal });
        expect(result).toContain('Expenditures');
        expect(result).toContain(reportedTotal === '0.0000' ? '$0' : '$2,800');
        expect(result).toContain('covering through Dec 31, 2025');
        expect(result).not.toContain('Total of named payments');
        expect(result).not.toContain(missingOfficial);
        expect(result).not.toContain('$1,234');
      },
    );

    it('keeps a measured zero in the named payments as a named figure', () => {
      const result = text({ ...base, itemizedPaymentTotal: '0.0000' } as MoneyOutLike);
      expect(result).toContain('Total of named payments');
      expect(result).toContain('$0');
      expect(result).toContain(missingOfficial);
      expect(result).not.toContain('Expenditures');
    });

    it.each([
      null,
      { ...base, itemizedPaymentTotal: null },
      { ...base, state: 'not_reported', itemizedPaymentTotal: '0.0000' },
      { ...base, state: 'unavailable' },
    ] as (MoneyOutLike | null)[])(
      'does not make a missing or unavailable named total into a figure: %j',
      (moneyOut) => {
        const result = text(moneyOut);
        expect(result).toContain(missingNamed);
        expect(result).toContain(missingOfficial);
        expect(result).not.toContain('$');
        expect(result).not.toContain('Expenditures');
        expect(result).not.toContain('Not reported');
      },
    );
  });
}
