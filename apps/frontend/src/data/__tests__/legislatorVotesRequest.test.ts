import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiOrigin = 'https://api.example.test';

describe('legislator vote requests', () => {
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

  it('maps the newest real member vote into the roadmap preview fields', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'record-1',
              vote_value: 'yes',
              vote_event_id: 'event-1',
              bill_id: '94-2025-SF1832',
              bill_code: 'SF 1832',
              occurred_at: '2025-05-30T00:00:00Z',
              chamber: 'senate',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { getLegislatorVotesFromApi } = await import('../api');
    const votes = await getLegislatorVotesFromApi('aisha-gomez', 1);

    expect(fetchMock).toHaveBeenCalledWith(
      `${apiOrigin}/api/v1/legislators/aisha-gomez/votes?limit=1`,
      expect.any(Object),
    );
    expect(votes).toEqual([
      {
        id: 'record-1',
        vote: 'yes',
        billId: '94-2025-SF1832',
        billCode: 'SF 1832',
        date: '2025-05-30',
        chamber: 'Senate',
      },
    ]);
  });
});
