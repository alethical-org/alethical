// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ accessToken: null, user: null, session: null }),
}));

import { createAppQueryClient } from '../../lib/appQueryClient';
import { legislatorRecordQueryKey } from '../../lib/legislatorProfile';
import { paymentsUnderNameQueryKey } from '../../lib/paymentNameRoute';
import { renderPageData, resetSeededPayloadsForTests } from '../../lib/pageData';
import nystrom from '../../lib/__tests__/fixtures/payments-under-name-nystrom.json';
import { useLegislator, usePaymentsUnderName } from '../useAppQueries';

/**
 * The 2 reads a deep money address now carries in its first response, drawn in
 * the app's first frame rather than fetched again: the member's record behind a
 * profile (which drew a skeleton until the identical request came back), and
 * the first page of payments under a name (which drew placeholder rows for
 * about a second). Measured live 17 Sep 2026.
 */
const LEGISLATOR = {
  id: '8c31565f',
  slug: 'aisha-gomez',
  full_name: 'Aisha Gomez',
  current_service: { chamber: 'house', district: { code: '62A' }, party: 'DFL' },
  committees: [{ name: 'Taxes', role: 'Chair' }],
  stats: { total_bill_count: 12, committee_count: 1 },
};

function render<T>(useHook: () => { data: T; isPending: boolean }) {
  const passes: { data: T; isPending: boolean }[] = [];
  function Probe() {
    const query = useHook();
    passes.push({ data: query.data, isPending: query.isPending });
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  act(() => {
    createRoot(host).render(
      (
        <QueryClientProvider client={createAppQueryClient()}>
          <Probe />
        </QueryClientProvider>
      ) as ReactNode,
    );
  });
  return passes;
}

function seed(block: string) {
  const holder = document.createElement('div');
  holder.innerHTML = block;
  document.body.append(...holder.childNodes);
  resetSeededPayloadsForTests();
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('a seeded read must not reach the network');
    }),
  );
});

afterEach(() => {
  document.body.innerHTML = '';
  resetSeededPayloadsForTests();
  vi.unstubAllGlobals();
});

describe('a profile address hands its record to the app', () => {
  it('draws the member from the served record in the first frame, with no request', () => {
    seed(renderPageData([{ key: legislatorRecordQueryKey('aisha-gomez'), payload: LEGISLATOR }]));
    const passes = render(() => useLegislator('aisha-gomez'));
    expect(passes[0].isPending).toBe(false);
    expect(passes[0].data).toMatchObject({
      id: '8c31565f',
      name: 'Aisha Gomez',
      chamber: 'House',
      district: '62A',
      committees: ['Taxes (Chair)'],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves a profile whose record was not served to fetch as before', () => {
    const passes = render(() => useLegislator('aisha-gomez'));
    expect(passes[0].isPending).toBe(true);
  });
});

describe('a payments-under-a-name address hands its first page to the app', () => {
  it('draws the served rows in the first frame, shaped as a fetched page would be', () => {
    seed(
      renderPageData([
        {
          key: paymentsUnderNameQueryKey('Nystrom, Mary Ann', 'contributor'),
          payload: nystrom.data,
        },
      ]),
    );
    const passes = render(() => usePaymentsUnderName('Nystrom, Mary Ann', 'contributor'));
    expect(passes[0].isPending).toBe(false);
    const first = passes[0].data?.pages[0];
    expect(first?.releaseId).toBe(nystrom.data.release_id);
    expect(first?.payments).toHaveLength(nystrom.data.payments.length);
    expect(first?.payments[0]).toMatchObject({
      filerName: 'Senate Victory Fund (SVF)',
      filerRegistrationNumber: '20013',
      amount: '25000.0000',
      paidOn: '2026-04-20',
    });
    expect(passes[0].data?.pageParams).toEqual([{ offset: 0, releaseId: null }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores a served page for a different spelling and fetches instead', () => {
    seed(
      renderPageData([
        {
          key: paymentsUnderNameQueryKey('Nystrom, Mary Ann', 'contributor'),
          payload: { ...nystrom.data, name: 'Nystrom, Mary' },
        },
      ]),
    );
    const passes = render(() => usePaymentsUnderName('Nystrom, Mary Ann', 'contributor'));
    // The shaper refuses a page that names another spelling, so the seed is dropped.
    expect(passes[0].isPending).toBe(true);
  });
});
