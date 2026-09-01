import { describe, expect, it } from 'vitest';

import {
  filedDateSentence,
  filingsTieSentence,
  centralDateLabel,
  confirmationDateLine,
  confirmationLine,
  filingPeriodLine,
  formatCount,
  laneCountLine,
  LOBBYING_NOT_LOADED,
  legislatorsLaneSentence,
  orderingSentence,
  RECORD_DOES_NOT_COVER,
} from '../moneyLanding';

describe('the does-not-cover block', () => {
  // Rule 12's exact sentence, and it carries 2 corrections a reader can be misled
  // by. The $200 test is on the donor's YEARLY TOTAL, never on the size of one gift
  // (327,759 of the 583,152 published rows are individually under $200 and are named
  // anyway). And it is a FLOOR on who a committee must name, never a ban on naming
  // anyone smaller, so the sentence says "need not be named" (#1755).
  it('states the donor threshold on the yearly total, never per gift', () => {
    expect(RECORD_DOES_NOT_COVER).toContain(
      'Donors who gave $200 or less in total for the year need not be named.',
    );
  });

  it('never says a small donor is not named, because a committee may name one', () => {
    // Filer 18135's 2026 pre-general itemizes 215 donors at or under $200 and
    // reconciles to the cent (campaign-finance-system-design.md §2.3), so the
    // absolute is false about a real filing.
    for (const line of RECORD_DOES_NOT_COVER) {
      expect(line).not.toContain('are never named');
    }
  });

  it('names the two permanent source gaps', () => {
    expect(RECORD_DOES_NOT_COVER[0]).toBe('Nothing before 2015.');
    expect(RECORD_DOES_NOT_COVER[1]).toBe('Unions don’t report to this board at all.');
  });

  // Lobbying is OURS to close, not a hole in what Minnesota publishes — the Board
  // publishes registrations, the lobbyist-to-client relationships and principal
  // expenditures. Folding it in with the permanent gaps would make a false claim
  // about Minnesota while trying to be honest about us.
  it('keeps lobbying out of the permanent gaps, because ours is a different kind of absence', () => {
    expect(RECORD_DOES_NOT_COVER).toHaveLength(3);
    expect(RECORD_DOES_NOT_COVER.join(' ').toLowerCase()).not.toContain('lobby');
  });

  // The spending half was loaded on 31 Aug 2026 (#1862) and our own research now
  // recomputes its $886m figure from our copy, so "we have not loaded it" became
  // false about the very records a reader is standing next to. What is still true
  // is narrower and this line has to keep both halves apart: we hold the spending,
  // we do not hold the registrations, and neither has a page in this section yet.
  it('separates the lobbying we hold from the lobbying we do not', () => {
    expect(LOBBYING_NOT_LOADED).toContain('no page here yet');
    expect(LOBBYING_NOT_LOADED).toContain('We hold what Minnesota publishes');
    expect(LOBBYING_NOT_LOADED).toContain('we have not loaded');
    expect(LOBBYING_NOT_LOADED.toLowerCase()).not.toContain('does not cover');
    // Never again claims we hold none of it, which is what went stale.
    expect(LOBBYING_NOT_LOADED).not.toContain('Lobbying is not here yet');
  });
});

describe('lane counts', () => {
  it('formats a served count with grouping', () => {
    expect(formatCount(1603)).toBe('1,603');
    expect(laneCountLine(1603, 'registered filers')).toBe('1,603 REGISTERED FILERS');
  });

  // A lane without its live query shows no number — never zero, never a
  // remembered one (a pasted count is how a page once said 1,336 while the
  // register held 1,603).
  it('shows nothing when the count is not served', () => {
    expect(laneCountLine(null, 'registered filers')).toBeNull();
  });
});

describe('filing rows', () => {
  it('prints both period ends when the filing resolves both', () => {
    expect(filingPeriodLine({ periodStart: '2026-01-01', periodEnd: '2026-07-20' })).toBe(
      'covers Jan 1, 2026 – Jul 20, 2026',
    );
  });

  // An unresolved start is never an assumed 1 January (build facts: a
  // special-election filer's period does not open on New Year's Day).
  it('prints an end-only period when the start does not resolve', () => {
    expect(filingPeriodLine({ periodStart: null, periodEnd: '2026-07-20' })).toBe(
      'covers through Jul 20, 2026',
    );
  });

  it('prints no period line when neither end resolves', () => {
    expect(filingPeriodLine({ periodStart: null, periodEnd: null })).toBeNull();
    expect(filingPeriodLine({ periodStart: '2026-01-01', periodEnd: null })).toBeNull();
  });

  // We hold no filing date for any report (the Board's catalogue serves none —
  // issue #1670), so the printed ordering sentence derives from the feed's own
  // ordered_by through one mapping, and an unknown value prints no sentence
  // rather than a guess.
  it('derives the ordering sentence from ordered_by, and stays silent on an unknown value', () => {
    expect(orderingSentence('period_end')).toBe('Newest first, by the period each report covers');
    expect(orderingSentence('filed_at')).toBeNull();
    expect(orderingSentence('')).toBeNull();
  });
});

describe('served instants print in Central time', () => {
  // 02:54 UTC on Aug 12 is 21:54 on Aug 11 in Minnesota — the honest day for a
  // Minnesotan reader is Aug 11 (ruled 19 Aug 2026).
  it('prints the Minnesota day, not the UTC day', () => {
    expect(centralDateLabel('2026-08-12T02:54:22.402100Z')).toBe('Aug 11, 2026');
    expect(centralDateLabel('2026-08-12T21:34:26.606333Z')).toBe('Aug 12, 2026');
  });

  it('passes through a value it cannot parse rather than inventing a date', () => {
    expect(centralDateLabel('unknown')).toBe('unknown');
  });
});

describe('confirmation progress', () => {
  it('states the confirmed share as counts, with no percentage and no bar', () => {
    expect(confirmationLine({ confirmed: 0, total: 200 })).toBe(
      'All 200 sitting members have a committee registered with the Board. Confirmed as theirs: ' +
        '0 of 200. Confirming is a person’s job.',
    );
  });

  it('dates the line by the newest confirmation, and stays undated while there is none', () => {
    expect(confirmationDateLine(null)).toBeNull();
    expect(confirmationDateLine('2026-08-19T15:00:00Z')).toBe(
      'Read live from the confirmation log · newest confirmation Aug 19, 2026',
    );
  });

  it('writes the Legislators lane sentence from both served numbers', () => {
    expect(legislatorsLaneSentence({ confirmed: 0, total: 200 })).toBe(
      "Confirmed for 0 of Minnesota's 200 sitting legislators — for the rest, no figures show " +
        'on a profile.',
    );
  });
});

describe('the filings tie sentence counts reports, never committees', () => {
  // The served figure is newest_period.filing_count, and a committee that
  // corrects a filing files a second report for the same period: 367 of 1,005
  // catalogued reports carry at least one amendment (#1661). So filings exceed
  // committees by however many corrected, and printing the number beside the
  // word "committees" would overstate how many filers the period covers. The
  // count also arrives with its period in one served block, so no count can sit
  // beside a period it does not describe (grounded-answers rule 12).
  it('says reports, not committees, when a count is served', () => {
    const sentence = filingsTieSentence(1203);
    expect(sentence).toContain('1,203 reports');
    expect(sentence).not.toMatch(/committees? filed/i);
    expect(sentence).not.toContain('1,203 committees');
  });

  it('keeps the anti-ranking clause whether or not a count is served', () => {
    for (const value of [1203, null]) {
      expect(filingsTieSentence(value)).toContain('not the newest and not the largest');
    }
  });

  it('falls back to the no-count wording rather than printing zero', () => {
    expect(filingsTieSentence(null)).not.toMatch(/\d/);
  });

  it('renders a served zero as a number, since a verified zero is a fact', () => {
    expect(filingsTieSentence(0)).toContain('0 reports');
  });
});

describe('the filed date, which is the one fact a page may not substitute for', () => {
  // The Board states the day it received a report inside the report's own document, and
  // serves no readable document for most reports before 2023 (issue #1670). So a null is
  // the ordinary answer, and the substitution nobody would catch is the period end
  // printed under a "filed" label -- a real date, on a real committee's real report.
  it('prints nothing at all when the Board states no filing date', () => {
    expect(filedDateSentence(null)).toBeNull();
    expect(filedDateSentence(undefined)).toBeNull();
    expect(filedDateSentence('')).toBeNull();
  });

  it('prints the day the Board received the report when there is one', () => {
    expect(filedDateSentence('2026-07-24')).toBe('filed Jul 24, 2026');
  });

  it('says the order is a mix, because a flat "by the date filed" would be false', () => {
    // Every undated row would be described wrongly by a flat filing-order sentence, and
    // undated rows are the majority.
    const mixed = orderingSentence('filed_date_then_period_end');
    expect(mixed).toContain('the day the Board received a report');
    expect(mixed).toContain('by the period it covers where it does not');
  });

  it('drops the alphabetical claim once rows are ordered by arrival', () => {
    // The alphabetical wording is true only while nothing is dated: 1,203 filers share
    // one period end, so with no other key the first rows really are the first by name.
    // Once dated rows lead, "the first by name, not the newest" is false about exactly
    // the rows a reader is looking at.
    const byName = filingsTieSentence(1203, 'period_end');
    expect(byName).toContain('listed alphabetically');
    expect(byName).toContain('not the newest');

    const byArrival = filingsTieSentence(1203, 'filed_date_then_period_end');
    expect(byArrival).not.toContain('alphabetically');
    expect(byArrival).not.toContain('not the newest');
    expect(byArrival).toContain('received most recently');
    // The anti-ranking half survives both wordings: no row carries an amount.
    expect(byArrival).toContain('never the largest');
    expect(byArrival).toContain('1,203 reports');
    // Read on the live page, the first version ran 2 "and" clauses together and used
    // "it" for a noun that was really the period. Neither is a correctness bug and both
    // cost a reader a second pass, which is the whole job of this sentence.
    expect(byArrival).not.toMatch(/period, and /);
    expect(byArrival).not.toMatch(/a report it states/);
  });

  it('keeps the no-count wording under the arrival order too', () => {
    const sentence = filingsTieSentence(null, 'filed_date_then_period_end');
    expect(sentence).not.toMatch(/\d/);
    expect(sentence).toContain('received most recently');
  });
});
