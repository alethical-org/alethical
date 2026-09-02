import { describe, expect, it } from 'vitest';

import { formatMoney } from '../legislatorCampaignMoney';
import {
  isMeasuredZero,
  outsideSpendingFetchedOn,
  outsideSpendingCoverage,
  outsideSpendingFigures,
  outsideSpendingLoadFailure,
  outsideSpendingPaymentCount,
  outsideSpendingPeriod,
  outsideSpendingSharedReason,
  outsideSpendingUnavailableReason,
  outsideSpendingYears,
  yearsShareOneDownload,
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
  snapshotId: 'snap-1',
  committees: [
    { registrationNumber: '18488', name: 'Fateh, Omar Senate Committee', office: 'State Senator' },
  ],
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

// Outside spending has no formatter of its own since #1929: the card calls the shared
// `formatMoney`, so one product rule has one implementation and cannot drift again.
// These are the values the deleted `formatSpendingAmount` was pinned on, kept here and
// re-pinned on the shared formatter so the switch is a checked change rather than an
// assumed one.
describe('outside spending money goes through the one shared formatter', () => {
  it('states whole dollars, cut rather than rounded', () => {
    expect(formatMoney(487974.82)).toBe('$487,974');
    expect(formatMoney(1092625.5)).toBe('$1,092,625');
    expect(formatMoney(2650)).toBe('$2,650');
    expect(formatMoney(0)).toBe('$0');
  });

  // The #1332 defect: the source columns hold 4 decimal places, so a filing really can
  // carry 1.9999, and the old formatter split a value into dollars and cents to round
  // the halves separately, which lost the carry between them and printed the malformed
  // "$1.100". Truncation cannot reach that shape — one floor over the whole magnitude
  // never carries anything upward — and these are the same values that found it.
  it('carries nothing into the dollars, at either end of the range', () => {
    expect(formatMoney(1.9999)).toBe('$1');
    expect(formatMoney(2.995)).toBe('$2');
    expect(formatMoney(1234.9999)).toBe('$1,234');
    expect(formatMoney(999.9999)).toBe('$999');
    for (const value of [1.9999, 2.995, 1234.9999, 999.9999, 0.999]) {
      // The malformed shape itself: a dollar figure with 3 digits after the point.
      expect(formatMoney(value)).not.toMatch(/\.\d{3}/);
    }
  });

  it('keeps a sub-dollar payment under a dollar rather than rounding it up', () => {
    // 0.999 printed "$1.00" before #1929 — higher than the money, and a dollar figure
    // inside the branch reserved for values under a dollar. It is the same carry
    // defect as #1332 at the other end of the range.
    expect(formatMoney(0.999)).toBe('$0.99');
    expect(formatMoney(0.9999)).toBe('$0.99');
    expect(formatMoney(0.5)).toBe('$0.50');
    // Binary floating point makes 0.29 * 100 come out as 28.999999999999996, so a bare
    // floor would print $0.28 for a 29-cent payment.
    expect(formatMoney(0.29)).toBe('$0.29');
    expect(formatMoney(0.07)).toBe('$0.07');
    expect(formatMoney(0.01)).toBe('$0.01');
  });

  it('reads no higher in magnitude on a negative amount either', () => {
    // 0 of the live release's 41,130 outside-spending rows are negative, but a
    // correction could be, and the rule holds in both directions.
    expect(formatMoney(-1.9999)).toBe('-$1');
    expect(formatMoney(-0.999)).toBe('-$0.99');
    expect(formatMoney(-487974.82)).toBe('-$487,974');
  });
});

describe('outsideSpendingLoadFailure', () => {
  it('lets one year fail without taking the other year down with it', () => {
    // With one combined promise, either year failing threw away the other year's real
    // figures and replaced them with a whole-card error: a year we could answer,
    // silently turned into a year we could not. Found by an automated review on #1332.
    const failed = outsideSpendingLoadFailure(2026);
    expect(failed.year).toBe(2026);
    expect(failed.state).toBe('load_failed');
    expect(outsideSpendingFigures(failed)).toEqual([]);
    expect(outsideSpendingPaymentCount(failed)).toBeNull();
    expect(isMeasuredZero(failed)).toBe(false);
    // And it does not merge with a genuinely different answer, so the good year keeps
    // its own line rather than being covered by one shared sentence.
    expect(
      outsideSpendingSharedReason([failed, { ...EMPTY, year: 2025, state: 'link_unconfirmed' }]),
    ).toBeNull();
  });

  it('says the request failed, not that our copy of the filings is stale', () => {
    // Two different facts. Telling a reader the state filings are out of date because
    // our network dropped is a claim we cannot support.
    const reason = outsideSpendingUnavailableReason(outsideSpendingLoadFailure(2026));
    expect(reason).toContain('problem at our end');
    expect(reason).not.toMatch(/out of date|cannot add up|committee/i);
    expect(reason).not.toMatch(/\$0|\bzero\b/i);
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

  it('shows the third figure when it holds payments, even if they total nothing', () => {
    // Gated on the payment count, not the money. Two unreadable rows that cancel out, or
    // a negative correction, would otherwise keep the payments in the page while the
    // figure vanished -- the same disappearance #1454 exists to stop.
    const figures = outsideSpendingFigures({
      ...REPORTED,
      directionNotRecorded: 0,
      directionNotRecordedPayments: 2,
    });
    expect(figures).toHaveLength(3);
    expect(figures[2].amount).toBe(0);
    expect(figures[2].payments).toBe(2);
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
      outsideSpendingPeriod({
        ...REPORTED,
        firstPaymentOn: '2025-06-01',
        lastPaymentOn: '2025-06-01',
      }),
    ).toBe('Jun 1, 2025');
  });

  it('invents no range when no payment carries a date', () => {
    expect(outsideSpendingPeriod({ ...REPORTED, firstPaymentOn: null })).toBeNull();
    expect(outsideSpendingPeriod({ ...EMPTY, state: 'link_unconfirmed' })).toBeNull();
  });
});

describe('outsideSpendingSharedReason', () => {
  const unconfirmed = { ...EMPTY, state: 'link_unconfirmed' as const };

  it('says it once when every year gives the same answer', () => {
    // The launch-day case for all 206 members. Two year headings over one repeated
    // paragraph would imply the years were the question; the reason is about the
    // person and holds for every year.
    const shared = outsideSpendingSharedReason([
      { ...unconfirmed, year: 2026 },
      { ...unconfirmed, year: 2025 },
    ]);
    expect(shared).toBe(outsideSpendingUnavailableReason(unconfirmed));
  });

  it('stays silent when the years disagree, so a different year keeps its own line', () => {
    expect(
      outsideSpendingSharedReason([
        { ...unconfirmed, year: 2026 },
        { ...EMPTY, year: 2025, state: 'unavailable' },
      ]),
    ).toBeNull();
  });

  it('stays silent when any year has real figures to show', () => {
    expect(outsideSpendingSharedReason([{ ...unconfirmed, year: 2026 }, REPORTED])).toBeNull();
    expect(outsideSpendingSharedReason([])).toBeNull();
  });
});

describe('outsideSpendingCoverage', () => {
  it('names the one confirmed committee, and says an unchecked one is not counted', () => {
    // A member can hold several committees while only 1 has been reviewed, so a bare
    // total can be a fraction of their money presented as all of it.
    const coverage = outsideSpendingCoverage(REPORTED);
    expect(coverage).toContain('Fateh, Omar Senate Committee (State Senator)');
    expect(coverage).toContain('nobody has checked yet is not in these figures');
  });

  it('names every committee when a total adds more than one together', () => {
    // The service says a race for another office must never be summed into a
    // legislative figure, and it sums every confirmed committee whose dates cover the
    // year. So when 2 are added, the page has to say which 2.
    const coverage = outsideSpendingCoverage({
      ...REPORTED,
      committees: [
        { registrationNumber: '18488', name: 'Senate Committee', office: 'State Senator' },
        { registrationNumber: '19205', name: 'House Committee', office: 'State Representative' },
      ],
    });
    expect(coverage).toContain('2 committees');
    expect(coverage).toContain('Senate Committee (State Senator)');
    expect(coverage).toContain('House Committee (State Representative)');
    expect(coverage).toContain('added together');
  });

  it('says nothing when there is no figure for it to scope', () => {
    expect(outsideSpendingCoverage({ ...EMPTY, state: 'link_unconfirmed' })).toBeNull();
    expect(outsideSpendingCoverage({ ...REPORTED, committees: [] })).toBeNull();
  });
});

describe('yearsShareOneDownload', () => {
  it('is false when 2 years came from 2 different downloads', () => {
    // Each year is its own request and each resolves the live download on its own, so a
    // publish landing between them pairs one year's money with another year's date.
    expect(
      yearsShareOneDownload([REPORTED, { ...REPORTED, year: 2026, snapshotId: 'snap-2' }]),
    ).toBe(false);
  });

  it('is true when they agree, or when only one carries an identity', () => {
    expect(yearsShareOneDownload([REPORTED, { ...REPORTED, year: 2026 }])).toBe(true);
    expect(yearsShareOneDownload([REPORTED, outsideSpendingLoadFailure(2026)])).toBe(true);
  });

  it('withholds the freshness date rather than printing one true of only one figure', () => {
    const mixed = [REPORTED, { ...REPORTED, year: 2026, snapshotId: 'snap-2' }];
    expect(outsideSpendingFetchedOn(mixed)).toBeNull();
    expect(outsideSpendingFetchedOn([REPORTED])).toBe('Aug 12, 2026');
  });
});

describe('outsideSpendingYears', () => {
  it('follows the calendar instead of naming a year that goes stale', () => {
    // A hardcoded 2025 and 2026 would still be on the page in 2028 and nothing would
    // have complained.
    expect(outsideSpendingYears(new Date('2026-08-13T00:00:00Z'))).toEqual([2026, 2025]);
    expect(outsideSpendingYears(new Date('2028-03-01T00:00:00Z'))).toEqual([2028, 2027]);
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
