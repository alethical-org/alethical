import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCampaignMoneyHistory,
  getCampaignMoneyYearState,
  getCompleteCampaignMoneyPayments,
} from '../campaignMoneyDetails';
import { publicApiRequest } from '../api';

vi.mock('../api', () => ({ publicApiRequest: vi.fn() }));
const request = vi.mocked(publicApiRequest);
const row = {
  contributor: 'Same name',
  amount: '10',
  receipt_type: 'Contribution',
  in_kind: 'No',
  received_on: '2025-01-01',
};
const page = (
  rows: Record<string, unknown>[],
  offset: number,
  total: number,
  hasMore = false,
  release = 'release-1',
) => ({
  data: {
    registration_number: '17868',
    state: 'reported',
    payments: rows,
    page: { limit: 250, offset, total_payments: total, has_more: hasMore },
    release_id: release,
    source_url: 'https://cfb.mn.gov/source',
    fetched_at: '2026-09-01',
    linkable_registration_numbers: offset ? ['2'] : ['1'],
  },
});
beforeEach(() => request.mockReset());

describe('complete single-committee payment reads', () => {
  it('loads every page with no payment deduplication and combines linkability', async () => {
    request.mockResolvedValueOnce(
      page(
        Array.from({ length: 250 }, () => row),
        0,
        251,
        true,
      ),
    );
    request.mockResolvedValueOnce(page([row], 250, 251));
    const result = await getCompleteCampaignMoneyPayments('17868', 2025, 'received');
    expect(result.payments).toHaveLength(251);
    expect(result.totalPayments).toBe(251);
    expect(result.linkableRegistrationNumbers).toEqual(['1', '2']);
    expect(request.mock.calls[0][0]).toContain('limit=250&offset=0');
    expect(request.mock.calls[1][0]).toContain('offset=250');
  });

  it('rejects a release change rather than splicing generations', async () => {
    request.mockResolvedValueOnce(page([row], 0, 2, true));
    request.mockResolvedValueOnce(page([row], 1, 2, false, 'release-2'));
    await expect(getCompleteCampaignMoneyPayments('17868', 2025, 'received')).rejects.toMatchObject(
      { reason: 'release_changed' },
    );
  });

  it('rejects a truncated list and a stalled page', async () => {
    request.mockResolvedValueOnce(page([row], 0, 2));
    await expect(getCompleteCampaignMoneyPayments('17868', 2025, 'received')).rejects.toMatchObject(
      { reason: 'incomplete_list' },
    );
    request.mockResolvedValueOnce(page([], 0, 2, true));
    await expect(getCompleteCampaignMoneyPayments('17868', 2025, 'received')).rejects.toMatchObject(
      { reason: 'invalid_page' },
    );
  });

  it('does not turn unavailable data into a reported zero', async () => {
    request.mockResolvedValueOnce({
      data: { state: 'unavailable', payments: [], release_id: 'release-1' },
    });
    const result = await getCompleteCampaignMoneyPayments('17868', 2025, 'made');
    expect(result).toMatchObject({ state: 'unavailable', payments: [], totalPayments: null });
  });

  it('keeps transaction trace fields and expenditure details', async () => {
    request.mockResolvedValueOnce(
      page([{ ...row, record_number: 56, in_kind_description: 'Signs' }], 0, 1),
    );
    const received = await getCompleteCampaignMoneyPayments('17868', 2025, 'received');
    expect(received.payments[0]).toMatchObject({ recordNumber: 56, inKindDescription: 'Signs' });
    request.mockResolvedValueOnce(
      page(
        [
          {
            vendor_name: 'Printer',
            vendor_city: 'Anoka',
            vendor_state: 'MN',
            purpose: 'Signs',
            amount: '10',
            unpaid_amount: '2',
            paid_on: '2025-01-01',
            in_kind: 'No',
            record_number: 70,
          },
        ],
        0,
        1,
      ),
    );
    const made = await getCompleteCampaignMoneyPayments('17868', 2025, 'made');
    expect(made.payments[0]).toMatchObject({
      vendorName: 'Printer',
      vendorCity: 'Anoka',
      unpaidAmount: '2',
      recordNumber: 70,
    });
  });

  it('propagates cancellation before another request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      getCompleteCampaignMoneyPayments('17868', 2025, 'received', controller.signal),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses the wrong year and direction when the response identifies them', async () => {
    request.mockResolvedValueOnce({ data: { ...page([row], 0, 1).data, year: 2024 } });
    await expect(getCompleteCampaignMoneyPayments('17868', 2025, 'received')).rejects.toMatchObject(
      { reason: 'wrong_year' },
    );
    request.mockResolvedValueOnce({ data: { ...page([row], 0, 1).data, direction: 'made' } });
    await expect(getCompleteCampaignMoneyPayments('17868', 2025, 'received')).rejects.toMatchObject(
      { reason: 'wrong_direction' },
    );
  });

  it('keeps separate committees separate at the request boundary', async () => {
    request.mockResolvedValueOnce({
      data: { ...page([row], 0, 1).data, registration_number: '999' },
    });
    await expect(getCompleteCampaignMoneyPayments('17868', 2025, 'received')).rejects.toMatchObject(
      { reason: 'wrong_committee' },
    );
  });
});

describe('history and year availability', () => {
  it('keeps every requested year in order and reuses the complete selected year', async () => {
    request.mockResolvedValueOnce(page([row], 0, 1));
    const selected = await getCompleteCampaignMoneyPayments('17868', 2025, 'received');
    request.mockResolvedValue(page([row], 0, 1));
    const history = await getCampaignMoneyHistory('17868', [2024, 2025, 2026], selected);
    expect(history.years.map((year) => year.year)).toEqual([2024, 2025, 2026]);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('does not publish a history from mismatched releases or an unavailable year', async () => {
    request.mockResolvedValueOnce(page([row], 0, 1));
    const selected = await getCompleteCampaignMoneyPayments('17868', 2025, 'received');
    request.mockResolvedValueOnce(page([row], 0, 1, false, 'release-2'));
    await expect(getCampaignMoneyHistory('17868', [2024, 2025], selected)).rejects.toMatchObject({
      reason: 'release_changed',
    });
    request.mockResolvedValueOnce({
      data: { state: 'unavailable', payments: [], release_id: 'release-1' },
    });
    await expect(getCampaignMoneyHistory('17868', [2024], selected)).rejects.toMatchObject({
      reason: 'history_unavailable',
    });
  });

  it('uses the actual server state per committee without assuming an older-year cutoff', async () => {
    request.mockResolvedValueOnce({
      data: {
        year: 2022,
        link_state: 'confirmed',
        committees: [
          { registration_number: '1', split: { state: 'shown', reported_total: '100' } },
          { registration_number: '2', split: { state: 'no_reported_total', reported_total: null } },
        ],
      },
    });
    expect(await getCampaignMoneyYearState('member', 2022)).toEqual({
      year: 2022,
      linkState: 'confirmed',
      committees: {
        '1': { splitState: 'shown', reportedTotal: '100' },
        '2': { splitState: 'no_reported_total', reportedTotal: null },
      },
    });
  });
});
