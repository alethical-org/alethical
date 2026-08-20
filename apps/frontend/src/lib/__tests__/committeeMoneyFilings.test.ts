import { describe, expect, it } from 'vitest';

import {
  AMENDED_CHIP,
  committeeTabFromParam,
  COMMITTEE_TAB_LABELS,
  filingIsAmended,
  filingRowPeriodLine,
  filingsCountLine,
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
  // We hold no filing date for any report (issue #1670), so the drawn "by the
  // date filed" sentence does not ship — the words derive from the served order.
  it('names the period order the server actually serves', () => {
    expect(filingsOrderingLine('period_end')).toBe(
      'Newest first, by the period each report covers — never by amount',
    );
  });

  it('prints nothing for an order it does not know, never a guess', () => {
    expect(filingsOrderingLine('filed_date')).toBeNull();
    expect(filingsOrderingLine('')).toBeNull();
  });

  it('never claims a filed-date order anywhere in the fixed copy', () => {
    for (const text of [FILINGS_HEADLINE, FILINGS_PERIOD_NOTE, FILINGS_EMPTY_WHY]) {
      expect(text.toLowerCase()).not.toContain('date filed');
      expect(text.toLowerCase()).not.toContain('filed on');
    }
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
