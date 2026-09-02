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
  EARLIEST_CAMPAIGN_MONEY_YEAR,
  LINK_UNCONFIRMED_EXPLANATION,
  type FilingSchedule,
  UNNAMED_MONEY_EXPLANATION,
  campaignMoneyYear,
  campaignMoneyYears,
  formatDay,
  formatMoney,
  isAmountAboveZero,
  moneyFigure,
  otherOfficeNote,
  severalCommitteesNote,
  paymentCountLabel,
  paymentDateRangeLabel,
  reportedThroughLabel,
  confirmedElsewhereExplanation,
  confirmedElsewhereHeading,
  matchCheckSentences,
  emptyStateFor,
  filingScheduleNote,
  statedSplitNote,
  spendingNote,
  splitExplanation,
  unnamedShareLabel,
} from '../legislatorCampaignMoney';

describe('formatMoney', () => {
  it('drops the cents on a figure in the millions', () => {
    // The House Republican Campaign Committee's own reported 2025 total. Every digit
    // that identifies the figure survives; only the cents go, and the filed amount to
    // the cent stays one click away on the Board's own site.
    expect(formatMoney('1747196.69')).toBe('$1,747,196');
  });

  // The half of the ruling that is a truth claim rather than a style choice: a figure
  // may never read LARGER than the money it stands for. Rounding breaks that on every
  // value whose cents are 50 or more, which is about half of them.
  it('cuts the cents rather than rounding them, so no figure reads high', () => {
    expect(formatMoney('99.99')).toBe('$99');
    expect(formatMoney('99.50')).toBe('$99');
    expect(formatMoney('178579449.67')).toBe('$178,579,449');
    // Negative amounts read high by getting closer to zero, so flooring the magnitude
    // rather than the signed value is what keeps the rule true in both directions.
    expect(formatMoney('-99.99')).toBe('-$99');
  });

  it('adds no cents to a whole-dollar figure', () => {
    expect(formatMoney('1000')).toBe('$1,000');
  });

  it('returns nothing at all for an absent value rather than a zero', () => {
    // The single most important line in this file. A "$0" invented here would be a
    // claim that a named person raised nothing.
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney(undefined)).toBeNull();
    expect(formatMoney('')).toBeNull();
  });

  it('prints a real zero as a zero', () => {
    expect(formatMoney('0')).toBe('$0');
  });

  // The exception truncation itself creates. Cutting the cents off 50 cents leaves
  // "$0", which a reader takes for a filed zero — the missing-versus-zero failure
  // `.claude/rules/grounded-answers.md` rule 12 exists to stop. So anything above zero
  // and under a dollar keeps its cents.
  it('keeps the cents under a dollar, so a 50-cent row never reads as a filed zero', () => {
    expect(formatMoney('0.50')).toBe('$0.50');
    expect(formatMoney('0.01')).toBe('$0.01');
    expect(formatMoney('0.99')).toBe('$0.99');
    expect(formatMoney('-0.50')).toBe('-$0.50');
    // A dollar and over is back under the ordinary rule.
    expect(formatMoney('1.99')).toBe('$1');
  });

  // The sub-dollar branch cuts too, and the reason is the same rule rather than
  // tidiness: `toFixed(2)` turned 0.999 into "$1.00", which reads higher than the money
  // AND prints a dollar figure inside the branch reserved for values under a dollar.
  // The source columns hold 4 decimal places, so a filing can carry these (#1929).
  it('cuts the cents under a dollar as well, and never rounds up to a whole one', () => {
    expect(formatMoney('0.999')).toBe('$0.99');
    expect(formatMoney('0.9999')).toBe('$0.99');
    expect(formatMoney('0.995')).toBe('$0.99');
    expect(formatMoney('-0.999')).toBe('-$0.99');
    // Never the malformed "$0.100" the clamp exists to stop, and never a whole dollar.
    for (const value of ['0.999', '0.9999', '0.99999', '0.995']) {
      expect(formatMoney(value)).not.toMatch(/\.\d{3}/);
      expect(formatMoney(value)).not.toBe('$1.00');
      expect(formatMoney(value)).not.toBe('$1');
    }
  });

  // Binary floating point: 0.29 * 100 is 28.999999999999996, so truncating without
  // first rounding to the source's own 4 decimal places would print $0.28 for a
  // 29-cent payment. Walked across every cent rather than spot-checked, because the
  // values that trip it are not the ones anybody would think to try.
  it('prints every whole cent under a dollar exactly, despite floating point', () => {
    for (let cents = 1; cents <= 99; cents += 1) {
      const expected = `$0.${String(cents).padStart(2, '0')}`;
      expect(formatMoney((cents / 100).toFixed(2))).toBe(expected);
      expect(formatMoney(cents / 100)).toBe(expected);
    }
  });
});

describe('moneyFigure', () => {
  it('shows a figure only when the block says the figures are real', () => {
    expect(moneyFigure('reported', '20552.62')).toEqual({
      text: '$20,552',
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
  });

  it('states the threshold as a floor on who must be named, never as a ban', () => {
    // The statute's words are that a contributor "must then be listed" once the
    // aggregate exceeds the threshold, and nothing in it forbids naming a smaller
    // one. Filer 18135's 2026 pre-general itemizes 215 donors at or under $200 and
    // reconciles to the cent (campaign-finance-system-design.md §2.3), so a reader
    // can open a real filing that contradicts the absolute (#1755).
    expect(UNNAMED_MONEY_EXPLANATION).toContain('may name a smaller donor but does not have to');
    expect(UNNAMED_MONEY_EXPLANATION).not.toContain('never named');
  });

  it("says the state's file does not name them, not that nobody knows", () => {
    // The source proves only what Minnesota published. The committee knows who gave it,
    // and another record may say so, which makes "nobody knows" a claim about the world
    // that this file cannot support.
    expect(UNNAMED_MONEY_EXPLANATION).toContain('public file does not say who gave it');
    expect(UNNAMED_MONEY_EXPLANATION).not.toContain('nobody knows');
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

  it('never says which of the two figures is the larger one', () => {
    // This state is reached from both directions and the sentence used to name only
    // one of them: "the donations the state lists add up to more than the committee
    // itself reported raising". Measured on the live release 18 Aug 2026 (#1496), 33
    // of the 76 disagreeing committee-years run the other way — the committee's own
    // filed report names money the state's donation list does not hold — so that
    // clause stated the reverse of the truth for 33 committee-years. Filer 20010's
    // 2025 is the plain case: its filing itemizes $1,493,418.08 and the donation list
    // holds $1,488,168.08. No reader had seen it — the money section is gated on a
    // confirmed member-to-committee match and there are 0 of those in production — so
    // this test guards a sentence before it is ever drawn rather than after.
    const text = splitExplanation('sources_disagree') ?? '';
    expect(text).not.toMatch(/more than|larger|bigger|exceed|greater|less than|smaller/i);
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
    // Not "the state has not published a report": the same state is reached when we
    // hold a report we cannot use, and blaming Minnesota for our gap is its own claim.
    expect(text).not.toMatch(/state has not published/i);
  });

  it('says an empty donation list is ours rather than a disagreement', () => {
    // #1682 and #1642's 7th empty-year state. Six live committee pages printed the
    // disagreement sentence here on 19 Aug 2026, Kristin Robbins's governor committee
    // among them, when the truth is that the state's donation list holds no row for
    // that year at all.
    const text = splitExplanation('named_payments_not_in_our_copy') ?? '';
    expect(text).toMatch(/names its donors/);
    expect(text).toMatch(/not from what the committee filed/);
    expect(text).not.toMatch(/do not agree|disagree/);
    // Never a filing-calendar sentence: the report was filed on time, so a deadline
    // would be true about the calendar and false about the money.
    expect(text).not.toMatch(/due|deadline|not required to report|schedule/i);
  });

  it('says a corrected filing is our refresh gap rather than a contradiction', () => {
    const text = splitExplanation('reported_total_predates_a_correction') ?? '';
    expect(text).toMatch(/then corrected it/);
    expect(text).toMatch(/had not picked the correction up/);
    expect(text).not.toMatch(/do not agree|disagree/);
  });

  it('keeps the unexplained case quieter than a disagreement', () => {
    const text = splitExplanation('figures_do_not_line_up') ?? '';
    expect(text).toMatch(/will not line up/);
    expect(text).toMatch(/cannot tell why/);
    expect(text).not.toMatch(/do not agree|disagree/);
  });

  it('gives every state a sentence, so none renders as a bare figure', () => {
    // A state the backend serves and this function does not know falls through to
    // `null`, which draws a withheld figure with nothing saying why. Adding a state to
    // the union without a sentence is the way that happens, so the list is walked.
    for (const state of [
      'no_reported_total',
      'sources_disagree',
      'periods_differ',
      'no_named_payments',
      'named_payments_not_in_our_copy',
      'reported_total_predates_a_correction',
      'figures_do_not_line_up',
    ] as const) {
      expect(splitExplanation(state)).not.toBeNull();
    }
  });

  it('never states a reason as a fact about the person', () => {
    // Every withheld state is about the records or about us. None may read as a
    // finding about the member whose photograph is at the top of the page.
    for (const state of [
      'no_reported_total',
      'sources_disagree',
      'periods_differ',
      'no_named_payments',
      'named_payments_not_in_our_copy',
      'reported_total_predates_a_correction',
      'figures_do_not_line_up',
    ] as const) {
      expect(splitExplanation(state)).not.toMatch(/hid|conceal|refus|failed to (report|file)/i);
    }
  });
});

describe('spendingNote', () => {
  it('says there is no bigger number, beside a real figure', () => {
    // Was 'no bigger number', which sat beside the claim that Minnesota publishes no
    // spending total. Minnesota publishes one for 3,630 filer-years, so what has to
    // survive is the $200 sentence and nothing that speaks for Minnesota's records.
    expect(spendingNote('reported')).toContain('$200 in total for the year');
  });

  it('says an absent figure is not a spending of zero', () => {
    // The sentence beside a figure would be explaining a number that is not on the
    // screen, and a reader takes the absence as zero. This is the same
    // missing-versus-zero failure as a "$0", one step further out.
    const text = spendingNote('not_reported');
    expect(text).toContain('does not mean the committee paid out nothing');
    expect(text).not.toContain('no bigger number');
    // Money out is never called spending here: a large share of it is money given to
    // other campaigns, and the committee page's own note words this state the same way.
    expect(text).not.toContain('spent nothing');
  });

  it('says a load failed rather than blaming the committee', () => {
    expect(spendingNote('unavailable')).toMatch(/our copy/);
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
  it('states the share of the donations reported, not of "the money raised"', () => {
    // Jim Nash's House committee, 2025: $10,072.32 of a reported $20,552.62. The
    // reported figure sums the filing's contribution lines only and excludes public
    // subsidy, loan income and miscellaneous income, so "the money raised" would be a
    // share of a larger number than the one it came from.
    expect(unnamedShareLabel('10072.32', '20552.62')).toBe(
      '49% of the donations the committee reported',
    );
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

  it('tells "nobody has looked" apart from "checked, but not this year"', () => {
    // An earlier version collapsed the two, so a member whose committee IS checked and
    // whose reviewed years simply do not reach the year on screen was told nobody had
    // looked at them. That blames our unfinished work for something that is finished.
    expect(emptyStateFor('unconfirmed', 0)).toBe('unconfirmed');
    expect(emptyStateFor('reviewed_none_confirmed', 0)).toBe('unconfirmed');
    expect(emptyStateFor('confirmed', 0)).toBe('confirmed-elsewhere');
    expect(emptyStateFor('confirmed', 1)).toBeNull();
  });

  it('names the year an empty match covers, and blames no one', () => {
    // The 'not a gap in the record' phrasing this used to assert was removed: it sat
    // beside a claim that the registration had ended, which was false on 22 live pages.
    // What has to survive is naming the year and never blaming our own unfinished work.
    const text = confirmedElsewhereExplanation(2026);
    expect(text).toContain('2026');
    expect(text).not.toMatch(/have not yet confirmed|nobody has/i);
  });
});

describe('otherOfficeNote', () => {
  it('says nothing when nothing was left out', () => {
    expect(otherOfficeNote(0)).toBeNull();
    expect(otherOfficeNote(null)).toBeNull();
  });

  it('names that the money exists and reports not a dollar of it', () => {
    // Leaving a member's run for Attorney General out in silence is its own small lie:
    // a reader who knows about that campaign concludes we missed it.
    const text = otherOfficeNote(1) ?? '';
    expect(text).toContain('one other committee');
    expect(text).toContain('not shown here');
    expect(text).not.toMatch(/\$/);
    // We check only that a committee exists for another race, never that it holds any
    // money for the year on screen, so the sentence may not say money is there.
    expect(text).not.toMatch(/that money is/i);
  });

  it('counts more than one', () => {
    expect(otherOfficeNote(2)).toContain('2 other committees');
  });

  it('never suggests the member hid it', () => {
    expect(otherOfficeNote(1)).not.toMatch(/hid|conceal|undisclosed|failed to/i);
  });
});

describe('statedSplitNote', () => {
  it("says nothing when the committee's own filed report was checked", () => {
    expect(statedSplitNote('agrees')).toBeNull();
  });

  it('says an unchecked figure is unchecked, without accusing the committee', () => {
    // The comparison costs a document request per filing and has been run for 2025 and
    // not for 2026, so the year a reader lands on says "not checked" today. Blanking
    // every 2026 profile would distort more than labelling the figure does.
    const text = statedSplitNote('not_checked') ?? '';
    expect(text).toContain('not yet compared');
    expect(text).not.toMatch(/hid|conceal|failed to|refus/i);
  });
});

describe('the filing schedule note, one committee at a time', () => {
  // Every fixture is dated in 2099 on purpose. The paragraph this replaced wrote 2026's
  // dates into its own words, so on 1 January 2027 it would have described a finished
  // election year and nothing would have announced it (#1642). A fixture a lifetime away
  // from today makes any surviving hardcoded year visible as a stray "20xx".
  const onTheBallot: FilingSchedule = {
    state: 'on_the_ballot',
    nextReportName: 'Pre-general report of receipts and expenditures',
    nextReportDueOn: '2099-10-26',
    periodStart: '2099-01-01',
    periodEnd: '2099-10-19',
    condition: 'Candidates who lost the primary election do not need to file this report.',
    terminatedOn: null,
  };
  const notOnTheBallot: FilingSchedule = {
    state: 'not_on_the_ballot',
    nextReportName: '2099 year-end report of receipts and expenditures',
    nextReportDueOn: '2100-02-01',
    periodStart: '2099-01-01',
    periodEnd: '2099-12-31',
    condition: null,
    terminatedOn: null,
  };
  const closed: FilingSchedule = {
    state: 'registration_closed',
    nextReportName: null,
    nextReportDueOn: null,
    periodStart: null,
    periodEnd: null,
    condition: null,
    terminatedOn: '2099-03-04',
  };
  const gap = (state: FilingSchedule['state']): FilingSchedule => ({
    state,
    nextReportName: null,
    nextReportDueOn: null,
    periodStart: null,
    periodEnd: null,
    condition: null,
    terminatedOn: null,
  });
  const all: FilingSchedule[] = [
    onTheBallot,
    notOnTheBallot,
    closed,
    gap('special_election_filer'),
    gap('calendar_not_transcribed'),
    gap('filings_cannot_answer'),
  ];
  const said = (schedule: FilingSchedule) => filingScheduleNote(schedule, 2099).join(' ');

  it('says a committee on the ballot owes a named report on a named date', () => {
    const text = said(onTheBallot);
    expect(text).toContain('is on the 2099 ballot');
    expect(text).toContain('“Pre-general report of receipts and expenditures”');
    expect(text).toContain('due 26 Oct 2099');
    expect(text).toContain('covering 1 Jan 2099 to 19 Oct 2099');
  });

  it('says a committee not on the ballot owes nothing until its once-a-year report', () => {
    const text = said(notOnTheBallot);
    expect(text).toContain('is not on the 2099 ballot');
    expect(text).toContain('once a year');
    expect(text).toContain('due 1 Feb 2100');
    // The whole point of this state: an empty year is the schedule, not a silence.
    expect(text).toContain('not money going unreported');
  });

  it('says a closed registration owes nothing further, and names the day it closed', () => {
    const text = said(closed);
    expect(text).toContain('closed its registration with the state on 4 Mar 2099');
    expect(text).toContain('no further report is due');
  });

  it('says a special-election filer runs on periods we have not written down', () => {
    const text = said(gap('special_election_filer'));
    expect(text).toContain('We cannot say when this committee’s next report is due');
    expect(text).toContain('special elections run on their own set of filing periods');
  });

  it('says an untranscribed calendar is a calendar we have not copied in', () => {
    const text = said(gap('calendar_not_transcribed'));
    expect(text).toContain('We cannot say when this committee’s next report is due');
    expect(text).toContain('we have not yet copied in the one covering this committee');
  });

  it('says our own copy of the filings is what cannot answer', () => {
    const text = said(gap('filings_cannot_answer'));
    expect(text).toContain('We cannot say when this committee’s next report is due');
    expect(text).toContain('Our copy of the state’s own list of filings cannot answer it');
  });

  it('gives all 6 states different words', () => {
    // The failure this catches is 2 states collapsing into 1 sentence, which would tell
    // a reader something false about a named politician's filing duties.
    expect(new Set(all.map(said)).size).toBe(6);
  });

  it('never lets one of our 3 gaps read like one of the committee’s 3 facts', () => {
    // Rule 12's missing-versus-zero rule, applied to dates instead of to money. Our
    // gaps say so in plain words and never name a due date; the committee-side states
    // never blame us.
    for (const state of [
      'special_election_filer',
      'calendar_not_transcribed',
      'filings_cannot_answer',
    ] as const) {
      const text = said(gap(state));
      expect(text).toContain('That gap is on our side');
      expect(text).not.toMatch(/due \d/);
      expect(text).not.toMatch(/nothing is due|not required to report/i);
    }
    for (const schedule of [onTheBallot, notOnTheBallot, closed]) {
      expect(said(schedule)).not.toContain('We cannot say');
      expect(said(schedule)).not.toContain('That gap is on our side');
    }
  });

  it('never says a report is late, in any state', () => {
    // The signal that marks an unfiled report is only readable in the current year, so
    // the claim cannot be supported — and it would name a real person.
    for (const schedule of all) {
      expect(said(schedule)).not.toMatch(
        /\blate\b|overdue|past due|delinquent|missed|failed to file|should have filed|has not filed/i,
      );
    }
  });

  it('never prints the pre-general date without the exemption printed beside it', () => {
    // Everyone who advanced past the primary owes that report and everyone who lost
    // does not, and no record we hold says which happened. The date alone invents a
    // deadline for the losers.
    const paragraphs = filingScheduleNote(onTheBallot, 2099);
    expect(paragraphs.join(' ')).toContain('due 26 Oct 2099');
    expect(paragraphs.join(' ')).toContain(
      '“Candidates who lost the primary election do not need to file this report.”',
    );
    // Its own paragraph, so a reader skimming does not lose it inside the date sentence.
    expect(paragraphs).toHaveLength(2);
  });

  it('writes no year into any sentence of its own', () => {
    // What the old fixed paragraph failed to pin. Every year on screen has to come from
    // the schedule or from the year the reader chose, so nothing here can go stale in
    // silence on 1 January.
    for (const schedule of all) {
      const years = said(schedule).match(/\b\d{4}\b/g) ?? [];
      expect(years.every((found) => found === '2099' || found === '2100')).toBe(true);
    }
  });

  it('drops a half-served date rather than printing “due” and nothing', () => {
    const text = said({ ...onTheBallot, nextReportDueOn: null });
    expect(text).toContain('is on the 2099 ballot');
    expect(text).not.toContain('due');
    // And the exemption goes with the date it qualifies rather than floating alone.
    expect(text).not.toContain('lost the primary');
  });

  it('treats a missing schedule block as our gap, never as a committee-side fact', () => {
    expect(filingScheduleNote(undefined, 2099).join(' ')).toContain('That gap is on our side');
  });
});

describe('the years the tab offers', () => {
  it('reads them off the calendar rather than a written-down pair', () => {
    // The failure this prevents is silent: a hardcoded 2026-and-2025 would hide 2027
    // from every reader on 1 January 2027, and nothing would announce it.
    expect(campaignMoneyYears(new Date('2026-08-13T12:00:00Z'))).toEqual([2026, 2025]);
    expect(campaignMoneyYears(new Date('2027-01-01T12:00:00Z'))).toEqual([2027, 2026]);
  });

  it("never offers a year before Minnesota's downloads start", () => {
    expect(campaignMoneyYears(new Date('2015-06-01T12:00:00Z'))).toEqual([
      EARLIEST_CAMPAIGN_MONEY_YEAR,
    ]);
  });
});

describe('campaignMoneyYear', () => {
  const on13Aug2026 = new Date('2026-08-13T12:00:00Z');

  it('takes the year a reader asked for', () => {
    expect(campaignMoneyYear('2025', on13Aug2026)).toBe(2025);
    expect(campaignMoneyYear(2026, on13Aug2026)).toBe(2026);
  });

  it('lands on a real page for a year we do not carry', () => {
    // A URL is something people type and edit, and a mistyped year should not 404.
    expect(campaignMoneyYear('1999', on13Aug2026)).toBe(2026);
    expect(campaignMoneyYear('banana', on13Aug2026)).toBe(2026);
    expect(campaignMoneyYear(undefined, on13Aug2026)).toBe(2026);
  });
});

describe('a member holding more than one committee (#1663)', () => {
  it('says the accounts are separate and that we never add them, before the figures', () => {
    // The double count this prevents is real and measured. Diane Napper's Senate
    // committee (19520) reports $3,000.00 for 2026, and all of it arrived on
    // 15 June 2026 from her own House committee (19121) as a payment the state types
    // `Contribution`. Frank Pafko's House committee (19512) reports $2,851.97, all of
    // it from his own Senate committee (18920) on 16 June 2026. A combined figure for
    // either would be 100% the same money counted twice.
    const note = severalCommitteesNote(2);
    expect(note).toContain('2 campaign committees');
    expect(note).toContain('each one reports to the state separately');
    expect(note).toContain('we never add them together');
    expect(note).toContain('count it twice');
  });

  it('never offers to subtract the moved money from either committee', () => {
    // The money really did arrive and the filing says so, so netting it out would put
    // our figure at odds with the Board's own. Rule 12: separate transfers, never a
    // chain, and never a figure that disagrees with the source it cites.
    const note = severalCommitteesNote(2) ?? '';
    for (const banned of ['subtract', 'minus', 'net', 'excluding', 'total for this member']) {
      expect(note.toLowerCase()).not.toContain(banned);
    }
  });

  it('says nothing at all for the ordinary member with one committee', () => {
    expect(severalCommitteesNote(1)).toBeNull();
    expect(severalCommitteesNote(0)).toBeNull();
    expect(severalCommitteesNote(null)).toBeNull();
    expect(severalCommitteesNote(undefined)).toBeNull();
  });
});

describe('isAmountAboveZero', () => {
  it('is the only place a committee amount becomes a number, and it cannot build a total', () => {
    // It returns a boolean, so 2 committees' amounts cannot be combined through it.
    // `scripts/check_no_cross_committee_total.py` fails any other conversion of these
    // fields anywhere in the app (#1663).
    expect(isAmountAboveZero('120.50')).toBe(true);
    expect(isAmountAboveZero('0.00')).toBe(false);
  });

  it('reads a missing figure as no line to draw, never as a zero', () => {
    // "Not reported" and "$0.00" are different facts (rule 12), and neither of them is
    // an amount worth a goods-and-services line.
    expect(isAmountAboveZero(null)).toBe(false);
    expect(isAmountAboveZero(undefined)).toBe(false);
    expect(isAmountAboveZero('')).toBe(false);
    expect(isAmountAboveZero('not a number')).toBe(false);
  });
});

describe('an empty year says which of 2 things is true', () => {
  const open = {
    registrationNumber: '15163',
    committeeNameAsReviewed: 'Rest, Ann H Senate Committee',
    closedOn: null,
  };
  const closed = {
    registrationNumber: '18472',
    committeeNameAsReviewed: 'Novotny, Paul House Committee',
    closedOn: '2026-07-28',
  };

  // The shipped bug: on the day the first 144 matches were confirmed, 23 profiles showed
  // this panel and Minnesota's own filer record had 22 of those committees open with no
  // closing date. The page told 22 named politicians' readers that a registration had
  // ended when it had not.
  it('never says a registration ended when we only know nothing was reported', () => {
    const body = confirmedElsewhereExplanation(2026, [open]);
    expect(body).toContain('reported no money in 2026');
    expect(body).toContain('not a statement that the committee has closed');
    expect(body).not.toContain('does not run forever');
    expect(body).not.toContain('the years it covers');
    expect(confirmedElsewhereHeading(2026, [open])).toBe('Nothing reported for 2026');
  });

  it('says the registration closed, and names the day, when the Board says so', () => {
    const body = confirmedElsewhereExplanation(2026, [closed]);
    expect(body).toContain('closed on July 28, 2026');
    expect(body).toContain('no further money will be reported');
    expect(confirmedElsewhereHeading(2026, [closed])).toBe('This committee has closed');
  });

  it('falls back to the honest wording when only some are closed', () => {
    const body = confirmedElsewhereExplanation(2026, [open, closed]);
    expect(body).toContain('not a statement that the committee has closed');
    expect(body).not.toContain('closed on');
    expect(confirmedElsewhereHeading(2026, [open, closed])).toBe('Nothing reported for 2026');
  });

  // A page that served nothing for this field, an older API or a cached response, must
  // still read truthfully rather than falling back to the claim this fix removed.
  it('says the honest thing when the server told it nothing', () => {
    expect(confirmedElsewhereExplanation(2026)).toContain('reported no money in 2026');
    expect(confirmedElsewhereExplanation(2026)).not.toContain('does not run forever');
    expect(confirmedElsewhereHeading(2026)).toBe('Nothing reported for 2026');
  });
});

describe('what the card says about who checked the match', () => {
  const acomb = {
    checkedOn: '2026-08-31',
    nameEvidence: 'exact',
    registerVerdict: 'same_seat',
    partyAgreement: 'agrees',
  };

  it('names the entity and the day, then what was read', () => {
    expect(matchCheckSentences(acomb)).toEqual([
      'Checked by Alethical on August 31, 2026',
      'The filed name matches theirs exactly',
      "Minnesota's register of registered candidates lists this account for their own seat and party",
      'Party organisations of their own party pay into it',
    ]);
  });

  // The weakest case among the 242 confirmed on 31 Aug 2026, and the one a reader most
  // deserves to see: the register has no row for it at all. It may never read as though the
  // state agreed.
  it('says plainly when the state has no row, rather than implying it agreed', () => {
    const sentences = matchCheckSentences({ ...acomb, registerVerdict: 'unknown' });
    expect(sentences).toContain(
      "Minnesota's register of current candidates does not list this account",
    );
    expect(sentences.join(' ')).not.toContain('lists this account for their own seat');
  });

  // Liish Kozlowski's shape: filed as "Kozlowski, Alicia". The card says so rather than
  // claiming a match the filed name does not show.
  it('says the first name is filed differently when only the last name matched', () => {
    const sentences = matchCheckSentences({ ...acomb, nameEvidence: 'surname_only' });
    expect(sentences).toContain(
      'The account shares their last name and the first name is filed differently',
    );
    expect(sentences).not.toContain('The filed name matches theirs exactly');
  });

  // All 4 party states get their own words, and 2 of them are not disagreements.
  it('never renders a missing party comparison as a disagreement', () => {
    expect(matchCheckSentences({ ...acomb, partyAgreement: 'no_party_money' })).toContain(
      'No party organisation has ever paid into it',
    );
    expect(
      matchCheckSentences({ ...acomb, partyAgreement: 'no_party_on_record' }).join(' '),
    ).not.toContain('other party');
    expect(matchCheckSentences({ ...acomb, partyAgreement: 'disagrees' })).toContain(
      'Party organisations of the other party pay into it',
    );
  });

  // Ruled 1 Sep 2026 (#1924). Every sentence this block can produce renders on its own
  // line, so the whole set is a stack and none of them closes with a full stop. Walked
  // across every stored value rather than the 3 in the happy path, because a value only
  // one committee triggers is exactly the one that gets missed.
  it('ends none of its sentences with a full stop, in any combination of evidence', () => {
    const nameEvidence = [
      'exact',
      'published_nickname',
      'shortened',
      'middle_name',
      'initial',
      'surname_only',
    ];
    const registerVerdict = [
      'same_seat',
      'same_seat_not_current',
      'different_race',
      'different_person',
      'unknown',
    ];
    const partyAgreement = ['agrees', 'disagrees', 'no_party_money', 'no_party_on_record'];
    let seen = 0;
    for (const name of nameEvidence) {
      for (const register of registerVerdict) {
        for (const party of partyAgreement) {
          const sentences = matchCheckSentences({
            checkedOn: '2026-08-31',
            nameEvidence: name,
            registerVerdict: register,
            partyAgreement: party,
          });
          expect(sentences).toHaveLength(4);
          for (const sentence of sentences) {
            expect(sentence.endsWith('.')).toBe(false);
            seen += 1;
          }
        }
      }
    }
    // 6 x 5 x 4 combinations x 4 lines each: every stored sentence is reached.
    expect(seen).toBe(480);
  });

  it('says nothing at all when the decision carries no stored basis', () => {
    expect(matchCheckSentences(null)).toEqual([]);
    expect(matchCheckSentences(undefined)).toEqual([]);
  });

  it('drops only the part it has no words for, and keeps the signature line', () => {
    const sentences = matchCheckSentences({
      checkedOn: '2026-08-31',
      nameEvidence: null,
      registerVerdict: null,
      partyAgreement: null,
    });
    expect(sentences).toEqual(['Checked by Alethical on August 31, 2026']);
  });
});

describe('the spending note never speaks for what Minnesota publishes', () => {
  // The shipped defect: this block told readers Minnesota "publishes no official total
  // for a committee's spending". Minnesota publishes one. cf_filing_figure holds a
  // total_expenditures line for 3,630 filer-years, our own committee route serves it, and
  // our own committee page prints it 2 clicks away. A reader who wanted the official
  // figure was told not to look for it.
  const everyState = ['reported', 'not_reported', 'unavailable'] as const;

  it('never claims Minnesota publishes no spending total, in any state', () => {
    for (const state of everyState) {
      expect(spendingNote(state)).not.toMatch(/publishes no official total/i);
      expect(spendingNote(state)).not.toMatch(/Minnesota[^.]*no (?:official )?total/i);
    }
  });

  // The money-in block on the same screen already says the true version, and the
  // difference is which side the gap is on: ours, not Minnesota's.
  it('puts a missing comparison on our side of the line', () => {
    // Was 'we do not repeat it here yet', which was true for the hours between removing
    // the false claim about Minnesota and drawing the figure. The page draws it now, so
    // what has to survive is that a missing comparison is described as ours.
    const note = spendingNote('reported');
    expect(note).toContain('that we can stand behind');
    expect(note).not.toContain('no bigger number');
  });

  it('still says the list is not everything, which is the true half', () => {
    expect(spendingNote('reported')).toContain('$200 in total for the year');
    expect(spendingNote('reported')).toContain('not everything');
  });

  // Unchanged and load-bearing: an absent figure must never read as a paying-out of zero.
  it('keeps refusing to let nothing named read as nothing paid out', () => {
    expect(spendingNote('not_reported')).toContain('does not mean the committee paid out nothing');
  });
});

describe('money out finally has its second number', () => {
  // Rule 12 wants a second figure beside every money figure, so a reader can see what
  // our list does and does not cover. Money out was the only figure on this tab with
  // none: the route served the committee's own reported total, the client mapping
  // dropped it, and the page then told readers Minnesota published no such total. It
  // publishes one for 3,630 filer-years.
  it('says the 2 figures are separate claims when both are on screen', () => {
    const note = spendingNote('reported', true);
    expect(note).toContain('2 different figures from Minnesota');
    expect(note).toContain('never subtract one from the other');
    expect(note).toContain('$200 in total for the year');
  });

  // Null is not zero and not Minnesota's fault. We hold no total for some
  // committee-years, and on a special-election filer-year we hold one and refuse to
  // stand behind it: 39 such filer-years are in the live snapshot, including Rep. Xp
  // Lee's committee 19223 for 2025, which holds $16,923.32 we will not publish.
  it('puts a missing comparison on our side when only our list is on screen', () => {
    const note = spendingNote('reported', false);
    expect(note).toContain('that we can stand behind');
    expect(note).not.toContain('2 different figures from Minnesota');
  });

  it('still never claims Minnesota publishes no spending total, either way', () => {
    for (const has of [true, false]) {
      expect(spendingNote('reported', has)).not.toMatch(/publishes no official total/i);
      expect(spendingNote('reported', has)).not.toMatch(/Minnesota[^.]*no (?:official )?total/i);
    }
  });

  it('defaults to the honest sentence when the caller says nothing', () => {
    expect(spendingNote('reported')).toBe(spendingNote('reported', false));
  });
});
