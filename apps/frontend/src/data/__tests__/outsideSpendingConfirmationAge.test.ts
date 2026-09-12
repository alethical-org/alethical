import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_SHARED_CACHE_MAX_AGE_MS } from '../../lib/currentClaimFreshness';

const payload = (overrides: Record<string, unknown> = {}) => ({
  data: {
    year: 2026,
    state: 'reported',
    snapshot_id: 'snapshot-1',
    supporting: '100.0000',
    opposing: '0.0000',
    direction_not_recorded: '0.0000',
    supporting_payments: 1,
    opposing_payments: 0,
    direction_not_recorded_payments: 0,
    fetched_at: '2020-01-01T00:00:00Z',
    committees: [{ registration_number: '17868', committee_name: 'Sample committee' }],
    ...overrides,
  },
});

describe('outside-spending confirmation age', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.test');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function read(age: string | null, body = payload()) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json', ...(age === null ? {} : { Age: age }) },
      }),
    );
    const { getLegislatorOutsideSpendingFromApi } = await import('../api');
    return getLegislatorOutsideSpendingFromApi('leg-1', 2026);
  }

  it.each([
    ['120', 120_000],
    [null, API_SHARED_CACHE_MAX_AGE_MS],
    ['unreadable', API_SHARED_CACHE_MAX_AGE_MS],
    ['9999', API_SHARED_CACHE_MAX_AGE_MS],
  ])('carries cache age %s independently of the download date', async (age, expected) => {
    const year = await read(age);
    expect(year.currentClaim).toEqual({ servedAgeMs: expected, validatedAt: null });
    expect(year.fetchedAt).toBe('2020-01-01T00:00:00Z');
    expect(year.supporting).toBe(100);
  });

  it('gives an unusable reported response no fresh claim or figures', async () => {
    const year = await read('0', payload({ supporting_payments: undefined }));
    expect(year.state).toBe('load_failed');
    expect(year.currentClaim).toBeUndefined();
    expect(year.supporting).toBeNull();
    expect(year.committees).toEqual([]);
  });

  it('rejects a failed recheck without renewing the previous answer', async () => {
    const held = await read('120');
    fetchMock.mockImplementation(async () => new Response('Temporary failure', { status: 503 }));
    const { getLegislatorOutsideSpendingFromApi } = await import('../api');
    await expect(getLegislatorOutsideSpendingFromApi('leg-1', 2026)).rejects.toMatchObject({
      status: 503,
    });
    expect(held.currentClaim).toEqual({ servedAgeMs: 120_000, validatedAt: null });
    expect(held.supporting).toBe(100);
  });
});
