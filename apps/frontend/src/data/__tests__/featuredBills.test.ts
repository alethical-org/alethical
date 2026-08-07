import { afterEach, describe, expect, it, vi } from 'vitest';

const FEATURED_BILL = {
  id: '94-2026-HF4138',
  file_type: 'HF',
  file_number: 4138,
  title: 'A featured bill',
  chief_sponsors: [],
  ai_analysis: { summary: 'Makes a concrete change.' },
};

async function loadFeaturedBillsApi() {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.test');
  return import('../api');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('getFeaturedBillsFromApi', () => {
  it('loads every featured summary in 1 public request and keeps a returned card', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: [FEATURED_BILL] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { getFeaturedBillsFromApi } = await loadFeaturedBillsApi();

    const bills = await getFeaturedBillsFromApi([FEATURED_BILL.id, '94-2025-SF856']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe('/api/v1/bills/featured');
    expect(requestUrl.searchParams.getAll('bill_id')).toEqual([FEATURED_BILL.id, '94-2025-SF856']);
    expect(bills.map((bill) => bill.id)).toEqual([FEATURED_BILL.id]);
  });

  it('keeps a short network failure as one rejected request', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Network request failed'));
    vi.stubGlobal('fetch', fetchMock);
    const { getFeaturedBillsFromApi } = await loadFeaturedBillsApi();

    await expect(getFeaturedBillsFromApi([FEATURED_BILL.id, '94-2025-SF856'])).rejects.toThrow(
      'Network request failed',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
