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
  coveredPeriodDetail,
  coveredPeriodLine,
  emptyListTitle,
  emptyListWhy,
  isBallotQuestionFiler,
  isInKind,
  listLinkNote,
  madeRowMeta,
  MONEY_OUT_FIGURE_LABEL,
  moneyOutKindLabel,
  moneyOutNote,
  notFoundBody,
  notFoundTitle,
  paymentsEyebrow,
  paymentsTabFromParam,
  paymentsTitle,
  receivedRowMeta,
  recordCoverageLines,
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

  it('the ballot sub-type codes name the finer kind; nothing else does', () => {
    expect(committeeEyebrow('political_committee_or_fund', 'BC')).toBe('Ballot question committee');
    expect(committeeEyebrow('political_committee_or_fund', 'BF')).toBe('Ballot question fund');
    expect(committeeEyebrow('political_committee_or_fund', 'PC')).toBe(
      'Political committee or fund',
    );
    expect(committeeEyebrow('party_unit', 'CAU')).toBe('Party unit');
    expect(isBallotQuestionFiler('BC')).toBe(true);
    expect(isBallotQuestionFiler('PF')).toBe(false);
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
  it('a party unit and a fund never imply a person is missing', () => {
    expect(whoseCommitteeText('party_unit', null)).toContain('not a candidate’s committee');
    expect(whoseCommitteeText('party_unit', 'CAU')).toContain('caucus');
    expect(whoseCommitteeText('political_committee_or_fund', 'PC')).toContain('fund');
    expect(whoseCommitteeText('political_committee_or_fund', 'BC')).toContain('ballot');
  });

  it('a candidate committee’s filed name is never treated as a confirmation', () => {
    const text = whoseCommitteeText('candidate_committee', null);
    expect(text).toContain('not a confirmation');
    expect(text).not.toContain('confirmed');
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
    expect(listLinkNote('gave', false)).toContain('$200 or less');
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
    expect(ordinary[3]).toBe('Donors who gave $200 or less in total for the year are never named.');
    const ballot = recordCoverageLines(true);
    expect(ballot).toHaveLength(3);
    expect(ballot.join(' ')).not.toContain('$200');
  });
});
