import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  committeeFinanceFromPayload,
  getLegislatorCampaignMoneyFromApi,
  getCommitteeFilingsFromApi,
} from '../api';
import { publicReadResponse } from '../../lib/publicRead';

vi.hoisted(() => vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.test'));
afterAll(() => vi.unstubAllEnvs());
vi.mock('../../lib/publicRead', () => ({ publicReadResponse: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const paymentDate = '2026-09-01T12:00:00Z';
const reportDate = '2026-08-11T12:00:00Z';

describe('source dates survive the API mapping separately', () => {
  it.each([reportDate, null, undefined])('keeps the committee report date %s', (copiedAt) => {
    const money = committeeFinanceFromPayload({
      registration_number: '17868',
      year: 2025,
      fetched_at: paymentDate,
      filings_copied_at: copiedAt,
    });
    expect(money.fetchedAt).toBe(paymentDate);
    expect(money.filingsCopiedAt).toBe(copiedAt ?? null);
  });

  it.each([reportDate, null, undefined])(
    'keeps the legislator report date %s',
    async (copiedAt) => {
      vi.mocked(publicReadResponse).mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              legislator_id: 'fixture-member',
              year: 2025,
              link_state: 'unconfirmed',
              release_id: 'fixture-release',
              fetched_at: paymentDate,
              filings_copied_at: copiedAt,
              committees: [],
            },
          }),
        ),
      );
      const money = await getLegislatorCampaignMoneyFromApi('fixture-member', 2025);
      expect(money.fetchedAt).toBe(paymentDate);
      expect(money.filingsCopiedAt).toBe(copiedAt ?? null);
    },
  );
});

it.each(['2026-08-12', null, undefined])(
  'uses the catalogue response copy date %s',
  async (asOf) => {
    vi.mocked(publicReadResponse).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            state: 'reported',
            as_of: asOf,
            filings: [],
            page: { total: 0, has_more: false },
          },
        }),
      ),
    );
    const result = await getCommitteeFilingsFromApi('19019');
    expect(result.asOf).toBe(asOf ?? null);
    expect(result.total).toBe(0);
  },
);
