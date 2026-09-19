/**
 * The outside-spending record page's rules (#1945; grounded-answers.md rules 3, 5
 * and 12). Each test is one way the page could total across subjects, name a
 * person no filing names, print a zero for an absence, or retype a ruled string.
 */
import { describe, expect, it } from 'vitest';

import {
  ALL_YEARS,
  DIRECTION_AS_FILED,
  directionAmountLine,
  directionCountLine,
  directionShares,
  EVERY_ROW_STATES_A_DIRECTION,
  figuresAsAcceptedNote,
  HOW_TO_READ_IT,
  inKindCountLine,
  laneByCommitteeBody,
  nothingOnRecordWhy,
  OUTSIDE_SPENDING_VIEW_LABELS,
  outsideSpendingPageNumber,
  outsideSpendingSort,
  outsideSpendingView,
  outsideSpendingViewLabel,
  outsideSpendingYear,
  pageLine,
  paidLine,
  periodNote,
  purposeText,
  READ_FROM_THE_BOARDS_FILE,
  recordSpanLine,
  rowCounterparty,
  rowsCountLine,
  rowsHeading,
  SEARCH_A_GROUP_OR_COMMITTEE,
  seatLine,
  SORT_LABELS,
  subjectCountLine,
  subjectScopeLine,
  typeText,
  unpaidNote,
  vendorText,
  whoseCommitteeConfirmed,
  whoseCommitteeUnconfirmed,
  type OutsideSpendingRecordFigures,
  type OutsideSpendingRecordPage,
  type OutsideSpendingRecordRow,
  type OutsideSpendingSubject,
} from '../outsideSpending';

// Figures are the live release's own where one exists (3 Sep 2026).
const FIGURES: OutsideSpendingRecordFigures = {
  rowCount: 41130,
  rowsMissingAnAmount: 0,
  amountTotal: '178579449.6700',
  supportingCount: 31718,
  supportingAmount: '140000000.00',
  opposingCount: 9412,
  opposingAmount: '38579449.67',
  directionNotRecordedCount: 0,
  directionNotRecordedAmount: '0',
  inKindCount: 1065,
  firstYear: 2015,
  lastYear: 2026,
  committeeCount: 1131,
  spenderCount: 250,
  committeesNotLinkable: 340,
};

const ROW: OutsideSpendingRecordRow = {
  spender: 'Education Minn PAC',
  spenderRegistrationNumber: '30558',
  spenderInRegister: true,
  spenderLinkable: true,
  aboutCommitteeName: 'Stephenson, Zachary House Committee',
  aboutCommitteeRegistrationNumber: '18129',
  aboutCommitteeInRegister: true,
  aboutCommitteeLinkable: true,
  direction: 'For',
  directionAsFiled: 'For',
  purpose: 'Advertising - Print: Direct Mail',
  vendorName: 'Great North Media LLC',
  expenditureType: 'Independent Expenditure',
  inKind: false,
  paidOn: '2026-08-03',
  year: 2026,
  amount: '128400.0000',
  unpaidAmount: '0.0000',
};

const SUBJECT: OutsideSpendingSubject = {
  registrationNumber: '18129',
  name: 'Stephenson, Zachary House Committee',
  inRegister: true,
  linkable: true,
  kind: 'candidate_committee',
  office: 'House',
  district: '35A',
  confirmedMember: null,
};

function page(overrides: Partial<OutsideSpendingRecordPage> = {}): OutsideSpendingRecordPage {
  return {
    state: 'reported',
    about: null,
    spender: null,
    year: null,
    sort: 'newest',
    rows: [ROW],
    pageNumber: 1,
    pageSize: 50,
    totalRows: 1,
    hasMore: false,
    figures: { ...FIGURES, rowCount: 1, committeeCount: 1, spenderCount: 1 },
    sourceUrl: 'https://cfb.mn.gov/',
    fetchedAt: '2026-08-19T02:54:00Z',
    ...overrides,
  };
}

describe('which view an address asks for', () => {
  it('is the whole record with no subject, and a spender wins over a committee', () => {
    expect(outsideSpendingView({})).toBe('record');
    expect(outsideSpendingView({ about: '18129' })).toBe('about');
    expect(outsideSpendingView({ spender: '30558' })).toBe('spender');
    expect(outsideSpendingView({ spender: '30558', about: '18129' })).toBe('spender');
  });

  it('reads sort, page and year defensively', () => {
    expect(outsideSpendingSort('largest')).toBe('largest');
    expect(outsideSpendingSort('amount')).toBe('newest');
    expect(outsideSpendingSort(undefined)).toBe('newest');
    expect(outsideSpendingPageNumber('3')).toBe(3);
    expect(outsideSpendingPageNumber('0')).toBe(1);
    expect(outsideSpendingPageNumber('x')).toBe(1);
    expect(outsideSpendingYear('2026')).toBe(2026);
    expect(outsideSpendingYear('1999')).toBeNull();
    expect(outsideSpendingYear(undefined)).toBeNull();
  });

  // Design retired the word "explorer" everywhere (build facts, 2 Sep 2026).
  it('never prints the retired word, and the whole-record button reads as ruled', () => {
    expect(OUTSIDE_SPENDING_VIEW_LABELS.record).toBe('The whole record');
    for (const label of Object.values(OUTSIDE_SPENDING_VIEW_LABELS)) {
      expect(label.toLowerCase()).not.toContain('explorer');
    }
    expect(outsideSpendingViewLabel('spender', 'record')).toBe('Browse groups');
    expect(outsideSpendingViewLabel('about', 'record')).toBe('Browse candidate committees');
    expect(outsideSpendingViewLabel('spender', 'spender')).toBe('One group');
    expect(ALL_YEARS).toBe('All years');
  });
});

describe('the whole record', () => {
  it('spans the file in the ruled word for a row', () => {
    expect(recordSpanLine(FIGURES)).toBe('across 41,130 payment records, 2015 through 2026');
    expect(recordSpanLine({ ...FIGURES, rowCount: 1, firstYear: 2026, lastYear: 2026 })).toBe(
      'across 1 payment record, 2026',
    );
  });

  it('names the count that is served, and says nothing when none is', () => {
    expect(laneByCommitteeBody(340)).toBe(
      'Every row names a committee, never a person. We cannot link 340 of those names to a ' +
        'committee page in the records we hold, so they are printed as filed.',
    );
    expect(laneByCommitteeBody(null)).toBe('Every row names a committee, never a person.');
  });

  it('claims every row states a direction in exactly those words', () => {
    expect(EVERY_ROW_STATES_A_DIRECTION).toBe(
      'Every payment record states a direction. Records for goods or services are already included ' +
        'in the supporting or opposing count. They are not additional records.',
    );
  });

  it('labels the bar as payment counts and names each count', () => {
    expect(DIRECTION_AS_FILED).toBe('Payments by direction, as the filing states it');
    expect(directionCountLine(1, 'supporting')).toBe('1 payment record supporting');
    expect(directionCountLine(31718, 'supporting')).toBe('31,718 payment records supporting');
    expect(inKindCountLine(1)).toBe('1 payment record in goods or services');
    expect(inKindCountLine(1065)).toBe('1,065 payment records in goods or services');
  });

  it('makes the next actions and whole-file explanation explicit', () => {
    expect(SEARCH_A_GROUP_OR_COMMITTEE).toBe('Open search for a group or committee');
    expect(HOW_TO_READ_IT.body).toContain('The total above covers the whole file.');
    expect(READ_FROM_THE_BOARDS_FILE).toBe(
      'Download the Minnesota Campaign Finance and Public Disclosure Board’s file',
    );
  });
});

describe('one subject', () => {
  // Ruled 1 Sep 2026: "12 payment records about 5 committees", singular "1 payment record about
  // 1 committee", never "payments named".
  it('prints the ruled count line, singular and plural, on both views', () => {
    expect(subjectCountLine('spender', { ...FIGURES, rowCount: 12, committeeCount: 5 })).toBe(
      '12 payment records about 5 committees',
    );
    expect(subjectCountLine('spender', { ...FIGURES, rowCount: 1, committeeCount: 1 })).toBe(
      '1 payment record about 1 committee',
    );
    expect(subjectCountLine('about', { ...FIGURES, rowCount: 5, spenderCount: 5 })).toBe(
      '5 payment records by 5 groups',
    );
    expect(subjectCountLine('about', { ...FIGURES, rowCount: 1, spenderCount: 1 })).toBe(
      '1 payment record by 1 group',
    );
  });

  it('caps with "Showing 6 of 12 payment records" and no closing dot', () => {
    const capped = page({ totalRows: 1284, rows: Array(50).fill(ROW), pageNumber: 2 });
    expect(rowsCountLine('record', capped)).toBe('Showing 50 of 1,284 payment records');
    expect(pageLine(capped)).toBe('Page 2 of 26');
    expect(rowsCountLine('spender', page())).toBe('1 payment record about 1 committee');
    expect(pageLine(page())).toBeNull();
    expect(rowsCountLine('record', page({ figures: null, totalRows: null }))).toBeNull();
  });

  it('scopes the figures to the year or the span, never an assumed one', () => {
    expect(subjectScopeLine(2026, FIGURES)).toBe('Outside spending · 2026');
    expect(subjectScopeLine(null, FIGURES)).toBe('Outside spending · 2015–2026');
    expect(subjectScopeLine(null, null)).toBe('Outside spending');
  });

  it('prints each direction as money with its own word, and shares from the amounts', () => {
    expect(directionAmountLine('234650.00', 'supporting')).toBe('$234,650 supporting');
    expect(directionAmountLine('71400.00', 'opposing')).toBe('$71,400 opposing');
    expect(directionAmountLine(null, 'opposing')).toBeNull();
    expect(directionShares('300', '100')).toEqual({ supporting: 0.75, opposing: 0.25 });
    expect(directionShares(null, null)).toEqual({ supporting: 0, opposing: 0 });
  });

  it('says what the period is and that no list is complete', () => {
    expect(periodNote(2026, FIGURES)).toContain('every row filed for 2026');
    expect(periodNote(2026, FIGURES)).toContain('cannot say whether one is still to come');
    expect(periodNote(null, FIGURES)).toBe(
      'Figures span every year on record, 2015 through 2026, and each row states its own date. ' +
        'No list here is offered as complete.',
    );
  });

  it('heads the rows for the side the view lists', () => {
    expect(rowsHeading('about')).toBe('The groups that spent');
    expect(rowsHeading('spender')).toBe('The committees this spending was about');
    expect(SORT_LABELS).toEqual({ newest: 'NEWEST FIRST', largest: 'LARGEST FIRST' });
  });
});

describe('whose committee this is', () => {
  it('names the committee only until a person confirms, then adds one sentence', () => {
    expect(seatLine(SUBJECT)).toBe('House District 35A');
    expect(whoseCommitteeUnconfirmed(SUBJECT)).toBe(
      'The register records this committee for House District 35A. We have not ' +
        'confirmed which person it belongs to, so this page names the committee only. Every ' +
        'figure below is spending about this committee — not about a candidate we have identified.',
    );
    const confirmed = whoseCommitteeConfirmed({
      ...SUBJECT,
      confirmedMember: { slug: 'zack-stephenson', fullName: 'Zack Stephenson' },
    });
    expect(confirmed).toContain('confirmed this committee is Zack Stephenson’s');
    expect(confirmed).toContain('the filings never name a person');
  });

  it('never invents a seat the register does not carry', () => {
    const fund = { ...SUBJECT, office: null, district: null };
    expect(seatLine(fund)).toBeNull();
    expect(whoseCommitteeUnconfirmed(fund)).toMatch(/^We have not confirmed which person/);
    // No confirmation means the unconfirmed words, exactly.
    expect(whoseCommitteeConfirmed(fund)).toBe(whoseCommitteeUnconfirmed(fund));
  });
});

describe('one row', () => {
  it('prints its own date month-first in short capitals', () => {
    expect(paidLine('2026-08-03')).toBe('PAID AUG 3, 2026');
    expect(paidLine('2025-12-31')).toBe('PAID DEC 31, 2025');
    expect(paidLine(null)).toBeNull();
    expect(paidLine('not a date')).toBeNull();
  });

  it('gives a blank purpose and a blank vendor their own words, never a dash', () => {
    expect(purposeText(null)).toEqual({ text: 'No purpose given in the filing', isMissing: true });
    expect(purposeText('Postage')).toEqual({ text: 'Postage', isMissing: false });
    expect(vendorText(null)).toEqual({ text: 'no vendor named in the filing', isMissing: true });
    expect(vendorText('Skyline Digital')).toEqual({
      text: 'paid to Skyline Digital',
      isMissing: false,
    });
  });

  it('carries in-kind as the row’s type text, one fact in one place', () => {
    expect(typeText({ inKind: true, expenditureType: 'Independent Expenditure' })).toBe(
      'given in kind',
    );
    expect(typeText({ inKind: false, expenditureType: 'Independent Expenditure' })).toBe(
      'independent expenditure',
    );
  });

  it('notes an unpaid part in whole dollars and nothing when paid', () => {
    expect(unpaidNote('1500.0000')).toBe('$1,500 of it unpaid');
    expect(unpaidNote('0.0000')).toBeNull();
    expect(unpaidNote(null)).toBeNull();
  });

  it('lists the committee on a spender’s view and the spender everywhere else', () => {
    expect(rowCounterparty('spender', ROW)).toEqual({
      name: 'Stephenson, Zachary House Committee',
      registrationNumber: '18129',
      linkable: true,
    });
    expect(rowCounterparty('about', ROW).name).toBe('Education Minn PAC');
    expect(rowCounterparty('record', ROW).name).toBe('Education Minn PAC');
  });
});

describe('states', () => {
  it('says absence is not a zero, for each subject', () => {
    expect(nothingOnRecordWhy('about')).toContain(
      'No independent expenditure about this committee',
    );
    expect(nothingOnRecordWhy('spender')).toContain('No independent expenditure by this group');
    expect(nothingOnRecordWhy('record')).toContain('This is not a reported zero');
    expect(nothingOnRecordWhy('about')).not.toMatch(/\b0\b/);
  });

  it('dates the last accepted figures and holds them until the service answers', () => {
    expect(figuresAsAcceptedNote('Aug 11, 2026')).toBe(
      'We could not reach our own data service just now, so these are the last figures we ' +
        'accepted, taken Aug 11, 2026 — held until it answers rather than expiring on a timer.',
    );
    expect(figuresAsAcceptedNote(null)).not.toContain('taken');
  });
});
