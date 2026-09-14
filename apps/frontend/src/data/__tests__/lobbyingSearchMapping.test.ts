import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  process.env.EXPO_PUBLIC_API_URL = 'http://records.test';
});
import { getCampaignFinanceNameSearchFromApi } from '../api';
import live from './fixtures/lobbying-search-live.json';

afterEach(() => vi.unstubAllGlobals());
function answer(data: unknown) {
  const fetcher = vi.fn(
    async (_url: string) =>
      new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('lobbying rows in the one money search service', () => {
  it('keeps the real current lobbyist separate from both exact payment-name spellings', async () => {
    const fetcher = answer(live.kozak);
    const result = await getCampaignFinanceNameSearchFromApi('Kozak');
    const lobbyists = result.groups.find((group) => group.kind === 'lobbyists')!;
    expect(lobbyists).toMatchObject({
      state: 'reported',
      total: 1,
      hasMore: false,
      results: [
        { kind: 'lobbyist', name: 'Kozak, Andrew', registrationNumber: '141', principalCount: 13 },
      ],
    });
    expect(
      result.groups
        .find((group) => group.kind === 'gave')
        ?.results.map((row) => ('name' in row ? row.name : null)),
    ).toEqual(['Kozak, Andrew', 'Kozak, Andrew V']);
    expect(result.groups.find((group) => group.kind === 'principals')).toMatchObject({
      state: 'not_reported',
      total: 0,
      results: [],
    });
    expect(fetcher.mock.calls[0][0]).toContain('/campaign-finance/search?q=Kozak&limit=5');
  });

  it('preserves per-principal years, IDs and linkability without passing extra contact fields', async () => {
    answer({
      state: 'reported',
      q: 'test',
      groups: [
        {
          kind: 'principals',
          state: 'reported',
          total: 2,
          results: [live.linked_principal, live.list_only_principal].map((row) => ({
            ...row,
            kind: 'principal',
            source_latest_year: live.source_latest_year,
            zip_code: 'DO-NOT-PASS',
            email_address: 'DO-NOT-PASS',
          })),
        },
      ],
    });
    const result = await getCampaignFinanceNameSearchFromApi('test');
    expect(result.groups[0].results).toEqual([
      {
        kind: 'principal',
        name: live.linked_principal.name,
        entityId: live.linked_principal.entity_id,
        latestReportedYear: 2017,
        sourceLatestYear: 2025,
        linkable: true,
        state: 'reported',
      },
      {
        kind: 'principal',
        name: live.list_only_principal.name,
        entityId: live.list_only_principal.entity_id,
        latestReportedYear: null,
        sourceLatestYear: 2025,
        linkable: false,
        state: 'no_spending_rows',
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/zip_code|email_address|DO-NOT-PASS/);
  });

  it('keeps a failed lobbying group unavailable with no stale rows or invented count', async () => {
    answer({
      state: 'reported',
      q: 'test',
      groups: [
        {
          kind: 'lobbyists',
          state: 'unavailable',
          total: null,
          reason: 'copy_unavailable',
          results: live.kozak.groups.find((group) => group.kind === 'lobbyists')!.results,
        },
        { kind: 'principals', state: 'not_reported', total: 0, results: [] },
      ],
    });
    const result = await getCampaignFinanceNameSearchFromApi('test');
    expect(result.groups[0]).toMatchObject({
      kind: 'lobbyists',
      state: 'unavailable',
      total: null,
      reason: 'copy_unavailable',
      results: [],
    });
    expect(result.groups[1]).toMatchObject({ state: 'not_reported', total: 0, results: [] });
  });
});
