import { describe, expect, it } from 'vitest';

import {
  formatSpendingAmount,
  isMeasuredZero,
  outsideSpendingFetchedOn,
  outsideSpendingFigures,
  outsideSpendingPaymentCount,
  outsideSpendingPeriod,
  outsideSpendingUnavailableReason,
  type OutsideSpendingYear,
} from '../outsideSpending';

// What the outside-spending block must never say (#1332, #1454). Each test stands in
// for a sentence that would be wrong while every number on the page was right.
//
// Figures are the real ones from the live release where a real one exists: Senator
// Omar Fateh's Minneapolis mayoral committees carry $487,974.82 supporting and
// $162,841.95 opposing across 101 payments in 2025.

const REPORTED: OutsideSpendingYear = {
  year: 2025,
  state: 'reported',
  supporting: 487974.82,
  opposing: 162841.95,
  directionNotRecorded: 0,
  supportingPayments: 74,
  opposingPayments: 27,
  directionNotRecordedPayments: 0,
  firstPaymentOn: '2025-02-03',
  lastPaymentOn: '2025-10-28',
  sourceUrl: 'https://cfb.mn.gov/reports/independent-expenditures.csv',
  fetchedAt: '2026-08-12T02:54:00Z',
};

const EMPTY: OutsideSpendingYear = {
  ...REPORTED,
  supporting: null,
  opposing: null,
  directionNotRecorded: null,
  supportingPayments: null,
  opposingPayments: null,
  directionNotRecordedPayments: null,
  firstPaymentOn: null,
  lastPaymentOn: null,
};

describe('formatSpendingAmount', () => {
  it('keeps real cents, because a rounded figure cannot be checked against the filing', () => {
    expect(formatSpendingAmount(487974.82)).toBe('$487,974.82');
    expect(formatSpendingAmount(1092625.5)).toBe('$1,092,625.50');
  });

  it('drops cents only when they are zero', () => {
    expect(formatSpendingAmount(2650)).toBe('$2,650');
    expect(formatSpendingAmount(0)).toBe('$0');
  });
});

describe('outsideSpendingFigures', () => {
  it('gives each side its own payment count, never one count under both', () => {
    // The two figures come from different payments, so one shared count would say the
    // same 101 payments produced each of them.
    const [supporting, opposing] = outsideSpendingFigures(REPORTED);
    expect(supporting.amount).toBe(487974.82);
    expect(supporting.payments).toBe(74);
    expect(opposing.amount).toBe(162841.95);
    expect(opposing.payments).toBe(27);
  });

  it('hides the third figure while every row records a side', () => {
    // All 41,130 rows of the live release read For or Against, so a permanently
    // visible third figure would tell a reader Minnesota leaves the question open.
    expect(outsideSpendingFigures(REPORTED)).toHaveLength(2);
  });

  it('shows the third figure the moment money lands in it', () => {
    // The failure this closes is a total that goes quietly short while still reading
    // as complete (#1454).
    const figures = outsideSpendingFigures({
      ...REPORTED,
      directionNotRecorded: 1665,
      directionNotRecordedPayments: 2,
    });
    expect(figures).toHaveLength(3);
    expect(figures[2].label).toBe('Spent where the filing does not say which');
    expect(figures[2].amount).toBe(1665);
    expect(figures[2].payments).toBe(2);
  });

  it('draws no figure at all in a state that carries none', () => {
    expect(outsideSpendingFigures({ ...EMPTY, state: 'link_unconfirmed' })).toEqual([]);
    expect(outsideSpendingFigures({ ...EMPTY, state: 'unavailable' })).toEqual([]);
  });

  it('never implies the money the sides add up to, or nets them against each other', () => {
    const labels = outsideSpendingFigures(REPORTED).map((figure) => figure.label);
    // Coordination is illegal and asserting it without a source is the most damaging
    // claim available on this page, so no label may read as money the campaign got.
    for (const label of labels) {
      expect(label).not.toMatch(/rais|receiv|back|alli|net|total|donat|contribut/i);
    }
    expect(labels).toEqual(['Spent supporting them', 'Spent opposing them']);
  });
});

describe('outsideSpendingPaymentCount', () => {
  it('counts every payment behind the figures, including the unclassified ones', () => {
    expect(
      outsideSpendingPaymentCount({
        ...REPORTED,
        directionNotRecorded: 45,
        directionNotRecordedPayments: 1,
      }),
    ).toBe(102);
  });

  it('is null when there is no figure, so nothing can print it as a zero', () => {
    expect(outsideSpendingPaymentCount({ ...EMPTY, state: 'link_unconfirmed' })).toBeNull();
    expect(outsideSpendingPaymentCount({ ...EMPTY, state: 'unavailable' })).toBeNull();
  });
});

describe('isMeasuredZero', () => {
  it('is true only for a checked year in which nobody filed anything', () => {
    expect(
      isMeasuredZero({
        ...REPORTED,
        supporting: 0,
        opposing: 0,
        supportingPayments: 0,
        opposingPayments: 0,
      }),
    ).toBe(true);
  });

  it('is false for every gap of ours, which is the whole of rule 12 here', () => {
    // A missing figure and a real zero are different facts. Reading a gap as a zero
    // would print "nobody spent anything" over money we simply cannot attribute.
    expect(isMeasuredZero({ ...EMPTY, state: 'link_unconfirmed' })).toBe(false);
    expect(isMeasuredZero({ ...EMPTY, state: 'unavailable' })).toBe(false);
  });
});

describe('outsideSpendingUnavailableReason', () => {
  it('says an unconfirmed link is our gap, and names why the link is needed', () => {
    const reason = outsideSpendingUnavailableReason({ ...EMPTY, state: 'link_unconfirmed' });
    expect(reason).toContain('committee');
    expect(reason).toContain('not a sign that no money was spent');
    expect(reason).not.toMatch(/\$0|\bzero\b|nothing was spent/i);
  });

  it('says a stale or untotallable copy is our gap too', () => {
    const reason = outsideSpendingUnavailableReason({ ...EMPTY, state: 'unavailable' });
    expect(reason).toContain('not a sign that no money was spent');
    expect(reason).not.toMatch(/\$0|\bzero\b/i);
  });

  it('offers no reason when there are real figures to show', () => {
    expect(outsideSpendingUnavailableReason(REPORTED)).toBeNull();
  });
});

describe('outsideSpendingPeriod', () => {
  it('states the span the payments actually fall in, never a whole calendar year', () => {
    // Almost every Minnesota report runs from 1 January and a special-election filer's
    // does not, so no surface may assume the year's edges.
    expect(outsideSpendingPeriod(REPORTED)).toBe('Feb 3, 2025 to Oct 28, 2025');
  });

  it('collapses a single day rather than repeating it', () => {
    expect(
      outsideSpendingPeriod({ ...REPORTED, firstPaymentOn: '2025-06-01', lastPaymentOn: '2025-06-01' }),
    ).toBe('Jun 1, 2025');
  });

  it('invents no range when no payment carries a date', () => {
    expect(outsideSpendingPeriod({ ...REPORTED, firstPaymentOn: null })).toBeNull();
    expect(outsideSpendingPeriod({ ...EMPTY, state: 'link_unconfirmed' })).toBeNull();
  });
});

describe('outsideSpendingFetchedOn', () => {
  it('shows one freshness date for the block, not one per year', () => {
    const stale = { ...EMPTY, year: 2026, state: 'link_unconfirmed' as const };
    expect(outsideSpendingFetchedOn([REPORTED, stale])).toBe('Aug 12, 2026');
  });

  it('is null when no year carries one, so no date is guessed', () => {
    expect(outsideSpendingFetchedOn([{ ...REPORTED, fetchedAt: null }])).toBeNull();
    expect(outsideSpendingFetchedOn([])).toBeNull();
  });
});
