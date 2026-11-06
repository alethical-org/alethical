import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache, useRead } from '../api/read';
import { SessionProvider } from '../auth/session';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const supabase = {
  auth: {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
} as unknown as SupabaseClient;

function Probe({ path }: { path: string | null }) {
  const read = useRead<{ name: string }>(path);
  if (read.failed) return <button onClick={read.retry}>Retry</button>;
  return <p aria-busy={read.pending}>{read.loading ? 'loading' : (read.data?.name ?? 'none')}</p>;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  clearReadCache();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function show(path: string | null) {
  root.render(
    <SessionProvider supabase={supabase} apiBaseUrl="https://api.test">
      <Probe path={path} />
    </SessionProvider>,
  );
}

describe('useRead', () => {
  it('is no longer pending when the active query is cleared', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted')));
        }),
    );
    await act(async () => show('bills/1'));
    expect(container.querySelector('p')?.getAttribute('aria-busy')).toBe('true');
    await act(async () => show(null));
    expect(container.textContent).toBe('none');
    expect(container.querySelector('p')?.getAttribute('aria-busy')).toBe('false');
  });

  it('reads the new address once after retrying the old one', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith('bills/1')
        ? new Response(null, { status: 500 })
        : new Response(JSON.stringify({ data: { name: 'Bill 2' } })),
    );
    vi.stubGlobal('fetch', fetcher);
    await act(async () => show('bills/1'));
    await act(async () => container.querySelector('button')!.click());
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('bills/1'))).toHaveLength(2);
    await act(async () => show('bills/2'));
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('bills/2'))).toHaveLength(1);
    expect(container.textContent).toBe('Bill 2');
  });

  it('shows loading instead of hydrating an expired cached answer on remount', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    let finish!: (response: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { name: 'Earlier bill' } })))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
    vi.stubGlobal('fetch', fetcher);
    await act(async () => show('bills/1'));
    expect(container.textContent).toBe('Earlier bill');
    await act(async () => root.render(null));
    now.mockReturnValue(70_000);
    await act(async () => show('bills/1'));
    const stateWhileLoading = container.textContent;
    await act(async () => finish(new Response(JSON.stringify({ data: { name: 'Updated bill' } }))));
    expect(stateWhileLoading).toBe('loading');
    expect(container.textContent).toBe('Updated bill');
  });

  it('shows a record held from before when Back returns while the next read is still open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith('bills/1')) {
          return Promise.resolve(new Response(JSON.stringify({ data: { name: 'Bill 1' } })));
        }
        // Bill 2 never answers until it is abandoned.
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted')));
        });
      }),
    );
    await act(async () => show('bills/1'));
    await act(async () => {});
    expect(container.textContent).toBe('Bill 1');
    await act(async () => show('bills/2'));
    expect(container.textContent).toBe('loading');
    await act(async () => show('bills/1'));
    await act(async () => {});
    await act(async () => {});
    expect(container.textContent).toBe('Bill 1');
  });
});
