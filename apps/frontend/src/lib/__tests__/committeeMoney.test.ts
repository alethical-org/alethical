/**
 * The committee money page's rules, each test one way the page could show a
 * confident wrong sentence (#1442 phase 2; grounded-answers.md rule 12;
 * campaign-finance-system-design.md §7).
 */
import { describe, expect, it } from 'vitest';

import { reportedThroughLabel } from '../legislatorCampaignMoney';

import {
  CAP_NOTE,
  COMMITTEE_TAB_LABELS,
  committeeTabFromParam,
  committeeTabs,
  NO_PURPOSE_GIVEN,
  NO_VENDOR_NAMED,
  OUTSIDE_ABOUT_INTRO,
  OUTSIDE_NEVER_ADDED,
  OUTSIDE_SORT_LABELS,
  outsideCountLine,
  outsideCounterparty,
  outsidePaidLine,
  outsideRegistrationLine,
  outsideRowMeta,
  outsideSortFromParam,
  outsideStanceLabel,
  outsideUnpaidNote,
  type OutsideSpendingRowLike,
  FILED_REPORTS_LINK_LABEL,
  MONEY_IN_HEADING,
  MONEY_IN_NAMED_LABEL,
  MONEY_IN_REPORTED_LABEL,
  MONEY_IN_UNNAMED_LABEL,
  MONEY_OUT_HEADING,
  NAMED_DONATIONS_LINK_LABEL,
  NOT_A_DONATION_HEADING,
  PAYMENTS_OUT_LINK_LABEL,
  reportedThroughNote,
  stampThroughDate,
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
  listedExceedsReported,
  inKindDonationsNote,
  inKindOutNote,
  paymentRowHref,
  receivedPaymentRow,
  madePaymentRow,
  UNNAMED_PAYMENT_PARTY,
  statedSpendingNote,
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

  // All 6 of the Board's finer-kind codes, in its own words (#1694). Measured on
  // production 20 Aug 2026: 403 of 526 registered committees and funds carried a
  // documented code that read as the register's broad 3-way kind, against 17 spelled out.
  it('spells out all 6 of the Board\u2019s finer kind codes', () => {
    expect(committeeEyebrow('political_committee_or_fund', 'PC')).toBe('Political committee');
    expect(committeeEyebrow('political_committee_or_fund', 'PF')).toBe('Political fund');
    expect(committeeEyebrow('political_committee_or_fund', 'IEC')).toBe(
      'Independent-expenditure committee',
    );
    expect(committeeEyebrow('political_committee_or_fund', 'IEF')).toBe(
      'Independent-expenditure fund',
    );
    expect(committeeEyebrow('political_committee_or_fund', 'BC')).toBe('Ballot question committee');
    expect(committeeEyebrow('political_committee_or_fund', 'BF')).toBe('Ballot question fund');
  });

  // The Board documents none of these and the API withholds them, so nothing reaches the
  // label layer to expand. A guess here would invent a kind (#1661).
  it('never guesses at an undocumented code', () => {
    for (const code of ['PCN', 'PFN', 'BCN']) {
      expect(committeeEyebrow('political_committee_or_fund', code)).toBe(
        'Political committee or fund',
      );
    }
  });

  it('names the finer kind only where the register publishes one', () => {
    expect(committeeEyebrow('political_committee_or_fund', 'BC')).toBe('Ballot question committee');
    expect(committeeEyebrow('political_committee_or_fund', 'BF')).toBe('Ballot question fund');
    // 'PC' used to be pinned here as 'Political committee or fund', deliberately, back
    // when only the 2 ballot-question codes were expanded. Issue #1694 expands all 6, so
    // that pin now lives in the test above with the Board's own word for it.
    expect(committeeEyebrow('political_committee_or_fund', null)).toBe(
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

  describe('a printed name links to its own exact spelling (#1331)', () => {
    const donor = {
      contributor: 'Messinger, Alida',
      contributorRegistrationNumber: null,
      contributorType: 'Individual',
      amount: '1000.0000',
      receivedOn: '2026-06-15',
      receiptType: 'Contribution',
      inKind: 'No',
    };

    it('links a person under the spelling the filing printed, untouched', () => {
      const row = receivedPaymentRow(donor, new Set());
      expect(row.nameLink).toEqual({ role: 'contributor', name: 'Messinger, Alida' });
      // The exact address the navigation module builds for this screen. Pinned
      // literally so a change to either side fails rather than drifting.
      expect(paymentRowHref(row)).toBe('/money/payments?name=Messinger%2C+Alida&role=contributor');
    });

    it('does NOT join 2 spellings of one name, which is the whole ruling', () => {
      const withMiddle = receivedPaymentRow(
        { ...donor, contributor: 'Messinger, Alida R' },
        new Set(),
      );
      expect(paymentRowHref(receivedPaymentRow(donor, new Set()))).not.toBe(
        paymentRowHref(withMiddle),
      );
    });

    it('sends a registered filer to its committee page and never to a spelling', () => {
      const filer = {
        ...donor,
        contributor: 'Some Committee',
        contributorRegistrationNumber: '18272',
      };
      // Registered but no page held: still must not fall through to a name lookup,
      // because a registration number identifies a committee and a name does not.
      expect(receivedPaymentRow(filer, new Set()).nameLink).toBeNull();
      const linkable = receivedPaymentRow(filer, new Set(['18272']));
      expect(linkable.nameLink).toBeNull();
      expect(paymentRowHref(linkable)).toContain('/money/committees/');
    });

    it('never links the filing-names-nobody row, which is our sentence not a name', () => {
      const unnamed = receivedPaymentRow({ ...donor, contributor: null }, new Set());
      expect(unnamed.name).toBe(UNNAMED_PAYMENT_PARTY);
      expect(unnamed.nameLink).toBeNull();
      expect(paymentRowHref(unnamed)).toBeUndefined();
    });

    it('never links a blank or whitespace-only printed name', () => {
      for (const contributor of ['', '   ']) {
        expect(receivedPaymentRow({ ...donor, contributor }, new Set()).nameLink).toBeNull();
      }
    });

    const payment = {
      vendorName: 'Acme Printing',
      vendorCity: 'Saint Paul',
      vendorState: 'MN',
      affectedCommitteeName: null,
      affectedCommitteeRegistrationNumber: null,
      amount: '500.0000',
      paidOn: '2026-06-15',
      expenditureType: 'Independent Expenditure',
      purpose: 'Advertising',
      inKind: 'No',
    };

    it('links a vendor under the vendor column', () => {
      expect(madePaymentRow(payment, new Set()).nameLink).toEqual({
        role: 'vendor',
        name: 'Acme Printing',
      });
    });

    it('never sends a transfer to the vendor column, because the row shows a committee', () => {
      // A transfer's row prints the RECEIVING committee's name. Looking that up
      // among vendors asks a different question and would answer it confidently.
      const transfer = madePaymentRow(
        {
          ...payment,
          expenditureType: 'Contribution',
          affectedCommitteeName: 'Some Other Committee',
        },
        new Set(),
      );
      expect(transfer.name).toBe('Some Other Committee');
      expect(transfer.nameLink).toBeNull();
      expect(paymentRowHref(transfer)).toBeUndefined();
    });
  });

  it('the donated-goods sentence names the figure, never where it sits', () => {
    // 3 renderers were writing this 2 ways and one was wrong. On a legislator profile the
    // reported total draws ABOVE this line, and what draws below it is "Donations with
    // nobody's name on them" — a different figure — which only appears when the split is
    // shown, so on a withheld split "the total below" pointed at nothing at all.
    for (const namesTheChip of [true, false]) {
      const note = inKindDonationsNote('$19,899.45', namesTheChip);
      expect(note).toContain('$19,899.45');
      expect(note).toContain('goods and services rather than money');
      expect(note).toContain('separately from the reported total');
      // No positional word, on either surface, however either one is laid out later.
      for (const positional of ['below', 'above the', 'the total below', 'beneath']) {
        expect(note.toLowerCase()).not.toContain(positional);
      }
    }
  });

  it('the chip is named on 2 surfaces and not the third, and nothing else differs', () => {
    // Closing that gap would change what a profile reader sees, which is not this fix.
    const withChip = inKindDonationsNote('$1,000.00', true);
    const without = inKindDonationsNote('$1,000.00', false);
    expect(withChip).toContain('donated goods or services');
    expect(without).not.toContain('donated goods or services');
    // The claim itself is identical: strip the marker and the 2 are the same sentence.
    expect(withChip.replace(' (donated goods or services)', '')).toBe(without);
  });

  it('names the goods-and-services amount, and says nothing at all without one', () => {
    // The whole point of #1894: money in has said this since #1332 and money out
    // could only name the mechanism.
    const note = inKindOutNote('325.50');
    // Whole dollars with the cents cut (#1924): $325.50 prints as $325, never $326.
    expect(note).toContain('$325');
    expect(note).not.toContain('$325.50');
    expect(note).not.toContain('$326');
    expect(note).toContain('goods and services');
    expect(note).toContain('rather than money');

    // Nothing to say, and 2 different reasons for it. A committee-year we hold no
    // payment rows for sends no figure; one whose payments are all cash sends a
    // measured 0. Neither may print "$0.00" against a named politician, and 97
    // committee-years in the live release hold in-kind rows summing to exactly 0.
    expect(inKindOutNote(null)).toBeNull();
    expect(inKindOutNote(undefined)).toBeNull();
    expect(inKindOutNote('')).toBeNull();
    expect(inKindOutNote('0')).toBeNull();
    expect(inKindOutNote('0.0000')).toBeNull();
    expect(inKindOutNote('not a number')).toBeNull();
  });

  it('the goods-and-services line states an amount and explains no gap', () => {
    // In-kind fully accounts for the excess on 254 of the 389 committee-years where
    // our payment list is the larger figure, and not on the other 135. So this line
    // may never say it is why the 2 figures differ: that is a cause, right two-thirds
    // of the time, printed under a named person's photograph.
    const note = inKindOutNote('325.50') ?? '';
    for (const forbidden of [
      'why',
      'because',
      'explains',
      'accounts for',
      'the difference',
      'the gap',
      'disagree',
    ]) {
      expect(note.toLowerCase()).not.toContain(forbidden);
    }
    // And the sentence that DOES discuss the 2 figures still names no cause for the
    // gap, so adding this line did not let the pair of them make the claim jointly.
    expect(moneyOutNote('reported', false, true, false, true)).not.toContain('because of');
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
  // A ballot-question filer's threshold is $500 and everyone else's is $200: the
  // statute (10A.20 subd. 3(c)) attaches its figures to what the money is for rather
  // than to who files, and the Board's own Independent Expenditure and Ballot Question
  // handbook says $500 for these filers too. Each page states its OWN figure and never
  // the other, because the whole risk here is a reader taking one filer kind's line for
  // another's.
  it('states the threshold each filer kind actually carries, and never the other one', () => {
    const ordinary = recordCoverageLines(false);
    expect(ordinary).toHaveLength(4);
    // No terminal full stop on any coverage line (#1924): each stands on its own line.
    expect(ordinary[3]).toBe(
      'Donors who gave $200 or less in total for the year need not be named',
    );
    expect(ordinary.join(' ')).not.toContain('$500');

    const ballot = recordCoverageLines(true);
    expect(ballot).toHaveLength(4);
    expect(ballot[3]).toBe('Donors who gave $500 or less in total for the year need not be named');
    // The $200 line must not also appear here: 2 thresholds on one page is worse than
    // the silence this replaced.
    expect(ballot.join(' ')).not.toContain('$200');
  });

  // Ruled 1 Sep 2026 (#1924). Every line here stands on its own line, and a stack of
  // standalone lines takes no closing mark — a terminal full stop makes each read as
  // the opening of a paragraph that never arrives. This holds both threshold variants
  // as well as the 3 fixed lines.
  it('ends no coverage line with a full stop, in either threshold variant', () => {
    for (const lines of [recordCoverageLines(false), recordCoverageLines(true)]) {
      for (const line of lines) {
        expect(line.endsWith('.')).toBe(false);
      }
    }
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

  // This sentence has been wrong twice, in opposite directions, and both are pinned.
  // It first told readers "official sources disagree about that threshold for
  // ballot-question committees" — live on filer 60083's 2025 page beside $8,459.00 of
  // unnamed money — which is a claim about Minnesota's own records contradicting each
  // other that Minnesota's records do not support. It then printed no figure at all,
  // which was honest but told a reader less than Minnesota publishes. Eugene lifted the
  // ban on 31 Aug 2026, so it now names $500 and says what the $200 line is.
  it('names $500 and never blames Minnesota for disagreeing with itself', () => {
    const ballot = unnamedMoneyExplanation(true);
    expect(ballot).not.toMatch(/sources disagree/i);
    expect(ballot).not.toMatch(/do not agree/i);
    expect(ballot).toContain('$500');
    // The $200 appears only as the contrast, so the reader knows which line is theirs.
    expect(ballot).toContain('higher line than the $200');
    // The 2 rules the figure carries with it, same as the $200 one (#1755): a yearly
    // total rather than a per-gift cut-off, and a floor rather than a bar.
    expect(ballot).toContain('in total for the year');
    expect(ballot).toContain('may name a smaller donor but');
    // And it still says what is true about this money.
    expect(ballot).toContain('does not say who gave them');
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

describe('money out never blames the naming threshold for a list that is bigger', () => {
  // The shipped defect: our listable payments total can EXCEED the committee's own
  // reported total, and the note blamed the $200 naming threshold, which can only ever
  // hold payments back and so can only make our list smaller. Measured on Lisa Demuth's
  // Governor committee for 2025: our list $60,286.21 against the filing's $41,331.05,
  // $18,955.16 larger, with the false sentence under it on a live page. Across every
  // filer-year where a reader sees both figures, 389 of 3,613 are in that shape, and 25
  // of those sit on a committee confirmed for a sitting legislator.
  it('drops the threshold-only explanation when our list is the larger figure', () => {
    const note = moneyOutNote('reported', false, true, false, true);
    expect(note).toContain('can disagree in either direction');
    expect(note).toContain('goods and services');
    expect(note).not.toContain('The total above is the filing’s own figure');
  });

  it('keeps the threshold explanation when the filing is the larger figure', () => {
    const note = moneyOutNote('reported', false, true, false, false);
    expect(note).toContain('The total above is the filing’s own figure');
    expect(note).toContain('$200');
    expect(note).not.toContain('can disagree in either direction');
  });

  // In-kind explains 254 of the 389, which is most and not all, so the sentence names the
  // mechanism and never claims it explains THIS committee's gap. Naming a cause that is
  // right 254 times out of 389 on a named person's page is the same failure in a new coat.
  it('names the mechanism without claiming it explains this committee', () => {
    const note = moneyOutNote('reported', false, true, false, true);
    expect(note).not.toMatch(/because this committee|the difference is|accounts for/i);
    expect(note).toContain('we never subtract one from the other');
  });

  it('compares the 2 figures and never subtracts them', () => {
    expect(listedExceedsReported('41331.05', '60286.21')).toBe(true);
    expect(listedExceedsReported('60286.21', '41331.05')).toBe(false);
    expect(listedExceedsReported('100.00', '100.00')).toBe(false);
  });

  // A missing figure on either side must never produce a claim about a gap. This is the
  // missing-versus-zero rule applied to a comparison rather than to a figure.
  it('says nothing about a gap when either figure is missing', () => {
    expect(listedExceedsReported(null, '60286.21')).toBe(false);
    expect(listedExceedsReported('41331.05', null)).toBe(false);
    expect(listedExceedsReported('', '60286.21')).toBe(false);
    expect(listedExceedsReported(undefined, undefined)).toBe(false);
    expect(listedExceedsReported('not a number', '60286.21')).toBe(false);
  });
});

describe('whether anybody checked this committee\u2019s money out against its own filing', () => {
  // Every one of these is a way the money-out card could tell a reader a figure was
  // checked when it was not, or explain away a gap the check has already disproved
  // (#1650; grounded-answers.md rule 12).

  it('says nothing when the filing and our rows agree, so a checked year draws plainly', () => {
    expect(statedSpendingNote('agrees')).toBeNull();
  });

  it('says the 2 official figures were compared and do not agree', () => {
    const note = statedSpendingNote('disagrees') ?? '';
    expect(note).toContain('do not');
    expect(note).toContain('agree');
    // It must not repeat the unchecked caveat: we did compare it.
    expect(note).not.toContain('have not yet compared');
  });

  it('never says which of the 2 figures is the larger one', () => {
    // The 208 disagreements in the live release run both ways, 168 of them ours being
    // larger, so any wording that picks a side is wrong about a third of the time.
    const note = (statedSpendingNote('disagrees') ?? '').toLowerCase();
    for (const side of ['more than', 'less than', 'larger', 'smaller', 'short of', 'missing']) {
      expect(note).not.toContain(side);
    }
  });

  it('never claims a cause for a disagreement it cannot explain', () => {
    // The $200 naming threshold and goods and services are the card's 2 ordinary
    // reasons for a gap, and neither survives a filing whose own itemized subtotal
    // disagrees. Naming one here would be the reassurance the check disproved.
    const note = statedSpendingNote('disagrees') ?? '';
    expect(note).not.toContain('$200');
    expect(note).not.toContain('goods and services');
  });

  it.each(['not_checked', 'reader_unproven', 'not_run', null, undefined, ''])(
    'warns that the filing may name payments our copy is missing when the state is %s',
    (state) => {
      const note = statedSpendingNote(state) ?? '';
      expect(note).toContain('have not yet compared');
      expect(note).toContain('missing');
    },
  );

  it('never lets an unverdicted state read like an agreement', () => {
    for (const state of ['not_checked', 'reader_unproven', 'not_run']) {
      expect(statedSpendingNote(state)).not.toBeNull();
    }
  });
});

describe('the 2 money cards’ fixed labels, shared by both surfaces', () => {
  it('names the 8-element inventory in the words the design ruled', () => {
    expect(MONEY_IN_HEADING).toBe('Money in');
    expect(MONEY_OUT_HEADING).toBe('Money out');
    expect(MONEY_IN_REPORTED_LABEL).toBe('Donations this committee reported to the state');
    expect(MONEY_IN_NAMED_LABEL).toBe('Donations with a donor’s name');
    expect(MONEY_IN_UNNAMED_LABEL).toBe('Donations with nobody’s name on them');
    // Ruled 2 Sep 2026: the card heading 2 elements above already says "Money in", and
    // the rows show that each is reported on its own line.
    expect(NOT_A_DONATION_HEADING).toBe('Not a donation');
    expect(NAMED_DONATIONS_LINK_LABEL).toBe('Minnesota’s list of named donations');
    expect(PAYMENTS_OUT_LINK_LABEL).toBe('Minnesota’s list of payments out');
    expect(FILED_REPORTS_LINK_LABEL).toBe(
      'This committee’s filed reports, on the state’s own site',
    );
  });

  it('never calls money out spent, spending or expenses', () => {
    for (const label of [
      MONEY_OUT_HEADING,
      MONEY_OUT_FIGURE_LABEL,
      MONEY_OUT_REPORTED_LABEL,
      PAYMENTS_OUT_LINK_LABEL,
    ]) {
      expect(label).not.toMatch(/spen[dt]|expense/i);
    }
  });

  it('ends no label with a full stop: these are standalone lines, not prose', () => {
    for (const label of [
      MONEY_IN_REPORTED_LABEL,
      MONEY_IN_NAMED_LABEL,
      MONEY_IN_UNNAMED_LABEL,
      NOT_A_DONATION_HEADING,
      NAMED_DONATIONS_LINK_LABEL,
      PAYMENTS_OUT_LINK_LABEL,
      FILED_REPORTS_LINK_LABEL,
    ]) {
      expect(label.endsWith('.')).toBe(false);
    }
  });
});

describe('the filing stamp states the period once, above both cards', () => {
  it('takes money in’s coverage date, and falls back to money out’s', () => {
    expect(
      stampThroughDate({ reportedThrough: '2026-07-20' }, { reportedThrough: '2026-07-20' }),
    ).toBe('2026-07-20');
    expect(stampThroughDate({ reportedThrough: null }, { reportedThrough: '2026-07-20' })).toBe(
      '2026-07-20',
    );
    expect(stampThroughDate({ reportedThrough: null }, null)).toBeNull();
  });

  it('a figure carries its own period note only where its date differs from the stamp’s', () => {
    // The ordinary case: one filing, one date, stated once in the stamp.
    expect(reportedThroughNote('2026-07-20', '2026-07-20')).toBeNull();
    // A figure whose report runs to a different day says so, or the stamp's date would
    // be wrong about it (rule 12: every total states the period it covers).
    expect(reportedThroughNote('2026-03-31', '2026-07-20')).toBe(
      reportedThroughLabel('2026-03-31'),
    );
    expect(reportedThroughNote(null, '2026-07-20')).toBeNull();
  });
});

describe('the 2 outside-spending tabs', () => {
  const row: OutsideSpendingRowLike = {
    spender: 'Working Families Alliance Fund',
    spenderRegistrationNumber: '41207',
    spenderInRegister: true,
    spenderLinkable: true,
    aboutCommitteeName: 'Neighbors for Chen',
    aboutCommitteeRegistrationNumber: '30622',
    aboutCommitteeInRegister: true,
    aboutCommitteeLinkable: true,
    direction: 'Against',
    purpose: 'Advertising - Print: Direct Mail',
    vendorName: 'Great North Media LLC',
    expenditureType: 'Independent Expenditure',
    inKind: false,
    paidOn: '2026-08-03',
    amount: '148500.0000',
    unpaidAmount: '0.0000',
  };

  it('carries the 2 ruled labels, the one place this section says "spent"', () => {
    expect(COMMITTEE_TAB_LABELS.about).toBe('Spent about them');
    expect(COMMITTEE_TAB_LABELS.by).toBe('Spent by them');
    expect(committeeTabFromParam('about')).toBe('about');
    expect(committeeTabFromParam('by')).toBe('by');
    expect(committeeTabFromParam('nonsense')).toBe('gave');
  });

  it('a tab follows the filer’s own rows in that direction, never its kind', () => {
    expect(committeeTabs({ spentAbout: false, spentBy: false })).toEqual([
      'gave',
      'spent',
      'filings',
    ]);
    expect(committeeTabs({ spentAbout: true, spentBy: false })).toEqual([
      'gave',
      'spent',
      'filings',
      'about',
    ]);
    // A caucus committee: spends about others, nobody spends about it.
    expect(committeeTabs({ spentAbout: false, spentBy: true })).toEqual([
      'gave',
      'spent',
      'filings',
      'by',
    ]);
  });

  it('sorts newest first by default, and names both sorts', () => {
    expect(outsideSortFromParam(undefined)).toBe('newest');
    expect(outsideSortFromParam('largest')).toBe('largest');
    expect(OUTSIDE_SORT_LABELS.newest).toBe('Newest first');
    expect(OUTSIDE_SORT_LABELS.largest).toBe('Largest first');
  });

  it('counts payments and the other side, singular where 1, capped while cut, never "named"', () => {
    expect(outsideCountLine('by', 12, 12, 5)).toBe('12 payments about 5 committees');
    expect(outsideCountLine('by', 1, 1, 1)).toBe('1 payment about 1 committee');
    expect(outsideCountLine('about', 5, 5, 5)).toBe('5 payments by 5 groups');
    expect(outsideCountLine('about', 1, 1, 1)).toBe('1 payment by 1 group');
    expect(outsideCountLine('about', 6, 12, 5)).toBe('Showing 6 of 12 payments');
    expect(outsideCountLine('by', 50, 1284, 40)).toBe('Showing 50 of 1,284 payments');
    expect(outsideCountLine('by', 0, null, null)).toBeNull();
    for (const line of [outsideCountLine('by', 12, 12, 5), outsideCountLine('about', 6, 12, 5)]) {
      expect(line).not.toContain('named');
      expect(line?.endsWith('.')).toBe(false);
    }
  });

  it('prints the filing’s own For or Against as a chip, filled on every row', () => {
    expect(outsideStanceLabel('For')).toBe('Supporting');
    expect(outsideStanceLabel('Against')).toBe('Opposing');
    expect(outsideStanceLabel('not recorded')).toBe('Direction not recorded');
  });

  it('the other side is the spender on one tab and the committee spent about on the other', () => {
    expect(outsideCounterparty('about', row)).toEqual({
      name: 'Working Families Alliance Fund',
      registrationNumber: '41207',
      linkable: true,
      inRegister: true,
    });
    expect(outsideCounterparty('by', row).name).toBe('Neighbors for Chen');
    expect(outsideCounterparty('by', row).registrationNumber).toBe('30622');
  });

  it('a number our copy of the register lacks prints the register line in its place', () => {
    expect(outsideRegistrationLine(outsideCounterparty('about', row))).toBe('REG 41207');
    expect(
      outsideRegistrationLine({
        name: 'Somebody',
        registrationNumber: '-102',
        linkable: false,
        inRegister: false,
      }),
    ).toBe(NOT_IN_REGISTER_LINE);
    expect(
      outsideRegistrationLine({
        name: 'Somebody',
        registrationNumber: null,
        linkable: false,
        inRegister: false,
      }),
    ).toBe(NOT_IN_REGISTER_LINE);
  });

  it('purpose and vendor each keep their position, with a designed empty state', () => {
    expect(outsideRowMeta(row)).toBe(
      'Advertising - Print: Direct Mail · paid to Great North Media LLC · Independent Expenditure',
    );
    expect(outsideRowMeta({ ...row, purpose: null })).toBe(
      `${NO_PURPOSE_GIVEN} · paid to Great North Media LLC · Independent Expenditure`,
    );
    expect(outsideRowMeta({ ...row, vendorName: null, expenditureType: null })).toBe(
      `Advertising - Print: Direct Mail · ${NO_VENDOR_NAMED}`,
    );
    // The file's own trailing space ("Nuntius Borealis ") never reaches the separator,
    // and a blank-only value is the empty state rather than a name.
    expect(outsideRowMeta({ ...row, vendorName: 'Nuntius Borealis ' })).toContain(
      'paid to Nuntius Borealis · Independent',
    );
    expect(outsideRowMeta({ ...row, purpose: '  ' })).toContain(NO_PURPOSE_GIVEN);
    expect(NO_PURPOSE_GIVEN.endsWith('.')).toBe(false);
    expect(NO_VENDOR_NAMED.endsWith('.')).toBe(false);
  });

  it('dates the row itself and names any unpaid part under the amount', () => {
    expect(outsidePaidLine('2026-08-03')).toBe('Paid 3 Aug 2026');
    expect(outsidePaidLine(null)).toBeNull();
    expect(outsideUnpaidNote('2000.0000')).toBe('$2,000 of it unpaid');
    expect(outsideUnpaidNote('0.0000')).toBeNull();
    expect(outsideUnpaidNote(null)).toBeNull();
  });

  it('keeps the never-added sentence verbatim, with its 491', () => {
    expect(OUTSIDE_NEVER_ADDED).toBe(
      'This is the independent-spending file, and it is never added to the ordinary ' +
        'expenditures file: 491 rows share a spender, name, amount and date with an ' +
        'expenditure row, and whether that is one payment filed twice or 2 that coincide ' +
        'is not established.',
    );
    expect(OUTSIDE_ABOUT_INTRO).toContain('neither received nor controlled');
  });
});
