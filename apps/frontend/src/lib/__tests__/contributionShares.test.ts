import { describe, expect, it } from 'vitest';

import { moneyUnits } from '../campaignMoneyDetails';
import {
  donationCardsCopy,
  figureArrangement,
  phoneScale,
  shareOfDollars,
} from '../contributionFigures';

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
  it('captions the table in one line, with no closing dot and no subtotal clause', () => {
    expect(donationCardsCopy.locationsCaption(2025)).toBe(
      'Itemized individual contributions by state, 2025',
    );
    expect(donationCardsCopy.locationsCaption(2024)).toBe(
      'Itemized individual contributions by state, 2024',
    );
  });

  it('prints 4 notes, each one line and none closing on a dot', () => {
    expect(donationCardsCopy.locationNotes).toEqual([
      'States are identified from ZIP codes in the state’s file',
      'Unknown means the state’s file has no usable ZIP code to identify the donor’s state',
      'Names count distinct spellings within each row, including contributions of goods and services',
      'The same name can appear in more than 1 state',
    ]);
  });

  it('counts the hidden states in the control\u2019s name, singular and plural', () => {
    expect(donationCardsCopy.locationsToggle(true, 7)).toBe('Hide the 7 states in Other states');
    expect(donationCardsCopy.locationsToggle(false, 7)).toBe('Show the 7 states in Other states');
    expect(donationCardsCopy.locationsToggle(true, 1)).toBe('Hide the state in Other states');
    expect(donationCardsCopy.locationsToggle(false, 1)).toBe('Show the state in Other states');
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

describe('the card grows with the text the browser really draws', () => {
  // Design's own 3 specimens, 19 September 2026.
  it.each([
    [15, { heading: 20, columnHeader: 11, bar: 20, cellPadding: 9, swatch: 14, chevron: 18 }],
    [20, { heading: 27, columnHeader: 14, bar: 24, cellPadding: 11, swatch: 14, chevron: 18 }],
    [30, { heading: 40, columnHeader: 21, bar: 36, cellPadding: 13, swatch: 20, chevron: 26 }],
  ])('draws Design\u2019s own sizes at %ipx text', (size, expected) => {
    expect(phoneScale(size)).toMatchObject({ body: size, ...expected });
  });

  it('never goes below the 15px the money section keeps on phones', () => {
    expect(phoneScale(11).body).toBe(15);
    expect(phoneScale(0).body).toBe(15);
    expect(phoneScale(15.4).body).toBe(15);
  });

  it('keeps the 44px target by pulling the row back, and stops pulling when it cannot', () => {
    // 15px text leaves 44 - 20.25 to absorb, so the row keeps the height it has today.
    expect(phoneScale(15).toggleMargin).toBe(-12);
    // At 30px the label is taller than 44 on its own, so there is nothing left to pull.
    expect(phoneScale(30).toggleMargin).toBe(-2);
    expect(Math.abs(phoneScale(40).toggleMargin)).toBe(0);
  });
});

describe('which phone arrangement the figures take', () => {
  it('keeps the 3 shared columns while they fit', () => {
    expect(figureArrangement({ available: 236, columns: 214, beside: 180 })).toBe('columns');
  });

  it('gives each figure its own line once the columns no longer fit', () => {
    expect(figureArrangement({ available: 236, columns: 260, beside: 230 })).toBe('beside');
  });

  it('puts the label above its figure once they cannot share a line', () => {
    expect(figureArrangement({ available: 236, columns: 300, beside: 280 })).toBe('above');
  });

  it('draws the card in its usual shape before anything has been measured', () => {
    // A server-rendered card has no layout to read, and the shape it ships in is the one
    // that fits at the 15px floor, which is what almost every reader has.
    expect(figureArrangement({ available: 0, columns: 0, beside: 0 })).toBe('columns');
  });

  it('never picks a wider arrangement than the one that fits', () => {
    // Nothing is ever shortened or clipped to make a choice work, so the last resort has
    // to be the arrangement that cannot overflow.
    expect(figureArrangement({ available: 40, columns: 999, beside: 999 })).toBe('above');
  });
});
