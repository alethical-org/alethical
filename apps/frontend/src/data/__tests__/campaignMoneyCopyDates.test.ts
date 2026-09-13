import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { committeeFinanceFromPayload, getLegislatorCampaignMoneyFromApi } from '../api';
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
      report_totals_copied_at: copiedAt,
    });
    expect(money.fetchedAt).toBe(paymentDate);
    expect(money.reportTotalsCopiedAt).toBe(copiedAt ?? null);
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
              report_totals_copied_at: copiedAt,
              committees: [],
            },
          }),
        ),
      );
      const money = await getLegislatorCampaignMoneyFromApi('fixture-member', 2025);
      expect(money.fetchedAt).toBe(paymentDate);
      expect(money.reportTotalsCopiedAt).toBe(copiedAt ?? null);
    },
  );
});
