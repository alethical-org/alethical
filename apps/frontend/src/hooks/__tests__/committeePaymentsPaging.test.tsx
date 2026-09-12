// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = 'http://records.test';
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ accessToken: null, user: null, session: null }),
}));
import { committeePaymentsListQueryKey } from '../../lib/committeeMoney';
import { createAppQueryClient } from '../../lib/appQueryClient';
import { renderPageData, resetSeededPayloadsForTests } from '../../lib/pageData';
import { useCommitteePaymentsList } from '../useAppQueries';
const RECEIVED = {
  state: 'reported',
  payments: [{ contributor: 'Donor', amount: '25.0000', received_on: '2025-12-28' }],
  linkable_registration_numbers: [],
  fetched_at: '2026-09-01T12:00:00Z',
};
function seed(block: string) {
  const holder = document.createElement('div');
  holder.innerHTML = block;
  document.body.append(...holder.childNodes);
  resetSeededPayloadsForTests();
}
afterEach(() => {
  document.body.innerHTML = '';
  resetSeededPayloadsForTests();
  vi.unstubAllGlobals();
});
describe('committee payments start small without skipping later rows', () => {
  it.each(['received', 'made'] as const)(
    'loads all remaining %s rows after a smaller served page',
    async (direction) => {
      const first = {
        ...RECEIVED,
        payments: Array.from({ length: 50 }, (_, i) => ({
          ...RECEIVED.payments[0],
          contributor: `Donor ${i}`,
          vendor_name: `Vendor ${i}`,
        })),
        page: { limit: 50, offset: 0, has_more: true, total_payments: 301 },
      };
      seed(
        renderPageData([
          {
            key: committeePaymentsListQueryKey({
              registrationNumber: '41363',
              direction,
              year: 2025,
            }),
            payload: first,
          },
        ]),
      );
      const requests: URL[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          const parsed = new URL(url);
          requests.push(parsed);
          const offset = Number(parsed.searchParams.get('offset'));
          const count = Math.min(250, 301 - offset);
          return new Response(
            JSON.stringify({
              data: {
                ...first,
                payments: Array.from({ length: count }, (_, i) => ({
                  ...RECEIVED.payments[0],
                  contributor: `Donor ${offset + i}`,
                  vendor_name: `Vendor ${offset + i}`,
                })),
                page: { limit: 250, offset, has_more: offset + count < 301, total_payments: 301 },
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }),
      );
      let query: ReturnType<typeof useCommitteePaymentsList>;
      function Probe() {
        query = useCommitteePaymentsList('41363', direction, 2025);
        return null;
      }
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      const client = createAppQueryClient();
      try {
        await act(async () =>
          root.render(
            <QueryClientProvider client={client}>
              <Probe />
            </QueryClientProvider>,
          ),
        );
        expect(requests).toHaveLength(0);
        const next = await act(async () => query!.fetchNextPage());
        expect(next.error).toBeNull();
        expect(next.data?.pages.flatMap((p) => p?.payments ?? [])).toHaveLength(300);
        const last = await act(async () => query!.fetchNextPage());
        expect(last.data?.pages.flatMap((p) => p?.payments ?? [])).toHaveLength(301);
        expect(last.hasNextPage).toBe(false);
        expect(
          requests.map((u) => [u.searchParams.get('limit'), u.searchParams.get('offset')]),
        ).toEqual([
          ['250', '50'],
          ['250', '300'],
        ]);
      } finally {
        act(() => root.unmount());
        client.clear();
        host.remove();
      }
    },
  );
});
