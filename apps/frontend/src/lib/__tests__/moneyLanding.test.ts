import { describe, expect, it } from 'vitest';
import { MONEY_LANE_LOBBYING } from '../lobbyingDirectoryCopy';

import {
  filedDateSentence,
  newestPeriodSentence,
  centralDateLabel,
  filingPeriodLine,
  formatCount,
  laneCountLine,
  LANE_COUNT_UNITS,
  legislatorsLaneBody,
  legislatorsLaneSentence,
  MONEY_LANDING_COVERAGE_HEADING,
  MONEY_LANDING_RECORD_DOES_NOT_COVER,
  MONEY_LANDING_SEARCH_NOTE,
  MONEY_LANDING_SUBTITLE,
  MONEY_LANE_BY_RACE,
  MONEY_LANE_COMMITTEES,
  MONEY_LANE_LEGISLATORS,
  MONEY_LANE_OUTSIDE_SPENDING,
  MONEY_LANE_WHO_GOT_PAID,
  orderingSentence,
  RECORD_DOES_NOT_COVER,
  RESEARCH_ROW_EMPTY,
  RESEARCH_ROW_LABEL,
  RESEARCH_ROW_LINK,
} from '../moneyLanding';

// The subtitle stands alone under the heading and each stored lane body is 1 sentence.
// All 7 standalone lines end bare. The distinction the rule
// turns on is INTERNAL versus TERMINAL: a body made of 2 sentences keeps the full stop
// that separates them, because that one is doing work a reader needs.
describe('the landing’s own standalone lines end without a full stop', () => {
  it('leaves the subtitle and all 6 lane descriptions bare', () => {
    const standalone = [
      MONEY_LANDING_SUBTITLE,
      MONEY_LANE_LEGISLATORS.body,
      MONEY_LANE_COMMITTEES.body,
      MONEY_LANE_WHO_GOT_PAID.body,
      MONEY_LANE_BY_RACE.body,
      MONEY_LANE_OUTSIDE_SPENDING.body,
      MONEY_LANE_LOBBYING.body,
    ];
    expect(standalone).toHaveLength(7);
    for (const line of standalone) {
      expect(line.endsWith('.')).toBe(false);
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it('carries no full stop inside any stored lane body, now that each is 1 sentence', () => {
    // The Who got paid body used to carry 2 sentences with the stop kept between them.
    // Its second sentence was a fact about the record, not the lane, and on 8 Sep 2026 it
    // moved to the landing's does-not-cover block, so every stored body is now 1 sentence.
    for (const body of [
      MONEY_LANE_LEGISLATORS.body,
      MONEY_LANE_COMMITTEES.body,
      MONEY_LANE_WHO_GOT_PAID.body,
      MONEY_LANE_BY_RACE.body,
      MONEY_LANE_OUTSIDE_SPENDING.body,
      MONEY_LANE_LOBBYING.body,
    ]) {
      expect(body).not.toContain('.');
    }
  });

  it('the Who got paid card says only what the lane does', () => {
    expect(MONEY_LANE_WHO_GOT_PAID.body).toBe(
      'Search payment records by the recipient name and spelling on the filing',
    );
    expect(MONEY_LANE_WHO_GOT_PAID.body).not.toContain('no list of every payee');
  });

  // Accepted 8 Sep 2026 (proposed by Design): "in district and then name order" is cut.
  // The order is a property of the list, and the race page prints its own order line
  // above the rows, so the card no longer states it. The card still promises no ranking.
  it('the race lane names the grouping and nothing about order, ranking or total', () => {
    expect(MONEY_LANE_BY_RACE.body).toBe(
      'Candidate committees’ filed figures, grouped by the seat',
    );
    expect(MONEY_LANE_BY_RACE.body).not.toContain('order');
    expect(MONEY_LANE_BY_RACE.body).not.toMatch(/total|most|largest|top/i);
  });

  it('uses the compact confirmed wording only when every sitting member is confirmed', () => {
    const drawn = legislatorsLaneBody({ confirmed: 200, total: 200 });
    expect(drawn).toBe(
      'Official contribution totals and named payment records, with every legislator’s committee match confirmed',
    );
  });

  it('names campaign money broadly without calling every received-payment row a donation', () => {
    expect(MONEY_LANDING_SUBTITLE).toBe(
      'Search Minnesota’s published campaign money and lobbying records',
    );
    expect(MONEY_LANDING_SUBTITLE).not.toContain('expenditure');
  });

  it('leaves the same body bare when no confirmation is served', () => {
    // The fallback state, where the body really does stand alone and takes no closing
    // mark — the same shape the first server response uses it in, as a link's detail.
    expect(legislatorsLaneBody(null)).toBe(MONEY_LANE_LEGISLATORS.body);
    expect(legislatorsLaneBody(null).endsWith('.')).toBe(false);
    expect(legislatorsLaneBody(undefined)).toBe(MONEY_LANE_LEGISLATORS.body);
  });
});

describe('the does-not-cover block', () => {
  // Rule 12's exact sentence, and it carries 2 corrections a reader can be misled
  // by. The $200 test is on the donor's YEARLY TOTAL, never on the size of one gift
  // (327,759 of the 583,152 published rows are individually under $200 and are named
  // anyway). And it is a FLOOR on who a committee must name, never a ban on naming
  // anyone smaller, so the sentence says "need not be named" (#1755).
  it('states the donor threshold on the yearly total, never per gift', () => {
    expect(RECORD_DOES_NOT_COVER).toContain(
      'Donors who gave $200 or less in total for the year need not be named',
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
    expect(RECORD_DOES_NOT_COVER[0]).toBe('No campaign payments held before 2015');
    expect(RECORD_DOES_NOT_COVER[1]).toBe(
      'These files cover union political funds, not a union’s wider finances',
    );
  });

  // Ruled 1 Sep 2026 (#1924). Each line stands alone in a stack, and a terminal full
  // stop makes it read as the opening of a paragraph that never arrives. The committee
  // page's own coverage block is worded identically, so this holds both copies.
  it('ends none of the 3 lines with a full stop', () => {
    for (const line of RECORD_DOES_NOT_COVER) {
      expect(line.endsWith('.')).toBe(false);
    }
  });

  // Lobbying is OURS to close, not a hole in what Minnesota publishes — the Board
  // publishes registrations, the lobbyist-to-client relationships and principal
  // expenditures. Folding it in with the permanent gaps would make a false claim
  // about Minnesota while trying to be honest about us.
  it('keeps lobbying out of the permanent gaps, because ours is a different kind of absence', () => {
    expect(RECORD_DOES_NOT_COVER).toHaveLength(3);
    expect(RECORD_DOES_NOT_COVER.join(' ').toLowerCase()).not.toContain('lobby');
    expect(MONEY_LANDING_RECORD_DOES_NOT_COVER.join(' ').toLowerCase()).not.toContain('lobby');
  });

  it('gives the landing its own ordered limits without changing the shared block', () => {
    expect(MONEY_LANDING_COVERAGE_HEADING).toBe('Limits of the campaign records');
    expect(MONEY_LANDING_RECORD_DOES_NOT_COVER).toEqual([
      'Payment records start in 2015',
      'Contributions totaling $200 or less from a donor to the same committee, party unit or fund in a calendar year may be reported without naming the donor. The threshold is $500 for ballot-question committees and funds. Smaller individual payments can still be named, including when the donor’s yearly total exceeds the threshold.',
      'Official report totals can include contributions without donor names. Individual records shown here may not add up to those totals.',
      'There is no complete directory of payment recipients. Records are grouped by the name recorded in the source. Different spellings appear separately, and a matching name alone does not establish identity.',
      'These files cover union political funds, not a union’s wider finances',
    ]);
    expect(RECORD_DOES_NOT_COVER).toHaveLength(3);
    expect(RECORD_DOES_NOT_COVER[0]).toBe('No campaign payments held before 2015');
  });

  it('keeps the shared multi-sentence limits intact', () => {
    expect(MONEY_LANDING_RECORD_DOES_NOT_COVER[1].endsWith('.')).toBe(true);
    expect(MONEY_LANDING_RECORD_DOES_NOT_COVER[2].endsWith('.')).toBe(true);
    expect(MONEY_LANDING_RECORD_DOES_NOT_COVER[3].endsWith('.')).toBe(true);
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

  // The 4 counted campaign lanes. Lobbying has its own count helper. The unit is a
  // count of rows or of groupings, never money: "payments" counts the rows of the
  // independent-expenditures file, and "contests" the race page's office-and-district
  // groupings.
  it('prints the 4 campaign count lines from served numbers', () => {
    expect(laneCountLine(200, LANE_COUNT_UNITS.legislators)).toBe('200 MEMBERS');
    expect(laneCountLine(1603, LANE_COUNT_UNITS.committees)).toBe('1,603 REGISTERED FILERS');
    expect(laneCountLine(222, LANE_COUNT_UNITS.byRace)).toBe('222 CONTESTS');
    expect(laneCountLine(41130, LANE_COUNT_UNITS.outsideSpending)).toBe('41,130 PAYMENT RECORDS');
  });

  // The Who got paid card has no count, and its slot carries no label either: a grey
  // "NOTHING TO COUNT" was proposed and withdrawn (false — we hold hundreds of thousands
  // of payment rows — and colour was its only signal). So there is no unit for it here.
  it('has no unit for the Who got paid lane, whose slot stays empty', () => {
    expect(Object.keys(LANE_COUNT_UNITS)).toEqual([
      'legislators',
      'committees',
      'byRace',
      'outsideSpending',
    ]);
    expect(Object.values(LANE_COUNT_UNITS).join(' ')).not.toMatch(/nothing|dollar|\$/i);
  });
});

describe('the research card', () => {
  it('is labelled RESEARCH and links to research', () => {
    expect(RESEARCH_ROW_LABEL).toBe('RESEARCH');
    expect(RESEARCH_ROW_LINK).toBe('Read the research');
  });

  // With nothing published the card reads 1 line and nothing else: no count of 0 pieces,
  // and no second link out to the /read page (proposed, refused).
  it('says only that nothing is published yet, with no count and no full stop', () => {
    expect(RESEARCH_ROW_EMPTY).toBe('Nothing is published yet');
    expect(RESEARCH_ROW_EMPTY).not.toMatch(/\d/);
    expect(RESEARCH_ROW_EMPTY.endsWith('.')).toBe(false);
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

  // The source can order by received dates or reporting periods. An unknown
  // ordering value must not acquire an explanation we cannot support.
  it('derives the ordering sentence from ordered_by, and stays silent on an unknown value', () => {
    expect(orderingSentence('period_end')).toBe(
      'Latest reporting periods first, then by filer name',
    );
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
    // A day above 12, so a day/month swap could not pass: month first, short month.
    expect(centralDateLabel('2026-08-20T21:34:26Z')).toBe('Aug 20, 2026');
  });

  it('passes through a value it cannot parse rather than inventing a date', () => {
    expect(centralDateLabel('unknown')).toBe('unknown');
  });
});

describe('confirmation progress', () => {
  it('writes the Legislators lane sentence from both served numbers, ending bare', () => {
    expect(legislatorsLaneSentence({ confirmed: 0, total: 200 })).toBe(
      "Campaign committee matches confirmed for 0 of Minnesota's 200 sitting legislators — for the rest, no figures show " +
        'on a profile',
    );
  });

  // Accepted 8 Sep 2026 (proposed by Design). The counted wording ends "for the rest, no
  // figures show on a profile", and once the 2 served numbers are equal that clause
  // describes nobody. Live, both numbers are 200.
  it('says every sitting legislator once the confirmed count reaches the total', () => {
    expect(legislatorsLaneSentence({ confirmed: 200, total: 200 })).toBe(
      'Campaign committee matches confirmed for every sitting legislator',
    );
    expect(legislatorsLaneSentence({ confirmed: 1, total: 1 })).toBe(
      'Campaign committee matches confirmed for every sitting legislator',
    );
    expect(legislatorsLaneSentence({ confirmed: 200, total: 200 }).endsWith('.')).toBe(false);
  });

  // The 2 branches must stay 2: a future edit that made the every-member wording
  // unconditional would tell a reader every member is confirmed while some are not.
  it('keeps the counted wording, word for word, while any member is unconfirmed', () => {
    expect(legislatorsLaneSentence({ confirmed: 199, total: 200 })).toBe(
      "Campaign committee matches confirmed for 199 of Minnesota's 200 sitting legislators — for the rest, no figures " +
        'show on a profile',
    );
    expect(legislatorsLaneSentence({ confirmed: 199, total: 200 })).not.toContain('every');
    expect(legislatorsLaneBody({ confirmed: 199, total: 200 })).toContain(
      'committee. Campaign committee matches confirmed for 199 of',
    );
  });

  it('does not claim every member is confirmed when no sitting members are served', () => {
    expect(legislatorsLaneBody({ confirmed: 0, total: 0 })).toBe(MONEY_LANE_LEGISLATORS.body);
    expect(legislatorsLaneSentence({ confirmed: 0, total: 0 })).not.toContain('every');
  });

  // Copy rule C: the sentence is the last one in a card description, so the drawn body
  // ends without a full stop even though it carries one between its 2 sentences.
  it('ends the drawn Legislators body bare, with the internal stop kept', () => {
    const drawn = legislatorsLaneBody({ confirmed: 200, total: 201 });
    expect(drawn.endsWith('.')).toBe(false);
    expect(drawn).toContain('committee. Campaign committee matches confirmed for 200 of Minnesota');
  });
});

describe('the newest period count names its own cutoff independently of the list', () => {
  it('counts reports and states the supplied cutoff', () => {
    expect(newestPeriodSentence({ filingCount: 1203, periodEnd: '2026-07-20' })).toBe(
      'Latest completed period: 1,203 reports cover through Jul 20, 2026',
    );
  });

  it('makes no claim when the count block or its cutoff is missing', () => {
    expect(newestPeriodSentence(null)).toBeNull();
    expect(newestPeriodSentence({ filingCount: 1203, periodEnd: null })).toBeNull();
    expect(newestPeriodSentence({ filingCount: 1203, periodEnd: '' })).toBeNull();
  });

  it.each([
    [0, '0 reports cover'],
    [1, '1 report covers'],
  ])('preserves a served count of %s', (filingCount, words) => {
    expect(newestPeriodSentence({ filingCount, periodEnd: '2026-07-20' })).toBe(
      `Latest completed period: ${words} through Jul 20, 2026`,
    );
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
    expect(filedDateSentence('2026-07-24')).toBe('Filed Jul 24, 2026');
  });

  it('says the order is a mix, because a flat "by the date filed" would be false', () => {
    // Every undated row would be described wrongly by a flat filing-order sentence, and
    // undated rows are the majority.
    const mixed = orderingSentence('filed_date_then_period_end');
    expect(mixed).toBe(
      'Newest first by received date.\nIf missing, we use the reporting period’s end.',
    );
  });

  it('keeps ordering separate from totals without repeating the removed amount disclaimer', () => {
    for (const orderedBy of ['period_end', 'filed_date_then_period_end']) {
      expect(orderingSentence(orderedBy)).not.toContain('Never by amount');
      expect(orderingSentence(orderedBy)).not.toMatch(/\d|reports cover/);
    }
  });
});

describe('the line under the search field', () => {
  it('explains partial-name search without repeating the name field or spelling caveat', () => {
    expect(MONEY_LANDING_SEARCH_NOTE).toBe(
      'Try all or part of a name: a person, committee, payee, or lobbyist',
    );
    expect(MONEY_LANDING_SEARCH_NOTE).not.toContain('nearest match');
    expect(MONEY_LANDING_SEARCH_NOTE.endsWith('.')).toBe(false);
  });
});
