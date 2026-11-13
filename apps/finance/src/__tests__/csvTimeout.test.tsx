import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CsvDownload } from '../pages/elections/CsvDownload';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let session = {
  apiBaseUrl: 'https://api.test',
  accessToken: 'private-token' as string | null,
  status: 'granted',
  email: 'reader@test.example',
  revoked: false,
  retry: vi.fn(),
};
vi.mock('../auth/session', () => ({ useFinanceSession: () => session }));
const report = 'finance/elections/mn-2026-11-03-general/analytics/export?format=csv';
let root: Root;
let container: HTMLDivElement;
let clicked: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  session = {
    ...session,
    accessToken: 'private-token',
    status: 'granted',
    revoked: false,
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:test'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function responseAfter(ms: number, status = 200) {
  const fetcher = vi.fn(
    (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => {
          init?.signal?.removeEventListener('abort', abort);
          resolve(
            status === 409
              ? new Response(
                  JSON.stringify({
                    type: 'https://api.alethical.com/problems/records-changed',
                  }),
                  { status },
                )
              : new Response('exact,12.50', {
                  headers: { 'Content-Type': 'text/csv' },
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
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
async function show(path = report, onChanged = vi.fn()) {
  await act(async () => root.render(<CsvDownload path={path} onChanged={onChanged} />));
}
async function start() {
  await act(async () => container.querySelector('button')!.click());
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
it('downloads a healthy whole-election CSV after 20 seconds', async () => {
  responseAfter(20_000);
  await show();
  await start();
  await advance(15_000);
  expect(container.textContent).toContain('Preparing download');
  expect(clicked).not.toHaveBeenCalled();
  await advance(5_000);
  expect(clicked).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('Download started');
});
it('still stops an unfinished whole-election CSV at 90 seconds', async () => {
  const fetcher = responseAfter(100_000);
  await show();
  await start();
  await advance(90_000);
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(container.textContent).toContain('Try again');
  expect(clicked).not.toHaveBeenCalled();
});
it('keeps a race CSV at the ordinary 10-second budget', async () => {
  responseAfter(20_000);
  await show('finance/elections/mn-2026-11-03-general/races/id/export');
  await start();
  await advance(10_000);
  expect(container.textContent).toContain('Try again');
  expect(clicked).not.toHaveBeenCalled();
});
it('aborts a long CSV when the route changes', async () => {
  const fetcher = responseAfter(20_000);
  await show();
  await start();
  await advance(15_000);
  await show(report + '&q=changed');
  await advance(10_000);
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(clicked).not.toHaveBeenCalled();
});
it('aborts a long CSV on sign-out without downloading its stale answer', async () => {
  const fetcher = responseAfter(20_000);
  await show();
  await start();
  await advance(15_000);
  session = { ...session, status: 'signed-out', accessToken: null };
  await show();
  await advance(10_000);
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(clicked).not.toHaveBeenCalled();
});
it('keeps changed-version handling on a delayed answer', async () => {
  responseAfter(20_000, 409);
  const changed = vi.fn();
  await show(report, changed);
  await start();
  await advance(20_000);
  expect(container.textContent).toContain('These records changed');
  expect(clicked).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>('.ec-link')!.click());
  expect(changed).toHaveBeenCalledTimes(1);
});
