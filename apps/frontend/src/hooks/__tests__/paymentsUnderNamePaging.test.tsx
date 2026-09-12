// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  process.env.EXPO_PUBLIC_API_URL = 'http://records.test';
});
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ accessToken: null, user: null, session: null }),
}));
import { usePaymentsUnderName } from '../useAppQueries';
import { getPaymentsUnderNameFromApi } from '../../data/api';
import source from '../../lib/__tests__/fixtures/payments-under-name-nystrom.json';
const first = () => ({
  data: {
    ...source.data,
    payments: Array.from({ length: 250 }, (_, i) => ({
      ...source.data.payments[0],
      record_number: i,
    })),
    page: { limit: 250, offset: 0, has_more: true, total_payments: null },
  },
});
let result: ReturnType<typeof usePaymentsUnderName>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
function mount() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Harness() {
    result = { ...usePaymentsUnderName('Nystrom, Mary Ann', 'contributor') };
    return null;
  }
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
afterEach(() => {
  if (root) act(() => root.unmount());
  client?.clear();
  host?.remove();
  vi.unstubAllGlobals();
});
it('merges complete pages from the same release without deduplicating identical rows', async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify(calls.length === 1 ? first() : source), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  mount();
  await settle();
  expect(result.data?.pages[0].payments).toHaveLength(250);
  await act(async () => {
    await result.fetchNextPage();
  });
  await settle();
  expect(result.data?.pages).toHaveLength(2);
  expect(result.data?.pages.flatMap((p) => p.payments)).toHaveLength(279);
  expect(calls[1]).toContain('offset=250');
  expect(result.hasNextPage).toBe(false);
});
it('rejects a different release and can restart all pages without mixing source versions', async () => {
  let count = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      count++;
      const value =
        count === 1
          ? first()
          : count === 2
            ? { data: { ...source.data, release_id: 'next' } }
            : { data: { ...first().data, release_id: 'next' } };
      return new Response(JSON.stringify(value), { status: 200 });
    }),
  );
  mount();
  await settle();
  await act(async () => {
    await result.fetchNextPage();
  });
  await settle();
  expect(result.isFetchNextPageError).toBe(true);
  expect(result.data?.pages).toHaveLength(1);
  expect(result.data?.pages[0].releaseId).toBe(source.data.release_id);
  await act(async () => {
    await result.refetch();
  });
  await settle();
  expect(result.isError).toBe(false);
  expect(result.data?.pages[0].releaseId).toBe('next');
});
it.each([{ name: 'Another name' }, { role: 'vendor' }, { release_id: undefined }])(
  'refuses a response that does not identify the requested records: %j',
  async (extra) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { ...source.data, ...extra } }), { status: 200 }),
      ),
    );
    await expect(getPaymentsUnderNameFromApi('Nystrom, Mary Ann', 'contributor')).rejects.toThrow(
      'did not identify',
    );
  },
);
it('does not erase the cap or accept an unavailable next page', async () => {
  let count = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify(
            ++count === 1
              ? first()
              : { data: { ...source.data, state: 'unavailable', payments: [] } },
          ),
          { status: 200 },
        ),
    ),
  );
  mount();
  await settle();
  await act(async () => {
    await result.fetchNextPage();
  });
  await settle();
  expect(result.isFetchNextPageError).toBe(true);
  expect(result.data?.pages).toHaveLength(1);
  expect(result.hasNextPage).toBe(true);
});

it('passes cancellation through to the public read and preserves unavailable first-page state', async () => {
  const abort = new AbortController();
  let cancelled = false;
  const fetch = vi.fn(async (_input: unknown, options?: RequestInit) => {
    abort.abort();
    cancelled = options?.signal?.aborted ?? false;
    return new Response(
      JSON.stringify({ data: { ...source.data, state: 'unavailable', payments: [] } }),
      { status: 200 },
    );
  });
  vi.stubGlobal('fetch', fetch);
  const page = await getPaymentsUnderNameFromApi('Nystrom, Mary Ann', 'contributor', {
    signal: abort.signal,
  });
  expect(page.state).toBe('unavailable');
  expect(cancelled).toBe(true);
});
