import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BILL_ID = '94-2026-HF4138';
const apiOrigin = 'https://api.example.test';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('bill detail requests', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('EXPO_PUBLIC_API_URL', apiOrigin);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('loads a bill detail without requesting votes', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          id: BILL_ID,
          title: 'Test bill',
          chief_sponsors: [],
        },
      }),
    );

    const { getBillFromApi } = await import('../api');
    await getBillFromApi(BILL_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain(`/bills/${BILL_ID}?include=`);
    expect(fetchMock.mock.calls[0][0]).not.toContain('/votes');
  });

  it('loads votes in their own request only when a reader asks for them', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));

    const { getBillVotesFromApi } = await import('../api');
    await getBillVotesFromApi(BILL_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${apiOrigin}/api/v1/bills/${BILL_ID}/votes`);
  });

  it('keeps an Ask topic separate from a typed keyword search', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [],
        page: { limit: 10, offset: 0, has_more: false, total: 0 },
      }),
    );

    const { listBillsFromApi } = await import('../api');
    await listBillsFromApi(undefined, undefined, {
      topic: 'consumer protection',
      scope: 'legislature',
    });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('topic=consumer+protection');
    expect(url).toContain('scope=legislature');
    expect(url).not.toContain('&q=');
  });

  it('loads issue counts for the same whole-Legislature scope', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [], page: {} }));

    const { listPolicyAreasFromApi } = await import('../api');
    await listPolicyAreasFromApi(undefined, 'legislature');

    expect(String(fetchMock.mock.calls[0][0])).toContain('scope=legislature');
  });
});
