import { describe, expect, it } from 'vitest';

import {
  catalogueCopiedLine,
  sourcePlace,
  statementCountFragment,
  statementDatesLine,
  statementDetailFromPayload,
  statementPdfAccessibleName,
  STATEMENT_BOX_SENTENCE,
  STATEMENT_FAILED,
  STATEMENT_LOADING,
  STATEMENT_NOT_READ,
  STATEMENT_NOT_YET_READ,
  STATEMENT_REFRESH_FAILED,
  UNLINKED_HEADING,
  UNLINKED_LEAD,
  unlinkedStatementsFromPayload,
} from '../disclosureStatementCopy';

/**
 * The words a disclosure statement prints inside its payment (#2347). Each case is a
 * way a statement could say more than it does: speak for the donor's other gifts, imply
 * its source controls the committee, print a third party's ZIP, or read a blank line as $0.
 */
describe('disclosure statement words', () => {
  it('counts statements on a collapsed row so the row total never reads as attributed', () => {
    expect(statementCountFragment(3, 5)).toBe('3 with a disclosure statement');
    expect(statementCountFragment(5, 5)).toBe('all 5 with a disclosure statement');
    expect(statementCountFragment(1, 1)).toBe('with a disclosure statement');
    expect(statementCountFragment(0, 5)).toBeNull();
  });

  it('prints Design’s supplied sentences, each about this contribution only', () => {
    expect(STATEMENT_BOX_SENTENCE[3]).toBe(
      'This statement names the sources below for this contribution',
    );
    expect(STATEMENT_BOX_SENTENCE[1]).toBe(
      'The donor reports using only business revenue for this contribution',
    );
    for (const sentence of Object.values(STATEMENT_BOX_SENTENCE)) {
      expect(sentence.endsWith('.')).toBe(false);
      expect(sentence).not.toMatch(/controls?|caused|other gifts|spending/i);
    }
    expect(STATEMENT_NOT_READ).toBe('We have this statement, but have not yet read its details');
    expect(STATEMENT_LOADING).toBe('Loading statement details…');
    expect(STATEMENT_FAILED).toBe(
      'We couldn’t load this statement’s details. You can still open its PDF.',
    );
    expect(STATEMENT_REFRESH_FAILED).toBe(
      'We couldn’t refresh this statement’s details. The details below were loaded earlier.',
    );
    expect(UNLINKED_HEADING).toBe('Statements not linked to a payment');
    expect(UNLINKED_LEAD).toBe(
      'We have these statements, but have not linked them to individual payments in our copied records',
    );
  });

  it('names a source by city and state, never ZIP', () => {
    expect(
      sourcePlace({ name: 'Uihlein, Richard E.', city: 'Lake Bluff', state: 'IL', amount: '1' }),
    ).toBe('Lake Bluff, IL');
    const detail = statementDetailFromPayload({
      id: 's2',
      state: 'read',
      donor_name: 'Restoration of America PAC',
      gift_date: '2026-08-27',
      gift_amount: '5000000.00',
      pdf_url:
        'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&year=26&type=disclosure&period=D&regnum=41412&disc=2',
      box: 3,
      sources: [
        {
          name: 'Uihlein, Richard E.',
          city: 'Lake Bluff',
          state: 'IL',
          amount: '5000000.00',
          zip: '60044',
        },
      ],
      line_a: '5000000.00',
      line_b: null,
      line_c: null,
      signed_on: '2026-09-20',
      received_on: '2026-09-21',
    })!;
    expect(detail.lineB).toBeNull();
    expect(JSON.stringify(detail)).not.toContain('60044');
    expect(statementDatesLine(detail.signedOn, detail.receivedOn)).toBe(
      'Signed: Sep 20, 2026 · Received by the Board: Sep 21, 2026',
    );
  });

  it('keeps the visible text first in the PDF link’s spoken name', () => {
    expect(statementPdfAccessibleName('North Metro Harness Initiative, LLC', '2026-06-09')).toBe(
      'View statement PDF, North Metro Harness Initiative, LLC, Jun 9, 2026',
    );
    expect(statementPdfAccessibleName(null, null)).toBe('View statement PDF');
  });

  it('reads the unlinked list, keeping an unread statement’s fields empty', () => {
    const listed = unlinkedStatementsFromPayload({
      state: 'listed',
      registration_number: '41412',
      year: 2026,
      copied_on: '2026-09-24',
      statements: [
        {
          id: 'b2',
          state: 'read',
          report_name: '2026 June Report',
          report_period: 'B',
          statement_number: 2,
          donor_name: 'North Metro Harness Initiative, LLC',
          recipient_name: 'Restore Sanity',
          gift_date: '2026-06-09',
          gift_amount: '500000.00',
          pdf_url:
            'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&year=26&type=disclosure&period=B&regnum=41412&disc=2',
        },
        {
          id: 'x',
          state: 'not_read',
          report_period: 'A',
          statement_number: 3,
          pdf_url: 'https://cfb.mn.gov/x',
        },
        { id: 'bad', state: 'read' },
      ],
    })!;
    expect(listed.statements.map((s) => s.id)).toEqual(['b2', 'x']);
    expect(listed.statements[1]).toMatchObject({
      donorName: null,
      giftDate: null,
      giftAmount: null,
    });
    expect(unlinkedStatementsFromPayload({ state: 'unavailable' })).toBeNull();
    expect(STATEMENT_NOT_YET_READ).toBe('Not yet read');
  });

  it('reuses the Filed reports catalogue line word for word', () => {
    expect(catalogueCopiedLine('2026-09-23')).toBe(
      'Minnesota’s report catalogue copied Sep 23, 2026',
    );
    expect(catalogueCopiedLine(null)).toBeNull();
  });
});
