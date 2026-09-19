import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publicReadResponse } from '../publicRead';

describe('public reads during a brief service overload', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits for the requested second before its single retry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(new Response('records'));
    vi.stubGlobal('fetch', fetch);
    const read = publicReadResponse('https://records.test');
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await read).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns a longer busy period without retrying ahead of the server', async () => {
    const busy = new Response(null, { status: 503, headers: { 'Retry-After': '30' } });
    const fetch = vi.fn().mockResolvedValue(busy);
    vi.stubGlobal('fetch', fetch);
    expect(await publicReadResponse('https://records.test')).toBe(busy);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('also honors a short HTTP-date retry time', async () => {
    vi.setSystemTime(new Date('2026-09-19T13:00:00Z'));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 503,
          headers: { 'Retry-After': 'Sat, 19 Sep 2026 13:00:01 GMT' },
        }),
      )
      .mockResolvedValueOnce(new Response('records'));
    vi.stubGlobal('fetch', fetch);
    const read = publicReadResponse('https://records.test');
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await read).status).toBe(200);
  });

  it.each(['invalid', '0'])('keeps the bounded retry for Retry-After %s', async (value) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { 'Retry-After': value } }))
      .mockResolvedValueOnce(new Response('records'));
    vi.stubGlobal('fetch', fetch);
    expect((await publicReadResponse('https://records.test')).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the wait without sending another request', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503, headers: { 'Retry-After': '1' } }));
    vi.stubGlobal('fetch', fetch);
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const read = publicReadResponse('https://records.test', { signal: caller.signal });
    const rejected = expect(read).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100);
    caller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops after the second busy response', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 503, headers: { 'Retry-After': '1' } })),
      );
    vi.stubGlobal('fetch', fetch);
    const read = publicReadResponse('https://records.test');
    await vi.advanceTimersByTimeAsync(1000);
    expect((await read).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
