import { describe, expect, it, vi } from 'vitest';

import { accessFromStatus, checkAccess, proveSignInCode, requestSignInCode } from '../api/client';

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
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/finance/access',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token-1' },
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('reads a network failure as unavailable, never as no access', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('offline');
    });
    expect(await checkAccess('https://api.example.test', 'token-1', fetcher)).toBe('unavailable');
  });
});

describe('code requests', () => {
  const request = (fetcher: typeof fetch) =>
    requestSignInCode('https://api.example.test', 'a@b.co', fetcher);

  it('keeps the challenge an accepted request answers with', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { status: 'accepted', challenge: 'challenge-1' } }), {
          status: 202,
        }),
    );
    expect(await request(fetcher)).toEqual({ kind: 'accepted', challenge: 'challenge-1' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/finance/sign-in/code',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.co' }),
      }),
    );
  });

  it.each([
    [422, 'invalid-email'],
    [429, 'rate-limited'],
    [503, 'unavailable'],
  ] as const)('reads HTTP %i as %s', async (status, kind) => {
    expect(await request(vi.fn(async () => new Response(null, { status })))).toEqual({ kind });
  });

  it('treats a 202 without a challenge, or no answer, as unavailable', async () => {
    const empty = vi.fn(
      async () => new Response(JSON.stringify({ data: { status: 'accepted' } }), { status: 202 }),
    );
    expect(await request(empty)).toEqual({ kind: 'unavailable' });
    const offline = vi.fn(async () => {
      throw new TypeError('offline');
    });
    expect(await request(offline)).toEqual({ kind: 'unavailable' });
  });
});

describe('code proofs', () => {
  const prove = (fetcher: typeof fetch) =>
    proveSignInCode('https://api.example.test', 'a@b.co', '12345678', 'challenge-1', fetcher);

  it('returns the 1-time token from a proved code', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { token_hash: 'tok', type: 'email' } }), {
          status: 200,
        }),
    );
    expect(await prove(fetcher)).toEqual({
      kind: 'token',
      tokenHash: 'tok',
      type: 'email',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/finance/sign-in/verify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.co', code: '12345678', challenge: 'challenge-1' }),
      }),
    );
  });

  it.each([
    [400, 'refused'],
    [429, 'rate-limited'],
    [503, 'unavailable'],
  ] as const)('reads HTTP %i as %s', async (status, kind) => {
    expect(await prove(vi.fn(async () => new Response(null, { status })))).toEqual({ kind });
  });

  it('treats a 200 without a token, or no answer, as unavailable', async () => {
    const empty = vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 }));
    expect(await prove(empty)).toEqual({ kind: 'unavailable' });
    const offline = vi.fn(async () => {
      throw new TypeError('offline');
    });
    expect(await prove(offline)).toEqual({ kind: 'unavailable' });
  });
});
