/**
 * The committee money page's rules, each test one way the page could show a
 * confident wrong sentence (#1442 phase 2; grounded-answers.md rule 12;
 * campaign-finance-system-design.md §7).
 */
import { describe, expect, it } from 'vitest';

import {
  CAP_NOTE,
  CLOSED_MONEY_OUT_WHY,
  EMPTY_YEAR_MONEY_OUT_WHY,
  NOT_IN_REGISTER_LINE,
  ZERO_REPORTED_NOTE,
  capNextLabel,
  closedChipLabel,
  closedPeriodDetail,
  closedPeriodLine,
  committeeEyebrow,
  committeeSlug,
  confirmedMemberLinkLabel,
  confirmedMemberMoneyPath,
  coveredPeriodDetail,
  coveredPeriodLine,
  emptyListTitle,
  emptyListWhy,
  isBallotQuestionFiler,
  isInKind,
  listLinkNote,
  madeRowMeta,
  MONEY_OUT_FIGURE_LABEL,
  MONEY_OUT_REPORTED_LABEL,
  moneyOutKindLabel,
  moneyOutNote,
  notFoundBody,
  notFoundTitle,
  paymentsEyebrow,
  paymentsTabFromParam,
  paymentsTitle,
  receivedRowMeta,
  recordCoverageLines,
  unnamedMoneyExplanation,
  registeredForLine,
  registerKindLabel,
  registrationNumberFromSlug,
  showingLine,
  staleHoldNote,
  uncoveredPeriodDetail,
  uncoveredPeriodLine,
  whoseCommitteeText,
} from '../committeeMoney';

describe('the address', () => {
  it('builds name-then-number and resolves only the number', () => {
    expect(committeeSlug('Aguirre-Bell, Marisol Senate Committee', '30412')).toBe(
      'aguirre-bell-marisol-senate-committee-30412',
    );
    expect(registrationNumberFromSlug('aguirre-bell-marisol-senate-committee-30412')).toBe('30412');
  });

  it('lands a misspelled or outdated name part on the same page', () => {
    expect(registrationNumberFromSlug('agire-bel-old-name-30412')).toBe('30412');
    expect(registrationNumberFromSlug('30412')).toBe('30412');
  });

  it('an address with no number resolves to nothing', () => {
    expect(registrationNumberFromSlug('aguirre-bell')).toBeNull();
    expect(registrationNumberFromSlug('')).toBeNull();
  });

  it('a nameless committee still gets an address from its number alone', () => {
    expect(committeeSlug(null, '60083')).toBe('60083');
  });
});

describe('the register-driven header', () => {
  it('prints only the register’s own 3 kind labels', () => {
    expect(registerKindLabel('candidate_committee')).toBe('Candidate committee');
    expect(registerKindLabel('party_unit')).toBe('Party unit');
    expect(registerKindLabel('political_committee_or_fund')).toBe('Political committee or fund');
    // An unknown kind is nothing, never a guess.
    expect(registerKindLabel('super_pac')).toBeNull();
  });

  it('names the finer kind only where the register publishes one', () => {
    expect(committeeEyebrow('political_committee_or_fund', 'BC')).toBe('Ballot question committee');
    expect(committeeEyebrow('political_committee_or_fund', 'BF')).toBe('Ballot question fund');
    expect(committeeEyebrow('political_committee_or_fund', 'PC')).toBe(
      'Political committee or fund',
    );
    expect(isBallotQuestionFiler('BC')).toBe(true);
    expect(isBallotQuestionFiler('PF')).toBe(false);
  });

  // The 2 party layers Minnesota publishes (#1661 §2, served by #1768). This
  // assertion used to pin 'Party unit' for a CAU filer, deliberately, back when
  // the layer codes were dropped before reaching the frontend. They are served
  // now, so printing the coarser kind hid a fact the register states, and
  // contradicted whoseCommitteeText on the same page.
  it('names the party layer for the 2 codes the register carries', () => {
    expect(committeeEyebrow('party_unit', 'CAU')).toBe('Legislative caucus');
    expect(committeeEyebrow('party_unit', 'SPU')).toBe('State party committee');
    expect(committeeEyebrow('party_unit', null)).toBe('Party unit');
    expect(committeeEyebrow('party_unit', 'ZZZ')).toBe('Party unit');
  });

  // The layer is a party-unit fact. #1768 measured that 0 candidate committees
  // and 0 political committees or funds carry either code on the live register,
  // so a filer of another kind carrying one is data we have never seen, and the
  // register's own kind is the honest answer rather than a party label.
  it('never reads a party layer off a filer that is not a party unit', () => {
    expect(committeeEyebrow('political_committee_or_fund', 'CAU')).toBe(
      'Political committee or fund',
    );
    expect(committeeEyebrow('candidate_committee', 'SPU')).toBe('Candidate committee');
  });

  it('says what a candidate committee registered for, from the register', () => {
    expect(
      registeredForLine({ kind: 'candidate_committee', office: 'House', district: '30B' }),
    ).toBe('Registered for House District 30B');
    expect(
      registeredForLine({ kind: 'candidate_committee', office: 'Governor', district: null }),
    ).toBe('Registered for Governor');
    expect(
      registeredForLine({ kind: 'candidate_committee', office: 'District Court', district: '2-8' }),
    ).toBe('Registered for District Court · District 2-8');
  });

  it('states the kind as registered for everyone else, never an expansion', () => {
    expect(
      registeredForLine({ kind: 'political_committee_or_fund', office: null, district: null }),
    ).toBe('Kind as registered: political committee or fund');
    expect(registeredForLine({ kind: 'party_unit', office: null, district: null })).toBe(
      'Kind as registered: party unit',
    );
  });

  it('the closed chip carries the register’s own date', () => {
    expect(closedChipLabel('2026-07-28')).toBe('Closed 28 Jul 2026');
    expect(closedChipLabel(null)).toBeNull();
  });
});

describe('whose committee', () => {
  const HORTMAN = { slug: 'melissa-hortman', fullName: 'Melissa Hortman' };

  it('a party unit and a fund never imply a person is missing', () => {
    expect(whoseCommitteeText('party_unit', null, null)).toContain('not a candidate’s committee');
    expect(whoseCommitteeText('party_unit', 'CAU', null)).toContain('caucus');
    expect(whoseCommitteeText('political_committee_or_fund', 'PC', null)).toContain('fund');
    expect(whoseCommitteeText('political_committee_or_fund', 'BC', null)).toContain('ballot');
  });

  it('a candidate committee’s filed name is never treated as a confirmation', () => {
    const text = whoseCommitteeText('candidate_committee', null, null);
    expect(text).toContain('not a confirmation');
    expect(text).not.toContain('confirmed');
  });

  // The state this page could not describe until #1680: a person read Minnesota's
  // records and wrote down whose committee this is.
  it('a confirmed committee names the member and says a person decided it', () => {
    const text = whoseCommitteeText('candidate_committee', null, HORTMAN);
    expect(text).toContain('Melissa Hortman’s');
    // Design §5.1: no score, threshold or rule ever produces a link, so the
    // sentence has to carry the person, not just the word "confirmed". A bare
    // "Confirmed" reads as our software having matched a name.
    expect(text).toContain('Someone at Alethical');
    expect(text).toContain('a decision a person made and signed');
    // And the filed name is still never the evidence.
    expect(text).toContain('on the strength of its filed name');
  });

  // #1663: 20 candidates hold more than one committee, and 2 of them would have
  // 100% of a combined figure be the same money twice. The arithmetic guard is that
  // issue's; this is the sentence's half, and "the committee of X" is what it bans.
  it('a confirmed committee never claims to be the member’s only one', () => {
    const text = whoseCommitteeText('candidate_committee', null, HORTMAN);
    expect(text).toContain('a candidate can register more than one committee');
    expect(text).toContain('this committee’s own record');
    expect(text).not.toContain('the committee of');
  });

  // A rejection is a decision about our own proposal and never a reader-facing claim
  // about the committee (§7), so it reaches this function as no confirmation at all
  // and the page keeps the words it already had. The route is what proves a stored
  // rejection arrives as null (alethical/tests/test_committee_page_reads.py).
  it('reviewed-and-none-confirmed reads exactly as nobody-has-looked', () => {
    expect(whoseCommitteeText('candidate_committee', null, null)).toBe(
      whoseCommitteeText('candidate_committee', null, null),
    );
    expect(whoseCommitteeText('candidate_committee', null, null)).not.toContain(
      'Someone at Alethical',
    );
  });

  it('the link out names the member and lands on their money', () => {
    expect(confirmedMemberLinkLabel('Melissa Hortman')).toBe(
      'See Melissa Hortman’s campaign money',
    );
    expect(confirmedMemberMoneyPath('melissa-hortman')).toBe(
      '/legislators/melissa-hortman?tab=money',
    );
  });
});

describe('the period stamp', () => {
  it('states the coverage end and never assumes a start', () => {
    expect(coveredPeriodLine('2026-07-20')).toBe('Figures through 20 Jul 2026');
    const detail = coveredPeriodDetail('2026-07-20', 'Aug 11, 2026');
    expect(detail).toContain('covers through 20 Jul 2026');
    expect(detail).toContain('no start is assumed');
    expect(detail).toContain('taken Aug 11, 2026');
    expect(detail).not.toContain('Jan 1');
  });

  it('shows both ends only when the Board’s own calendar prints the start', () => {
    expect(coveredPeriodLine('2026-07-20', '2026-01-01')).toBe(
      'Figures for 1 Jan 2026 – 20 Jul 2026',
    );
    const detail = coveredPeriodDetail('2026-07-20', 'Aug 11, 2026', {
      reportedPeriodStart: '2026-01-01',
    });
    expect(detail).toContain('covers 1 Jan 2026 through 20 Jul 2026');
    expect(detail).toContain('the Board’s own published filing calendar');
    // No printed start, no start — never an assumed January.
    expect(coveredPeriodLine('2026-11-16', null)).toBe('Figures through 16 Nov 2026');
  });

  it('a party unit’s stamp says its calendar is its own', () => {
    expect(coveredPeriodDetail('2026-03-31', 'Aug 11, 2026', { isPartyUnit: true })).toContain(
      'party-unit series',
    );
  });

  it('an uncovered year says no figures cover it, not that nothing happened', () => {
    expect(uncoveredPeriodLine(2026)).toBe('No figures cover 2026');
    const detail = uncoveredPeriodDetail(2026, 'Aug 11, 2026');
    expect(detail).toContain('carry no report figures covering 2026');
    expect(detail).toContain('do not carry an earlier year’s money forward');
  });

  it('a closed committee’s stamp carries the termination date and the final report', () => {
    expect(closedPeriodLine('2026-07-28')).toBe('Committee closed 28 Jul 2026');
    const detail = closedPeriodDetail('2026-07-28', 'Aug 11, 2026');
    expect(detail).toContain('terminated on 28 Jul 2026');
    expect(detail).toContain('final report');
    // Never "nothing is on record": the final report exists and is public.
    expect(detail).not.toContain('nothing is on record');
  });

  it('held figures say they are held until the service answers, never timed out', () => {
    const note = staleHoldNote('Aug 11, 2026');
    expect(note).toContain('last figures we accepted');
    expect(note).toContain('held until it answers');
  });
});

describe('the not-found state', () => {
  it('is a fact about our records, never that the committee does not exist', () => {
    expect(notFoundTitle()).toBe('This number isn’t in the register we hold');
    const body = notFoundBody('99999');
    expect(body).toContain('99999');
    expect(body).toContain('our records');
    expect(body).not.toContain('does not exist');
  });
});

describe('money out', () => {
  it('is never labelled spent, spending or expenses', () => {
    expect(MONEY_OUT_FIGURE_LABEL).toBe('Payments we can list');
    for (const sentence of [
      MONEY_OUT_FIGURE_LABEL,
      CLOSED_MONEY_OUT_WHY,
      EMPTY_YEAR_MONEY_OUT_WHY,
    ]) {
      expect(sentence.toLowerCase()).not.toContain('spent');
      expect(sentence.toLowerCase()).not.toContain('spending');
      expect(sentence.toLowerCase()).not.toContain('expense');
    }
  });

  it('its note drops every threshold figure on a ballot-question page', () => {
    expect(moneyOutNote('reported', false)).toContain('$200');
    expect(moneyOutNote('reported', true)).not.toContain('$200');
    expect(moneyOutNote('not_reported', true)).not.toContain('$200');
    expect(moneyOutNote('not_reported', true)).not.toContain('$500');
    expect(moneyOutNote('reported', true, true)).not.toContain('$200');
  });

  it('a filing’s own zero paid out never gets "does not mean it paid out nothing"', () => {
    const note = moneyOutNote('not_reported', true, true, true);
    expect(note).toContain('says it paid out nothing');
    expect(note).not.toContain('does not mean');
    // A real total beside an empty payments file says which claim is whose.
    expect(moneyOutNote('not_reported', false, true, false)).toContain(
      'names none of its payments',
    );
  });

  it('with the filing’s own total on screen, the note explains two figures and no subtraction', () => {
    const note = moneyOutNote('reported', false, true);
    expect(note).toContain('the filing’s own figure');
    expect(note).toContain('do not subtract');
    expect(MONEY_OUT_REPORTED_LABEL.toLowerCase()).not.toContain('spent');
    // Without one, the note owns the gap as ours rather than claiming Minnesota
    // publishes no such total — it does, and our copy can simply lack a year.
    expect(moneyOutNote('reported', false, false)).toContain('Our copy');
  });

  it('a Contribution-typed payment out is money given to another campaign', () => {
    expect(moneyOutKindLabel('Contribution')).toBe('Given to other campaigns');
    // Every other label is the source's own, verbatim.
    expect(moneyOutKindLabel('General Expenditure')).toBe('General Expenditure');
    expect(moneyOutKindLabel('Non-Campaign Disbursement')).toBe('Non-Campaign Disbursement');
  });
});

describe('the payments view', () => {
  it('names its tabs and titles for what they list', () => {
    expect(paymentsTabFromParam('spent')).toBe('spent');
    expect(paymentsTabFromParam(undefined)).toBe('gave');
    expect(paymentsTitle('gave')).toBe('Who gave to this committee');
    expect(paymentsTitle('spent')).toBe('Where this committee’s money went');
    expect(paymentsEyebrow('gave')).toBe('Every donor named');
  });

  it('says how much of the population is showing, from a measured count', () => {
    expect(showingLine(250, 1284)).toBe('Showing 250 of 1,284 payments named');
    expect(showingLine(41, 41)).toBe('41 payments named in this period');
    expect(showingLine(1, 1)).toBe('1 payment named in this period');
    // No served count, no claim.
    expect(showingLine(50, null)).toBeNull();
  });

  it('owns its cap in plain words', () => {
    expect(CAP_NOTE).toContain('the cap is ours, not the filing’s');
    expect(capNextLabel(250, 1284)).toBe('Show the next 250');
    expect(capNextLabel(1250, 1284)).toBe('Show the next 34');
  });

  it('the link note drops the threshold sentence on a ballot-question page', () => {
    // The ordinary note names the threshold as the point a name becomes REQUIRED,
    // rather than as a line below which nobody is named (#1755).
    expect(listLinkNote('gave', false)).toContain('more than $200 in total for the year');
    expect(listLinkNote('gave', true)).not.toContain('$200');
    expect(listLinkNote('spent', true)).not.toContain('$200');
  });

  it('an empty year’s list says which year, and that older payments stay put', () => {
    expect(emptyListTitle('gave', 2026)).toBe('No donors named for 2026');
    expect(emptyListTitle('spent', 2026)).toBe('No payments named for 2026');
    expect(emptyListWhy(2026)).toContain('we do not show them under a 2026 heading');
  });
});

describe('payment rows', () => {
  it('a loan under "who gave" carries its schedule label, never reads as a gift', () => {
    expect(
      receivedRowMeta({ contributorType: 'Self', receiptType: 'Loan Payable', inKind: 'No' }),
    ).toBe('Self · Loan Payable — reported on its own schedule, not a donation');
    expect(
      receivedRowMeta({ contributorType: 'Individual', receiptType: 'Contribution', inKind: 'No' }),
    ).toBe('Individual');
  });

  it('a transfer out is named in plain words; a vendor row keeps the filing’s purpose', () => {
    expect(
      madeRowMeta({
        expenditureType: 'Contribution',
        purpose: null,
        vendorCity: null,
        vendorState: null,
        inKind: 'No',
      }),
    ).toBe('Money given to another campaign');
    expect(
      madeRowMeta({
        expenditureType: 'Campaign Expenditure',
        purpose: 'Printing and postage',
        vendorCity: 'Saint Paul',
        vendorState: 'MN',
        inKind: 'No',
      }),
    ).toBe('Printing and postage · Saint Paul, MN');
  });

  it('donated goods and services get a marker and stay inside the totals', () => {
    expect(isInKind('Yes')).toBe(true);
    expect(isInKind('No')).toBe(false);
    expect(isInKind(null)).toBe(false);
  });
});

describe('a verified zero and an unregistered number', () => {
  it('a reported zero is the filing’s own zero, never a gap', () => {
    expect(ZERO_REPORTED_NOTE).toContain('says it raised nothing');
    expect(ZERO_REPORTED_NOTE).toContain('not a gap');
  });

  it('a number missing from our register copy is stated as our copy’s fact', () => {
    expect(NOT_IN_REGISTER_LINE).toContain('our copy');
  });
});

describe('the record-coverage block', () => {
  it('drops the threshold line on a ballot-question page and keeps the rest', () => {
    const ordinary = recordCoverageLines(false);
    expect(ordinary).toHaveLength(4);
    expect(ordinary[3]).toBe(
      'Donors who gave $200 or less in total for the year need not be named.',
    );
    const ballot = recordCoverageLines(true);
    expect(ballot).toHaveLength(3);
    expect(ballot.join(' ')).not.toContain('$200');
  });

  // The $200 test is a floor on who a committee MUST name, never a ban on naming
  // anyone smaller. The statute's own words are that a contributor "must then be
  // listed" once the aggregate exceeds the threshold, and filer 18135's 2026
  // pre-general itemizes 215 donors at or under $200 and reconciles to the cent
  // (campaign-finance-system-design.md §2.3), so the absolute was false about a real
  // filing a reader can open (#1755).
  it('never tells a reader that a small donor or recipient is not named', () => {
    for (const lines of [recordCoverageLines(false), recordCoverageLines(true)]) {
      expect(lines.join(' ')).not.toContain('never named');
    }
    for (const isBallot of [false, true]) {
      expect(unnamedMoneyExplanation(isBallot)).not.toContain('never named');
      for (const tab of ['gave', 'spent'] as const) {
        expect(listLinkNote(tab, isBallot)).not.toContain('never named');
      }
    }
  });
});

describe('the money-out threshold sentence describes a yearly total, never a per-payment cut-off', () => {
  // grounded-answers rule 12: "Minnesota only publishes payments over $200" was live on
  // production on both money surfaces. It reads as a rule about the size of a single
  // payment. The real rule is a test on what one recipient was paid across the year, and
  // most named payments are individually under $200, so the per-payment phrasing tells a
  // reader the opposite of the truth about which payments are missing.
  const forbidden = /(publishes|names)\s+(a committee’s\s+)?payments\s+over\s+\$200/i;

  it('never phrases the threshold as a per-payment rule', () => {
    for (const state of ['reported', 'not_reported', 'unavailable'] as const) {
      expect(moneyOutNote(state, false)).not.toMatch(forbidden);
      expect(moneyOutNote(state, true)).not.toMatch(forbidden);
    }
  });

  it('says the threshold is a total for the year, per recipient', () => {
    expect(moneyOutNote('reported', false)).toContain(
      'once payments to them pass $200 in total for the year',
    );
  });

  it('still prints no threshold figure at all on a ballot-question page', () => {
    expect(moneyOutNote('reported', true)).not.toContain('$200');
  });
});
