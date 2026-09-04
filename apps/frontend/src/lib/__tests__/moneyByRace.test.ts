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
  noContestsTitle,
  officeFilterFromParam,
  racesCountLine,
  racesOrderingLine,
} from '../moneyByRace';
import type { RaceCommittee } from '../../data/types';

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

  it('calls a statewide office statewide, and keeps a court’s district', () => {
    expect(contestSeatLabel({ office: 'Governor', district: null })).toBe('Governor · Statewide');
    expect(contestSeatLabel({ office: 'District Court', district: '2-14' })).toBe(
      'District Court · District 2-14',
    );
    expect(contestSeatLabel({ office: 'Supreme Court', district: 'Chief' })).toBe(
      'Supreme Court · District Chief',
    );
  });

  it('never prints a dollar sign in a heading or a count', () => {
    for (const count of [1, 2, 28, 1_000]) {
      expect(contestCountLabel(count)).not.toMatch(/\$/);
    }
    expect(racesCountLine(222, 778, '2026-08-12')).toBe(
      '222 CONTESTS · 778 CANDIDATE COMMITTEES · COUNTED FROM THE REGISTER AUG 12, 2026',
    );
    expect(racesCountLine(222, 778, null)).toBe('222 CONTESTS · 778 CANDIDATE COMMITTEES');
    // No served count: no sentence, rather than one counted off the rows on screen.
    expect(racesCountLine(null, 778, '2026-08-12')).toBeNull();
    expect(racesCountLine(222, null, '2026-08-12')).toBeNull();
  });

  it('says under the list why there is no total and no ranking', () => {
    expect(MONEY_BY_RACE_NOTE).toMatch(/never a total/);
    expect(MONEY_BY_RACE_NOTE).toMatch(/count it twice/);
    expect(MONEY_BY_RACE_NOTE).toMatch(/no position reads as a ranking/);
  });
});

describe('the page prints its order, and it is never by amount', () => {
  it('names the served order and nothing else', () => {
    expect(racesOrderingLine('district_then_name')).toBe('DISTRICT, THEN NAME A–Z');
    // An order this page does not know prints no sentence rather than a guess.
    expect(racesOrderingLine('amount')).toBeNull();
    expect(racesOrderingLine('')).toBeNull();
  });

  it('says so in the dek, in the words Design drew', () => {
    expect(MONEY_BY_RACE_DEK).toBe(
      'Every candidate committee, grouped by the office and district it is registered for. ' +
        'Ordered by district, then by name — never by amount.',
    );
  });
});

describe('every figure carries its own dates', () => {
  it('gives the reported total its filing’s period and the named figure its payment dates', () => {
    const [reported, named] = committeeFigures(committee());
    expect(reported).toEqual({
      label: REPORTED_FIGURE_LABEL,
      text: '$61,200',
      isFigure: true,
      period: 'Figures for Jan 1, 2026 – Jul 20, 2026',
    });
    expect(named).toEqual({
      label: NAMED_FIGURE_LABEL,
      text: '$750',
      isFigure: true,
      period: 'Payments dated Feb 3, 2026 to Jun 15, 2026',
    });
  });

  it('uses the committee page’s own 2 labels, word for word', () => {
    expect(REPORTED_FIGURE_LABEL).toBe('Donations this committee reported to the state');
    expect(NAMED_FIGURE_LABEL).toBe('Donations with a donor’s name');
  });

  it('never assumes a period start the Board’s calendars do not print', () => {
    const [reported] = committeeFigures(committee({ reportedPeriodStart: null }));
    expect(reported.period).toBe('Figures through Jul 20, 2026');
  });

  it('cuts cents rather than rounding them, on both figures', () => {
    const [reported, named] = committeeFigures(
      committee({
        reportedTotal: '61200.9900',
        named: { ...committee().named, total: '999.99' },
      }),
    );
    expect(reported.text).toBe('$61,200');
    expect(named.text).toBe('$999');
  });

  it('says above a mixed-period contest that the periods differ, without guessing why', () => {
    expect(MIXED_PERIODS_NOTE).toMatch(/cover different periods/);
    expect(MIXED_PERIODS_NOTE).not.toMatch(/special/i);
    // A standalone line: no dot at the end (copy rule C).
    expect(MIXED_PERIODS_NOTE.endsWith('.')).toBe(false);
  });
});

describe('a missing figure reads "Not reported" and never $0', () => {
  it('prints the words with no period when no filing speaks for the year', () => {
    const [reported] = committeeFigures(
      committee({ reportedTotal: null, reportedThrough: null, reportedPeriodStart: null }),
    );
    expect(reported).toEqual({
      label: REPORTED_FIGURE_LABEL,
      text: 'Not reported',
      isFigure: false,
      period: null,
    });
  });

  it('keeps a verified zero as $0, because a filed zero is a fact', () => {
    const [reported] = committeeFigures(committee({ reportedTotal: '0.0000' }));
    expect(reported.text).toBe('$0');
    expect(reported.isFigure).toBe(true);
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
    )[1];
    expect(silent).toEqual({
      label: NAMED_FIGURE_LABEL,
      text: 'Not reported',
      isFigure: false,
      period: null,
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
    )[1];
    expect(gap.isFigure).toBe(false);
    expect(gap.text).toBe("We couldn't load this");
    expect(gap.period).toBeNull();
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
      'No Senate candidate committees in our copy of the register',
    );
    expect(noContestsTitle(null)).toBe('No candidate committees in our copy of the register');
  });

  it('names the year the figures are for', () => {
    expect(figuresYearLine(2026)).toBe('Money figures are for 2026');
  });
});
