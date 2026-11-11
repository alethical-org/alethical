import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import { ElectionComparison } from '../pages/elections/Comparison';
import { exactMoney, lineLabel } from '../pages/elections/format';
import type {
  ElectionFinanceAnswer,
  CategorySpending,
  PaymentRecord,
} from '../pages/elections/data';
import fixture from './fixtures/electionComparison.json';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({
    apiBaseUrl: 'https://api.example.test',
    accessToken: 'token',
    email: 'reader@example.test',
    status: 'granted',
    revoked: false,
  }),
}));
const key = fixture.detail.election_key;
const race = fixture.detail.race.id;
const path = `/money/races/attorney-general?election=${key}&race=${race}`;
let container: HTMLDivElement, root: Root;
let finance: ElectionFinanceAnswer;
let requests: string[];
let failFinance = false;
const payment: PaymentRecord = {
  row_number: 6835,
  resolution: 'checked_account_and_period',
  fields: {
    Spender: 'Jackson County RPM',
    Amount: '203.8600',
    Date: '2026-10-13',
    'For /Against': 'For',
    'Affected Cmte Reg Num': '19261',
    'Spender Reg Num': '20214',
    'Spender type': 'PTU',
    'Spender sub-type': 'Party unit',
    'Affected Comte Name': 'Schutz, Ronald Atty Gen Committee',
    Year: 2026,
    Type: 'Independent expenditure',
    'Unpaid amount': '0.0000',
    'In kind?': 'No',
    'In kind descr': null,
    Purpose: 'Printing and Photocopying: Print ad and post cards',
    'Vendor name': 'Livewire Printing Company',
    'Vendor city': 'Jackson',
    'Vendor State': 'MN',
    'Vendor zip': '56143',
  },
};
const group: CategorySpending = {
  category: 'PTU',
  direction: 'For',
  state: 'reported',
  record_count: 1,
  amount: '203.8600',
  known_amount_subtotal: '203.8600',
  missing_amount_count: 0,
  included_unpaid_amount: '0.0000',
  known_unpaid_subtotal: '0.0000',
  missing_unpaid_count: 0,
  missing_date_count: 0,
  missing_year_count: 0,
  date_year_conflict_count: 0,
  date_coverage: 'dates_present',
  first_known_date: '2026-10-13',
  last_known_date: '2026-10-13',
};
const json = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    headers: { 'Content-Type': 'application/json' },
  });
const buttons = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
    b.textContent?.includes(text),
  );
async function settle() {
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
}
async function render(url = path) {
  window.history.replaceState(null, '', url);
  await act(async () => root.render(<ElectionComparison />));
  await settle();
}
async function click(button: HTMLElement) {
  await act(async () => button.click());
  await settle();
}
beforeEach(() => {
  clearReadCache();
  finance = structuredClone(fixture.finance) as unknown as ElectionFinanceAnswer;
  requests = [];
  failFinance = false;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:source');
      static revokeObjectURL = vi.fn();
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      requests.push(input);
      const url = new URL(input);
      const endpoint = url.pathname;
      if (endpoint.endsWith(`/elections`)) return json({ elections: [fixture.detail] });
      if (endpoint.endsWith('/outside-spending/source'))
        return new Response('source bytes', {
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      if (endpoint.includes('/candidates/') && endpoint.endsWith('/outside-spending'))
        return json({
          rows: [payment],
          page: { total: 1, offset: 0, limit: 50, has_more: false },
        });
      if (endpoint.endsWith('/finance'))
        return failFinance ? new Response('failed', { status: 500 }) : json(finance);
      if (endpoint.endsWith('/precincts')) return json(fixture.precincts);
      if (endpoint.endsWith('/lines')) return json(fixture.sourceLines);
      if (endpoint.includes('/sources/'))
        return new Response('source bytes', {
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      if (endpoint.endsWith(`/races/${race}`)) return json(fixture.detail);
      if (endpoint.endsWith('/races'))
        return json({
          ...fixture.detail,
          query: url.searchParams.get('q') ?? '',
          races: [fixture.detail.race],
          page: { total: 1, offset: 0, limit: 50, has_more: false },
        });
      throw new Error(`Unexpected route ${input}`);
    }),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('keeps exact report cents, write-ins in the vote denominator and precinct candidates aligned by source code', async () => {
  await render();
  expect(container.textContent).toContain('$4,327,206.21');
  expect(container.textContent).toContain('$3,784,789.65');
  expect(container.textContent).toContain('54.29%');
  expect(container.textContent).toContain('0.15%');
  expect(container.textContent).toContain('Unofficial results');
  expect(container.textContent).not.toMatch(/won|winner/i);
  const table = container.querySelector('[aria-label="Precinct results"] table')!;
  const row = table.querySelector('tbody tr')!;
  expect([...row.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual([
    'Aitkin',
    '524',
    '384',
    '0',
    '908',
    'View source for AITKIN',
  ]);
  expect(container.textContent).toContain('Report figures not held');
});

it('keeps votes and precincts when the campaign read fails', async () => {
  failFinance = true;
  await render();
  expect(container.textContent).toContain('1,521,032');
  expect(container.textContent).toContain('AITKIN');
  expect(container.textContent).toContain('We couldn’t load campaign money');
  expect(container.textContent).not.toContain('$0');
});

it('restores a shared payment-source link and keeps unsupported positions distinct from zero', async () => {
  finance.outside_spending_availability = { state: 'available', reason: null };
  finance.payment_release_id = '00000000-0000-0000-0000-000000000123';
  finance.payment_version = '0123456789abcdef';
  const candidate = finance.candidates.find((c) => c.name === 'Ronald J. Schutz')!;
  candidate.outside_spending.groups = [group];
  const pay = `${candidate.candidate_id}:PTU:For`;
  await render(`${path}&pay=${encodeURIComponent(pay)}&source=payment%3A6835`);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Jackson County RPM');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Record 6835');
  expect(
    requests.some((url) => url.includes('spender_type=PTU') && url.includes('direction=For')),
  ).toBe(true);
  expect(
    requests.some(
      (url) => url.includes('/outside-spending/source?') && url.includes('release_id='),
    ),
  ).toBe(true);
  expect(container.textContent).toContain('No party-unit payments held for this position');
});

it('opens precise precinct source lines and closes evidence without changing the race', async () => {
  await render();
  await click(buttons('View source for AITKIN')[0]);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Lines 28–30');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('28  MN;01;0005;0335');
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(new URLSearchParams(window.location.search).get('race')).toBe(race);
});

it('keeps decimal precision beyond cents and separate physical source lines', () => {
  expect(exactMoney('12345678901234567890.1200')).toBe('$12,345,678,901,234,567,890.12');
  expect(exactMoney('-0.0001')).toBe('−$0.0001');
  expect(exactMoney('-0.00')).toBe('$0.00');
  expect(exactMoney(null)).toBe('Not available');
  expect(lineLabel([29, 28, 30, 114, 114, 116])).toBe('Lines 28–30, 114, 116');
});
