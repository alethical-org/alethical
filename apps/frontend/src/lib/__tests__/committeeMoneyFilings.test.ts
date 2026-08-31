import { describe, expect, it } from 'vitest';

import {
  AMENDED_CHIP,
  committeeTabFromParam,
  COMMITTEE_TAB_LABELS,
  filingIsAmended,
  filingRowPeriodLine,
  filingsCountLine,
  filedDateLine,
  filingsOrderingLine,
  FILINGS_EMPTY_WHY,
  FILINGS_HEADLINE,
  FILINGS_PERIOD_NOTE,
  unlistedReportsLine,
} from '../committeeMoney';

describe('the committee page tabs', () => {
  it('adds Filings as the third tab without touching the two payment tabs', () => {
    expect(Object.keys(COMMITTEE_TAB_LABELS)).toEqual(['gave', 'spent', 'filings']);
    expect(COMMITTEE_TAB_LABELS.filings).toBe('Filings');
  });

  it('reads the filings tab off the address and falls back like the payment tabs', () => {
    expect(committeeTabFromParam('filings')).toBe('filings');
    expect(committeeTabFromParam('spent')).toBe('spent');
    expect(committeeTabFromParam('nonsense')).toBe('gave');
    expect(committeeTabFromParam(undefined)).toBe('gave');
  });
});

describe('the ordering sentence', () => {
  // A row carries the day the Board received it where the report's own document says so
  // and nothing where it does not (issue #1670), so the drawn flat "by the date filed"
  // sentence still does not ship: it would be false about every undated row, and those
  // are the majority. The words derive from the served order in both cases.
  it('names the period order the server actually serves', () => {
    expect(filingsOrderingLine('period_end')).toBe(
      'Newest first, by the period each report covers — never by amount',
    );
  });

  it('names the mixed order, saying which rows are which', () => {
    const mixed = filingsOrderingLine('filed_date_then_period_end');
    expect(mixed).toContain('the day the Board received a report');
    expect(mixed).toContain('by the period it covers where it does not');
    // No row carries an amount and nothing sorts by one, in either order.
    expect(mixed).toContain('Never by amount');
  });

  it('prints nothing for an order it does not know, never a guess', () => {
    // `filed_date` alone is deliberately unknown: the server never serves a pure
    // filing order, because most rows carry no filing date to order by.
    expect(filingsOrderingLine('filed_date')).toBeNull();
    expect(filingsOrderingLine('')).toBeNull();
  });

  it('never claims a filed-date order anywhere in the fixed copy', () => {
    // Fixed copy speaks for every row, and most rows have no filing date, so no fixed
    // sentence may imply one. A per-row date is a different thing: it is printed only
    // from that row's own served value.
    for (const text of [FILINGS_HEADLINE, FILINGS_PERIOD_NOTE, FILINGS_EMPTY_WHY]) {
      expect(text.toLowerCase()).not.toContain('date filed');
      expect(text.toLowerCase()).not.toContain('filed on');
    }
  });
});

describe('the per-row filed date', () => {
  // The substitution nobody could catch is the period end printed under a "filed"
  // label: a real date, on a real committee's real report, 4 days off on filer 11880's
  // 2026 pre-primary. So a row with no served date prints no date (issue #1670).
  it('prints nothing when the Board states no filing date', () => {
    expect(filedDateLine(null)).toBeNull();
    expect(filedDateLine(undefined)).toBeNull();
    expect(filedDateLine('')).toBeNull();
  });

  it('prints the day the Board received the report when there is one', () => {
    expect(filedDateLine('2026-07-24')).toBe('Filed 24 Jul 2026');
  });
});

describe('the period line', () => {
  it('prints both ends when the Board calendar resolves a start', () => {
    expect(filingRowPeriodLine({ periodStart: '2026-01-01', periodEnd: '2026-07-20' })).toBe(
      'Covers 1 Jan 2026 – 20 Jul 2026',
    );
  });

  // §7 forbids assuming 1 January: a special-election filer's year does not
  // open then, so an unresolved start reads "through", never a guessed range.
  it('reads "covers through" when no start resolves, never an assumed January', () => {
    expect(filingRowPeriodLine({ periodStart: null, periodEnd: '2024-10-21' })).toBe(
      'Covers through 21 Oct 2024',
    );
  });

  it('draws no period line at all when the filing has no period end', () => {
    expect(filingRowPeriodLine({ periodStart: null, periodEnd: null })).toBeNull();
  });
});

describe('the AMENDED marker', () => {
  it('marks a report whose effective version is an amendment', () => {
    expect(filingIsAmended(1)).toBe(true);
    expect(filingIsAmended(7)).toBe(true);
  });

  it('never marks the original version, and never a report with no record', () => {
    expect(filingIsAmended(0)).toBe(false);
    expect(filingIsAmended(null)).toBe(false);
  });

  // The catalogue's amendment record is version indexes only — a dated chip
  // would be a fabricated fact about a named committee.
  it('carries no date', () => {
    expect(AMENDED_CHIP).toBe('AMENDED');
  });
});

describe('the counts', () => {
  it('says how many reports are filed, and when the list is a slice', () => {
    expect(filingsCountLine(16, 16)).toBe('16 reports filed');
    expect(filingsCountLine(1, 1)).toBe('1 report filed');
    expect(filingsCountLine(100, 120)).toBe('Showing 100 of 120 reports filed');
  });

  it('prints no count when none is served', () => {
    expect(filingsCountLine(5, null)).toBeNull();
  });
});

describe('the unlisted-reports boundary', () => {
  // The catalogue lists a report from the moment its filing period opens, and
  // for pre-2008 rows it keeps no record either way — so the headline is not
  // "every report", and the boundary is said out loud.
  it('says how many catalogued reports carry no filing record', () => {
    const line = unlistedReportsLine(4);
    expect(line).toContain('4 reports');
    expect(line).toContain('without saying whether they were filed');
  });

  it('handles the single-report wording', () => {
    const line = unlistedReportsLine(1);
    expect(line).toContain('1 report');
    expect(line).toContain('whether it was filed');
  });

  it('prints nothing when there is no boundary to explain', () => {
    expect(unlistedReportsLine(0)).toBeNull();
    expect(unlistedReportsLine(null)).toBeNull();
  });

  // #1642 bans any lateness claim: the deadline signal is only readable for the
  // year happening now, so the same words would accuse people of missing
  // deadlines they never had.
  it('never calls an unfiled report late or overdue', () => {
    const line = unlistedReportsLine(3) ?? '';
    expect(line.toLowerCase()).not.toContain('late');
    expect(line.toLowerCase()).not.toContain('overdue');
    expect(line.toLowerCase()).not.toContain('missed');
  });
});
