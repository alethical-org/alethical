// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock('react-native-svg', () => ({
  default: ({ children, ...props }: React.SVGProps<SVGSVGElement>) => (
    <svg {...props}>{children}</svg>
  ),
  Circle: (props: React.SVGProps<SVGCircleElement>) => <circle {...props} />,
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
}));
vi.mock('../../../data/api', async (original) => ({
  ...(await original<typeof import('../../../data/api')>()),
  publicApiRequest: vi.fn(),
}));
import { publicApiRequest } from '../../../data/api';
import { CommitteeDonations } from '../CommitteeDonations';

const request = vi.mocked(publicApiRequest);
const refresh = vi.fn();
let client: QueryClient;
let root: Root;
let host: HTMLDivElement;
let failedDirection: string | null;
let responseRelease: string;
let donor: string;
let empty: boolean;
let unavailable: boolean;
let props: React.ComponentProps<typeof CommitteeDonations>;
function payload(path: string) {
  const url = new URL(path, 'https://fixture.test');
  const direction = url.searchParams.get('direction');
  if (direction === failedDirection) throw new Error('Controlled payment refresh failure');
  const payments =
    direction === 'received' && !empty
      ? [
          {
            contributor: donor,
            contributor_type: 'Individual',
            amount: '100',
            receipt_type: 'Contribution',
            in_kind: 'No',
            received_on: '2025-01-10',
            record_number: 1,
          },
        ]
      : [];
  return {
    data: {
      registration_number: url.pathname.split('/')[2],
      year: Number(url.searchParams.get('year')),
      direction,
      state: unavailable ? 'unavailable' : 'reported',
      payments,
      release_id: responseRelease,
      linkable_registration_numbers: [],
      fetched_at: '2026-10-01',
      source_url: 'https://cfb.mn.gov/fixture',
      page: { limit: 250, offset: 0, total_payments: payments.length, has_more: false },
    },
  };
}
function draw() {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <CommitteeDonations {...props} />
      </QueryClientProvider>,
    ),
  );
}
async function settled() {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(client.isFetching()).toBe(0);
    expect(request).toHaveBeenCalled();
    expect(host.textContent).not.toContain('Loading the complete payment list');
  });
}
async function recheck() {
  await act(async () => {
    await client.refetchQueries({ queryKey: ['campaign-money-details'] });
  });
  await settled();
}
beforeEach(() => {
  failedDirection = null;
  responseRelease = 'release-A';
  donor = 'Accepted Donor';
  empty = false;
  unavailable = false;
  request.mockReset();
  refresh.mockReset();
  request.mockImplementation(async (path) => payload(String(path)) as never);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  props = {
    committee: {
      registrationNumber: '17868',
      split: {
        state: 'no_reported_total',
        reportedTotal: null,
        reportedThrough: null,
        namedPayments: 1,
        statedSplitState: 'not_checked',
        firstPaymentOn: '2025-01-10',
        lastPaymentOn: '2025-01-10',
        namedTotal: '100',
        namedCashTotal: '100',
        namedInKindTotal: '0',
        unnamedTotal: null,
      },
    },
    year: 2025,
    releaseId: 'release-A',
    onRefresh: refresh,
    preferences: { tab: 'individuals', sort: 'largest' },
    onPreferences: vi.fn(),
    children: <p>Accepted summary</p>,
  };
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
});

describe.each(['committee', 'profile'])('%s payment rechecks', (surface) => {
  it.each(['received', 'made'])(
    'keeps matching accepted rows and chart when %s refresh fails, then retries',
    async (direction) => {
      props.headingLevel = surface === 'committee' ? 2 : 3;
      props.showStatements = surface === 'committee';
      draw();
      await settled();
      expect(host.textContent).toContain('Accepted Donor');
      expect(host.querySelector('svg')).not.toBeNull();
      failedDirection = direction;
      await recheck();
      expect(host.textContent).toContain('Accepted Donor');
      expect(host.querySelector('svg')).not.toBeNull();
      expect(host.textContent).toContain(
        'We could not refresh these payments. This is a problem on our side. The last complete payment list is still shown.',
      );
      const retry = [...host.querySelectorAll<HTMLElement>('[role="button"],button')].find(
        (button) => button.textContent === 'Try again',
      )!;
      expect(retry).toBeDefined();
      failedDirection = null;
      donor = 'Replacement Donor';
      act(() => retry.click());
      await settled();
      expect(refresh).toHaveBeenCalledOnce();
      expect(host.textContent).toContain('Replacement Donor');
      expect(host.textContent).not.toContain('Accepted Donor');
      expect(host.textContent).not.toContain('last complete payment list');
    },
  );
});

it('keeps a first-load failure distinct from an empty record', async () => {
  failedDirection = 'received';
  draw();
  await settled();
  expect(host.textContent).not.toContain('Accepted Donor');
  expect(host.textContent).toContain('We could not load the complete payment list');
  expect(host.textContent).not.toContain('No itemized contributions');
  expect(host.textContent).not.toContain('last complete payment list');
});

it.each(['year', 'committee', 'release'])(
  'never holds rows across a changed %s',
  async (changed) => {
    draw();
    await settled();
    expect(host.textContent).toContain('Accepted Donor');
    failedDirection = 'received';
    if (changed === 'year') props.year = 2024;
    if (changed === 'committee')
      props.committee = { ...props.committee, registrationNumber: '99999' };
    if (changed === 'release') props.releaseId = 'release-B';
    draw();
    await recheck();
    expect(host.textContent).not.toContain('Accepted Donor');
    expect(host.textContent).not.toContain('last complete payment list');
    expect(host.querySelector('svg')).toBeNull();
  },
);

it('does not retain rows without a pinned summary release', async () => {
  props.releaseId = undefined;
  draw();
  await settled();
  failedDirection = 'received';
  await recheck();
  expect(host.textContent).not.toContain('Accepted Donor');
});

it('replaces accepted rows with a successful empty answer and keeps it through a later failure', async () => {
  draw();
  await settled();
  empty = true;
  await recheck();
  expect(host.textContent).toContain('No itemized contributions or expenditures');
  expect(host.textContent).not.toContain('Accepted Donor');
  failedDirection = 'received';
  await recheck();
  expect(host.textContent).toContain('No itemized contributions or expenditures');
  expect(host.textContent).toContain('last complete payment list');
  expect(host.textContent).toContain('Try again');
});

it('an explicit unavailable answer invalidates held rows rather than becoming an empty answer', async () => {
  draw();
  await settled();
  unavailable = true;
  await recheck();
  expect(host.textContent).not.toContain('Accepted Donor');
  expect(host.textContent).not.toContain('No itemized contributions');
  failedDirection = 'received';
  await recheck();
  expect(host.textContent).not.toContain('last complete payment list');
});

it('keeps matching accepted rows through newer copies, then replaces them when the summary catches up', async () => {
  draw();
  await settled();
  responseRelease = 'release-B';
  donor = 'New copy donor';
  await recheck();
  expect(host.textContent).toContain('Accepted Donor');
  expect(host.textContent).not.toContain('New copy donor');
  props.releaseId = 'release-B';
  draw();
  await settled();
  expect(host.textContent).toContain('New copy donor');
  expect(host.textContent).not.toContain('Accepted Donor');
});

it('does not expose a first complete list from a different summary release', async () => {
  responseRelease = 'release-B';
  draw();
  await settled();
  expect(host.textContent).not.toContain('Accepted Donor');
  expect(host.textContent).toContain('copied from Minnesota’s records at different times');
});

it('keeps each committee’s held rows separate', async () => {
  const second = { ...props, committee: { ...props.committee, registrationNumber: '99999' } };
  request.mockImplementation(async (path) => {
    const result = payload(String(path));
    result.data.payments = result.data.payments.map((payment) => ({
      ...payment,
      contributor: String(path).includes('/99999/') ? 'Second Committee Donor' : 'Accepted Donor',
    }));
    return result as never;
  });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <section data-committee="first">
          <CommitteeDonations {...props} />
        </section>
        <section data-committee="second">
          <CommitteeDonations {...second} />
        </section>
      </QueryClientProvider>,
    ),
  );
  await settled();
  failedDirection = 'received';
  await recheck();
  expect(host.querySelector('[data-committee="first"]')?.textContent).toContain('Accepted Donor');
  expect(host.querySelector('[data-committee="first"]')?.textContent).not.toContain(
    'Second Committee Donor',
  );
  expect(host.querySelector('[data-committee="second"]')?.textContent).toContain(
    'Second Committee Donor',
  );
  expect(host.querySelector('[data-committee="second"]')?.textContent).not.toContain(
    'Accepted Donor',
  );
});

it('keeps accepted rows and chart throughout a delayed retry and prevents a duplicate retry', async () => {
  draw();
  await settled();
  failedDirection = 'received';
  await recheck();
  failedDirection = null;
  const pending: Array<() => void> = [];
  request.mockImplementation(
    (path) =>
      new Promise((resolve) => {
        pending.push(() => resolve(payload(String(path)) as never));
      }),
  );
  const retry = [...host.querySelectorAll<HTMLElement>('[role="button"],button')].find(
    (button) => button.textContent === 'Try again',
  )!;
  act(() => retry.click());
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(pending).toHaveLength(2);
    expect(retry.getAttribute('aria-disabled')).toBe('true');
  });
  expect(host.textContent).toContain('Accepted Donor');
  expect(host.querySelector('svg')).not.toBeNull();
  act(() => retry.click());
  expect(refresh).toHaveBeenCalledOnce();
  expect(pending).toHaveLength(2);
  await act(async () => {
    pending.forEach((finish) => finish());
  });
  await settled();
  expect(host.textContent).toContain('Accepted Donor');
  expect(host.textContent).not.toContain('last complete payment list');
});

it('ignores an old year response that finishes after the reader switches years', async () => {
  draw();
  await settled();
  const old: Array<() => void> = [];
  request.mockImplementation((path) => {
    if (String(path).includes('year=2025'))
      return new Promise((resolve) => {
        const result = payload(String(path));
        old.push(() => resolve(result as never));
      });
    const result = payload(String(path));
    result.data.payments = result.data.payments.map((payment) => ({
      ...payment,
      contributor: 'New Year Donor',
    }));
    return Promise.resolve(result as never);
  });
  let refetch: Promise<unknown>;
  act(() => {
    refetch = client.refetchQueries({ queryKey: ['campaign-money-details'] });
  });
  await vi.waitFor(() => expect(old).toHaveLength(2));
  props.year = 2024;
  draw();
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain('New Year Donor');
  });
  await act(async () => {
    old.forEach((finish) => finish());
    await refetch;
  });
  await settled();
  expect(host.textContent).toContain('New Year Donor');
  expect(host.textContent).not.toContain('Accepted Donor');
});

it('holds the accepted list when a later replacement page is unavailable without exposing partial new rows', async () => {
  draw();
  await settled();
  request.mockImplementation(async (path) => {
    const result = payload(String(path));
    const url = new URL(String(path), 'https://fixture.test');
    if (url.searchParams.get('direction') !== 'received') return result as never;
    if (url.searchParams.get('offset') === '0') {
      result.data.payments = Array.from({ length: 250 }, (_, i) => ({
        ...result.data.payments[0],
        contributor: 'Partial replacement donor',
        record_number: i,
      }));
      result.data.page = { limit: 250, offset: 0, total_payments: 251, has_more: true };
    } else {
      result.data.state = 'unavailable';
      result.data.payments = [];
      result.data.page = { limit: 250, offset: 250, total_payments: 251, has_more: false };
    }
    return result as never;
  });
  await recheck();
  expect(host.textContent).toContain('Accepted Donor');
  expect(host.textContent).not.toContain('Partial replacement donor');
  expect(host.textContent).toContain('last complete payment list');
  expect(host.querySelector('svg')).not.toBeNull();
});
