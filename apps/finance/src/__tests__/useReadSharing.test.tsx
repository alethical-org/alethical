import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { clearReadCache, useRead, type Read } from '../api/read';
import {
  CampaignFinance,
  KeyFigures,
  type Account,
  type FinanceYear,
} from '../parts/CampaignFinance';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session = vi.hoisted(() => ({
  apiBaseUrl: 'https://api.test',
  accessToken: 'account-a',
  retry: vi.fn(),
}));
vi.mock('../auth/session', () => ({ useFinanceSession: () => session }));
type Value = { name: string };
type Props = {
  id: string;
  path?: string;
  revision?: number;
  unwrapped?: boolean;
  enabled?: boolean;
  sharePending?: boolean;
  acceptData?: (value: Value) => boolean;
};
const reads = new Map<string, Read<Value>>();
function Probe({ id, path = 'finance/profile/year?year=2026', ...options }: Props) {
  const read = useRead<Value>(path, { keepPrevious: true, sharePending: true, ...options });
  reads.set(id, read);
  return <p data-reader={id}>{read.data?.name ?? 'none'}</p>;
}
type Request = {
  url: string;
  signal?: AbortSignal | null;
  done: boolean;
  resolve: (response: Response) => void;
};
let container: HTMLDivElement, root: Root, requests: Request[];
const answer = (name: string) => new Response(JSON.stringify({ data: { name } }));
const value = (id: string) => container.querySelector(`[data-reader="${id}"]`)?.textContent;
async function show(...props: Props[]) {
  await act(async () => root.render(props.map((props) => <Probe key={props.id} {...props} />)));
}
async function finish(index: number, response: Response) {
  await act(async () => requests[index].resolve(response));
}
beforeEach(() => {
  clearReadCache();
  session.apiBaseUrl = 'https://api.test';
  session.accessToken = 'account-a';
  session.retry.mockClear();
  reads.clear();
  requests = [];
  window.history.replaceState(null, '', '/candidates/one');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          const request: Request = {
            url,
            signal: init?.signal,
            done: false,
            resolve(response) {
              request.done = true;
              resolve(response);
            },
          };
          requests.push(request);
        }),
    ),
  );
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    // Some cases deliberately model a server/body that ignores abort. Drain it
    // so no API-admission slot leaks into the next case.
    for (const request of requests)
      if (!request.done) request.resolve(new Response(null, { status: 500 }));
  });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('keeps sharing opt-in and leaves ordinary concurrent reads independent', async () => {
  function Ordinary() {
    useRead('finance/profile/year?year=2026');
    return null;
  }
  await act(async () =>
    root.render(
      <>
        <Ordinary />
        <Ordinary />
      </>,
    ),
  );
  expect(requests).toHaveLength(2);
});

it('shares pending transport and body parsing; a surviving subscriber and cache still work', async () => {
  await show({ id: 'a' }, { id: 'b' });
  expect(requests).toHaveLength(1);
  await show({ id: 'b' });
  expect(requests[0].signal?.aborted).toBe(false);
  const response = answer('Shared');
  const parse = vi.spyOn(response, 'json');
  await finish(0, response);
  expect(value('b')).toBe('Shared');
  expect(parse).toHaveBeenCalledOnce();
  await show({ id: 'c' });
  expect(value('c')).toBe('Shared');
  expect(requests).toHaveLength(1);
});

it('removes the final lease before replacement and old settlement cannot delete the new flight', async () => {
  await show({ id: 'a' });
  await show({ id: 'b' });
  expect(requests[0].signal?.aborted).toBe(true);
  expect(requests).toHaveLength(2);
  await finish(0, answer('Abandoned'));
  expect(value('b')).toBe('none');
  await show({ id: 'b' }, { id: 'c' });
  expect(requests).toHaveLength(2);
  await finish(1, answer('Replacement'));
  expect(value('b')).toBe('Replacement');
  expect(value('c')).toBe('Replacement');
});

it.each([
  { path: 'finance/profile/year?year=2024' },
  { path: 'finance/other/year?year=2026' },
  { revision: 1 },
  { unwrapped: true },
])('keeps distinct path/revision/response shapes separate (%j)', async (different) => {
  await show({ id: 'a' }, { id: 'b', ...different });
  expect(requests).toHaveLength(2);
});

it.each(['accessToken', 'apiBaseUrl'] as const)(
  'never shares or displays data across a changed %s',
  async (field) => {
    await show({ id: 'a' });
    await finish(0, answer('Private old result'));
    await show({ id: 'a', revision: 1 });
    session[field] = field === 'accessToken' ? 'account-b' : 'https://another.test';
    await show({ id: 'a', revision: 1 }, { id: 'b', revision: 1 });
    expect(value('a')).toBe('none');
    expect(value('b')).toBe('none');
    expect(requests[1].signal?.aborted).toBe(true);
    expect(requests).toHaveLength(3);
    await finish(1, answer('Late old result'));
    expect(value('a')).toBe('none');
    await finish(2, answer('New scope'));
    expect(value('a')).toBe('New scope');
    expect(value('b')).toBe('New scope');
  },
);

it('validates separately and retries only the subscriber that asks', async () => {
  const accepts = (value: Value) => value.name === 'Accepted by second';
  await show({ id: 'a' }, { id: 'b', acceptData: accepts });
  await finish(0, answer('First result'));
  expect(value('a')).toBe('First result');
  expect(reads.get('b')?.failed).toBe(true);
  await act(async () => reads.get('b')!.retry());
  expect(requests).toHaveLength(2);
  await finish(1, answer('Accepted by second'));
  expect(value('a')).toBe('First result');
  expect(value('b')).toBe('Accepted by second');
});

it('a throwing subscriber validator does not reject the shared transport or affect another reader', async () => {
  await show(
    {
      id: 'a',
      acceptData: () => {
        throw new Error('Invalid data');
      },
    },
    { id: 'b' },
  );
  await finish(0, answer('Accepted by other reader'));
  expect(reads.get('a')?.failed).toBe(true);
  expect(value('b')).toBe('Accepted by other reader');
});

it('unexpected transport rejection settles and leaves no pending flight to reuse', async () => {
  await show({ id: 'a' }, { id: 'b' });
  const response = answer('Unreadable response');
  vi.spyOn(response.headers, 'get').mockImplementation(() => {
    throw new Error('Broken headers');
  });
  await finish(0, response);
  expect(reads.get('a')?.failed).toBe(true);
  expect(reads.get('b')?.failed).toBe(true);
  await show({ id: 'c' });
  expect(requests).toHaveLength(2);
});

it('a retry bypasses pending work and an older flight cannot replace its successful cache', async () => {
  await show({ id: 'a' }, { id: 'b' });
  await act(async () => reads.get('a')!.retry());
  expect(requests).toHaveLength(2);
  expect(requests[0].signal?.aborted).toBe(false);
  await finish(1, answer('New retry'));
  await finish(0, answer('Older flight'));
  expect(value('a')).toBe('New retry');
  expect(value('b')).toBe('Older flight');
  await show({ id: 'c' });
  expect(value('c')).toBe('New retry');
  expect(requests).toHaveLength(2);
});

it('two intentional retries start separate transports even with the same attempt count', async () => {
  await show({ id: 'a' }, { id: 'b' });
  await finish(0, new Response(null, { status: 500 }));
  await act(async () => {
    reads.get('a')!.retry();
    reads.get('b')!.retry();
  });
  expect(requests).toHaveLength(3);
});

it('clearing the cache invalidates writes from an already pending flight', async () => {
  await show({ id: 'a' }, { id: 'b' });
  clearReadCache();
  await finish(0, answer('Predates clear'));
  await show({ id: 'c' });
  expect(value('c')).toBe('none');
  expect(requests).toHaveLength(2);
});

it('a new mount after cache clear cannot join the old physical flight', async () => {
  await show({ id: 'a' });
  clearReadCache();
  await show({ id: 'a' }, { id: 'b' });
  expect(requests).toHaveLength(2);
  await finish(1, answer('After clear'));
  await finish(0, answer('Before clear'));
  await show({ id: 'c' });
  expect(value('c')).toBe('After clear');
});

it('suspending one subscriber retains the other subscription', async () => {
  await show({ id: 'a' }, { id: 'b' });
  await show({ id: 'a', enabled: false }, { id: 'b' });
  expect(requests[0].signal?.aborted).toBe(false);
  expect(reads.get('a')?.pending).toBe(false);
  await finish(0, answer('Remaining reader'));
  expect(value('a')).toBe('none');
  expect(value('b')).toBe('Remaining reader');
  await show({ id: 'a' }, { id: 'b' });
  expect(value('a')).toBe('Remaining reader');
  expect(requests).toHaveLength(1);
});

it.each([401, 403, 500, 404, 409])(
  'preserves each subscriber state after HTTP %s',
  async (status) => {
    await show({ id: 'a' }, { id: 'b' });
    await finish(0, answer('Earlier result'));
    await show({ id: 'a', revision: 1 }, { id: 'b', revision: 1 });
    const body =
      status === 409
        ? JSON.stringify({ type: 'https://api.alethical.com/problems/records-changed' })
        : null;
    await finish(1, new Response(body, { status }));
    for (const id of ['a', 'b']) {
      expect(reads.get(id)?.failed).toBe(status !== 404);
      expect(reads.get(id)?.accessDenied).toBe(status === 401 || status === 403);
      expect(reads.get(id)?.notFound).toBe(status === 404);
      expect(reads.get(id)?.changed).toBe(status === 409);
      expect(value(id)).toBe(status === 401 || status === 403 ? 'none' : 'Earlier result');
    }
    expect(session.retry).toHaveBeenCalledTimes(status === 401 || status === 403 ? 2 : 0);
  },
);

it('shares the existing busy retry loop, not another retry loop per subscriber', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(
    async () => new Response(null, { status: 503, headers: { 'Retry-After': '1' } }),
  );
  vi.stubGlobal('fetch', fetcher);
  await show({ id: 'a' }, { id: 'b' });
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(reads.get('a')?.busy).toBe(true);
  expect(reads.get('b')?.busy).toBe(true);
});

it('does not extend the completed answer lifetime', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  await show({ id: 'a' }, { id: 'b' });
  await finish(0, answer('Earlier'));
  await show();
  now.mockReturnValue(61000);
  await show({ id: 'c' }, { id: 'd' });
  expect(value('c')).toBe('none');
  expect(requests).toHaveLength(2);
  await finish(1, answer('Fresh'));
  expect(value('c')).toBe('Fresh');
});

const account: Account = { registrationNumber: '100', name: 'First account', years: [2026, 2024] };
const yearAnswer = (year = 2026): FinanceYear => ({
  year,
  committees: [
    {
      registration_number: '100',
      committee_name: 'First account',
      split: { state: 'shown', reported_total: year === 2026 ? '123.99' : '24.99' },
      money_in: { state: 'reported', itemized_contribution_total: '77.77' },
    },
    {
      registration_number: '200',
      committee_name: 'Second account',
      split: { state: 'shown', reported_total: '456.99' },
    },
  ],
});
async function showProfile(accounts = [account]) {
  await act(async () =>
    root.render(
      <>
        <KeyFigures legislatorId={null} candidateId="one" account={account} />
        <CampaignFinance candidateId="one" accounts={accounts} from="/candidates/one" />
      </>,
    ),
  );
}
const yearRequests = () => requests.filter(({ url }) => url.includes('/campaign-finance?year='));

it('shares the deferred candidate year read between headline and first account', async () => {
  await showProfile();
  // Both real consumers mount before a response can complete or enter cache.
  expect(yearRequests()).toHaveLength(1);
  await act(async () =>
    yearRequests()[0].resolve(new Response(JSON.stringify({ data: yearAnswer() }))),
  );
  expect(container.querySelector('.cf-key')?.textContent).toContain('$123');
  expect(container.querySelector('.cf-account')?.textContent).toContain('$123');
});

it('selects each same-year campaign account from one response', async () => {
  await showProfile([
    account,
    { registrationNumber: '200', name: 'Second account', years: [2026] },
  ]);
  expect(yearRequests()).toHaveLength(1);
  await act(async () =>
    yearRequests()[0].resolve(new Response(JSON.stringify({ data: yearAnswer() }))),
  );
  const cards = container.querySelectorAll('.cf-account');
  expect(cards[0].textContent).toContain('$123');
  expect(cards[1].textContent).toContain('$456');
});

it('keeps headline newest-year and existing URL-year behavior unchanged', async () => {
  await showProfile([
    account,
    { registrationNumber: '200', name: 'Second account', years: [2026, 2024] },
  ]);
  await act(async () => {
    yearRequests()[0].resolve(new Response(JSON.stringify({ data: yearAnswer() })));
    for (const request of requests)
      if (request.url.includes('/outside-spending'))
        request.resolve(
          new Response(JSON.stringify({ data: { state: 'not_reported', year: 2026, groups: [] } })),
        );
  });
  const first = container.querySelector('.cf-account')!;
  const year = [...first.querySelectorAll('button')].find(
    (button) => button.textContent === '2024',
  )!;
  await act(async () => year.click());
  const older = yearRequests().filter(({ url }) => url.endsWith('year=2024'));
  expect(older).toHaveLength(1);
  await act(async () => older[0].resolve(new Response(JSON.stringify({ data: yearAnswer(2024) }))));
  expect(window.location.search).toContain('year=2024');
  expect(container.querySelector('.cf-key')?.textContent).toContain('Year 2026');
  expect(container.querySelector('.cf-key')?.textContent).toContain('$123');
  expect(first.textContent).toContain('$24');
  // Existing behavior: another card without an explicit local choice follows
  // the URL year. Sharing transport must not change that selection policy.
  for (const card of container.querySelectorAll('.cf-account'))
    expect(card.querySelector('button[aria-pressed="true"]')?.textContent).toBe('2024');
});
