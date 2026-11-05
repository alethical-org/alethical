import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import { useNamePayments, useNameSpellings, type NamePage } from '../pages/payments/data';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session = vi.hoisted(() => ({
  apiBaseUrl: 'https://api.example.test',
  accessToken: 'account-a',
  retry: vi.fn(),
}));
vi.mock('../auth/session', () => ({ useFinanceSession: () => session }));

let root: Root;
let container: HTMLDivElement;
const waiting = new Map<string, (response: Response) => void>();

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function page(name: string): NamePage<{ record_number: number }> {
  return {
    name,
    role: 'contributor',
    year: null,
    state: 'reported',
    payments: [{ record_number: 1 }],
    page: { limit: 200, offset: 0, has_more: false, total_payments: 1 },
    linkable_registration_numbers: [],
    source_url: null,
    release_id: 'held-release',
    fetched_at: null,
  };
}
function PaymentProbe({ name }: { name: string }) {
  const read = useNamePayments({ name, role: 'contributor' });
  return (
    <div>
      {read.data?.name ?? 'No rows'}
      {read.failed ? ' Failed' : ''}
      {read.data?.hasMore && <button onClick={read.more}>More</button>}
    </div>
  );
}
function SpellingProbe({ name }: { name: string }) {
  const read = useNameSpellings({ name, role: 'donor' });
  return <div>{read.data?.names.join(',') ?? 'No rows'}</div>;
}

beforeEach(() => {
  clearReadCache();
  waiting.clear();
  session.accessToken = 'account-a';
  session.retry.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (input: string, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          const url = new URL(input);
          const token = (init?.headers as Record<string, string>)?.Authorization ?? '';
          // Intentionally ignore abort: even a late response must never cross a view/account boundary.
          waiting.set(`${token}|${url.searchParams.get('name')}`, resolve);
        }),
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('does not show the previous account’s payment rows during loading or access refusal', async () => {
  await act(async () => root.render(<PaymentProbe name="A donor" />));
  await act(async () => waiting.get('Bearer account-a|A donor')!(json(page('A donor'))));
  expect(container.textContent).toBe('A donor');
  session.accessToken = 'account-b';
  await act(async () => root.render(<PaymentProbe name="A donor" />));
  expect(container.textContent).toBe('No rows');
  await act(async () => waiting.get('Bearer account-b|A donor')!(json(null, 403)));
  expect(container.textContent).toBe('No rows Failed');
  expect(session.retry).toHaveBeenCalledOnce();
});

it('ignores a late payment response after the reader chooses another name', async () => {
  await act(async () => root.render(<PaymentProbe name="First donor" />));
  const old = waiting.get('Bearer account-a|First donor')!;
  await act(async () => root.render(<PaymentProbe name="Second donor" />));
  await act(async () => waiting.get('Bearer account-a|Second donor')!(json(page('Second donor'))));
  await act(async () => old(json(page('First donor'))));
  expect(container.textContent).toBe('Second donor');
});

it('ignores late spelling discovery from the previous requested name', async () => {
  await act(async () => root.render(<SpellingProbe name="Danchik, Arthur" />));
  const old = waiting.get('Bearer account-a|Danchik, Arthur')!;
  await act(async () => root.render(<SpellingProbe name="Other, Alice" />));
  await act(async () =>
    waiting.get('Bearer account-a|Other, Alice')!(json({ names: ['Other, Alice Ms'] })),
  );
  await act(async () => old(json({ names: ['Dantchik, Arthur'] })));
  expect(container.textContent).toBe('Other, Alice Ms');
});

it.each([401, 403])(
  'removes previously loaded rows if pagination loses access (%s)',
  async (status) => {
    await act(async () => root.render(<PaymentProbe name="A donor" />));
    const first = page('A donor');
    first.page.has_more = true;
    await act(async () => waiting.get('Bearer account-a|A donor')!(json(first)));
    expect(container.textContent).toBe('A donorMore');
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    await act(async () => waiting.get('Bearer account-a|A donor')!(json(null, status)));
    expect(container.textContent).toBe('No rows Failed');
    expect(session.retry).toHaveBeenCalledOnce();
  },
);

it('rechecks page access when spelling discovery is refused', async () => {
  await act(async () => root.render(<SpellingProbe name="A donor" />));
  await act(async () => waiting.get('Bearer account-a|A donor')!(json(null, 403)));
  expect(container.textContent).toBe('No rows');
  expect(session.retry).toHaveBeenCalledOnce();
});
