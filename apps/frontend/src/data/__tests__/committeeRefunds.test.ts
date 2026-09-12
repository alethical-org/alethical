import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { getLegislatorCampaignMoneyFromApi } from '../api';
import { publicReadResponse } from '../../lib/publicRead';

vi.hoisted(() => vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.test'));
afterAll(() => vi.unstubAllEnvs());

vi.mock('../../lib/publicRead', () => ({ publicReadResponse: vi.fn() }));
const read = vi.mocked(publicReadResponse);
const sourceUrl =
  'https://cfb.mn.gov/citizen-resources/board-programs/public-subsidy-of-campaigns/historical-use-of-public-subsidy-program/';
// Figures and missing count from committee 17868's live refunds block, copied Sep 12, 2026.
const refunds = {
  state: 'reported',
  source_url: sourceUrl,
  copied_on: '2026-09-12',
  years: [
    {
      year: 2025,
      state: 'reported',
      contributions_refunded: 180,
      amount_refunded: '14216.47',
      source_file_name: '2025_refunds_cand.pdf',
      copied_on: '2026-09-12',
      joint_filing_counts_as_one: true,
    },
    {
      year: 2024,
      state: 'reported',
      contributions_refunded: null,
      amount_refunded: '10508.22',
      source_file_name: '2024_refunds_cand.pdf',
      copied_on: '2026-09-12',
      joint_filing_counts_as_one: true,
    },
    {
      year: 2016,
      state: 'not_published',
      contributions_refunded: null,
      amount_refunded: null,
      source_file_name: null,
      copied_on: null,
      joint_filing_counts_as_one: null,
    },
  ],
};
const payload = {
  legislator_id: 'jim-abeler',
  year: 2025,
  link_state: 'confirmed',
  release_id: 'test-release',
  committees: [],
};
function respond(data: unknown) {
  read.mockResolvedValue(new Response(JSON.stringify({ data }), { headers: { Age: '30' } }));
}
const committee = (block: unknown = refunds) => ({
  registration_number: '17868',
  committee_name_as_reviewed: 'Abeler, Jim Senate Committee',
  refunds: block,
  split: { state: 'no_reported_total' },
});
afterEach(() => vi.clearAllMocks());

describe('the refund block on a legislator response', () => {
  it('preserves exact amounts, absent counts, source notes and distinct missing-file states', async () => {
    respond({ ...payload, committees: [committee()] });
    const result = await getLegislatorCampaignMoneyFromApi('jim-abeler', 2025);
    expect(result.committees[0].refunds).toEqual({
      state: 'reported',
      sourceUrl,
      copiedOn: '2026-09-12',
      years: [
        {
          year: 2025,
          state: 'reported',
          contributionsRefunded: 180,
          amountRefunded: '14216.47',
          sourceFileName: '2025_refunds_cand.pdf',
          copiedOn: '2026-09-12',
          jointFilingCountsAsOne: true,
        },
        {
          year: 2024,
          state: 'reported',
          contributionsRefunded: null,
          amountRefunded: '10508.22',
          sourceFileName: '2024_refunds_cand.pdf',
          copiedOn: '2026-09-12',
          jointFilingCountsAsOne: true,
        },
        {
          year: 2016,
          state: 'not_published',
          contributionsRefunded: null,
          amountRefunded: null,
          sourceFileName: null,
          copiedOn: null,
          jointFilingCountsAsOne: null,
        },
      ],
    });
    expect(result.currentClaim.servedAgeMs).toBe(30_000);
  });

  it('keeps all refund years on an out-of-year confirmed committee without adding campaign totals', async () => {
    respond({ ...payload, year: 2023, committees_outside_this_year: [committee()] });
    const result = await getLegislatorCampaignMoneyFromApi('jim-abeler', 2023);
    expect(result.committees).toEqual([]);
    expect(result.committeesOutsideThisYear[0]).toMatchObject({
      registrationNumber: '17868',
      refunds: { years: [{ year: 2025 }, { year: 2024 }, { year: 2016 }] },
    });
  });

  it('does not invent source dates, links or counting rules for older cached responses', async () => {
    respond({
      ...payload,
      committees: [
        committee({
          state: 'unavailable',
          years: [
            {
              year: 2025,
              state: 'unavailable',
              contributions_refunded: null,
              amount_refunded: null,
              source_file_name: null,
              copied_on: null,
            },
          ],
        }),
      ],
    });
    const result = await getLegislatorCampaignMoneyFromApi('jim-abeler', 2025);
    expect(result.committees[0].refunds).toMatchObject({
      state: 'unavailable',
      sourceUrl: null,
      copiedOn: null,
      years: [
        {
          state: 'unavailable',
          jointFilingCountsAsOne: null,
          contributionsRefunded: null,
          amountRefunded: null,
        },
      ],
    });
    respond({ ...payload, committees: [committee(null)] });
    expect(
      (await getLegislatorCampaignMoneyFromApi('jim-abeler', 2025)).committees[0].refunds,
    ).toBeUndefined();
  });

  it('retains the source date and URL when no candidate row matches', async () => {
    respond({
      ...payload,
      committees: [committee({ ...refunds, state: 'not_matched', years: [] })],
    });
    expect(
      (await getLegislatorCampaignMoneyFromApi('jim-abeler', 2025)).committees[0].refunds,
    ).toMatchObject({ state: 'not_matched', sourceUrl, copiedOn: '2026-09-12' });
  });
});
