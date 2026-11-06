import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useSuggestionBox } from '../search/SuggestionBox';

const session = vi.hoisted(() => ({
  apiBaseUrl: 'https://api.test',
  accessToken: 'account-one',
  email: 'one@example.test',
  signInPath: '/sign-in',
  status: 'granted',
  retry: vi.fn(),
}));
vi.mock('../auth/session', () => ({ useFinanceSession: () => session }));
vi.mock('../router', () => ({ navigate: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let box: ReturnType<typeof useSuggestionBox>;
let pending: Array<{
  url: URL;
  signal?: AbortSignal | null;
  resolve: (response: Response) => void;
}>;
function Probe() {
  box = useSuggestionBox('test', '/home');
  return (
    <div ref={box.rootRef}>
      <input {...box.inputProps} />
      {box.panel}
    </div>
  );
}
async function type(value: string) {
  await act(async () => box.inputProps.onChange({ target: { value } } as never));
}
async function tick(ms = 140) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}
async function answer(index: number, name: string, status = 200) {
  const request = pending[index];
  await act(async () =>
    request.resolve(
      new Response(
        JSON.stringify({
          data: {
            request_id: request.url.searchParams.get('request_id'),
            q: request.url.searchParams.get('q'),
            money: {
              groups: [
                {
                  kind: 'gave',
                  state: 'reported',
                  results: [{ kind: 'payment_name', name, role: 'contributor' }],
                },
              ],
            },
            bills: [],
          },
        }),
        { status },
      ),
    ),
  );
}
beforeEach(async () => {
  vi.useFakeTimers();
  session.accessToken = 'account-one';
  session.email = 'one@example.test';
  session.status = 'granted';
  session.retry.mockClear();
  pending = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          pending.push({ url: new URL(url), signal: init?.signal, resolve });
        }),
    ),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const request of pending) request.resolve(new Response('{}', { status: 500 }));
  await Promise.resolve();
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('invalidates an older answer immediately, before the next typing pause ends', async () => {
  await type('danc');
  await tick();
  await type('danch');
  await answer(0, 'Old answer');
  expect(host.textContent).not.toContain('Old answer');
  expect(pending[0].signal?.aborted).toBe(true);
  await tick();
  await answer(1, 'Danchik');
  expect(host.textContent).toContain('Danchik');
});
it('keeps results visible while updating and after a failed request', async () => {
  await type('danc');
  await tick();
  await answer(0, 'Danchik');
  await type('danch');
  expect(host.textContent).toContain('Danchik');
  expect(host.textContent).toContain('Searching…');
  await tick();
  await answer(1, '', 500);
  expect(host.textContent).toContain('Danchik');
  expect(host.textContent).toContain('Suggestions couldn’t load');
  await act(async () =>
    box.inputProps.onKeyDown({
      key: 'ArrowDown',
      preventDefault() {},
    } as never),
  );
  expect(host.querySelector('[aria-selected="true"]')?.textContent).toContain('Danchik');
});
it('reuses a recent exact query on refocus, then refreshes after 60 seconds', async () => {
  await type('danch');
  await tick();
  await answer(0, 'Danchik');
  await act(async () => box.inputProps.onBlur({ relatedTarget: null } as never));
  await act(async () => box.inputProps.onFocus());
  expect(host.textContent).toContain('Danchik');
  expect(host.textContent).not.toContain('Searching…');
  await tick();
  expect(pending).toHaveLength(1);
  await act(async () => box.inputProps.onBlur({ relatedTarget: null } as never));
  await tick(60_000);
  await act(async () => box.inputProps.onFocus());
  await tick();
  expect(pending).toHaveLength(2);
  await answer(1, 'Fresh Danchik');
});
it('clears short queries and cannot revive them with a late answer', async () => {
  await type('danch');
  await tick();
  await type('d');
  await answer(0, 'Danchik');
  expect(host.querySelector('[role="listbox"]')).toBeNull();
  expect(pending[0].signal?.aborted).toBe(true);
});
it('clears results, pending work and cached answers when the account changes', async () => {
  await type('danch');
  await tick();
  await answer(0, 'Private one');
  await type('other');
  await tick();
  session.accessToken = 'account-two';
  session.email = 'two@example.test';
  await act(async () => root.render(<Probe />));
  expect(host.textContent).not.toContain('Private one');
  expect(box.query).toBe('');
  expect(pending[1].signal?.aborted).toBe(true);
  await answer(1, 'Late private one');
  expect(host.textContent).not.toContain('Late private one');
  await type('danch');
  await tick();
  expect(pending).toHaveLength(3);
  await answer(2, 'Private two');
  expect(host.textContent).toContain('Private two');
});
it('removes held results and rechecks access on an access refusal', async () => {
  await type('danch');
  await tick();
  await answer(0, 'Private one');
  await type('other');
  await tick();
  await answer(1, '', 403);
  expect(host.textContent).not.toContain('Private one');
  expect(session.retry).toHaveBeenCalledOnce();
  await type('danch');
  await tick();
  expect(pending).toHaveLength(3);
  await answer(2, '', 403);
});

it('ignores an older response that arrives after the newest result', async () => {
  await type('old');
  await tick();
  await type('new');
  await tick();
  await answer(1, 'Newest');
  await answer(0, 'Stale');
  expect(host.textContent).toContain('Newest');
  expect(host.textContent).not.toContain('Stale');
});
it('aborts an abandoned field and ignores its answer after unmount', async () => {
  await type('danch');
  await tick();
  await act(async () => root.render(null));
  expect(pending[0].signal?.aborted).toBe(true);
  await answer(0, 'Late answer');
  expect(host.textContent).toBe('');
});

it('keeps an in-flight exact query when refocusing the field', async () => {
  await type('danch');
  await tick();
  await act(async () => box.inputProps.onBlur({ relatedTarget: null } as never));
  await act(async () => box.inputProps.onFocus());
  await tick();
  expect(pending).toHaveLength(1);
  expect(pending[0].signal?.aborted).toBe(false);
  await answer(0, 'Danchik');
  expect(host.textContent).toContain('Danchik');
});

it('clears held results and requests when access is revoked with the same token', async () => {
  await type('danch');
  await tick();
  await answer(0, 'Private');
  await type('other');
  await tick();
  session.status = 'no-access';
  await act(async () => root.render(<Probe />));
  expect(host.textContent).not.toContain('Private');
  expect(pending[1].signal?.aborted).toBe(true);
  await answer(1, 'Late private');
  await type('danch');
  await tick();
  expect(pending).toHaveLength(2);
  expect(host.querySelector('[role="listbox"]')).toBeNull();
  session.status = 'granted';
  await act(async () => root.render(<Probe />));
  await type('danch');
  await tick();
  expect(pending).toHaveLength(3);
  await answer(2, 'New permission');
});

it('preserves typed words on same-account token refresh but clears old data and requests', async () => {
  await type('danch');
  await tick();
  await answer(0, 'Earlier answer');
  await type('danchik');
  await tick();
  session.accessToken = 'refreshed-account-one';
  await act(async () => root.render(<Probe />));
  expect(box.query).toBe('danchik');
  expect(host.querySelector('input')?.value).toBe('danchik');
  expect(host.textContent).not.toContain('Earlier answer');
  expect(pending[1].signal?.aborted).toBe(true);
  await answer(1, 'Old token answer');
  expect(host.textContent).not.toContain('Old token answer');
  await type('danch');
  await tick();
  expect(pending).toHaveLength(3);
  await answer(2, 'Current token answer');
  expect(host.textContent).toContain('Current token answer');
});
