import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import { ElectionComparison } from '../pages/elections/Comparison';
import { ExternalCandidate } from '../pages/elections/ExternalCandidate';
import { raceCsvPath, type RaceAnswer } from '../pages/elections/data';
import type { ExternalCandidate as Answer } from '../pages/elections/externalData';
import fixture from './fixtures/electionComparison.json';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const retry = vi.fn();
vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({
    apiBaseUrl: 'https://api.example.test',
    accessToken: 'token',
    email: 'reader@example.test',
    status: 'granted',
    revoked: false,
    retry,
  }),
}));
const detail = fixture.detail as unknown as RaceAnswer;
const candidate = {
  ...detail.race.candidates[0],
  candidate_id: detail.race.candidates[0].candidate_id!,
};
const H = (value: string) => value.repeat(64);
const generation = H('a'),
  reportKey = H('b'),
  source = H('c'),
  figureSource = H('d');
let container: HTMLDivElement,
  root: Root,
  data: Answer,
  requests: URL[],
  fetchOptions: RequestInit[];
const onStatus = vi.fn(),
  onSelect = vi.fn(),
  onSource = vi.fn(),
  reload = vi.fn();
const json = (value: unknown) =>
  new Response(JSON.stringify({ data: value }), {
    headers: { 'Content-Type': 'application/json' },
  });
const buttons = (text: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
    b.textContent?.includes(text),
  );
async function settle() {
  for (let i = 0; i < 8; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
async function render(props: Partial<Parameters<typeof ExternalCandidate>[0]> = {}) {
  await act(async () =>
    root.render(
      <ExternalCandidate
        detail={detail}
        candidate={candidate}
        revision={0}
        selected=""
        source=""
        onSelect={onSelect}
        onSource={onSource}
        onStatus={onStatus}
        reload={reload}
        {...props}
      />,
    ),
  );
  await settle();
}
async function click(button: HTMLElement) {
  await act(async () => button.click());
  await settle();
}
it('requires an explicit choice for unknown amendments and keeps it out of comparison totals', async () => {
  data.reports[0].effective = null;
  data.reports[0].version_scope = 'exact_document';
  data.reports[0].amendment_status = 'not_established';
  await render();
  expect(container.textContent).toContain('Choose a filing to inspect; amendments not established');
  expect(container.textContent).not.toContain('$1,200');
  await click(buttons('Available filings')[0]);
  expect(container.textContent).not.toContain('Earlier version');
  await click(container.querySelector('input[type=radio]')!);
  expect(onSelect).toHaveBeenCalled();
  await render({ selected: `fec|C00000001|${reportKey}` });
  expect(container.textContent).toContain('$1,200');
  expect(container.textContent).toContain('Amendments not established; excluded from totals');
  expect(onStatus.mock.calls.at(-1)![1].selectedReports).toEqual([]);
});
it('shows unreadable local fields with their exact source and no guessed amount', async () => {
  data.reports[0].source_field_gaps = [
    {
      measure: 'cash_on_hand',
      label: 'Cash on hand',
      state: 'unreadable',
      literal: '1?0',
      sources: [
        {
          source_sha256: figureSource,
          locator: { page: 3, field: 'cash_on_hand' },
          quote: '1?0',
        },
      ],
    },
  ];
  await render();
  const row = [...container.querySelectorAll('dl > div')].find((r) =>
    r.textContent?.includes('Cash on hand'),
  )!;
  expect(row?.textContent).toContain('Unreadable');
  expect(row.textContent).not.toContain('$0');
  await click(row.querySelector('button')!);
  expect(onSource).toHaveBeenLastCalledWith(
    `external:${encodeURIComponent(candidate.candidate_id)}:gap:${reportKey}.0:0`,
  );
  await render({ source: onSource.mock.calls.at(-1)![0] });
  const panel = document.querySelector('[role="dialog"]')!;
  expect(panel.textContent).toContain('Unreadable');
  expect(panel.textContent).toContain('1?0');
  expect(panel.textContent).toContain('page 3');
});
it('dates the checked listing separately from a companion PDF and opens each version source', async () => {
  Object.assign(data.reports[0], {
    report_type: null,
    version_scope: 'publisher_inventory_as_of',
    amendment_status: 'offered_inventory_checked',
    version_as_of: '2026-11-11T20:00:00Z',
    version_sources: [
      {
        source_sha256: source,
        locator: { table: 'reports_2', line: 4 },
        source_copied_at: '2026-11-11T20:00:00Z',
      },
      {
        source_sha256: figureSource,
        locator: { page: 1 },
        source_copied_at: '2026-11-13T01:00:00Z',
      },
    ],
  });
  await render();
  expect(container.textContent).toContain('Only listed version for this period as of Nov 11, 2026');
  expect(container.textContent).not.toContain('null');
  await click(buttons('View version source 2')[0]);
  expect(onSource).toHaveBeenLastCalledWith(
    `external:${encodeURIComponent(candidate.candidate_id)}:version:${reportKey}:1`,
  );
  await render({ source: onSource.mock.calls.at(-1)![0] });
  const panel = document.querySelector('[role="dialog"]')!;
  expect(panel.textContent).toContain('Only listed version for this period as of Nov 11, 2026');
  expect(panel.textContent).toContain('Nov 13, 2026');
  expect(panel.textContent).toContain('page 1');
  expect(requests.some((url) => url.pathname.includes(figureSource))).toBe(true);
});
it('identifies a bundled report by its checked section page without inventing a filing number', async () => {
  const account = data.accounts[0];
  Object.assign(account, {
    account_id: `group:${H('f')}`,
    issued_id: false,
    account_id_kind: 'physical_section',
    source_section: { source_sha256: source, page: 5 },
  });
  data.reports[0].account_id = account.account_id;
  data.reports[0].source_report_id = null;
  data.reports[0].sources[0].locator = {};
  await render();
  expect(container.querySelector('.ec-account')?.textContent).toContain('Report section · Page 5');
  expect(container.textContent).not.toContain(account.account_id);
  await render({
    source: `external:${encodeURIComponent(candidate.candidate_id)}:report:${reportKey}:0`,
  });
  const panel = document.querySelector('[role="dialog"]')!;
  expect(panel.textContent).toContain('Report sectionPage 5');
  expect(panel.textContent).not.toContain('page 5');
  expect(panel.textContent).not.toContain('Filing account');
  expect(panel.textContent).not.toContain(account.account_id);
});
beforeEach(() => {
  clearReadCache();
  vi.clearAllMocks();
  requests = [];
  fetchOptions = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  data = {
    election_key: detail.election_key,
    race_id: detail.race.id,
    candidate_id: candidate.candidate_id,
    snapshot_id: detail.snapshot_id,
    generation_id: generation,
    version: H('e'),
    copied_at: '2026-11-12T15:00:00Z',
    authorities: [
      {
        key: 'fec',
        name: 'Federal Election Commission',
        jurisdiction: 'US',
        status: 'checked',
      },
    ],
    accounts: [
      {
        authority: 'fec',
        account_id: 'C00000001',
        name: 'Example campaign',
        source_candidate_id: 'H6MN00001',
        checked_on: '2026-11-12',
        period_start: '2026-01-01',
        period_end: '2026-12-31',
      },
    ],
    account_gaps: [],
    coverage: { status: 'checked', authority: 'fec' },
    reports: [
      {
        report_key: reportKey,
        authority: 'fec',
        account_id: 'C00000001',
        report_type: 'Q3',
        source_report_id: '1000001',
        period_start: '2026-07-01',
        period_end: '2026-09-30',
        received_date: '2026-10-15',
        effective: true,
        check_status: 'checked',
        figures: [
          {
            measure: 'disbursements',
            label: 'Disbursements this period',
            value: '1200.99',
            unit: 'USD',
            currency: 'USD',
            period_start: '2026-07-01',
            period_end: '2026-09-30',
            basis: 'period',
            sources: [
              {
                source_sha256: figureSource,
                locator: { row: 1, column: 'total' },
                quote: '1200.99',
              },
            ],
          },
        ],
        sources: [
          {
            source_sha256: source,
            locator: { page: 2 },
            quote: 'Exact source quote 1200.99',
          },
        ],
      },
    ],
    payments: [
      {
        payment_key: H('f'),
        authority: 'fec',
        account_id: 'C00000002',
        report_key: H('1'),
        source_report_id: '1000002',
        source_row_id: 'T1',
        date: '2026-10-01',
        payee: {
          name: 'Example vendor',
          street1: '123 Main St',
          city: 'St Paul',
          state: 'MN',
          zip: '55101',
        },
        purpose: 'Printing',
        amount: '54.99',
        currency: 'USD',
        direction: 'independent_for',
        transaction_type: 'Schedule E',
        memo: null,
        nonadditive: false,
        effective: true,
        period_start: '2026-10-01',
        period_end: '2026-10-19',
        sources: [{ source_sha256: source, locator: { row: 2 }, quote: '54.99' }],
      },
    ],
  };
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:report');
      static revokeObjectURL = vi.fn();
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, options: RequestInit = {}) => {
      const url = new URL(input);
      requests.push(url);
      fetchOptions.push(options);
      if (url.pathname.includes('/sources/'))
        return new Response('exact source 1200.99', {
          headers: { 'Content-Type': 'text/plain' },
        });
      return json(data);
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it('shows own source measures with exact dates and whole dollars, without relabelling as Board cash', async () => {
  await render();
  expect(container.textContent).toContain('Disbursements this period');
  expect(container.textContent).toContain('$1,200');
  expect(container.textContent).not.toContain('$1,201');
  expect(container.textContent).not.toContain('Public subsidy');
  expect(container.textContent).toContain('Jul 1 to Sep 30, 2026');
  expect(container.textContent).toContain('Received Oct 15, 2026');
  expect(onStatus.mock.calls.at(-1)?.[1]).toMatchObject({
    state: 'ready',
    generation,
    selectedReports: [reportKey],
  });
});
it('keeps prior campaign figures through source capacity failures and recovers on retry', async () => {
  await render();
  const fetcher = vi.mocked(fetch);
  fetcher.mockImplementation(
    async () => new Response('', { status: 503, headers: { 'Retry-After': '0.001' } }),
  );
  await render({ revision: 1 });
  await vi.waitFor(() => expect(container.textContent).toContain('Records are busy'));
  expect(container.textContent).toContain('$1,200');
  expect(container.textContent).toContain('Showing previous records');
  expect(container.textContent).not.toContain('No campaign reports');
  fetcher.mockImplementation(async () => json(data));
  await click(buttons('Try again')[0]);
  expect(container.textContent).not.toContain('Records are busy');
  expect(container.textContent).not.toContain('Showing previous records');
  expect(container.textContent).toContain('$1,200');
});
it('opens the figure’s own retained source using its generation and Finance authorization', async () => {
  const selectedSource = `external:${encodeURIComponent(candidate.candidate_id)}:figure:${reportKey}.0:0`;
  await render({ source: selectedSource });
  const index = requests.findIndex((url) => url.pathname.endsWith('/sources/' + figureSource));
  expect(index).toBeGreaterThanOrEqual(0);
  expect(requests[index].searchParams.get('generation_id')).toBe(generation);
  expect(fetchOptions[index].headers).toEqual({
    Authorization: 'Bearer token',
  });
  expect(container.textContent).toContain('1200.99');
});
it('keeps a source from another election snapshot out of the displayed race', async () => {
  data.snapshot_id = H('0');
  await render();
  expect(container.textContent).toContain('These records changed');
  expect(container.textContent).not.toContain('$1,200');
  expect(onStatus.mock.calls.at(-1)?.[1].state).toBe('changed');
});
it('does not pick between two effective report series with the same cutoff', async () => {
  data.reports.push({
    ...data.reports[0],
    report_key: H('2'),
    report_type: 'Other series',
  });
  await render();
  expect(container.textContent).toContain('The latest report is not resolved');
  expect(container.textContent).not.toContain('$1,200');
  expect(onStatus.mock.calls.at(-1)?.[1].selectedReports).toEqual([]);
});
it('keeps an earlier amendment accessible without selecting or adding its figures', async () => {
  data.reports.push({
    ...data.reports[0],
    report_key: H('2'),
    effective: false,
  });
  await render();
  await click(buttons('Available filings')[0]);
  expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(1);
  expect(container.textContent).toContain('Earlier version');
});
it('retains memo and negative payments with their positions and no aggregate total', async () => {
  data.payments[0] = {
    ...data.payments[0],
    amount: '-54.99',
    nonadditive: true,
  };
  await render();
  await click(buttons('Spending and support')[0]);
  expect(container.textContent).toContain('Independent spending for');
  expect(container.textContent).toContain('−$54');
  expect(container.textContent).toContain('Supplemental memo, not added to spending');
  expect(container.textContent).toContain('Example vendor');
  expect(container.textContent).toContain('123 Main St');
});
it('opens a payment source with the filed payee name and address', async () => {
  await render({
    source: `external:${encodeURIComponent(candidate.candidate_id)}:payment:${data.payments[0].payment_key}:0`,
  });
  const panel = container.querySelector('[role="dialog"]');
  expect(panel?.textContent).toContain('Example vendor');
  expect(panel?.textContent).toContain('123 Main St');
});
it('shows unknown amounts separately from source zero', async () => {
  data.reports[0].figures![0].value = null;
  data.payments[0].amount = '0';
  await render();
  await click(buttons('Spending and support')[0]);
  expect(container.textContent).toContain('Unavailable');
  expect(container.textContent).toContain('$0');
});
it('does not call an unavailable external collection zero spending', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
  await render();
  expect(container.textContent).toContain('Campaign reports unavailable');
  expect(container.textContent).not.toContain('$0');
});
it('race CSV keeps selected filings, all-page precinct scope and each independent version', () => {
  const path = raceCsvPath(
    {
      ...detail,
      race: { ...detail.race, outcome_review: { version: H('9') } },
    },
    {
      version: '1234567890abcdef',
      query: 'Aitkin',
      reports: [reportKey, H('2')],
      externalGeneration: generation,
      externalVersions: [[candidate.candidate_id, H('e')]],
    },
  );
  const url = new URL(path, 'https://example.test');
  expect(url.searchParams.getAll('report_key')).toEqual([reportKey, H('2')]);
  expect(url.searchParams.get('q')).toBe('Aitkin');
  expect(url.searchParams.has('offset')).toBe(false);
  expect(url.searchParams.get('outcome_version')).toBe(H('9'));
  expect(url.searchParams.get('external_version')).toBe(`${candidate.candidate_id}:${H('e')}`);
});
it('shows external campaign figures even when the Board read fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      requests.push(url);
      if (url.pathname.endsWith('/elections')) return json({ elections: [detail] });
      if (url.pathname.includes('/external-finance/'))
        return json({
          ...data,
          candidate_id: decodeURIComponent(url.pathname.split('/').at(-1)!),
        });
      if (url.pathname.endsWith('/precincts')) return json(fixture.precincts);
      if (url.pathname.endsWith('/finance')) return new Response('{}', { status: 500 });
      if (url.pathname.endsWith('/races'))
        return json({
          ...detail,
          races: [detail.race],
          page: { total: 1, limit: 50, offset: 0, has_more: false },
        });
      return json(detail);
    }),
  );
  window.history.replaceState(
    null,
    '',
    `/money/races?election=${detail.election_key}&race=${detail.race.id}`,
  );
  await act(async () => root.render(<ElectionComparison />));
  await settle();
  expect(container.textContent).toContain('Couldn’t load campaign money');
  expect(container.textContent).toContain('Disbursements this period');
  expect(container.textContent).toContain('$1,200');
  expect(buttons('Download CSV')[0]?.disabled).toBe(false);
});
