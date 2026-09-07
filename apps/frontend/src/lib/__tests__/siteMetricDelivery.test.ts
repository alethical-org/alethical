import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
});

import {
  getSiteMetricCollectionDecisionFromApi,
  recordSiteMetricEventFromApi,
} from '../../data/api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('authenticated collection permission', () => {
  it('asks the shared backend with the current token and no identity body', async () => {
    const decision = { collect: false, teamAccount: true, teamExclusionConfigured: true };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(decision)));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    await expect(
      getSiteMetricCollectionDecisionFromApi('test-token', controller.signal),
    ).resolves.toEqual(decision);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/site-metrics/collection',
      {
        headers: { Accept: 'application/json', Authorization: 'Bearer test-token' },
        cache: 'no-store',
        signal: controller.signal,
      },
    );
  });

  it.each([401, 403, 404, 503])(
    'does not fall back when permission is unavailable (%i)',
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(new Response('', { status }));
      vi.stubGlobal('fetch', fetcher);
      await expect(getSiteMetricCollectionDecisionFromApi('test-token')).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([null, {}, { collect: 'true' }, { collect: true, teamAccount: false }])(
    'rejects an incomplete permission answer',
    async (decision) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(decision))));
      await expect(getSiteMetricCollectionDecisionFromApi('test-token')).rejects.toThrow();
    },
  );
});

describe('anonymous action delivery', () => {
  it('keeps old clients without UUID support to one attempt', async () => {
    vi.stubGlobal('crypto', {});
    const fetcher = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetcher);
    await expect(recordSiteMetricEventFromApi('official_source_opened')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ event: 'official_source_opened' });
  });

  it('aborts slow requests and stops after 2 attempts', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const done = expect(recordSiteMetricEventFromApi('official_source_opened')).rejects.toThrow(
      'aborted',
    );
    await vi.advanceTimersByTimeAsync(10_250);
    await done;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retries a lost answer with the same event identifier and original token', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('connection closed'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    await recordSiteMetricEventFromApi('bill_search_with_results', 'test-original-token');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const first = fetcher.mock.calls[0][1];
    const second = fetcher.mock.calls[1][1];
    expect(second.body).toEqual(first.body);
    expect(JSON.parse(first.body)).toEqual({
      event: 'bill_search_with_results',
      eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(second.headers.Authorization).toBe('Bearer test-original-token');
    expect(first.keepalive).toBe(true);
  });

  it('retries server errors once, and stops after the second failed response', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(recordSiteMetricEventFromApi('official_source_opened')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([401, 422, 429])('does not retry a refused action (%i)', async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status }));
    vi.stubGlobal('fetch', fetcher);
    await expect(recordSiteMetricEventFromApi('official_source_opened')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('gives different actions different random identifiers', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    await recordSiteMetricEventFromApi('official_source_opened');
    await recordSiteMetricEventFromApi('official_source_opened');
    expect(fetcher.mock.calls[0][1].body).not.toEqual(fetcher.mock.calls[1][1].body);
  });
});
