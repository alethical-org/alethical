import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import { ElectionComparison } from '../pages/elections/Comparison';
import { moneyLabel, lineLabel, dateLabel, periodLabel } from '../pages/elections/format';
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
let failPayments = false;
let currentSnapshot = fixture.detail.snapshot_id;
let detail = structuredClone(fixture.detail);
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
  failPayments = false;
  currentSnapshot = fixture.detail.snapshot_id;
  detail = structuredClone(fixture.detail);
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
      if (endpoint.endsWith(`/elections`))
        return json({
          elections: [{ ...fixture.detail, snapshot_id: currentSnapshot }],
        });
      if (
        url.searchParams.has('snapshot_id') &&
        url.searchParams.get('snapshot_id') !== currentSnapshot
      )
        return new Response(
          JSON.stringify({
            type: 'https://api.alethical.com/problems/records-changed',
            status: 409,
          }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/problem+json' },
          },
        );
      if (endpoint.endsWith('/outside-spending/source'))
        return new Response('source bytes', {
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      if (endpoint.includes('/candidates/') && endpoint.endsWith('/outside-spending'))
        return failPayments
          ? new Response('failed', { status: 500 })
          : json({
              rows: [
                {
                  ...payment,
                  resolution:
                    url.searchParams.get('scope') === 'outside_reviewed_period'
                      ? 'outside_checked_period'
                      : payment.resolution,
                },
              ],
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
      if (endpoint.endsWith(`/races/${race}`))
        return json({ ...detail, snapshot_id: currentSnapshot });
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

it('shows whole dollars, write-ins in the vote denominator and precinct candidates aligned by source code', async () => {
  await render();
  expect(container.textContent).toContain('$4,327,206');
  expect(container.textContent).toContain('$3,784,789');
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
  expect(container.textContent).toContain('Couldn’t load campaign money');
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
  expect(container.textContent).toContain(
    'No party-unit payments within the checked account dates',
  );
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

it('drops displayed cents without losing whole dollars or source-line distinctions', () => {
  expect(moneyLabel('12345678901234567890.1200')).toBe('$12,345,678,901,234,567,890');
  expect(moneyLabel('-0.0001')).toBe('−$0');
  expect(moneyLabel('-0.00')).toBe('$0');
  expect(moneyLabel(null)).toBe('Unavailable');
  expect(lineLabel([29, 28, 30, 114, 114, 116])).toBe('Lines 28–30, 114, 116');
});

it('moves focus to the precinct heading on page change and preserves the race', async () => {
  await render();
  const next = container.querySelector<HTMLButtonElement>(
    '[aria-label="Precinct pages"] button:last-child',
  )!;
  await click(next);
  expect(document.activeElement?.id).toBe('ec-precincts');
  expect(new URLSearchParams(window.location.search).get('ppage')).toBe('2');
  expect(new URLSearchParams(window.location.search).get('race')).toBe(race);
});

it('keeps race search results beside the finder before the existing comparison', async () => {
  await render(`${path}&q=Attorney&list=1`);
  const races = container.querySelector('#ec-races-heading');
  const votes = container.querySelector('#ec-votes');
  expect(races).not.toBeNull();
  expect(votes).not.toBeNull();
  expect(races!.compareDocumentPosition(votes!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('keeps a failed shared payment read distinct from a missing source', async () => {
  failPayments = true;
  finance.outside_spending_availability = { state: 'available', reason: null };
  const candidate = finance.candidates.find((c) => c.name === 'Ronald J. Schutz')!;
  candidate.outside_spending.groups = [group];
  await render(
    `${path}&pay=${encodeURIComponent(`${candidate.candidate_id}:PTU:For`)}&source=payment%3A6835`,
  );
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('Couldn’t load payment source');
  expect(dialog.textContent).not.toContain('not held');
  expect(dialog.textContent).toContain('Reload comparison');
  failPayments = false;
  currentSnapshot = fixture.detail.snapshot_id;
  await click(
    [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent === 'Reload comparison',
    )!,
  );
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Record 6835');
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Couldn’t load');
});

it('keeps payments outside checked dates separate and opens their source without claiming attribution', async () => {
  finance.outside_spending_availability = { state: 'available', reason: null };
  finance.payment_release_id = '00000000-0000-0000-0000-000000000123';
  finance.payment_version = '0123456789abcdef';
  const candidate = finance.candidates.find((c) => c.accounts.length)!;
  candidate.outside_spending.excluded_outside_reviewed_period = {
    ...group,
    amount: '249.2900',
  };
  await render();
  // An excluded subtotal can mix For and Against; only individual rows show amounts.
  expect(container.textContent).not.toContain('$249.29');
  expect(container.textContent).toContain('Payments outside checked dates');
  expect(container.textContent).toContain('excluded from this candidate’s totals');
  await click(buttons('View excluded payments')[0]);
  expect(requests.some((url) => url.includes('scope=outside_reviewed_period'))).toBe(true);
  await click(container.querySelector<HTMLButtonElement>('.ec-payments button')!);
  expect(document.body.textContent).toContain(
    'Outside checked account dates; excluded from candidate totals',
  );
  expect(document.body.textContent).not.toContain(
    'Account relationship and reporting period checked',
  );
});

it('reloads the election snapshot when precinct pagination reports changed records', async () => {
  await render();
  currentSnapshot = 'b'.repeat(64);
  await click(
    container.querySelector<HTMLButtonElement>('[aria-label="Precinct pages"] button:last-child')!,
  );
  expect(container.textContent).toContain('These records changed');
  await click(buttons('Reload comparison')[0]);
  expect(container.textContent).not.toContain('These records changed');
  expect(
    requests.some(
      (url) =>
        url.includes('/precincts?') &&
        new URL(url).searchParams.get('snapshot_id') === currentSnapshot,
    ),
  ).toBe(true);
  expect(new URLSearchParams(window.location.search).get('ppage')).toBe('2');
  expect(new URLSearchParams(window.location.search).get('race')).toBe(race);
});

it('opens and closes a campaign report without crashing the comparison', async () => {
  await render();
  expect(buttons('View report').length).toBeGreaterThan(0);
  await click(buttons('View report')[0]);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Reporting period');
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).toContain('1,521,032');
});

it('uses short months and keeps years clear across reporting periods', () => {
  expect(dateLabel('2026-01-01')).toBe('Jan 1, 2026');
  expect(periodLabel('2026-01-01', '2026-10-19')).toBe('Jan 1 to Oct 19, 2026');
  expect(periodLabel('2025-12-01', '2026-01-19')).toBe('Dec 1, 2025 to Jan 19, 2026');
  expect(periodLabel(null, '2026-01-19')).toBe('Dates unavailable');
});

it('selects an earlier filing without replacing unavailable figures with the latest report', async () => {
  await render();
  const account = finance.candidates.find((c) => c.accounts.length)!.accounts[0];
  await click(buttons('Available filings')[0]);
  const choice = container.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${account.reports![1].report_key}"]`,
  );
  expect(choice).not.toBeNull();
  await click(choice!);
  expect(new URLSearchParams(window.location.search).get('reports')).toContain(
    account.reports![1].report_key,
  );
  const card = choice!.closest('.ec-account')!;
  expect(card.textContent).toContain('Dates unavailable');
  expect(card.querySelector('.ec-measures')).toBeNull();
  expect(card.textContent).toContain('Report figures not held');
});

it('restores a copied filing choice and shows its own dates and checked figures', async () => {
  const account = finance.candidates.find((c) => c.accounts.length)!.accounts[0];
  const older = account.reports![1];
  older.period_start = '2026-01-01';
  older.period_end = '2026-07-20';
  older.received_date = '2026-07-27';
  older.attribution = 'checked';
  older.figure_status = 'source_verified';
  older.figures = structuredClone(account.reports![0].figures!);
  older.figures.campaign_expenditures.total = '1234.99';
  await render(path + '&reports=' + account.registration_number + ':' + older.report_key);
  const card = [...container.querySelectorAll('.ec-account')].find((node) =>
    node.textContent?.includes(account.registration_number),
  )!;
  expect(card.textContent).toContain('Jan 1 to Jul 20, 2026');
  expect(card.textContent).toContain('Received Jul 27, 2026');
  expect(card.textContent).toContain('$1,234');
  expect(card.textContent).not.toContain('$3,784,789');
});

it('shows an outcome only with checked authority evidence and opens that original', async () => {
  const candidate = detail.race.candidates[0];
  Object.assign(candidate, {
    outcome: 'elected',
    outcome_status: 'certified',
    evidence: [
      {
        sha256: 'c'.repeat(64),
        authority: 'State Canvassing Board',
        locator: { page: 4 },
        quote: 'Certified election result',
      },
    ],
  });
  detail.race.result_status = 'certified';
  await render();
  expect(container.textContent).toContain('Certified results');
  expect(container.textContent).toContain('Elected');
  await click(buttons('View outcome source')[0]);
  expect(container.textContent).toContain('State Canvassing Board');
  expect(container.textContent).toContain('Page 4');
  expect(requests.some((path) => path.includes('/sources/' + 'c'.repeat(64)))).toBe(true);
});
it('never promotes a ranked candidate or an outcome with unavailable proof to elected', async () => {
  Object.assign(detail.race.candidates[0], {
    outcome: 'elected',
    outcome_status: 'pending',
    evidence: [],
  });
  await render();
  expect(buttons('View outcome source')).toHaveLength(0);
  expect(container.textContent).not.toContain('Elected');
  expect(container.textContent).toContain('Pending');
});
