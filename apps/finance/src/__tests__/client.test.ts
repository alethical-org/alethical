import { describe, expect, it, vi } from 'vitest';

import { accessFromStatus, checkAccess, requestSignInCode } from '../api/client';

describe('access answers', () => {
  it.each([
    [200, 'granted'],
    [401, 'signed-out'],
    [403, 'no-access'],
    [503, 'unavailable'],
    [500, 'unavailable'],
  ] as const)('reads HTTP %i as %s', (status, state) => {
    expect(accessFromStatus(status)).toBe(state);
  });

  it('asks with the bearer token and never from a cache', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    expect(await checkAccess('https://api.example.test', 'token-1', fetcher)).toBe('granted');
    expect(fetcher).toHaveBeenCalledWith('https://api.example.test/api/v1/finance/access', {
      headers: { Authorization: 'Bearer token-1' },
      cache: 'no-store',
    });
  });

  it('reads a network failure as unavailable, never as no access', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('offline');
    });
    expect(await checkAccess('https://api.example.test', 'token-1', fetcher)).toBe('unavailable');
  });
});

describe('code requests', () => {
  it.each([
    [202, 'accepted'],
    [422, 'invalid-email'],
    [429, 'rate-limited'],
    [503, 'unavailable'],
  ] as const)('reads HTTP %i as %s', async (status, result) => {
    const fetcher = vi.fn(async () => new Response(null, { status }));
    expect(await requestSignInCode('https://api.example.test', 'a@b.co', fetcher)).toBe(result);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/finance/sign-in/code',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'a@b.co' }) }),
    );
  });
});
