// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MoneyOutBlock, type MoneyOutLike } from '../MoneyCards';

const missingOfficial =
  'We do not hold an official spending total for this committee for this year.';
const officialZero =
  'The committee’s own report states $0 in expenditures. That is the filing’s own zero, not a gap in our records.';
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

    it.each([
      base,
      null,
      { ...base, itemizedPaymentTotal: '0.0000' },
      { ...base, itemizedPaymentTotal: null },
      { ...base, state: 'not_reported', itemizedPaymentTotal: '0.0000' },
      { ...base, state: 'unavailable' },
    ] as (MoneyOutLike | null)[])(
      'prints only our missing-official-total sentence, regardless of named rows: %j',
      (moneyOut) => {
        const result = text(moneyOut);
        expect(result).toBe(`Money out${missingOfficial}`);
        expect(result).not.toContain('Total of named payments');
        expect(result).not.toContain(listedNote);
        expect(result).not.toContain('$');
      },
    );

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

    it('keeps an official figure when the separate comparison is unproved', () => {
      const moneyOut = {
        ...base,
        reportedTotal: '17307.4800',
        statedSpendingState: 'reader_unproven',
      };
      const result = text(moneyOut);
      expect(result).toContain('Expenditures');
      expect(result).toContain('$17,307');
      expect(result).not.toContain(missingOfficial);
    });

    it('gives an official zero its own sentence even when the comparison is unproved', () => {
      const moneyOut = { ...base, reportedTotal: '0.0000', statedSpendingState: 'reader_unproven' };
      const result = text(moneyOut);
      expect(result).toContain('Expenditures');
      expect(result).toContain('$0');
      expect(result).toContain(officialZero);
      expect(result).not.toContain(missingOfficial);
    });
  });
}
