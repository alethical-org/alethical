import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import {
  countLine,
  Recipients,
  recipientAmount,
  recipientHref,
  recipientKind,
  recipientPeriod,
  sortFromParam,
  sourceLines,
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
  // Under the amount heading a withheld total reads "Incomplete" (Design Round 34).
  expect(container.querySelector('.vp-amount[data-missing]')?.textContent).toBe('Incomplete');
  expect(container.textContent).not.toContain('$0');
  // Each group names its source file under its kind tag (Round 37).
  expect([...container.querySelectorAll('.vp-file')].map((e) => e.textContent)).toEqual([
    'Expenditure file',
    'Independent expenditure file',
  ]);
  expect(container.querySelector('.vp-tag')?.textContent).toBe('Printed name');
  // The pager is drawn with both ends inert on a single page.
  expect(button('Previous').getAttribute('aria-disabled')).toBe('true');
  expect(button('Next').getAttribute('aria-disabled')).toBe('true');
  expect(container.textContent).toContain(
    'A recipient is not a vendor unless confirmed; refunds keep their filed sign',
  );
});
it('carries the selected year into a printed name’s payments link', async () => {
  await render('/money/recipients?year=2026');
  const link = container.querySelector<HTMLAnchorElement>('a.vp-name-link')!;
  expect(link.getAttribute('href')).toBe(
    '/money/names/Same%20Printed%20Name?role=payee&year=2026&section=campaign-payments&from=%2Fmoney%2Frecipients%3Fyear%3D2026',
  );
  // `from=` joins once the recipients route is on in BUILT (returnContext accepts
  // only built pages); the row link is built with withFrom either way.
});
it('offers Largest total first in place of Itemized amount, and maps the old address', async () => {
  await render('/money/recipients?sort=Itemized%20amount');
  expect(requests[0].searchParams.get('sort')).toBe('amount');
  expect(container.textContent).toContain('Sort by: Largest total first');
  expect(container.textContent).not.toContain('Smallest total first');
  expect(sortFromParam('nonsense')).toBe('name');
  expect(sortFromParam('records')).toBe('records');
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
  // Person profiles are not built, so a confirmed person gets no link to a missing page.
  expect(
    recipientHref({
      ...row,
      identity: { id: 'p', kind: 'person', name: 'Person' },
      record_kind: 'confirmed_person',
    }),
  ).toBeNull();
  expect(recipientKind({ ...row, record_kind: 'confirmed_person' })).toBe('Person');
  expect(recipientKind({ ...row, record_kind: 'confirmed_vendor' })).toBe('Organization');
  expect(recipientAmount({ ...row, amount: '10', amount_state: 'incomplete' })).toBe('Incomplete');
  // A phone row has no amount heading, so it says what is missing (Round 36).
  expect(recipientAmount({ ...row, amount: '10', amount_state: 'incomplete' }, true)).toBe(
    'Missing payment amount',
  );
  expect(recipientAmount({ ...row, amount: '0' })).toBe('$0');
  expect(recipientAmount({ ...row, amount: null })).toBe('Amount not given');
});
it('says the count line in the tab’s own noun', () => {
  expect(countLine({ ...data, total: 1, payment_count: 1, q: 'x' }, 'printed')).toBe(
    '1 printed name · 1 payment record matching “x”',
  );
  expect(countLine({ ...data, total: 3, payment_count: 7 }, 'confirmed')).toBe(
    '3 organizations · 7 payment records',
  );
  expect(countLine(data, 'all')).toBe('2 recipients · 4 payment records');
});
it('names both files once when copied the same day, else each with its own date', () => {
  expect(
    sourceLines([
      { dataset: 'expenditures', fetched_at: '2026-10-29T12:00:00Z', source_url: null },
      { dataset: 'independent_expenditures', fetched_at: '2026-10-29T15:00:00Z', source_url: null },
    ]),
  ).toEqual([
    'Payment records from the expenditure and independent expenditure files, copied Oct 29, 2026',
  ]);
  expect(
    sourceLines([
      { dataset: 'expenditures', fetched_at: '2026-10-29T12:00:00Z', source_url: null },
      { dataset: 'independent_expenditures', fetched_at: null, source_url: null },
    ]),
  ).toEqual([
    'Spending file copied Oct 29,\u00a02026',
    'Outside-spending file copy date unavailable',
  ]);
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
  // A filing-year basis is labelled as such (Design Round 41).
  expect(recipientPeriod({ ...row, period_basis: 'years', undated_payment_count: 1 })).toBe(
    'Filing years 2025–2026',
  );
  expect(recipientPeriod({ ...row, period_basis: 'years', last_year: 2025 })).toBe(
    'Filing year 2025',
  );
  expect(recipientPeriod(row)).toBe('Jan 1, 2025 to Feb 2, 2026');
  expect(
    recipientAmount({ ...row, period_basis: 'unknown', amount_state: 'incomplete_period' }),
  ).toBe('Reporting period incomplete');
  // A missing amount is said first, before the period.
  expect(recipientAmount({ ...row, period_basis: 'unknown', amount_state: 'incomplete' })).toBe(
    'Incomplete',
  );
  expect(recipientPeriod({ ...row, period_basis: 'unknown' })).toBe(
    'Date not given in the public file',
  );
});
