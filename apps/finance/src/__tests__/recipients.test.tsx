import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import {
  Recipients,
  recipientAmount,
  recipientHref,
  recipientPeriod,
  type Recipient,
  type RecipientsPage,
} from '../pages/Recipients';
import { matchRoute } from '../routes';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));
const row: Recipient = {
  key: 'campaign|name',
  name: 'Same Printed Name',
  record_kind: 'printed_name',
  identity: null,
  role: 'vendor',
  dataset: 'expenditures',
  payment_count: 2,
  amount: '-145.99',
  amount_state: 'reported',
  period_basis: 'dates',
  first_year: 2025,
  last_year: 2026,
  first_payment_on: '2025-01-01',
  last_payment_on: '2026-02-02',
  undated_payment_count: 0,
  source_url: null,
  snapshot_id: 's',
  fetched_at: '2026-10-29T12:00:00Z',
};
const data: RecipientsPage = {
  state: 'reported',
  rows: [
    row,
    {
      ...row,
      key: 'independent|name',
      role: 'independent_vendor',
      amount: null,
      amount_state: 'incomplete',
    },
  ],
  total: 2,
  payment_count: 4,
  has_more: false,
  limit: 10,
  offset: 0,
  years: [2026, 2025],
  payment_types: ['Refund'],
  counts: { all: 2, confirmed: 0, printed: 2 },
  sources: [],
};
let container: HTMLDivElement, root: Root, requests: URL[];
beforeEach(() => {
  clearReadCache();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  requests = [];
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const json = (data: unknown) =>
  new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
async function render(
  path: string,
  answer: (url: URL) => Response | Promise<Response> = () => json(data),
) {
  window.history.replaceState(null, '', path);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const u = new URL(input);
      requests.push(u);
      return answer(u);
    }),
  );
  await act(async () => root.render(<Recipients match={matchRoute('/money/recipients')!} />));
  await settle();
}
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label)!;
it('lists all payees without a query, preserving separate payment files and signed amounts', async () => {
  await render('/money/recipients');
  expect(requests[0].pathname).toContain('/finance/payees');
  expect(container.textContent).toContain('2 recipients · 4 payment records');
  expect(container.querySelectorAll('a.vp-name-link')).toHaveLength(2);
  expect(container.querySelector('a[href*="section=campaign-payments"]')).toBeTruthy();
  expect(container.querySelector('a[href*="section=outside-payments"]')).toBeTruthy();
  expect(container.textContent).toContain('-$145');
  expect(container.textContent).toContain('Incomplete: a payment amount is missing');
  expect(container.textContent).not.toContain('$0');
});
it('sends filters and sort to the whole server list', async () => {
  await render('/money/recipients?tab=confirmed&year=2026&type=Refund&sort=amount&page=3');
  expect(Object.fromEntries(requests[0].searchParams)).toMatchObject({
    tab: 'confirmed',
    year: '2026',
    payment_type: 'Refund',
    sort: 'amount',
    offset: '20',
    limit: '10',
  });
});
it('pages on the server instead of slicing a capped search', async () => {
  await render('/money/recipients', (url) =>
    json({
      ...data,
      total: 23,
      has_more: Number(url.searchParams.get('offset')) < 20,
      offset: Number(url.searchParams.get('offset')),
    }),
  );
  await act(async () => button('Next').click());
  await settle();
  expect(requests.at(-1)?.searchParams.get('offset')).toBe('10');
  expect(container.textContent).toContain('Page 2 of 3');
});
it('keeps the prior answer visible when an update fails', async () => {
  await render('/money/recipients', (url) =>
    url.searchParams.get('tab') === 'printed' ? new Response(null, { status: 500 }) : json(data),
  );
  const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) =>
    b.textContent?.startsWith('Printed names'),
  )!;
  await act(async () => tab.click());
  await settle();
  expect(container.textContent).toContain('We couldn’t update these results');
  expect(container.querySelectorAll('a.vp-name-link')).toHaveLength(2);
  expect(button('Try again')).toBeTruthy();
});
it('shows a failed read as failure, not no matches', async () => {
  await render('/money/recipients', () => new Response(null, { status: 500 }));
  expect(container.textContent).toContain('We couldn’t load these results');
  expect(container.textContent).not.toContain('No matching records');
});
it('links only the covered confirmed identity and withholds incomplete totals', () => {
  expect(
    recipientHref({
      ...row,
      identity: { id: 'i', kind: 'organization', name: 'Official' },
      record_kind: 'confirmed_vendor',
    }),
  ).toBe('/organizations/i');
  expect(
    recipientHref({
      ...row,
      identity: { id: 'p', kind: 'person', name: 'Person' },
      record_kind: 'confirmed_person',
    }),
  ).toBe('/people/p');
  expect(recipientAmount({ ...row, amount: '10', amount_state: 'incomplete' })).toContain(
    'Incomplete',
  );
  expect(recipientPeriod({ ...row, undated_payment_count: 1 })).toContain(
    '1 undated payment record',
  );
});

it('treats an unavailable source as a failure rather than zero recipients', async () => {
  await render('/money/recipients', () =>
    json({ ...data, state: 'unavailable', rows: [], total: null, payment_count: null }),
  );
  expect(container.textContent).toContain('We couldn’t load these results');
  expect(container.textContent).not.toContain('0 recipients');
});

it('keeps the previous rows when the source returns unavailable', async () => {
  await render('/money/recipients', (url) =>
    json(
      url.searchParams.get('tab') === 'printed'
        ? { ...data, state: 'unavailable', rows: [], total: null }
        : data,
    ),
  );
  const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) =>
    b.textContent?.startsWith('Printed names'),
  )!;
  await act(async () => tab.click());
  await settle();
  expect(container.querySelectorAll('a.vp-name-link')).toHaveLength(2);
  expect(container.textContent).toContain('We couldn’t update these results');
});

it('shows a whole year span or withholds a total whose period is incomplete', () => {
  expect(recipientPeriod({ ...row, period_basis: 'years', undated_payment_count: 1 })).toContain(
    'Years 2025–2026',
  );
  expect(
    recipientAmount({ ...row, period_basis: 'unknown', amount_state: 'incomplete_period' }),
  ).toBe('Amount unavailable: payment period is incomplete');
  expect(recipientPeriod({ ...row, period_basis: 'unknown' })).not.toContain('Feb');
});
