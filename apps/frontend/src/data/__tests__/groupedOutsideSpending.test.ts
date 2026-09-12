import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publicApiRequest } from '../api';
import {
  getCompleteOutsideSpendingPayments,
  getGroupedOutsideSpending,
} from '../groupedOutsideSpending';
import type { OutsideSpendingYear } from '../../lib/outsideSpending';

vi.mock('../api', () => ({ publicApiRequest: vi.fn() }));
const request = vi.mocked(publicApiRequest);

function year(overrides: Partial<OutsideSpendingYear> = {}): OutsideSpendingYear {
  return {
    year: 2025,
    state: 'reported',
    snapshotId: 'download-1',
    committees: [{ registrationNumber: '1', name: 'Candidate', office: null }],
    supporting: 10,
    supportingPayments: 2,
    opposing: 0,
    opposingPayments: 0,
    directionNotRecorded: 0,
    directionNotRecordedPayments: 0,
    firstPaymentOn: '2025-01-01',
    lastPaymentOn: '2025-01-01',
    sourceUrl: 'https://cfb.mn.gov/',
    fetchedAt: '2026-09-01',
    ...overrides,
  };
}

function grouped(about = '1', amount: string | null = '10.00', count = 2) {
  return {
    data: {
      state: 'reported',
      about: { registration_number: about },
      year: 2025,
      release_id: 'release-1',
      snapshot_id: 'download-1',
      group_by: 'spender',
      groups: [
        {
          spender: 'Example Fund',
          spender_registration_number: '900',
          spender_linkable: true,
          grouping_basis: 'registration_number',
          direction: 'For',
          amount,
          row_count: count,
        },
      ],
      figures: {
        row_count: count,
        spender_count: 1,
        supporting_amount: amount,
        supporting_count: count,
        supporting_spender_count: 1,
        opposing_amount: '0',
        opposing_count: 0,
        opposing_spender_count: 0,
        direction_not_recorded_amount: '0',
        direction_not_recorded_count: 0,
        direction_not_recorded_spender_count: 0,
      },
    },
  };
}

function payment(record: number, about = '1') {
  return {
    spender: 'Example Fund',
    spender_registration_number: '900',
    about_committee_registration_number: about,
    direction: 'For',
    amount: '5.00',
    paid_on: '2025-01-01',
    purpose: 'Postcards',
    vendor_name: 'Printer',
    record_number: record,
    year: 2025,
  };
}

function page(rows = [payment(1), payment(2)], number = 1, total = 2, more = false) {
  return {
    data: {
      state: 'reported',
      about: { registration_number: '1' },
      year: 2025,
      release_id: 'release-1',
      snapshot_id: 'download-1',
      rows,
      page: { number, size: 50, total_rows: total, has_more: more },
      figures: null,
    },
  };
}

beforeEach(() => request.mockReset());

describe('complete outside spending reads', () => {
  it('makes one grouped request per confirmed committee without loading raw payments', async () => {
    request.mockResolvedValueOnce(grouped());
    request.mockResolvedValueOnce(grouped('2', '0.20', 1));
    const result = await getGroupedOutsideSpending(
      year({
        supportingPayments: 3,
        committees: [
          ...year().committees,
          { registrationNumber: '2', name: 'Second committee', office: null },
        ],
      }),
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      '/campaign-finance/outside-spending?about=1&year=2025&group_by=spender',
      '/campaign-finance/outside-spending?about=2&year=2025&group_by=spender',
    ]);
    expect(result.figures[0]).toMatchObject({ amount: '10.20', paymentCount: 3, spenderCount: 1 });
    expect(result.groups).toHaveLength(1);
    expect(result).toMatchObject({ snapshotId: 'download-1', releaseId: 'release-1' });
  });

  it('keeps state refusals for headline amounts even when another direction has complete rows', async () => {
    const body = grouped('1', null);
    body.data.figures.opposing_amount = null as unknown as string;
    body.data.figures.direction_not_recorded_amount = null as unknown as string;
    request.mockResolvedValueOnce(body);
    const result = await getGroupedOutsideSpending(year());
    expect(result.figures.map((figure) => figure.amount)).toEqual([null, null, null]);
  });

  it('rejects download changes and does not compare a release UUID with a download UUID', async () => {
    request.mockResolvedValueOnce({ data: { ...grouped().data, snapshot_id: 'download-2' } });
    await expect(getGroupedOutsideSpending(year())).rejects.toMatchObject({
      reason: 'snapshot_changed',
    });
    request.mockResolvedValueOnce(grouped());
    await expect(getGroupedOutsideSpending(year())).resolves.toMatchObject({
      releaseId: 'release-1',
      snapshotId: 'download-1',
    });
  });

  it('rejects mixed releases across confirmed committees', async () => {
    request.mockResolvedValueOnce(grouped());
    request.mockResolvedValueOnce({ data: { ...grouped('2').data, release_id: 'release-2' } });
    await expect(
      getGroupedOutsideSpending(
        year({
          committees: [
            ...year().committees,
            { registrationNumber: '2', name: 'Second', office: null },
          ],
          supportingPayments: 4,
        }),
      ),
    ).rejects.toMatchObject({ reason: 'release_changed' });
  });

  it('does not show a truncated grouping or silently switch candidate or year', async () => {
    request.mockResolvedValueOnce({ data: { ...grouped().data, groups: [] } });
    await expect(getGroupedOutsideSpending(year())).rejects.toMatchObject({
      reason: 'incomplete_groups',
    });
    request.mockResolvedValueOnce({ data: { ...grouped().data, year: 2024 } });
    await expect(getGroupedOutsideSpending(year())).rejects.toMatchObject({
      reason: 'wrong_scope',
    });
    request.mockResolvedValueOnce(grouped('9'));
    await expect(getGroupedOutsideSpending(year())).rejects.toMatchObject({
      reason: 'wrong_scope',
    });
  });

  it('requires the full grouped count to agree with the selected year summary', async () => {
    request.mockResolvedValueOnce(grouped());
    await expect(getGroupedOutsideSpending(year({ supportingPayments: 3 }))).rejects.toMatchObject({
      reason: 'summary_changed',
    });
  });

  it('recognizes a confirmed no-row committee without treating an unavailable file as zero', async () => {
    const empty = { ...grouped().data, state: 'not_reported', groups: [], figures: null };
    request.mockResolvedValueOnce({ data: empty });
    expect((await getGroupedOutsideSpending(year({ supportingPayments: 0 }))).groups).toEqual([]);
    request.mockResolvedValueOnce({ data: { ...empty, state: 'unavailable' } });
    await expect(getGroupedOutsideSpending(year({ supportingPayments: 0 }))).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });

  it('loads all 50-row pages and preserves separate payments with the same date and amount', async () => {
    request.mockResolvedValueOnce(grouped('1', '255.00', 51));
    const summary = await getGroupedOutsideSpending(year({ supportingPayments: 51 }));
    request.mockResolvedValueOnce(
      page(
        Array.from({ length: 50 }, (_, index) => payment(index + 1)),
        1,
        51,
        true,
      ),
    );
    request.mockResolvedValueOnce(page([payment(51)], 2, 51));
    const rows = await getCompleteOutsideSpendingPayments(summary);
    expect(rows).toHaveLength(51);
    expect(rows[50]).toMatchObject({
      recordNumber: 51,
      paidOn: '2025-01-01',
      amount: '5.00',
      purpose: 'Postcards',
      vendorName: 'Printer',
    });
    expect(request.mock.calls[2][0]).toContain('page=2&sort=newest');
  });

  it.each(['release_id', 'snapshot_id'] as const)(
    'rejects a changed %s during expanded payments',
    async (field) => {
      request.mockResolvedValueOnce(grouped());
      const summary = await getGroupedOutsideSpending(year());
      request.mockResolvedValueOnce({ data: { ...page().data, [field]: 'different' } });
      await expect(getCompleteOutsideSpendingPayments(summary)).rejects.toMatchObject({
        reason: field === 'release_id' ? 'release_changed' : 'snapshot_changed',
      });
    },
  );

  it('rejects premature pagination, a changed detail sum, and the wrong spender', async () => {
    request.mockResolvedValueOnce(grouped());
    const summary = await getGroupedOutsideSpending(year());
    request.mockResolvedValueOnce(page([payment(1)]));
    await expect(getCompleteOutsideSpendingPayments(summary)).rejects.toMatchObject({
      reason: 'incomplete_payments',
    });
    request.mockResolvedValueOnce(page([{ ...payment(1), amount: '8' }, payment(2)]));
    await expect(getCompleteOutsideSpendingPayments(summary)).rejects.toMatchObject({
      reason: 'incomplete_payments',
    });
    request.mockResolvedValueOnce(
      page([{ ...payment(1), spender_registration_number: 'wrong' }, payment(2)]),
    );
    await expect(getCompleteOutsideSpendingPayments(summary)).rejects.toMatchObject({
      reason: 'unexpected_spender',
    });
  });

  it('honors cancellation before a source request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(getGroupedOutsideSpending(year(), controller.signal)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses repeated source rows without deduplicating real gifts that share their details', async () => {
    request.mockResolvedValueOnce(grouped());
    const summary = await getGroupedOutsideSpending(year());
    request.mockResolvedValueOnce(page([payment(1), payment(1)]));
    await expect(getCompleteOutsideSpendingPayments(summary)).rejects.toMatchObject({
      reason: 'overlapping_pages',
    });
  });
});
