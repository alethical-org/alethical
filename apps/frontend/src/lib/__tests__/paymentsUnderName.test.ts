/**
 * The payments-under-a-name page's rules (#1780; grounded-answers.md rules 3, 5,
 * 11 and 12). Each test is one way this page could add up money that must not be
 * added, name an organisation the records cannot name, or print a figure nobody
 * counted.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CAP_NOTE,
  committeesInRows,
  filesLastCopiedLine,
  INDEPENDENT_IS_A_SEPARATE_FILING,
  LIST_NOTE,
  nothingFiledTitle,
  ORDERED_NEWEST_FIRST,
  PAYMENT_NAME_ROLES,
  PAYMENTS_UNDER_NAME_PAGE_SIZE,
  paymentNameRole,
  paymentsShowingLine,
  paymentsUnderNameEyebrow,
  paymentsUnderNameHeading,
  paymentsUnderNameStandfirst,
  paymentUnderNameMeta,
  paymentUnderNameRow,
  type PaymentNameRole,
  type PaymentUnderName,
} from '../paymentsUnderName';

const HERE = dirname(fileURLToPath(import.meta.url));

function payment(overrides: Partial<PaymentUnderName> = {}): PaymentUnderName {
  return {
    filerName: 'Walz, Tim Gov Committee',
    filerRegistrationNumber: '18135',
    filerEntityType: 'PCC',
    receiptType: 'Contribution',
    purpose: null,
    expenditureType: null,
    affectedCommitteeName: null,
    stance: null,
    amount: '4000.0000',
    paidOn: '2025-10-06',
    inKind: 'No',
    ...overrides,
  };
}

describe('the roles this page answers for', () => {
  // Exactly the 3 the name search emits on its rows, so a result opens its
  // payments without translating anything.
  it('takes the search’s own 3 roles and nothing else', () => {
    expect(PAYMENT_NAME_ROLES).toEqual(['contributor', 'vendor', 'independent_vendor']);
    for (const role of PAYMENT_NAME_ROLES) {
      expect(paymentNameRole(role)).toBe(role);
    }
  });

  // The server serves a 4th role, `employer`, reading a free-text column whose
  // commonest values are "Not Employed" and "Retired". Nothing links to it, and a
  // page that answered for it without wording of its own would read as a
  // company's giving.
  it('refuses a role we do not answer for rather than falling back to another', () => {
    expect(paymentNameRole('employer')).toBeNull();
    expect(paymentNameRole('landlord')).toBeNull();
    expect(paymentNameRole('')).toBeNull();
    expect(paymentNameRole(null)).toBeNull();
  });
});

describe('the page is a spelling, never an organisation', () => {
  // The release holds "Messinger, Alida", "Messinger, Alida R" and "Messinger,
  // Alida Rockefelle" as 3 separate strings, and nothing joins them. A heading
  // that stood the bare name up as a title would read as a profile of whoever
  // carries it (rule 3).
  it('quotes the searched spelling and says what the page is in front of it', () => {
    for (const role of PAYMENT_NAME_ROLES) {
      const heading = paymentsUnderNameHeading('Messinger, Alida', role);
      expect(heading).toContain('“Messinger, Alida”');
      expect(heading).toContain('under the name');
      expect(heading.startsWith('“')).toBe(false);
    }
  });

  it('never says this is everything the name received', () => {
    for (const role of PAYMENT_NAME_ROLES) {
      const standfirst = paymentsUnderNameStandfirst(role);
      expect(standfirst).toContain('exactly as it was spelled');
      expect(standfirst).toContain('this may not be everything');
      expect(standfirst).toContain('a name is all this is');
    }
  });

  it('names the side of the record each role reads', () => {
    expect(paymentsUnderNameStandfirst('contributor')).toContain('who or what gave');
    expect(paymentsUnderNameStandfirst('vendor')).toContain('who or what got paid');
    expect(paymentsUnderNameEyebrow('contributor')).toBe('GAVE');
    expect(paymentsUnderNameEyebrow('vendor')).toBe('GOT PAID');
    expect(paymentsUnderNameEyebrow('independent_vendor')).toBe('PAID BY INDEPENDENT SPENDING');
  });

  // 491 rows of the independent-spending file share a spender, name, amount and
  // date with an ordinary expenditure row, and whether that is one payment filed
  // twice or 2 that coincide is not established (rule 12).
  it('says the independent file is never added to the ordinary one', () => {
    expect(INDEPENDENT_IS_A_SEPARATE_FILING).toContain('never added');
    expect(INDEPENDENT_IS_A_SEPARATE_FILING).toContain('491');
  });

  it('says nothing about a person when a spelling matches nothing', () => {
    const title = nothingFiledTitle('Aguirre Printing');
    expect(title).toContain('“Aguirre Printing”');
    expect(title).toContain('as spelled');
  });
});

describe('no total across committees, in any form', () => {
  // The acceptance criterion this whole page turns on. The rows come from
  // committees on different filing calendars, so any figure that combined them
  // would set one period against another (rule 12).
  //
  // Mutation-checked: adding a total to either the screen or its library fails
  // this test, and removing it again passes.
  // Amounts arrive as strings and only ever reach `formatMoney`, so ANY total
  // would have to turn one into a number first — by `Number(`, `parseFloat`,
  // `reduce(`, or `+=` — or be held in something named for a total. The guard
  // reads code only: the comments and the printed sentences on this page say the
  // word "total" constantly, because saying there is none is half the point.
  const SUMMING =
    /\breduce\s*\(|\bparseFloat\b|\bNumber\s*\(|\+=|\btotal\b|\bsum\b|\bsubtotal\b|\baverage\b/i;

  it('the library computes no figure across the rows', () => {
    expect(codeOnly(join(HERE, '..', 'paymentsUnderName.ts'))).not.toMatch(SUMMING);
  });

  it('the screen computes no figure across the rows', () => {
    expect(
      codeOnly(join(HERE, '../..', 'screens/redesign/PaymentsUnderNameScreen.tsx')),
    ).not.toMatch(SUMMING);
  });

  it('says out loud that there is no total, and why', () => {
    expect(LIST_NOTE).toContain('There is no total');
    expect(LIST_NOTE).toContain('different filing calendars');
  });

  // The one figure a reader could mistake for a claim about the world. It is a
  // count of rows and committees, never money.
  it('counts payments and committees, never amounts', () => {
    expect(paymentsShowingLine(9, 7, false)).toBe('9 payments, from 7 committees');
    expect(paymentsShowingLine(1, 1, false)).toBe('1 payment, from 1 committee');
    expect(paymentsShowingLine(1284, 96, false)).toBe('1,284 payments, from 96 committees');
  });
});

describe('a capped list says only what it is showing', () => {
  // The server serves no count on a name-keyed lookup, so "of N" would be a
  // number we made up, and a committee count over a partial list would read as
  // how many committees filed (rule 11).
  it('never prints a total it was not served, and drops the committee count', () => {
    const line = paymentsShowingLine(250, 41, true);
    expect(line).toBe('Showing the first 250 payments, newest first');
    expect(line).not.toContain(' of ');
    expect(line).not.toContain('committee');
  });

  it('says the cap is ours and matches the order the server actually serves', () => {
    expect(CAP_NOTE).toContain('the cap is ours');
    expect(CAP_NOTE).toContain('newest first');
    expect(ORDERED_NEWEST_FIRST).toBe('NEWEST FIRST');
    expect(PAYMENTS_UNDER_NAME_PAGE_SIZE).toBe(250);
  });
});

describe('the freshness date', () => {
  // Rule 12: a page that prints money figures carries one clearly labelled
  // freshness date, and it is never the period the money covers.
  it('labels the copy date as a copy date, and says the years are every year we hold', () => {
    expect(filesLastCopiedLine('Aug 11, 2026')).toBe(
      'All years we hold · files last copied Aug 11, 2026',
    );
    expect(filesLastCopiedLine(null)).toBe('All years we hold');
  });
});

describe('rows', () => {
  it('names the committee that filed the row, never the searched name', () => {
    const row = paymentUnderNameRow(payment(), 'contributor', new Set(['18135']));
    expect(row.name).toBe('Walz, Tim Gov Committee');
    expect(row.amount).toBe('$4,000.00');
    expect(row.date).toBe('6 Oct 2025');
  });

  it('opens the committee only where this release holds that number as a filer', () => {
    expect(paymentUnderNameRow(payment(), 'contributor', new Set(['18135'])).linkNumber).toBe(
      '18135',
    );
    expect(paymentUnderNameRow(payment(), 'contributor', new Set()).linkNumber).toBeNull();
  });

  it('says so when a filing names no committee, rather than showing a blank', () => {
    const row = paymentUnderNameRow(
      payment({ filerName: null, filerRegistrationNumber: null }),
      'vendor',
      new Set(),
    );
    expect(row.name).toBe('Name not given in the filing');
    expect(row.linkNumber).toBeNull();
  });

  // A loan listed under money given, with no label, would read as a gift.
  it('labels a contributions row filed on a schedule other than a donation', () => {
    expect(paymentUnderNameMeta(payment(), 'contributor')).toBe('Candidate committee');
    expect(paymentUnderNameMeta(payment({ receiptType: 'Loan' }), 'contributor')).toContain(
      'not a donation',
    );
  });

  it('prints an expenditure’s own purpose, in the filing’s words', () => {
    const meta = paymentUnderNameMeta(
      payment({ purpose: 'Advertising - general: Ads', expenditureType: 'Campaign Expenditure' }),
      'vendor',
    );
    expect(meta).toBe('Advertising - general: Ads');
  });

  // "For" and "Against" are the filing's own column, and the product already
  // reads them as supporting and opposing. A row whose filing records neither
  // says that rather than picking one.
  it('reads independent spending’s own for-or-against, and says when it records neither', () => {
    const about = { affectedCommitteeName: 'Audette, Matt', purpose: 'Digital ads' };
    expect(
      paymentUnderNameMeta(payment({ ...about, stance: 'For' }), 'independent_vendor'),
    ).toContain('Spent supporting Audette, Matt');
    expect(
      paymentUnderNameMeta(payment({ ...about, stance: 'Against' }), 'independent_vendor'),
    ).toContain('Spent opposing Audette, Matt');
    expect(
      paymentUnderNameMeta(payment({ ...about, stance: null }), 'independent_vendor'),
    ).toContain('does not say which way');
  });

  it('counts the committees behind the loaded rows, once each', () => {
    expect(
      committeesInRows([
        payment(),
        payment(),
        payment({ filerRegistrationNumber: '20003', filerName: 'MN DFL State Central Committee' }),
      ]),
    ).toBe(2);
    // A row carrying no number still counts, by the name the filing printed.
    expect(committeesInRows([payment({ filerRegistrationNumber: null, filerName: 'Anon' })])).toBe(
      1,
    );
  });
});

/** One file's code with every comment and every literal string removed, so the
 *  no-total guard reads what the page COMPUTES rather than what it says. */
function codeOnly(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** Keeps the role type referenced, so a rename cannot leave this file compiling
 *  against a type nothing uses. */
export type _Role = PaymentNameRole;
