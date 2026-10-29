import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiGet, apiPath, MAX_CONCURRENT_READS } from '../api/read';

afterEach(() => vi.useRealTimers());

const ok = () => new Response(JSON.stringify({ data: { fine: true } }), { status: 200 });

describe('apiGet', () => {
  it('sends the account token only to Finance routes', async () => {
    const fetcher = vi.fn(async () => ok());
    await apiGet('https://api.test', 'finance/access', 'token-1', fetcher);
    await apiGet('https://api.test', 'bills/1', 'token-1', fetcher);
    const headers = fetcher.mock.calls.map(([, init]) => (init as RequestInit).headers);
    expect(headers[0]).toEqual({ Authorization: 'Bearer token-1' });
    expect(headers[1]).toEqual({});
  });

  it('runs at most 4 reads at once and queues the rest', async () => {
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          release.push(() => {
            active -= 1;
            resolve(ok());
          });
        }),
    );
    const reads = Array.from({ length: 10 }, (_, index) =>
      apiGet('https://api.test', `bills/${index}`, null, fetcher),
    );
    for (let step = 0; step < 40 && release.length + fetcher.mock.calls.length < 20; step += 1) {
      await Promise.resolve();
      release.shift()?.();
    }
    while (release.length || fetcher.mock.calls.length < 10) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      release.shift()?.();
    }
    await Promise.all(reads);
    expect(peak).toBe(MAX_CONCURRENT_READS);
    expect(fetcher).toHaveBeenCalledTimes(10);
  });

  it('retries the server’s busy answer after its wait, and fails any other 503 at once', async () => {
    vi.useFakeTimers();
    const busy = () => new Response(null, { status: 503, headers: { 'Retry-After': '1' } });
    const fetcher = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(ok());
    const pending = apiGet('https://api.test', 'bills/1', null, fetcher);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({ state: 'ok', data: { fine: true }, page: null });

    const plain = vi.fn(async () => new Response(null, { status: 503 }));
    await expect(apiGet('https://api.test', 'bills/1', null, plain)).resolves.toEqual({
      state: 'failed',
    });
    expect(plain).toHaveBeenCalledTimes(1);
  });
});

describe('apiPath', () => {
  it('encodes each part and keeps only the query values given', () => {
    expect(apiPath(['committees', 'A/B', 'payments'], { year: 2026, sort: '', page: null })).toBe(
      'committees/A%2FB/payments?year=2026',
    );
  });
});
