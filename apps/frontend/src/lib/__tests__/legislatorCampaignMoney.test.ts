/**
 * What the campaign money tab is allowed to put on screen (#1329).
 *
 * These pin sentences as much as numbers, because on this tab the sentences are
 * where a false claim would live. `.claude/rules/grounded-answers.md` rule 12 forbids
 * three specific ones, and each has a test here that fails if the wording drifts back:
 *
 * - saying that small gifts go unnamed, when the threshold is on the donor's yearly
 *   total and 327,759 of 583,152 published rows are individually under $200;
 * - printing "$0" where we mean "we do not hold this";
 * - turning the dates of the payments we hold into a claimed coverage period.
 */
import { describe, expect, it } from 'vitest';

import {
  CAMPAIGN_MONEY_YEARS,
  FILING_SCHEDULE_NOTE,
  LINK_UNCONFIRMED_EXPLANATION,
  UNNAMED_MONEY_EXPLANATION,
  campaignMoneyYear,
  formatDay,
  formatMoney,
  moneyFigure,
  paymentCountLabel,
  paymentDateRangeLabel,
  reportedThroughLabel,
  showsUnconfirmedState,
  splitExplanation,
  unnamedShareLabel,
} from '../legislatorCampaignMoney';

describe('formatMoney', () => {
  it('keeps cents on a figure in the millions', () => {
    // The House Republican Campaign Committee's own reported 2025 total. Rounded to
    // $1.7M a reader cannot check it against Minnesota's filing, which is the whole
    // promise of this tab.
    expect(formatMoney('1747196.69')).toBe('$1,747,196.69');
  });

  it('adds the cents a whole-dollar figure arrives without', () => {
    expect(formatMoney('1000')).toBe('$1,000.00');
  });

  it('returns nothing at all for an absent value rather than a zero', () => {
    // The single most important line in this file. A "$0" invented here would be a
    // claim that a named person raised nothing.
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney(undefined)).toBeNull();
    expect(formatMoney('')).toBeNull();
  });

  it('prints a real zero as a zero', () => {
    expect(formatMoney('0')).toBe('$0.00');
  });
});

describe('moneyFigure', () => {
  it('shows a figure only when the block says the figures are real', () => {
    expect(moneyFigure('reported', '20552.62')).toEqual({
      text: '$20,552.62',
      isFigure: true,
    });
  });

  it('says "Not reported" rather than showing a zero when we hold nothing', () => {
    // Missing versus zero. A committee whose donors all stayed under the naming
    // threshold is never itemized, so absence here is silence, not a zero.
    expect(moneyFigure('not_reported', null)).toEqual({
      text: 'Not reported',
      isFigure: false,
    });
  });

  it('says a load failed rather than letting it fall through to "Not reported"', () => {
    // A fault on our side must never read as a named person having filed nothing.
    expect(moneyFigure('unavailable', null).isFigure).toBe(false);
    expect(moneyFigure('unavailable', null).text).not.toBe('Not reported');
  });

  it('never marks a stand-in sentence as a figure', () => {
    // `isFigure` is what stops "Not reported" being set in the size reserved for
    // money, where a reader would scan it as a number.
    expect(moneyFigure('reported', null).isFigure).toBe(false);
  });
});

describe('the sentence explaining money with no name on it', () => {
  it('puts the $200 threshold on the donor’s yearly total, never on one gift', () => {
    expect(UNNAMED_MONEY_EXPLANATION).toContain('more than $200 in total for the year');
    expect(UNNAMED_MONEY_EXPLANATION).toContain('$200 or less in total');
  });

  it('never says that small donations go unnamed', () => {
    // 327,759 of the 583,152 published rows are individually under $200 and are named
    // anyway, because that donor's yearly total had already passed it.
    expect(UNNAMED_MONEY_EXPLANATION).not.toMatch(/small (gift|donation|payment)/i);
    expect(UNNAMED_MONEY_EXPLANATION).not.toMatch(/under \$200|below \$200|less than \$200/i);
  });

  it('says candidates, because a ballot-question committee’s threshold is $500', () => {
    expect(UNNAMED_MONEY_EXPLANATION).toContain('candidates');
  });
});

describe('splitExplanation', () => {
  it('says nothing when the split is honest and the figures speak', () => {
    expect(splitExplanation('shown')).toBeNull();
  });

  it('names the two sources disagreeing rather than picking one', () => {
    const text = splitExplanation('sources_disagree') ?? '';
    expect(text).toContain('do not agree');
    expect(text).toMatch(/cannot tell which one is right/);
  });

  it('explains a period mismatch as time rather than as a disagreement', () => {
    // The House Republican Campaign Committee's 2026: our rows run to 20 July, its
    // report stops on 31 March. Calling that a contradiction blames Minnesota for
    // our arithmetic.
    const text = splitExplanation('periods_differ') ?? '';
    expect(text).toContain('different stretches of time');
    expect(text).not.toMatch(/do not agree|disagree/);
  });

  it('refuses to guess when we hold no named payment for reported money', () => {
    // Never rendered as "this money had no names", which is the claim it silently
    // becomes if the reported total is handed whole to the unnamed bucket.
    const text = splitExplanation('no_named_payments') ?? '';
    expect(text).toContain('cannot tell');
    expect(text).toMatch(/missing from the list/);
  });

  it('labels a lone figure as only the donations that had to be named', () => {
    const text = splitExplanation('no_reported_total') ?? '';
    expect(text).toMatch(/only the donations/);
  });

  it('never states a reason as a fact about the person', () => {
    // Every withheld state is about the records or about us. None may read as a
    // finding about the member whose photograph is at the top of the page.
    for (const state of [
      'no_reported_total',
      'sources_disagree',
      'periods_differ',
      'no_named_payments',
    ] as const) {
      expect(splitExplanation(state)).not.toMatch(/hid|conceal|refus|failed to (report|file)/i);
    }
  });
});

describe('dates', () => {
  it('reads an ISO date in local terms rather than through UTC midnight', () => {
    // `new Date('2026-07-20')` is UTC midnight and prints as the 19th everywhere
    // west of Greenwich, which is everywhere this is read. A filing period off by
    // one day is the kind of wrong number nobody notices.
    expect(formatDay('2026-07-20')).toBe('20 Jul 2026');
    expect(formatDay('2025-01-04T00:00:00Z')).toBe('4 Jan 2025');
  });

  it('returns nothing for a value that is not a date', () => {
    expect(formatDay(null)).toBeNull();
    expect(formatDay('soon')).toBeNull();
  });

  it('says when payments were made and never that a period is covered', () => {
    const label = paymentDateRangeLabel('2025-01-04', '2025-11-12') ?? '';
    expect(label).toBe('Payments dated 4 Jan 2025 to 12 Nov 2025');
    // The forbidden reading: no source we store states a filing's own start date,
    // and one filer reports from 11 July rather than 1 January.
    expect(label).not.toMatch(/cover|through|period/i);
  });

  it('does not print a range when both ends are the same day', () => {
    expect(paymentDateRangeLabel('2025-06-01', '2025-06-01')).toBe('Payment dated 1 Jun 2025');
  });

  it('names the report a total comes from, with the day it runs to', () => {
    expect(reportedThroughLabel('2026-03-31')).toBe(
      "The committee's own report to the state, covering through 31 Mar 2026",
    );
  });

  it('says nothing when there is no coverage date to state', () => {
    expect(reportedThroughLabel(null)).toBeNull();
  });
});

describe('paymentCountLabel', () => {
  it('counts one payment in the singular', () => {
    expect(paymentCountLabel(1)).toBe('1 payment');
  });

  it('groups the digits of a large count', () => {
    expect(paymentCountLabel(1488)).toBe('1,488 payments');
  });

  it('says nothing rather than zero when there is no count', () => {
    expect(paymentCountLabel(null)).toBeNull();
  });
});

describe('unnamedShareLabel', () => {
  it('states the share of money with no name on it', () => {
    // Jim Nash's House committee, 2025: $9,822.32 of a reported $20,552.62.
    expect(unnamedShareLabel('9822.32', '20552.62')).toBe('48% of the money raised');
  });

  it('states nothing when there is no whole to take a share of', () => {
    expect(unnamedShareLabel('100', null)).toBeNull();
    expect(unnamedShareLabel(null, '20552.62')).toBeNull();
    expect(unnamedShareLabel('100', '0')).toBeNull();
  });

  it('states nothing rather than an impossible share', () => {
    // A negative or over-100% share means the subtraction behind it was not honest,
    // and the server withholds those. This is the second line of defence.
    expect(unnamedShareLabel('-482540.48', '399275.76')).toBeNull();
    expect(unnamedShareLabel('30000', '20000')).toBeNull();
  });
});

describe('the unconfirmed state, which is every profile today', () => {
  it('never says no committee is registered for the member', () => {
    // All 200 sitting members appear in the Board's own list of registered filers,
    // so that sentence is false for every one of them.
    expect(LINK_UNCONFIRMED_EXPLANATION).not.toMatch(/no committee is registered/i);
    expect(LINK_UNCONFIRMED_EXPLANATION).toContain('on file with the state');
  });

  it('says the unfinished work is ours', () => {
    expect(LINK_UNCONFIRMED_EXPLANATION).toMatch(/we have not yet confirmed/i);
  });

  it('says nothing about the other members, at any count', () => {
    // A sentence true at 0 confirmed and false at 1 is one somebody has to remember
    // to change. This wording is equally true at 0, at 144 and at 199.
    expect(LINK_UNCONFIRMED_EXPLANATION).not.toMatch(
      /no figures are on any|every profile|all 200/i,
    );
  });

  it('shows the unconfirmed panel whenever there is nothing confirmed to show', () => {
    expect(showsUnconfirmedState('unconfirmed', 0)).toBe(true);
    expect(showsUnconfirmedState('reviewed_none_confirmed', 0)).toBe(true);
    // Confirmed, but no committee whose reviewed period covers this year: still
    // nothing this page may attribute to them.
    expect(showsUnconfirmedState('confirmed', 0)).toBe(true);
    expect(showsUnconfirmedState('confirmed', 1)).toBe(false);
  });
});

describe('the filing schedule note', () => {
  it('names when new money next appears, so a July figure is not read as a fault', () => {
    // Nothing new publishes between 21 July and 26 October 2026, and this ships in
    // September, so without this line "checked today" over July figures reads as
    // broken.
    expect(FILING_SCHEDULE_NOTE).toContain('26 October');
    expect(FILING_SCHEDULE_NOTE).toContain('1 February 2027');
  });
});

describe('campaignMoneyYear', () => {
  it('takes the year a reader asked for', () => {
    expect(campaignMoneyYear('2025')).toBe(2025);
    expect(campaignMoneyYear(2026)).toBe(2026);
  });

  it('lands on a real page for a year we do not carry', () => {
    // A URL is something people type and edit, and a mistyped year should not 404.
    expect(campaignMoneyYear('1999')).toBe(CAMPAIGN_MONEY_YEARS[0]);
    expect(campaignMoneyYear('banana')).toBe(CAMPAIGN_MONEY_YEARS[0]);
    expect(campaignMoneyYear(undefined)).toBe(CAMPAIGN_MONEY_YEARS[0]);
  });
});
