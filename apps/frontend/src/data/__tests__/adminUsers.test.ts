import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('private account requests', () => {
  it('sends credentials and email search in a non-cached POST body, with cancellation', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.com');
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [],
            summary: {
              confirmed_accounts: 0,
              pending_accounts: 0,
              confirmed_today: 0,
              confirmed_7d: 0,
              confirmed_30d: 0,
            },
            page: { offset: 0, limit: 25, total: 0, has_more: false },
            as_of: '2026-09-07T12:00:00Z',
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const { searchAdminUsersFromApi } = await import('../adminUsers');
    const search = {
      query: 'person@example.com',
      status: 'all' as const,
      created_within_days: null,
      offset: 0,
      limit: 25,
    };
    const controller = new AbortController();
    await searchAdminUsersFromApi('test-access-token', search, controller.signal);
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/api/v1/admin/users/search', {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      body: JSON.stringify(search),
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json',
      },
    });
  });
  it('keeps access-check failure distinct from a successful refusal', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.com');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { is_admin: false } }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    const { getAdminAccessFromApi } = await import('../api');
    expect(await getAdminAccessFromApi('test-access-token')).toBe(false);
    await expect(getAdminAccessFromApi('test-access-token')).rejects.toMatchObject({ status: 503 });
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-store' });
  });
});
