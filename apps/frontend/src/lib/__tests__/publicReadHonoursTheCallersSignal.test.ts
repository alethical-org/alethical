// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { publicReadResponse } from '../publicRead';

/**
 * A caller who has given up can stop a public read (issue #2020).
 *
 * Each attempt makes its own stopper for its 5-second timeout and hands that to
 * `fetch`, which means a caller's own stopper is dropped unless it is forwarded
 * onto it. Without the forwarding, a reader who types a longer name leaves the
 * shorter name's request running to the end and its answer arrives for nobody.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a public read can be given up on', () => {
  it('stops the request the caller stopped', async () => {
    let handed: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      // A real fetch rejects when the signal it was handed is stopped, so this
      // stand-in does too.
      vi.fn(async (_url: string, init?: RequestInit) => {
        handed = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          handed?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }),
    );

    const caller = new AbortController();
    const read = publicReadResponse('http://records.test/x', { signal: caller.signal });
    await Promise.resolve();

    expect(handed?.aborted).toBe(false);
    caller.abort();
    expect(handed?.aborted).toBe(true);
    await expect(read).rejects.toBeTruthy();
  });

  it('does not send a second attempt for a caller who has given up', async () => {
    const caller = new AbortController();
    const attempts = vi.fn(async () => {
      caller.abort();
      throw new Error('connection lost');
    });
    vi.stubGlobal('fetch', attempts);

    await expect(
      publicReadResponse('http://records.test/x', { signal: caller.signal }),
    ).rejects.toThrow('connection lost');
    expect(attempts).toHaveBeenCalledTimes(1);
  });

  it('still gives an ordinary read its one second chance', async () => {
    const attempts = vi.fn(async () => {
      throw new Error('connection lost');
    });
    vi.stubGlobal('fetch', attempts);

    await expect(publicReadResponse('http://records.test/x')).rejects.toThrow('connection lost');
    expect(attempts).toHaveBeenCalledTimes(2);
  });
});
