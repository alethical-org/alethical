import { describe, expect, it } from 'vitest';

import { moneyUnits } from '../campaignMoneyDetails';
import { donationCardsCopy, shareOfDollars } from '../contributionFigures';

/** The share arithmetic reads amounts exactly as the filings state them. */
const share = (numerator: string, denominator: string) =>
  shareOfDollars(moneyUnits(numerator)!, moneyUnits(denominator)!);

describe('a category share of itemized individual contribution dollars', () => {
  it('separates a measured zero from having no money to take a share of', () => {
    // A category that really holds none of a positive total is a measured zero.
    expect(share('0', '39950')).toBe('0%');
    expect(share('0.0000', '39950.0000')).toBe('0%');
    // No dollars at all is not zero per cent; it is a share nobody can take.
    expect(share('0', '0')).toBe('Not applicable');
  });

  it('never shows money that exists as nothing', () => {
    // $20 of $41,470 is 0.048%, which rounds to 0.0% and would read as none.
    expect(share('20', '41470')).toBe('<0.1%');
    expect(share('0.01', '1000000')).toBe('<0.1%');
    // Exactly a tenth prints as a tenth rather than as less than one.
    expect(share('1', '1000')).toBe('0.1%');
  });

  it('divides the full stored amount, not the whole dollars the table prints', () => {
    // Both amounts cut to $99 on screen; only one of them is half the total.
    expect(share('99.9999', '199.9998')).toBe('50.0%');
    expect(share('0.5', '100')).toBe('0.5%');
  });

  it('rounds each row on its own and never nudges one to make them total 100%', () => {
    // 3 equal thirds print 33.3% each and add to 99.9%. That is the honest figure.
    expect(['1', '1', '1'].map((part) => share(part, '3'))).toEqual(['33.3%', '33.3%', '33.3%']);
    // Half a tenth rounds up.
    expect(share('1005', '10000')).toBe('10.1%');
    expect(share('1004', '10000')).toBe('10.0%');
  });

  it('prints the production figures for committee 17868 in 2025', () => {
    expect(share('38700.0000', '39950.0000')).toBe('96.9%');
    expect(share('0', '39950.0000')).toBe('0%');
    expect(share('1250.0000', '39950.0000')).toBe('3.1%');
  });

  it('refuses a negative rather than clamping it into a plausible chart', () => {
    expect(shareOfDollars(moneyUnits('-100')!, moneyUnits('1000')!)).toBeNull();
    expect(shareOfDollars(moneyUnits('100')!, moneyUnits('-1000')!)).toBeNull();
  });
});

describe('the contributor-location card names its own limits', () => {
  it('states the subtotal relationship in words only where there are state rows', () => {
    expect(donationCardsCopy.locationsCaption(2025, true)).toBe(
      'Itemized individual contributions by state, 2025. States listed under Other states ' +
        'are included in its subtotal.',
    );
    expect(donationCardsCopy.locationsCaption(2025, false)).toBe(
      'Itemized individual contributions by state, 2025',
    );
  });

  it('warns that a name count is spellings, and can repeat across states', () => {
    expect(donationCardsCopy.locationNotes[2]).toBe(
      'Names count distinct spellings within each row, including contributions of goods ' +
        'and services. The same name can appear in more than 1 state.',
    );
  });

  it('prints a payment location from the record, inventing nothing', () => {
    expect(donationCardsCopy.paymentLocation('Minnesota', '55401')).toBe(
      'State: Minnesota · ZIP code as filed: 55401',
    );
    expect(donationCardsCopy.paymentLocation(null, '553')).toBe(
      'State: Unknown · ZIP code as filed: 553',
    );
    expect(donationCardsCopy.paymentLocation(null, null)).toBe(
      'State: Unknown · ZIP code as filed: Not reported',
    );
  });
});
