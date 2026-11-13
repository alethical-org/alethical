import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache, useRead } from '../api/read';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session = vi.hoisted(() => ({ accessToken: 'first-account' }));
vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ ...session, apiBaseUrl: 'https://api.test', retry: vi.fn() }),
}));
let container: HTMLDivElement, root: Root;
function Probe({ path, enabled, revision }: { path: string; enabled: boolean; revision: number }) {
  const read = useRead<{ name: string }>(path, { keepPrevious: true, enabled, revision });
  return (
    <p aria-busy={read.pending || read.updating || read.loading}>{read.data?.name ?? 'none'}</p>
  );
}
async function show(path: string, enabled = true, revision = 0) {
  await act(async () => root.render(<Probe {...{ path, enabled, revision }} />));
}
const answer = (name: string) => new Response(JSON.stringify({ data: { name } }));
beforeEach(() => {
  clearReadCache();
  session.accessToken = 'first-account';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it('holds dependent requests and same-account results until enabled, across path and account changes', async () => {
  const fetcher = vi.fn(async (url: string) => answer(url.endsWith('/one') ? 'Earlier' : 'Fresh'));
  vi.stubGlobal('fetch', fetcher);
  await show('one');
  expect(container.textContent).toBe('Earlier');
  await show('one', false, 1);
  await show('two', false, 1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe('Earlier');
  expect(container.querySelector('p')?.getAttribute('aria-busy')).toBe('false');
  session.accessToken = 'second-account';
  await show('two', false, 1);
  expect(container.textContent).toBe('none');
  expect(fetcher).toHaveBeenCalledTimes(1);
  await show('two', true, 1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(container.textContent).toBe('Fresh');
});
it('aborts an unfinished dependent request and ignores its late answer while held', async () => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/one')) return answer('Earlier');
    signal = init?.signal;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  vi.stubGlobal('fetch', fetcher);
  await show('one');
  await show('two');
  await show('two', false);
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(answer('Abandoned')));
  expect(container.textContent).toBe('Earlier');
  expect(container.querySelector('p')?.getAttribute('aria-busy')).toBe('false');
  await show('two');
  expect(fetcher).toHaveBeenCalledTimes(3);
  await act(async () => finish(answer('Fresh')));
  expect(container.textContent).toBe('Fresh');
});
