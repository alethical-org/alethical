import { describe, expect, it } from 'vitest';

import {
  committeeNoticesFromPayload,
  minnesotaToday,
  noticeDetailParts,
  noticeFirstFiledLine,
  noticeMatchedAccessibleName,
  noticePdfAccessibleName,
  noticesCardDraws,
  noticesCopiedLine,
  noticesLead,
  noticeStatusText,
  noticeWindowDates,
  NOTICE_NOT_LINKED,
  noticeAfterLatestReport,
  NOTICE_WINDOW_NONE,
  NOTICE_WINDOW_NOT_OPEN,
  NOTICE_WINDOW_OPEN,
  NOTICES_FAILED,
  NOTICES_LOADING,
  windowOpenState,
  type CommitteeNotice,
} from '../committeeNotices';

/**
 * Every sentence the notices card prints (#2347). Each case is a way the card could say
 * something false: call a notice a report, imply its amount is added to a figure, claim
 * a committee received no large gift, or say a gift is missing when only a spelling
 * differs.
 */

// Restore Sanity's real 2026 answer, as the API serves it (23 Sep 2026).
const RESTORE_SANITY = {
  state: 'listed',
  registration_number: '41412',
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
            'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&year=26&type=notice&period=PrePrimary&se=0&regnum=41412&date=260806_140546',
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

const notice = (patch: Partial<CommitteeNotice> = {}): CommitteeNotice => ({
  ...committeeNoticesFromPayload(RESTORE_SANITY)!.windows[0].notices[0],
  ...patch,
});

describe('the words', () => {
  it('leads with the statute’s own test, in 3 full sentences, never calling a notice a report', () => {
    const lead = noticesLead('more_than_1000');
    expect(lead).toBe(
      'A committee must tell the Minnesota Campaign Finance Board by the end of the next ' +
        'business day when money from one source adding up to more than $1,000 arrives in ' +
        'the days just before an election. The same money appears again as an ordinary ' +
        'payment once the committee files its next report, so a notice is never a second ' +
        'gift. No notice amount is added to any total on this page.',
    );
    expect(lead.match(/\./g)).toHaveLength(3);
    expect(lead).not.toMatch(/notice is a report|notices are reports/i);
    expect(noticesLead('more_than_2000')).toContain('more than $2,000');
    expect(noticesLead('more_than_400')).toContain('more than $400');
    expect(noticesLead('more_than_half_the_limit')).toContain(
      'more than half of what one source may give it in the election cycle',
    );
  });

  it('ends a lone sentence without a period and every sentence of a pair with one', () => {
    for (const lone of [
      NOTICE_WINDOW_OPEN,
      NOTICE_WINDOW_NOT_OPEN,
      NOTICE_WINDOW_NONE,
      NOTICE_NOT_LINKED,
      noticeAfterLatestReport('2026-09-15')!,
      noticesCopiedLine('2026-09-23'),
    ]) {
      expect(lone.endsWith('.'), lone).toBe(false);
    }
    for (const pair of [NOTICES_FAILED]) {
      expect(pair.endsWith('.'), pair).toBe(true);
      expect(pair.match(/\. /g), pair).toHaveLength(1);
    }
    expect(NOTICES_LOADING.endsWith('…')).toBe(true);
    for (const words of [NOTICE_WINDOW_NONE, NOTICE_NOT_LINKED, NOTICES_FAILED]) {
      expect(words).not.toContain("'");
    }
  });

  it('describes the Board’s list, never the committee’s gifts, when a window holds none', () => {
    expect(NOTICE_WINDOW_NONE).toBe(
      'The Board’s list held no notice from this committee for these dates when we last copied it',
    );
    expect(NOTICE_WINDOW_NONE).not.toMatch(/received no|did not receive|no large/i);
  });

  it('prints Design’s status sentences, dating our copy and naming no cause', () => {
    expect(noticeAfterLatestReport('2026-09-15')).toBe(
      'Our latest copied report covers dates through Sep 15, 2026',
    );
    expect(noticeAfterLatestReport(null)).toBeNull();
    expect(NOTICE_NOT_LINKED).toBe(
      'We have not linked this notice to a payment in our copied records',
    );
    expect(NOTICE_NOT_LINKED).not.toMatch(/missing|absent|spelling|will appear/i);
  });

  it('names the tab, the contributor and the date on the matched link', () => {
    const matched = notice();
    expect(noticeStatusText(matched, 'Individuals', null)).toBe(
      'Also a payment in the list above, under Individuals',
    );
    expect(noticeMatchedAccessibleName(matched)).toBe(
      'Show the Aug 6, 2026 payment from HEAD, MARTHA M in the list above',
    );
    expect(noticePdfAccessibleName(matched)).toBe('View notice PDF, HEAD, MARTHA M, Aug 6, 2026');
    const after = notice({ status: 'not_yet_on_a_report' });
    expect(noticeStatusText(after, null, '2026-09-15')).toBe(
      'Our latest copied report covers dates through Sep 15, 2026',
    );
    // Without a known report end, no notice claims to follow one.
    expect(noticeStatusText(after, null, null)).toBe(NOTICE_NOT_LINKED);
    expect(noticeStatusText(notice({ status: 'no_exact_match' }), null, '2026-09-15')).toBe(
      NOTICE_NOT_LINKED,
    );
  });

  it('prints the received date only where the notice states it', () => {
    expect(noticeDetailParts(notice(), 'DONATED GOODS OR SERVICES')).toEqual([
      'Aug 6, 2026',
      'Received by the Board: Aug 7, 2026',
      'INVESTOR',
    ]);
    expect(
      noticeDetailParts(
        notice({
          receivedOn: null,
          employer: null,
          inKind: true,
          inKindDescription: 'Printing',
          loan: true,
        }),
        'DONATED GOODS OR SERVICES',
      ),
    ).toEqual(['Aug 6, 2026', 'DONATED GOODS OR SERVICES Printing', 'LOAN']);
  });

  it('keeps an amended notice’s first-filed value readable', () => {
    expect(noticeFirstFiledLine(notice({ amended: true, earlierAmount: '30000.00' }))).toBe(
      'As first filed: $30,000',
    );
    expect(noticeFirstFiledLine(notice({ amended: true }))).toBeNull();
  });

  it('dates a window with one year when both ends share it', () => {
    expect(noticeWindowDates({ start: '2026-07-21', end: '2026-08-10' })).toBe(
      'Jul 21 – Aug 10, 2026',
    );
    expect(noticeWindowDates({ start: '2026-10-20', end: '2026-11-02' })).toBe(
      'Oct 20 – Nov 2, 2026',
    );
    expect(noticeWindowDates({ start: '2026-12-28', end: '2027-01-04' })).toBe(
      'Dec 28, 2026 – Jan 4, 2027',
    );
  });

  it('dates the list’s copy in the foot', () => {
    expect(noticesCopiedLine('2026-09-23')).toBe(
      'Minnesota’s list of large-contribution notices copied Sep 23, 2026',
    );
  });
});

describe('the states', () => {
  it('draws only a listed answer that has a window', () => {
    expect(noticesCardDraws(committeeNoticesFromPayload(RESTORE_SANITY))).toBe(true);
    for (const state of ['not_covered', 'no_windows', 'unavailable']) {
      expect(
        noticesCardDraws(committeeNoticesFromPayload({ ...RESTORE_SANITY, state, windows: [] })),
        state,
      ).toBe(false);
    }
    expect(noticesCardDraws(committeeNoticesFromPayload({ ...RESTORE_SANITY, windows: [] }))).toBe(
      false,
    );
    expect(committeeNoticesFromPayload({ registration_number: '41412' })).toBeNull();
  });

  it('drops a notice missing a field the card prints rather than drawing a blank', () => {
    const broken = structuredClone(RESTORE_SANITY);
    (broken.windows[0].notices[0] as Record<string, unknown>).amount = null;
    expect(committeeNoticesFromPayload(broken)!.windows[0].notices).toEqual([]);
  });

  it('judges a window against Minnesota’s today', () => {
    const [primary, general] = committeeNoticesFromPayload(RESTORE_SANITY)!.windows;
    expect(windowOpenState(general, '2026-09-23')).toBe('not_open');
    expect(windowOpenState(general, '2026-10-20')).toBe('open');
    expect(windowOpenState(general, '2026-11-02')).toBe('open');
    expect(windowOpenState(general, '2026-11-03')).toBe('closed');
    expect(windowOpenState(primary, '2026-09-23')).toBe('closed');
    // 04:30 UTC on 21 Oct is still 20 Oct in Minnesota.
    expect(minnesotaToday(new Date('2026-10-21T04:30:00Z'))).toBe('2026-10-20');
  });
});
