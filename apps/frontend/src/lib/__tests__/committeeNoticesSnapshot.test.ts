import { describe, expect, it } from 'vitest';

import committeeFixture from './fixtures/committee-money-page-snapshot.json';
import { committeePageSnapshot, renderPageSnapshot } from '../pageSnapshot';

/**
 * The text served before the app loads repeats every line the notices card draws
 * (#2347, build-facts §5 "Plain text"), and the coverage line names all 3 record kinds
 * wherever a page can show them.
 */
const NOTICES = {
  state: 'listed',
  registration_number: '41326',
  year: 2026,
  threshold: 'more_than_1000',
  copied_on: '2026-09-23',
  source_url:
    'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/large-contribution-notices/',
  any_amended: false,
  windows: [
    {
      key: 'pre_primary',
      label: 'Before the primary',
      start: '2026-07-21',
      end: '2026-08-10',
      notices: [
        {
          id: 'n1',
          contributor: 'HEAD, MARTHA M',
          amount: '50000.00',
          contribution_date: '2026-08-06',
          received_on: '2026-08-07',
          employer: 'INVESTOR',
          in_kind: false,
          in_kind_description: null,
          loan: false,
          amended: false,
          earlier_contributor: null,
          earlier_contribution_date: null,
          earlier_amount: null,
          status: 'matched',
          matched_payment: {
            contributor: 'Head, Martha M',
            contributor_type: 'Individual',
            received_on: '2026-08-06',
            amount: '50000.0000',
            record_number: 7,
          },
          pdf_url:
            'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&year=26&type=notice&period=PrePrimary&se=0&regnum=41326&date=260806_140546',
        },
      ],
    },
    {
      key: 'pre_general',
      label: 'Before the general election',
      start: '2026-10-20',
      end: '2026-11-02',
      notices: [],
    },
  ],
};

const served = (view: Parameters<typeof committeePageSnapshot>[2], money = committeeFixture) =>
  renderPageSnapshot(committeePageSnapshot(money as never, '41326', view)).replace(
    /&#39;|&rsquo;/g,
    '’',
  );

describe('the served committee page', () => {
  it('repeats the notices card in its own words and order', () => {
    const body = served({ confirmedFor: null, notices: NOTICES, today: '2026-09-23' });
    expect(body).toContain('Large-contribution notices');
    expect(body).toContain(
      'adding up to more than $1,000 arrives in the days just before an election',
    );
    expect(body).toContain('Before the primary · Jul 21 – Aug 10, 2026');
    expect(body).toContain('Before the general election · Oct 20 – Nov 2, 2026 · Not open yet');
    expect(body).toContain(
      'HEAD, MARTHA M · $50,000 · Aug 6, 2026 · Received by the Board: Aug 7, 2026 · INVESTOR · Also a payment in the list above, under Individuals',
    );
    expect(body).toContain('View notice PDF, HEAD, MARTHA M, Aug 6, 2026');
    expect(body).toContain('Minnesota’s list of large-contribution notices copied Sep 23, 2026');
    expect(body.indexOf('Money out')).toBeLessThan(body.indexOf('Large-contribution notices'));
    expect(body.indexOf('Large-contribution notices')).toBeLessThan(
      body.indexOf('What this record covers'),
    );
  });

  it('serves no notices section where the card draws none', () => {
    for (const notices of [
      undefined,
      { ...NOTICES, state: 'not_covered', windows: [] },
      { registration_number: '41326' },
    ]) {
      expect(served({ confirmedFor: null, notices })).not.toContain('Large-contribution notices');
    }
    expect(served({ confirmedFor: null, notices: NOTICES, tab: 'filings' })).not.toContain(
      'Before the primary',
    );
  });

  it('repeats the unlinked statements with their labelled fields, and serves none when empty', () => {
    const unlinked = {
      state: 'listed',
      registration_number: '41326',
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
          pdf_url: 'https://cfb.mn.gov/b2',
        },
        {
          id: 'x',
          state: 'not_read',
          report_period: 'A',
          statement_number: 3,
          pdf_url: 'https://cfb.mn.gov/a3',
        },
      ],
    };
    const body = served({ confirmedFor: null, unlinkedStatements: unlinked });
    expect(body).toContain('Statements not linked to a payment');
    expect(body).toContain(
      'Donor: North Metro Harness Initiative, LLC · Recipient: Restore Sanity · Contribution date: Jun 9, 2026 · Contribution amount: $500,000',
    );
    expect(body).toContain(
      'Donor: Not yet read · Recipient: Not yet read · Contribution date: Not yet read · Contribution amount: Not yet read · We have this statement, but have not yet read its details',
    );
    expect(body).toContain('View statement PDF, North Metro Harness Initiative, LLC, Jun 9, 2026');
    expect(
      served({ confirmedFor: null, unlinkedStatements: { ...unlinked, statements: [] } }),
    ).not.toContain('Statements not linked to a payment');
  });

  it('names all 3 record kinds in the coverage line, and reports alone for a party unit', () => {
    expect(served({ confirmedFor: null })).toContain(
      'Campaign finance reports, large-contribution notices and disclosure statements filed with the Minnesota Campaign Finance and Public Disclosure Board',
    );
    const partyUnit = {
      ...committeeFixture,
      register: { ...committeeFixture.register, kind: 'party_unit' },
    };
    const body = served({ confirmedFor: null, notices: NOTICES }, partyUnit as never);
    expect(body).toContain(
      'Campaign finance reports filed with the Minnesota Campaign Finance and Public Disclosure Board',
    );
    expect(body).not.toContain('large-contribution notices and disclosure statements');
    expect(body).not.toContain('Before the primary');
  });
});
