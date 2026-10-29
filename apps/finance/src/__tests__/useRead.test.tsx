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

function Probe({ path }: { path: string }) {
  const read = useRead<{ name: string }>(path);
  return <p>{read.loading ? 'loading' : read.failed ? 'failed' : (read.data?.name ?? 'none')}</p>;
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
});

function show(path: string) {
  root.render(
    <SessionProvider supabase={supabase} apiBaseUrl="https://api.test">
      <Probe path={path} />
    </SessionProvider>,
  );
}

describe('useRead', () => {
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
