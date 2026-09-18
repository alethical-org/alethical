/**
 * The Money by race page's rules (#1954; grounded-answers.md rule 12;
 * campaign-finance-system-design.md §7). Each test is one way this page could
 * print a confident wrong sentence: a total across committees, an order that
 * reads as a ranking, a figure without its dates, or a zero where there is no
 * figure.
 */
import { describe, expect, it } from 'vitest';

import {
  ALL_OFFICES_LABEL,
  MIXED_PERIODS_NOTE,
  MONEY_BY_RACE_DEK,
  MONEY_BY_RACE_NOTE,
  NAMED_FIGURE_LABEL,
  REPORTED_FIGURE_LABEL,
  committeeFigures,
  contestCountLabel,
  contestHeadingParts,
  contestSeatLabel,
  figuresYearLine,
  matchingRaceContests,
  noContestsTitle,
  officeFilterFromParam,
  racesCountLine,
  racesOrderingLine,
  registerDateLine,
  shownCommitteeCount,
} from '../moneyByRace';
import type { RaceCommittee, RaceContest } from '../../data/types';

const OFFICES = [
  { office: 'House', committeeCount: 478 },
  { office: 'Senate', committeeCount: 232 },
  { office: 'Governor', committeeCount: 28 },
];

function committee(overrides: Partial<RaceCommittee> = {}): RaceCommittee {
  return {
    registrationNumber: '31544',
    name: 'Committee to Elect R. Lindqvist',
    isClosed: false,
    terminationDate: null,
    reportedTotal: '61200.0000',
    reportedThrough: '2026-07-20',
    reportedPeriodStart: '2026-01-01',
    named: {
      state: 'reported',
      total: '750.0000',
      payments: 2,
      firstPaymentOn: '2026-02-03',
      lastPaymentOn: '2026-06-15',
    },
    ...overrides,
  };
}

function contest(overrides: Partial<RaceContest> = {}): RaceContest {
  return {
    office: 'House',
    district: '12A',
    anchor: 'house-12a',
    committeeCount: 1,
    periodsDiffer: false,
    committees: [committee()],
    ...overrides,
  };
}

describe('a contest heading carries a count and never a sum', () => {
  it('names the seat as a person says it, then the count of committees', () => {
    expect(contestHeadingParts({ office: 'House', district: '12A', committeeCount: 3 })).toEqual([
      'House District 12A',
      '3 candidate committees',
    ]);
    expect(contestHeadingParts({ office: 'Senate', district: '41', committeeCount: 1 })).toEqual([
      'Senate District 41',
      '1 candidate committee',
    ]);
  });

  it('distinguishes statewide offices, court districts, and court seats', () => {
    expect(contestSeatLabel({ office: 'Governor', district: null })).toBe('Governor · Statewide');
    expect(contestSeatLabel({ office: 'District Court', district: '2-14' })).toBe(
      'District Court · District 2 · Seat 14',
    );
    expect(contestSeatLabel({ office: 'Supreme Court', district: 'Chief' })).toBe(
      'Supreme Court · Chief justice',
    );
    expect(contestSeatLabel({ office: 'Supreme Court', district: 'chief' })).toBe(
      'Supreme Court · Chief justice',
    );
    expect(contestSeatLabel({ office: 'Supreme Court', district: '3' })).toBe(
      'Supreme Court · Seat 3',
    );
    expect(contestSeatLabel({ office: 'Appellate Court', district: '7' })).toBe(
      'Appellate Court · Seat 7',
    );
  });

  it('preserves an unfamiliar filed seat instead of inventing a district', () => {
    expect(contestSeatLabel({ office: 'District Court', district: 'Unassigned' })).toBe(
      'District Court · Unassigned',
    );
    expect(contestSeatLabel({ office: 'Appellate Court', district: 'Chief' })).toBe(
      'Appellate Court · Chief',
    );
    expect(contestSeatLabel({ office: 'Other office', district: 'Central' })).toBe(
      'Other office · Central',
    );
  });

  it('never prints a dollar sign in a heading or a count', () => {
    for (const count of [1, 2, 28, 1_000]) {
      expect(contestCountLabel(count)).not.toMatch(/\$/);
    }
    expect(racesCountLine(222, 778, '2026-08-12')).toBe('778 candidate committees');
    expect(racesCountLine(222, 778)).toBe('778 candidate committees');
    expect(racesCountLine(1, 1)).toBe('1 candidate committee');
    expect(racesCountLine(0, 0)).toBe('0 candidate committees');
    // No served count: no sentence, rather than one counted off the rows on screen.
    expect(racesCountLine(null, 778, '2026-08-12')).toBeNull();
    expect(racesCountLine(222, null, '2026-08-12')).toBeNull();
  });

  it('keeps the register date separate from the displayed counts', () => {
    expect(registerDateLine('2026-08-12')).toBe('Committee list copied Aug 12, 2026');
    expect(registerDateLine(null)).toBeNull();
    expect(registerDateLine('invalid')).toBeNull();
  });

  it('counts the served groups without adding their money or using the global count', () => {
    const filtered = [contest({ committeeCount: 3 }), contest({ committeeCount: 2 })];
    expect(shownCommitteeCount(filtered)).toBe(5);
    expect(shownCommitteeCount([])).toBe(0);
    expect(racesCountLine(filtered.length, shownCommitteeCount(filtered))).toBe(
      '5 candidate committees',
    );
  });

  it('says under the list why committee amounts are not added together', () => {
    expect(MONEY_BY_RACE_NOTE).toBe(
      'We do not add committees’ money together. Transfers between committees could otherwise be counted twice.',
    );
  });
});

describe('the page prints its order, and it is never by amount', () => {
  it('names the served order and nothing else', () => {
    expect(racesOrderingLine('district_then_name')).toBe('By office, then district or court seat');
    // An order this page does not know prints no sentence rather than a guess.
    expect(racesOrderingLine('district_then_name', 'House')).toBe('By district or court seat');
    expect(racesOrderingLine('amount')).toBeNull();
    expect(racesOrderingLine('')).toBeNull();
  });

  it('says so in the dek, in the words Design drew', () => {
    expect(MONEY_BY_RACE_DEK).toBe(
      'Find candidate committees and their reported donations by office, district or court seat. ' +
        'Candidate committees raise and spend money for a candidate’s campaign.',
    );
  });
});

describe('every figure carries its own dates', () => {
  it('gives the reported total its filing’s period and the named figure its payment dates', () => {
    const [reported, named] = committeeFigures(committee(), 2026);
    expect(reported).toEqual({
      label: REPORTED_FIGURE_LABEL,
      text: '$61,200',
      isFigure: true,
      period: 'Figures for Jan 1, 2026 to Jul 20, 2026',
      explanation: null,
    });
    expect(named).toEqual({
      label: NAMED_FIGURE_LABEL,
      text: '$750',
      isFigure: true,
      period: 'Payments dated Feb 3, 2026 to Jun 15, 2026',
      explanation: null,
    });
  });

  it('uses the committee page’s own 2 labels, word for word', () => {
    expect(REPORTED_FIGURE_LABEL).toBe('Total contributions');
    expect(NAMED_FIGURE_LABEL).toBe('Itemized contributions');
  });

  it('never assumes a period start the Board’s calendars do not print', () => {
    const [reported] = committeeFigures(committee({ reportedPeriodStart: null }), 2026);
    expect(reported.period).toBe('Figures through Jul 20, 2026');
  });

  it('does not borrow payment dates when the official period is missing', () => {
    const [reported, named] = committeeFigures(
      committee({ reportedThrough: null, reportedPeriodStart: null }),
      2026,
    );
    expect(reported.period).toBeNull();
    expect(named.period).toBe('Payments dated Feb 3, 2026 to Jun 15, 2026');
  });

  it('keeps a larger named figure and its later dates without treating it as part of the total', () => {
    const [reported, named] = committeeFigures(
      committee({
        reportedTotal: '225766',
        reportedThrough: '2026-03-31',
        named: {
          ...committee().named,
          total: '414891',
          firstPaymentOn: '2026-01-11',
          lastPaymentOn: '2026-07-20',
        },
      }),
      2026,
    );
    expect(reported.text).toBe('$225,766');
    expect(reported.period).toBe('Figures for Jan 1, 2026 to Mar 31, 2026');
    expect(named.text).toBe('$414,891');
    expect(named.period).toBe('Payments dated Jan 11, 2026 to Jul 20, 2026');
  });

  it('cuts cents rather than rounding them, on both figures', () => {
    const [reported, named] = committeeFigures(
      committee({
        reportedTotal: '61200.9900',
        named: { ...committee().named, total: '999.99' },
      }),
      2026,
    );
    expect(reported.text).toBe('$61,200');
    expect(named.text).toBe('$999');
  });

  it('says above a mixed-period contest that the periods differ, without guessing why', () => {
    expect(MIXED_PERIODS_NOTE).toMatch(/cover different periods/);
    expect(MIXED_PERIODS_NOTE).not.toMatch(/special/i);
    expect(MIXED_PERIODS_NOTE).toBe(
      'The reported totals in this group cover different periods. Each total shows its own dates.',
    );
  });
});

describe('a missing figure states our gap and never becomes $0', () => {
  it('prints the words with no period when no filing speaks for the year', () => {
    const [reported] = committeeFigures(
      committee({ reportedTotal: null, reportedThrough: null, reportedPeriodStart: null }),
      2026,
    );
    expect(reported).toEqual({
      label: REPORTED_FIGURE_LABEL,
      text: 'No usable official total in our records for 2026',
      isFigure: false,
      period: null,
      explanation: null,
    });
  });

  it('keeps a verified zero as $0, because a filed zero is a fact', () => {
    const [reported, named] = committeeFigures(
      committee({ reportedTotal: '0.0000', named: { ...committee().named, total: '0.00' } }),
      2026,
    );
    expect(reported.text).toBe('$0');
    expect(reported.isFigure).toBe(true);
    expect(named.text).toBe('$0');
    expect(named.isFigure).toBe(true);
    expect(named.explanation).toBeNull();
  });

  it('tells silence from a gap on the named figure, and dates neither', () => {
    const silent = committeeFigures(
      committee({
        named: {
          state: 'not_reported',
          total: null,
          payments: null,
          firstPaymentOn: null,
          lastPaymentOn: null,
        },
      }),
      2026,
    )[1];
    expect(silent).toEqual({
      label: NAMED_FIGURE_LABEL,
      text: 'No itemized contributions in our records for 2026',
      isFigure: false,
      period: null,
      explanation: null,
    });
    const gap = committeeFigures(
      committee({
        named: {
          state: 'unavailable',
          total: null,
          payments: null,
          firstPaymentOn: null,
          lastPaymentOn: null,
        },
      }),
      2026,
    )[1];
    expect(gap.isFigure).toBe(false);
    expect(gap.text).toBe('We couldn’t load this figure');
    expect(gap.period).toBeNull();
    expect(gap.explanation).toBeNull();
  });

  it('does not claim no named contributions when a reported response has no usable amount', () => {
    const named = committeeFigures(
      committee({ named: { ...committee().named, total: null } }),
      2026,
    )[1];
    expect(named.text).toBe('We couldn’t load this figure');
    expect(named.isFigure).toBe(false);
    expect(named.period).toBeNull();
    expect(named.explanation).toBeNull();
  });

  it('withholds leftover amounts and dates when the response marks a figure unavailable', () => {
    const [reported, named] = committeeFigures(
      committee({
        reportedTotal: null,
        named: { ...committee().named, state: 'unavailable' },
      }),
      2026,
    );
    expect(reported.isFigure).toBe(false);
    expect(reported.period).toBeNull();
    expect(named.text).toBe('We couldn’t load this figure');
    expect(named.isFigure).toBe(false);
    expect(named.period).toBeNull();
  });
});

describe('the finder navigates among complete district and seat groups', () => {
  const house = contest();
  const senate = contest({ office: 'Senate', district: '12', anchor: 'senate-12' });
  const court = contest({
    office: 'District Court',
    district: '4-12',
    anchor: 'district-court-4-12',
  });
  const chief = contest({
    office: 'Supreme Court',
    district: 'Chief',
    anchor: 'supreme-court-chief',
  });
  const governor = contest({ office: 'Governor', district: null, anchor: 'governor' });
  const groups = [house, senate, court, chief, governor];

  it('matches words in any order without regard to letter case or surrounding spaces', () => {
    expect(matchingRaceContests(groups, '  12A   hOuSe  ')).toEqual([house]);
    expect(matchingRaceContests(groups, 'seat 12 court 4')).toEqual([court]);
    expect(matchingRaceContests(groups, '4-12')).toEqual([court]);
    expect(matchingRaceContests(groups, 'justice chief')).toEqual([chief]);
  });

  it('requires every word and searches groups rather than committee names', () => {
    expect(matchingRaceContests(groups, 'House 41')).toEqual([]);
    expect(matchingRaceContests(groups, 'Lindqvist')).toEqual([]);
    expect(matchingRaceContests(groups, '31544')).toEqual([]);
    expect(matchingRaceContests(groups, 'Governor')).toEqual([governor]);
    expect(matchingRaceContests(groups, 'null')).toEqual([]);
    expect(matchingRaceContests(groups, '   ')).toEqual([]);
  });

  it('preserves served order and complete groups without changing the source array', () => {
    const served = [court, house, senate];
    const matches = matchingRaceContests(served, '12');
    expect(matches).toEqual(served);
    expect(matches[0]).toBe(court);
    expect(matches[1].committees).toBe(house.committees);
    expect(served).toEqual([court, house, senate]);
    expect(matchingRaceContests([senate], 'House')).toEqual([]);
  });

  it('does not silently limit how many matching groups can be reached', () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      contest({ district: String(index + 1), anchor: `house-${index + 1}` }),
    );
    expect(matchingRaceContests(many, 'House')).toEqual(many);
  });
});

describe('the office filter offers only what the register holds', () => {
  it('narrows to a served office and clears on anything else', () => {
    expect(officeFilterFromParam('Senate', OFFICES)).toBe('Senate');
    expect(officeFilterFromParam('Mayor', OFFICES)).toBeNull();
    expect(officeFilterFromParam('senate', OFFICES)).toBeNull();
    expect(officeFilterFromParam(undefined, OFFICES)).toBeNull();
    expect(officeFilterFromParam('House', [])).toBeNull();
  });

  it('labels the clearing chip and the empty state plainly', () => {
    expect(ALL_OFFICES_LABEL).toBe('All offices');
    expect(noContestsTitle('Senate')).toBe(
      'No Senate candidate committees in our copy of the committee list',
    );
    expect(noContestsTitle(null)).toBe('No candidate committees in our copy of the committee list');
  });

  it('names the year the figures are for', () => {
    expect(figuresYearLine(2026)).toBe('Campaign contributions for 2026');
  });
});
