import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiGet } from '../api/read';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function delayedHealthyRead(ms: number): typeof fetch {
  return vi.fn(
    (_url, init) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => {
          init?.signal?.removeEventListener('abort', abort);
          resolve(
            new Response(JSON.stringify({ data: { checked: true } }), {
              status: 200,
            }),
          );
        }, ms);
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        init?.signal?.addEventListener('abort', abort, { once: true });
      }),
  );
}

it('lets a healthy whole-election expense read finish after 20 seconds', async () => {
  const pending = apiGet(
    'https://api.test',
    'finance/elections/mn-2026-11-03-general/analytics/expenses',
    'token',
    delayedHealthyRead(20_000),
  );
  await vi.advanceTimersByTimeAsync(20_000);
  await expect(pending).resolves.toEqual({
    state: 'ok',
    data: { checked: true },
    page: null,
  });
});

it('keeps a finite 90-second limit on a whole-election report', async () => {
  const pending = apiGet(
    'https://api.test',
    'finance/elections/mn-2026-11-03-general/analytics/funders',
    'token',
    delayedHealthyRead(100_000),
  );
  await vi.advanceTimersByTimeAsync(89_999);
  let done = false;
  void pending.then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await expect(pending).resolves.toEqual({ state: 'failed' });
});

it.each([
  'finance/access',
  'bills/1',
  'finance/elections/mn-2026-11-03-general/races/race/export',
  'finance/elections/mn-2026-11-03-general/sources/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
])('keeps the 10-second limit on %s', async (path) => {
  const pending = apiGet('https://api.test', path, 'token', delayedHealthyRead(20_000));
  await vi.advanceTimersByTimeAsync(10_000);
  await expect(pending).resolves.toEqual({ state: 'failed' });
});

it('still cancels a long report immediately when navigation aborts', async () => {
  const controller = new AbortController();
  const pending = apiGet(
    'https://api.test',
    'finance/elections/mn-2026-11-03-general/analytics/expenses',
    'token',
    delayedHealthyRead(20_000),
    controller.signal,
  );
  await vi.advanceTimersByTimeAsync(15_000);
  controller.abort();
  await expect(pending).resolves.toEqual({ state: 'failed' });
});

it('keeps the deadline active while the JSON body is still arriving', async () => {
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, init?: RequestInit) =>
      ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      }) as Response,
  );
  const pending = apiGet(
    'https://api.test',
    'finance/elections/mn-2026-11-03-general/analytics/records',
    'token',
    fetcher,
  );
  await vi.advanceTimersByTimeAsync(90_000);
  await expect(pending).resolves.toEqual({ state: 'failed' });
});

it('starts the long budget after admission, without charging time spent in the queue', async () => {
  const releases: Array<() => void> = [];
  const delayed = delayedHealthyRead(85_000);
  const fetcher = vi.fn((url: RequestInfo | URL, init?: RequestInit) =>
    String(url).includes('q=held')
      ? new Promise<Response>((resolve) =>
          releases.push(() => resolve(new Response(JSON.stringify({ data: { checked: true } })))),
        )
      : delayed(url, init),
  );
  const base = 'finance/elections/mn-2026-11-03-general/analytics/funders';
  const active = Array.from({ length: 4 }, (_, i) =>
    apiGet('https://api.test', `${base}?q=held${i}`, 'token', fetcher),
  );
  const queued = apiGet('https://api.test', `${base}?q=queued`, 'token', fetcher);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(fetcher).toHaveBeenCalledTimes(4);
  releases.forEach((release) => release());
  await vi.advanceTimersByTimeAsync(85_000);
  await Promise.all(active);
  await expect(queued).resolves.toEqual({ state: 'ok', data: { checked: true }, page: null });
});
