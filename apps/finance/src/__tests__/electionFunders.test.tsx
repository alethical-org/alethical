import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import { Funders } from '../pages/elections/Funders';
import { changeElection, funderReturnHref, reportHref } from '../pages/elections/navigation';
import * as d from '../pages/elections/funderData';
import type { ElectionSummary } from '../pages/elections/data';
import fixture from './fixtures/electionComparison.json';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({
    apiBaseUrl: 'https://api.example.test',
    accessToken: 'reader-token',
    status: 'granted',
    email: 'reader@example.test',
    retry: vi.fn(),
    revoked: false,
  }),
}));
let container: HTMLDivElement, root: Root, paths: string[], changed: boolean;
const measure = (amount: string | null): d.Measure => ({
  state: amount === null ? 'no_records' : 'reported',
  record_count: amount === null ? 0 : 1,
  amount,
  known_amount_subtotal: amount,
  missing_amount_count: 0,
});
const context: d.Context = {
  election_key: fixture.detail.election_key,
  election_date: '2026-11-03',
  snapshot_id: fixture.detail.snapshot_id,
  version: 'd'.repeat(16),
  release_id: 'release',
  reported_year: 2026,
  filters: {},
  scope_note: 'Calendar-year records',
  sources: {
    contributions: {
      snapshot_id: 's',
      content_hash: 'a'.repeat(64),
      copied_at: '2026-11-12',
      source_url: 'https://cfb.mn.gov/original.csv',
      retained_source_url: '',
      retained_original_state: 'held',
    },
  },
};
const funder: d.Funder = {
  funder_id: 'one',
  registration_number: '123',
  names: ['Example funder'],
  identity_state: 'checked',
  recorded_classifications: [
    {
      category: 'PCF',
      recorded_type: 'Political committee',
      recorded_subtype: null,
    },
  ],
  amounts: {
    direct_contributions: measure('-12.99'),
    independent_For: measure('0.50'),
    independent_Against: measure(null),
    independent_unknown: measure(null),
  },
  supported_outcomes: {
    candidacies: 2,
    elected: 1,
    not_elected: 0,
    pending: 1,
  },
  opposed_outcomes: { candidacies: 1, elected: 0, not_elected: 1, pending: 0 },
  support_count_review: { state: 'review_negative_records' },
};
const page = { total: 1, limit: 50, offset: 0, has_more: false };
const json = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    headers: { 'Content-Type': 'application/json' },
  });
const buttons = (text: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].filter((button) =>
    button.textContent?.includes(text),
  );
async function settle() {
  for (let i = 0; i < 6; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}
async function render() {
  await act(async () =>
    root.render(
      <Funders
        election={fixture.detail as ElectionSummary}
        elections={[fixture.detail as ElectionSummary]}
        backHref="/money/races?election=mn-2026-11-03-general"
        onElectionChange={vi.fn()}
        onRemoveRace={vi.fn()}
      />,
    ),
  );
  await settle();
}
beforeEach(() => {
  clearReadCache();
  paths = [];
  changed = false;
  window.history.replaceState(
    null,
    '',
    '/money/races?election=mn-2026-11-03-general&report=funders',
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      paths.push(input);
      const url = new URL(input);
      if (changed && url.pathname.endsWith('/candidates'))
        return new Response(
          JSON.stringify({
            type: 'https://api.alethical.com/problems/records-changed',
          }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/problem+json' },
          },
        );
      if (url.pathname.endsWith('/funders'))
        return json({
          ...context,
          filters: { q: url.searchParams.get('q') || '' },
          funders: [funder],
          page,
        });
      if (url.pathname.endsWith('/candidates'))
        return json({
          ...context,
          page,
          candidates: [
            {
              name: 'Example candidate',
              candidate_id: 'candidate',
              race_id: fixture.detail.race.id,
              race_label: 'Attorney General',
              party: 'DFL',
              district: null,
              votes: 10,
              outcome: 'elected',
              outcome_status: 'certified',
              result_status: 'certified',
              supported: true,
              opposed: false,
              candidate_source_sha256: null,
              candidate_source_row: null,
              evidence: [],
              amounts: funder.amounts,
            },
          ],
        });
      if (url.pathname.endsWith('/records'))
        return json({ ...context, page: { ...page, total: 0 }, rows: [] });
      throw new Error(`Unexpected route ${url.pathname}`);
    }),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it('keeps documented support counts separate from net money and preserves pending outcomes', async () => {
  await render();
  expect(container.textContent).toContain('Candidates supported (2)');
  expect(container.textContent).toContain('Pending1');
  expect(container.textContent).toContain('Candidates opposed (1)');
  expect(container.textContent).toContain('−$12');
  expect(container.textContent).not.toContain('−$13');
  expect(container.textContent).toContain('Net amount is negative');
  expect(container.textContent).toContain('No records');
  expect(container.textContent).not.toContain('.99');
});
it('opens candidate outcomes with the same pins and returns from the race to the funder filter', async () => {
  await render();
  await click(buttons('View candidates')[0]);
  const request = new URL(paths.find((path) => new URL(path).pathname.endsWith('/candidates'))!);
  expect(request.searchParams.get('snapshot_id')).toBe(context.snapshot_id);
  expect(request.searchParams.get('version')).toBe(context.version);
  expect(container.textContent).toContain('Example candidate');
  const link = [...container.querySelectorAll<HTMLAnchorElement>('a')].find(
    (a) => a.textContent === 'View race',
  )!;
  const target = new URL(link.href);
  expect(target.searchParams.get('race')).toBe(fixture.detail.race.id);
  const back = funderReturnHref(target)!;
  expect(back).toContain('report=funders');
  expect(back).toContain('funder=one');
});
it('reloads candidate evidence after changed records instead of reusing the cached refusal', async () => {
  await render();
  changed = true;
  await click(buttons('View candidates')[0]);
  expect(container.textContent).toContain('These records changed');
  changed = false;
  await click(buttons('Reload comparison')[0]);
  expect(container.textContent).toContain('Example candidate');
  expect(paths.filter((path) => new URL(path).pathname.endsWith('/candidates'))).toHaveLength(2);
});
it('keeps source and auth secrets out of report navigation and rejects foreign return state', () => {
  const url = new URL(
    'https://alethicalfinance.com/money/races?election=mn-2026-11-03-general&race=r&report=funders&fq=Example&funder=one&token=secret&expenseExcluded=old',
  );
  expect(reportHref(url, 'comparison')).not.toContain('token');
  expect(reportHref(url, 'comparison')).not.toContain('expenseExcluded');
  expect(reportHref(url, 'comparison')).not.toContain('fq=');
  expect(changeElection(url, 'mn-2024-11-05-general')).toBe(
    '/money/races?election=mn-2024-11-05-general&report=funders',
  );
  url.searchParams.set('freturn', 'https://outside.example/');
  expect(funderReturnHref(url)).toBeNull();
  url.searchParams.set('freturn', '?report=funders&election=wrong');
  expect(funderReturnHref(url)).toBeNull();
});
it('validates actual calendar dates without rolling impossible dates into another month', () => {
  expect(d.inputDate('02/30/2026')).toBeNull();
  expect(d.inputDate('02/29/2024')).toBe('2024-02-29');
  expect(d.inputDate('2/1/2026')).toBeNull();
  expect(d.inputDate('')).toBe('');
});
it('returns from each report with the selected comparison filing and precinct scope intact', () => {
  const original = new URL(
    `https://alethicalfinance.com/money/races?election=mn-2026-11-03-general&race=r&q=Attorney&reports=123:${'a'.repeat(64)}&pq=Ward&ppage=2&votesView=table&token=secret`,
  );
  for (const mode of ['funders', 'expenses'] as const) {
    const report = new URL(reportHref(original, mode), original.origin);
    const returned = new URL(reportHref(report, 'comparison'), original.origin);
    for (const key of ['election', 'race', 'q', 'reports', 'pq', 'ppage', 'votesView']) {
      expect(returned.searchParams.get(key)).toBe(original.searchParams.get(key));
    }
    expect(returned.searchParams.has('token')).toBe(false);
  }
});

it('keeps external native records together, with source-specific measures and exact retained evidence', async () => {
  const generation = 'e'.repeat(64),
    hash = 'f'.repeat(64);
  const externalContext: d.Context = {
    ...context,
    sources: {},
    source_scopes: {
      mn_cfb: { status: 'unavailable' },
      external: {
        status: 'available',
        generation_id: generation,
        authorities: [{ key: 'fec', name: 'Federal Election Commission' }],
      },
    },
    external_sources: [
      {
        generation_id: generation,
        source_sha256: hash,
        authority: 'fec',
        copied_at: '2026-11-10',
      },
    ],
  };
  const row: d.Payment = {
    dataset: 'external',
    row_number: null,
    record_id: 'external:one',
    funder_id: 'external-payer',
    funder_name: 'Example outside group',
    date: '2026-10-01',
    amount: '18.99',
    metric: 'external_communication_cost',
    resolution: 'supplemental_memo',
    fields: {
      'Vendor name': 'Filed vendor',
      Purpose: 'Communication',
      Recipient: 'H6MN00001',
    },
    claims: [],
    related_candidacies: [],
    source_family: 'external',
    currency: 'USD',
    authority: 'fec',
    source_account_id: 'C00000001',
    external_generation_id: generation,
    report_key: 'a'.repeat(64),
    source_report_id: '1000001',
    source_row_id: 'row-5',
    direction: 'communication_cost',
    transaction_type: 'Communication cost',
    nonadditive: true,
    effective: true,
    period_start: '2026-10-01',
    period_end: '2026-10-14',
    source_bindings: [
      {
        source_sha256: hash,
        locator: { row: 5 },
        quote: '18.99 EXACT',
        source_copied_at: '2026-11-10',
      },
    ],
    source: {
      source_family: 'external',
      generation_id: generation,
      content_hash: hash,
      source_sha256: hash,
      source_url: 'https://example.test/source',
      copied_at: '2026-11-10',
      retained_original_state: 'available',
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      paths.push(input);
      const url = new URL(input);
      if (url.pathname.endsWith('/funders'))
        return json({
          ...externalContext,
          funders: [
            {
              ...funder,
              funder_id: 'external-payer',
              names: ['Example outside group'],
              source_family: 'external',
              registration_number: null,
              recorded_classifications: [
                {
                  category: 'external',
                  recorded_type: 'Federal Election Commission',
                  recorded_subtype: null,
                },
              ],
              source_measures: [
                {
                  authority: 'fec',
                  account_id: 'C00000001',
                  report_key: row.report_key,
                  source_report_id: '1000001',
                  measure: 'external_communication_cost',
                  label: 'Communication cost',
                  direction: 'communication_cost',
                  transaction_type: 'Communication cost',
                  period_start: row.period_start,
                  period_end: row.period_end,
                  currency: 'USD',
                  basis: 'checked_retained_itemized_rows',
                  effective: true,
                  nonadditive: true,
                  attribution: 'supplemental_memo',
                  state: 'amount_unavailable',
                  amount: null,
                  record_count: 1,
                  sources: row.source_bindings,
                },
              ],
            },
          ],
          page,
        });
      if (url.pathname.endsWith('/records')) return json({ ...externalContext, rows: [row], page });
      if (url.pathname.includes('/external-finance/sources/'))
        return new Response('18.99 EXACT', {
          headers: { 'Content-Type': 'text/plain' },
        });
      return json({ ...externalContext, candidates: [], page });
    }),
  );
  await render();
  expect(container.textContent).toContain('Minnesota Board records unavailable');
  expect(container.textContent).toContain('Communication cost');
  expect(container.textContent).not.toContain('Political committees and funds');
  await click(buttons('View payments')[0]);
  const records = paths
    .map((path) => new URL(path))
    .filter((url) => url.pathname.endsWith('/records'));
  expect(records).toHaveLength(1);
  expect(records[0].searchParams.has('metric')).toBe(false);
  expect(container.querySelector('.ef-payments')?.textContent).toContain(
    'Supplemental memo, not added to spending',
  );
  await click(buttons('View source')[0]);
  const panel = document.querySelector('[role="dialog"]')!;
  expect(panel.textContent).toContain('Federal Election Commission');
  expect(panel.textContent).toContain('18.99 EXACT');
  expect(panel.textContent).toContain('CopiedNov 10, 2026');
  const source = paths
    .map((path) => new URL(path))
    .find((url) => url.pathname.includes('/external-finance/sources/'))!;
  expect(source.searchParams.get('generation_id')).toBe(generation);
  expect(source.pathname).toContain(hash);
});
