// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
});
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ accessToken: null, user: null, session: null }),
}));
import { createAppQueryClient } from '../../lib/appQueryClient';
import { renderPageData, resetSeededPayloadsForTests } from '../../lib/pageData';
import { mapBillDetail } from '../../data/api';
import { mapBillVotes } from '../../lib/billRecordReads';
import { useBill } from '../useAppQueries';

const id = '94-2025-HF719';
const detail = { id, title: 'Bill title', chief_sponsors: [], actions: [] };
const votes = [
  {
    id: 'roll-old',
    motion_text: 'Third reading',
    result_text: 'Bill was passed',
    chamber: 'house',
    yes_count: 1,
    no_count: 0,
    records: [{ legislator_id: 'member', legislator_name: 'Anna Member', vote_value: 'yes' }],
  },
];
afterEach(() => {
  document.body.innerHTML = '';
  resetSeededPayloadsForTests();
  vi.unstubAllGlobals();
});

it('draws the same records on its first render and rechecks both caches without a blank state', async () => {
  document.body.innerHTML = renderPageData([
    { key: ['bill', id], payload: detail, validatedAgeMs: 0 },
    { key: ['bill-votes', id], payload: votes, validatedAgeMs: 0 },
  ]);
  resetSeededPayloadsForTests();
  const pending: { url: string; resolve: (response: Response) => void }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => new Promise<Response>((resolve) => pending.push({ url, resolve }))),
  );
  const passes: ReturnType<typeof useBill>[] = [];
  const client = createAppQueryClient();
  const node = document.createElement('div');
  document.body.append(node);
  const root = createRoot(node);
  function Reader() {
    passes.push(useBill(id));
    return null;
  }
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Reader />
      </QueryClientProvider>,
    );
  });
  expect(passes[0].isLoading).toBe(false);
  expect(passes[0].data).toEqual({
    ...mapBillDetail(detail, []),
    votes: mapBillVotes(votes),
    rollCallCount: 1,
  });
  expect(pending).toHaveLength(2);
  const newVotes = [...votes, { ...votes[0], id: 'roll-new' }];
  await act(async () => {
    for (const request of pending)
      request.resolve(
        new Response(JSON.stringify({ data: request.url.endsWith('/votes') ? newVotes : detail }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
  });
  await vi.waitFor(() => expect(client.getQueryData(['bill-votes', id])).toHaveLength(2));
  expect(passes.every((pass) => !pass.isLoading && !!pass.data)).toBe(true);
  act(() => root.unmount());
  client.clear();
});

// Keep the real screen, query hooks, transports and error handling. Replace
// unrelated navigation/chrome and the complex tab content.
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: vi.fn(), setParams: vi.fn() }),
  useRoute: () => ({ params: { billId: '94-2025-HF719', tab: 'votes' } }),
}));
vi.mock('../useResponsive', () => ({ useResponsive: () => ({ isDesktop: true }) }));
vi.mock('../useEntityReturnPageNames', () => ({ useEntityReturnPageNames: vi.fn() }));
vi.mock('../../navigation/documentTitle', () => ({ useDocumentTitle: vi.fn() }));
vi.mock('../useBillTracking', () => ({
  useBillTracking: () => ({
    trackedIds: new Set(),
    isTracked: () => false,
    toggleTrack: vi.fn(),
    trackedLoading: false,
  }),
}));
vi.mock('../../components/search/searchPieces', () => ({
  SearchPageShell: ({ children, hero }: any) => (
    <main>
      {hero}
      {children}
    </main>
  ),
}));
vi.mock('../../components/search/ReturnToast', () => ({ ReturnToast: () => null }));
vi.mock('../../components/GoBackLink', () => ({ GoBackLink: () => null }));
vi.mock('../../components/Skeleton', () => ({
  Skeleton: () => <span>Loading</span>,
  useOneScreenTall: () => ({}),
}));
vi.mock('../../components/billDetail/BillHeader', () => ({
  BillHeader: ({ title }: any) => <h1>{title}</h1>,
}));
vi.mock('../../components/billDetail/SummaryTab', () => ({ SummaryTab: () => null }));
vi.mock('../../components/billDetail/ActionsTab', () => ({ ActionsTab: () => null }));
vi.mock('../../components/billDetail/VersionsTab', () => ({ VersionsTab: () => null }));
vi.mock('../../components/billDetail/FullTextTab', () => ({ FullTextTab: () => null }));
vi.mock('../../components/billDetail/BillNotFound', () => ({
  BillNotFound: () => <div>Bill not found</div>,
}));
vi.mock('../../components/billDetail/VotesTab', () => ({
  VotesTab: ({ bill }: any) => (
    <section aria-label="Recorded votes">
      {bill.votes.map((vote: any) => (
        <div key={vote.id}>{vote.id}</div>
      ))}
    </section>
  ),
}));
import { BillDetailWebScreen } from '../../screens/redesign/BillDetailWebScreen';

it('keeps loaded history through a long failed refresh and recovers on retry', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T03:00:00Z'));
  document.body.innerHTML = renderPageData([
    { key: ['bill', id], payload: detail, validatedAgeMs: 0 },
    { key: ['bill-votes', id], payload: votes, validatedAgeMs: 0 },
  ]);
  resetSeededPayloadsForTests();
  const pending: { url: string; resolve: (response: Response) => void }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => new Promise<Response>((resolve) => pending.push({ url, resolve }))),
  );
  const client = createAppQueryClient();
  const node = document.createElement('div');
  document.body.append(node);
  const root = createRoot(node);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <BillDetailWebScreen />
        </QueryClientProvider>,
      ),
    );
    expect(node.textContent).toContain('roll-old');
    expect(node.querySelector('[role="status"]')?.textContent).toContain('Updating');
    await act(async () => {
      for (const request of pending.splice(0))
        request.resolve(new Response('{}', { status: 503, headers: { 'Retry-After': '2' } }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(node.textContent).toContain('Bill title');
    expect(node.textContent).toContain('roll-old');
    expect(node.querySelector('[role="alert"]')?.textContent).toContain('refresh');
    const retry = node.querySelector('[role="button"]') as HTMLElement;
    expect(retry.textContent).toContain('Try again');
    act(() => retry.focus());
    await act(async () => retry.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(document.activeElement).toBe(retry);
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    expect(pending).toHaveLength(2);
    expect(node.textContent).toContain('roll-old');
    // Historical records remain readable throughout an outage. The served
    // HTML cache allowance does not expire a reader's already-loaded history.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7 * 24 * 60 * 60_000);
    });
    expect(node.textContent).toContain('roll-old');
    expect(node.querySelector('[role="alert"]')?.textContent).toContain('last records loaded');
    const callsAfterTimeout = vi.mocked(fetch).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7 * 24 * 60 * 60_000);
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(callsAfterTimeout);
    expect(node.textContent).toContain('Bill title');
    expect(node.textContent).toContain('roll-old');
    pending.splice(0); // Timed-out transport attempts cannot deliver a later response.
    await act(async () => (node.querySelector('[role="button"]') as HTMLElement).click());
    await act(async () => {
      for (const request of pending.splice(0))
        request.resolve(
          new Response(
            JSON.stringify({
              data: request.url.endsWith('/votes') ? [{ ...votes[0], id: 'roll-new' }] : detail,
            }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
        );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(node.textContent).toContain('roll-new');
    expect(node.querySelector('[role="alert"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    client.clear();
    vi.useRealTimers();
  }
});

it.each([
  {
    name: 'retains recorded votes on a vote-only failure',
    seedVotes: votes,
    age: 0,
    status: 503,
    expected: 'retained',
  },
  {
    name: 'keeps a known empty vote list distinct from failure',
    seedVotes: [],
    age: 0,
    status: 503,
    expected: 'empty',
  },
  {
    name: 'reports missing votes as unavailable, never empty',
    seedVotes: undefined,
    age: 0,
    status: 503,
    expected: 'unavailable',
  },
  {
    name: 'refreshes an unknown-age seed but retains its history on failure',
    seedVotes: votes,
    age: undefined,
    status: 503,
    expected: 'retained',
  },
  {
    name: 'honors an authoritative not-found response over seeded data',
    seedVotes: votes,
    age: 0,
    status: 404,
    expected: 'notfound',
  },
])('$name', async ({ seedVotes, age, status, expected }) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T03:00:00Z'));
  document.body.innerHTML = renderPageData([
    { key: ['bill', id], payload: detail, validatedAgeMs: age },
    ...(seedVotes ? [{ key: ['bill-votes', id], payload: seedVotes, validatedAgeMs: age }] : []),
  ]);
  resetSeededPayloadsForTests();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      // Valid details refresh independently of a failing vote endpoint. Unknown
      // ages and not-found cases exercise the detail failure path as well.
      if (!url.endsWith('/votes') && age !== undefined && status !== 404) {
        return new Response(JSON.stringify({ data: detail }));
      }
      return new Response('{}', { status, headers: { 'Retry-After': '2' } });
    }),
  );
  const client = createAppQueryClient();
  const node = document.createElement('div');
  document.body.append(node);
  const root = createRoot(node);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <BillDetailWebScreen />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const records = node.querySelector('[aria-label="Recorded votes"]');
    if (expected === 'retained' || expected === 'empty') {
      expect(records).not.toBeNull();
      expect(records?.textContent).toBe(expected === 'retained' ? 'roll-old' : '');
      expect(node.querySelector('[role="alert"]')?.textContent).toContain('refresh');
    } else {
      expect(records).toBeNull();
      expect(node.textContent).toContain(
        expected === 'notfound' ? 'Bill not found' : 'load this bill’s votes',
      );
    }
    if (expected !== 'notfound')
      expect(node.querySelector('[role="button"]')?.textContent).toBe('Try again');
  } finally {
    act(() => root.unmount());
    client.clear();
    vi.useRealTimers();
  }
});

it('does not poll or expire loaded history while a bill stays open', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T03:00:00Z'));
  const fetch = vi.fn(
    async (url: string) =>
      new Response(JSON.stringify({ data: url.endsWith('/votes') ? votes : detail })),
  );
  vi.stubGlobal('fetch', fetch);
  const client = createAppQueryClient();
  const node = document.createElement('div');
  document.body.append(node);
  const root = createRoot(node);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <BillDetailWebScreen />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(node.textContent).toContain('roll-old');
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(node.textContent).toContain('roll-old');
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000);
    });
    expect(node.textContent).toContain('roll-old');
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
    client.clear();
    vi.useRealTimers();
  }
});
