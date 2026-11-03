import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import {
  IdentityNames,
  IdentityRecords,
  identityNameAmount,
  identityNamePeriod,
  type IdentityName,
} from '../pages/checking/IdentityRead';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));
vi.mock('../pages/media/shared', async () => ({
  ...(await vi.importActual('../pages/media/shared')),
  PageImage: () => <div>Page image</div>,
}));
const name: IdentityName = {
  record_kind: 'payee_name',
  record_key: 'Example',
  name: 'Example',
  records: 40,
  confirmed: 2,
  amount: '800',
  amount_state: 'reported',
  period_basis: 'years',
  first_year: 2025,
  last_year: 2026,
  first_date: '2026-01-01',
  last_date: '2026-01-01',
  missing_amounts: 0,
  undated_records: 0,
  file: 'expenditures',
  snapshot_id: 'snapshot',
  source_url: null,
  copied_at: '2026-10-29',
};
it('withholds incomplete name totals and uses only the complete period basis', () => {
  expect(
    identityNameAmount({ ...name, amount_state: 'incomplete_amount', missing_amounts: 1 }),
  ).toBe('Amount unavailable');
  expect(
    identityNameAmount({ ...name, amount_state: 'incomplete_period', period_basis: null }),
  ).toBe('Amount unavailable');
  expect(identityNamePeriod(name)).toBe('Years 2025–2026');
  expect(identityNamePeriod({ ...name, period_basis: null })).toBe(
    'Period not available for every record',
  );
});
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  clearReadCache();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.history.replaceState(null, '', '/money/identities');
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const json = (data: unknown) =>
  new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
async function flush() {
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
it('uses server queue filters/counts and keeps source-separated spellings separate', async () => {
  const requests: URL[] = [];
  const select = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      requests.push(new URL(input));
      return json({
        rows: [name, { ...name, record_kind: 'independent_payee_name' }],
        total: 300,
        page: 1,
        page_size: 20,
        pages: 15,
        sources: {},
      });
    }),
  );
  await act(async () => root.render(<IdentityNames selected={null} onSelect={select} />));
  await flush();
  expect(container.textContent).toContain('300 names');
  expect(container.textContent).toContain('Campaign payments');
  expect(container.textContent).toContain('Outside spending');
  await act(async () => container.querySelector<HTMLButtonElement>('.ck-name-item')!.click());
  expect(select.mock.calls[0][0].snapshot_id).toBe('snapshot');
  await act(async () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Payee names')!.click(),
  );
  await flush();
  expect(requests.at(-1)!.searchParams.get('record_type')).toBe('payee');
});
it('pins source on every records page and never labels off-page confirmations absent', async () => {
  const requests: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const u = new URL(input);
      requests.push(u);
      return json({
        record_kind: 'payee_name',
        record_key: 'Example',
        snapshot_id: 'snapshot',
        file: 'expenditures',
        records: 40,
        confirmed: 2,
        page: Number(u.searchParams.get('page')),
        page_size: 20,
        total_fingerprints: 30,
        pages: 2,
        years: [2026],
        identities: [],
        no_longer_in_board_file: [],
        fingerprints: [
          {
            fingerprint: 'f',
            fields: { committee_reg_num: '12345', transaction_date: '2026-01-01', amount: '10' },
            rows: [{ row_number: 1 }, { row_number: 2 }],
            confirmation: null,
          },
        ],
      });
    }),
  );
  await act(async () => root.render(<IdentityRecords name={name} />));
  await flush();
  expect(container.textContent).toContain('40 records · Confirmed for 2 of 40');
  expect(container.textContent).toContain('2 identical records');
  expect(container.textContent).toContain('per record');
  expect(container.querySelector('a[href^="/money/committees"]')).toBeNull();
  await act(async () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Next')!.click(),
  );
  await flush();
  expect(requests.at(-1)!.searchParams.get('page')).toBe('2');
  expect(requests.every((u) => u.searchParams.get('snapshot_id') === 'snapshot')).toBe(true);
});
