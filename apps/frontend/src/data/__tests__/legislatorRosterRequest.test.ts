import { afterEach, describe, expect, it, vi } from 'vitest';

const session = '94-2025-regular';

function rosterPage({ total = 200, hasMore = false }: { total?: number; hasMore?: boolean } = {}) {
  return {
    data: Array.from({ length: 200 }, (_, index) => ({
      id: `legislator-${index + 1}`,
      slug: `legislator-${index + 1}`,
      full_name: `Legislator ${index + 1}`,
      current_service: {
        chamber: 'house',
        party: 'DFL',
        district: { id: `district-${index + 1}`, code: String(index + 1) },
      },
      committees: [],
      stats: { chief_bill_count: 0, total_bill_count: 0 },
    })),
    page: { limit: 250, offset: 0, has_more: hasMore, total },
  };
}

async function requestRoster(page = rosterPage()) {
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.test');
  vi.resetModules();
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(page), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const { listLegislatorsFromApi } = await import('../api');

  return { legislators: await listLegislatorsFromApi(undefined, session), fetch };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('listLegislatorsFromApi roster request', () => {
  it('gets the complete selected-session roster in 1 public request', async () => {
    const { legislators, fetch } = await requestRoster();

    expect(legislators).toHaveLength(200);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      `https://api.example.test/api/v1/legislators?limit=250&offset=0&session=${session}`,
      expect.any(Object),
    );
  });

  it('refuses a response that would silently omit part of the roster', async () => {
    await expect(requestRoster(rosterPage({ total: 201, hasMore: true }))).rejects.toThrow(
      'Legislator roster response is incomplete.',
    );
  });
});
