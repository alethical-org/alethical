// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const state = vi.hoisted(() => ({
  money: {} as unknown,
  pending: false,
  expired: false,
  by: false,
}));
vi.mock(
  '../../../components/campaignMoney/MoneyDetailsOnDemand',
  () => import('../../../components/campaignMoney/MoneyDetailsBundle'),
);

vi.mock('../../../hooks/useAppQueries', () => ({
  useCommitteeMoney: () => ({
    data: state.money,
    isPending: state.pending,
    isError: false,
    refetch: vi.fn(),
  }),
  useOutsideSpending: vi.fn(() => ({
    data: {
      pages: [
        { state: state.by ? 'reported' : 'not_reported', rows: [], totalRows: state.by ? 1 : null },
      ],
    },
    isPending: false,
    isError: false,
  })),
  useCommitteeFilingsList: () => ({
    data: { pages: [{ state: 'not_reported', filings: [] }] },
    isPending: false,
    isError: false,
  }),
  usePrefetchCommitteeMoney: () => () => {},
  usePrefetchLegislator: () => () => {},
}));
vi.mock('../../../hooks/useCurrentClaimExpiry', () => ({
  useCurrentClaimExpiry: () => state.expired,
}));
vi.mock('../../../navigation/documentTitle', () => ({ useDocumentTitle: () => {} }));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock('../../../data/api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  publicApiRequest: vi.fn(),
}));
vi.mock('../../../components/campaignMoney/TrackCommitteeButton', () => ({
  TrackCommitteeButton: () => null,
}));
vi.mock('../../../components/billDetail/SharePopover', () => ({ SharePopover: () => null }));
vi.mock('../../../theme/primitives', () => ({
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PageBackground: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TopNav: () => null,
  Footer: () => null,
}));
vi.mock('react-native-svg', () => ({
  default: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  Path: () => <path />,
  Circle: () => <circle />,
}));

import { CommitteeMoneyScreen } from '../CommitteeMoneyScreen';
import {
  committeeFinanceFromPayload,
  publicApiRequest,
  type ApiCommitteeMoneyPayload,
} from '../../../data/api';
import { useOutsideSpending } from '../../../hooks/useAppQueries';
import {
  CONFIRMED_MEMBER_WITHHELD_LINE,
  inKindDonationsNote,
  MONEY_OUT_ZERO_NOTE,
} from '../../../lib/committeeMoney';
import { splitExplanation } from '../../../lib/legislatorCampaignMoney';
import type { RootScreenProps } from '../../../navigation/types';
// Public API envelopes copied 12 September 2026. These are complete pages, with
// their source, release, download date and original row counts retained.
import candidateFinance from './fixtures/committee-money/19193-finance-2025.json';
import candidateReceived from './fixtures/committee-money/19193-received-2025.json';
import candidateMade from './fixtures/committee-money/19193-made-2025.json';
import candidateGroups from './fixtures/committee-money/19193-grouped-2025.json';
import partyFinance from './fixtures/committee-money/20003-finance-2025.json';
import partyReceived from './fixtures/committee-money/20003-received-2025.json';
import partyMade from './fixtures/committee-money/20003-made-2025.json';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
let payload: ApiCommitteeMoneyPayload;
let params: { slug: string; year: string; tab?: string };
const request = vi.mocked(publicApiRequest);
const rows = {
  '19193': { received: candidateReceived, made: candidateMade },
  '20003': { received: partyReceived, made: partyMade },
};
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <CommitteeMoneyScreen
          {...({
            route: { params },
            navigation: { navigate: vi.fn(), push: vi.fn(), setParams: vi.fn() },
          } as unknown as RootScreenProps<'CommitteeMoney'>)}
        />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
function shape() {
  state.money = committeeFinanceFromPayload(payload, { servedAgeMs: 0 });
}
function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  act(() => element!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
function button(label: string) {
  return [...host.querySelectorAll('[role="button"],button')].find(
    (node) => node.textContent === label,
  );
}
function tab(label: string) {
  return [...host.querySelectorAll('[role="tab"]')].find((node) =>
    node.textContent?.startsWith(label),
  );
}
beforeEach(() => {
  payload = structuredClone(candidateFinance.data) as ApiCommitteeMoneyPayload;
  params = { slug: 'gottfried-david-house-committee-19193', year: '2025' };
  state.pending = false;
  state.expired = false;
  state.by = false;
  shape();
  request.mockReset();
  request.mockImplementation(async (path) => {
    const url = new URL(path, 'https://example.test');
    if (url.pathname.endsWith('/outside-spending'))
      return structuredClone(candidateGroups) as never;
    const registration = url.pathname.split('/')[2] as keyof typeof rows;
    const direction = url.searchParams.get('direction') as 'received' | 'made';
    const offset = Number(url.searchParams.get('offset'));
    const page = rows[registration]?.[direction].find((value) => value.data.page.offset === offset);
    if (!page) throw new Error(`Unexpected payment scope ${path}`);
    return structuredClone(page) as never;
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  client.clear();
});

describe('one committee shares the donation browser', () => {
  it('reads only the candidate year, prints its real rows and groups ABOUT spending once', async () => {
    await render();
    expect(host.textContent).toContain('Who gave, by kind of donor (named donations only)');
    expect(
      [...host.querySelectorAll('[role=heading]')]
        .find((node) => node.textContent?.startsWith('Who gave, by kind of donor'))
        ?.getAttribute('aria-level'),
    ).toBe('2');
    expect(host.textContent).toContain('Named total in this tab:');
    expect(host.textContent).toContain('$173,279');
    expect(host.textContent).toContain('DFL House Caucus');
    expect(host.textContent).not.toContain("this legislator's campaign");
    expect(host.textContent).not.toContain('Covers the one committee somebody has confirmed');
    expect(request.mock.calls.map(([path]) => path)).toHaveLength(3);
    expect(request.mock.calls.every(([path]) => path.includes('year=2025'))).toBe(true);
    expect(request.mock.calls.filter(([path]) => path.includes('group_by=spender'))).toHaveLength(
      1,
    );
    expect(request.mock.calls.some(([path]) => path.includes('about=19193'))).toBe(true);
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(5);
    expect(host.textContent).not.toContain('FILING YEAR');
    const source = [...host.querySelectorAll('a')].find((node) =>
      node.textContent?.includes('Minnesota Campaign Finance Board filings'),
    );
    expect(source?.getAttribute('href')).toBe(
      candidateFinance.data.independent_spending.source_url,
    );
    const fullLinks = [...host.querySelectorAll('a')].filter((node) =>
      ['Who gave', 'Where it went'].some((label) => node.textContent?.startsWith(label)),
    );
    expect(fullLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/money/committees/gottfried-david-house-committee-19193/payments?tab=gave&year=2025',
      '/money/committees/gottfried-david-house-committee-19193/payments?tab=spent&year=2025',
    ]);
    click(tab('Expenditures'));
    expect(host.textContent).toContain('Total of listed payments in this tab: $104,004');
    expect(host.textContent?.match(/Total of listed payments in this tab:/g)).toHaveLength(1);
  });

  it('shows an unconfirmed party unit with its unnamed slice, all payments, and authoritative outside zero', async () => {
    payload = structuredClone(partyFinance.data) as ApiCommitteeMoneyPayload;
    params.slug = 'mn-dfl-state-central-committee-20003';
    state.by = true;
    shape();
    await render();
    expect(payload.confirmed_for).toBeNull();
    expect(host.textContent).toContain('Non-itemized contributions');
    expect(host.textContent).toContain('$5,996');
    expect(host.textContent).toContain(
      'No outside group reported spending anything to support or oppose this committee in 2025.',
    );
    expect(host.textContent).toContain('Spent by them');
    expect(request.mock.calls).toHaveLength(9);
    expect(request.mock.calls.every(([path]) => path.includes('/20003/payments'))).toBe(true);
    click(tab('Expenditures'));
    expect(host.textContent).toContain('Total of listed payments in this tab: $5,150,294');
    expect(vi.mocked(useOutsideSpending)).toHaveBeenCalledWith({ spender: '20003' }, 'newest');
  });

  it('keeps committee figures and rows after the member ownership claim expires', async () => {
    state.expired = true;
    await render();
    expect(host.textContent).toContain(CONFIRMED_MEMBER_WITHHELD_LINE);
    expect(host.textContent).toContain('$59,950');
    expect(host.textContent).toContain('DFL House Caucus');
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(
      'Individuals',
    );
  });

  it('preserves donor tab and sort through an uncached year load while resetting search and expanded rows', async () => {
    await render();
    click(tab('Expenditures'));
    click(host.querySelector('[aria-label^="Sort names, currently"]'));
    click(host.querySelector('[aria-label="Name A to Z"]'));
    const search = host.querySelector('input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        search,
        'Square',
      );
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    params = { ...params, year: '2026' };
    state.money = undefined;
    state.pending = true;
    await render();
    expect(host.textContent).toContain('Loading figures');
    payload = { ...payload, year: 2026 };
    shape();
    state.pending = false;
    request.mockImplementation(async (path) => {
      if (path.includes('outside-spending')) throw new Error('not held');
      return {
        data: {
          registration_number: '19193',
          year: 2026,
          state: 'not_reported',
          payments: [],
          release_id: payload.release_id,
        },
      } as never;
    });
    await render();
    expect(tab('Expenditures')?.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('input')?.value).toBe('');
    expect(
      host.querySelector('[aria-label^="Sort names, currently"]')?.getAttribute('aria-label'),
    ).toContain('Name A to Z');
    expect(host.querySelectorAll('[aria-expanded="true"]')).toHaveLength(0);
    expect(host.textContent).toContain(
      'The state’s file names no payees for this committee in 2026.',
    );
  });

  it.each(['filings', 'by'])(
    'keeps withheld and donated-goods explanations on %s without a chart',
    async (addressed) => {
      payload = {
        ...payload,
        split: { ...payload.split, state: 'sources_disagree', named_in_kind_total: '25' },
      };
      params.tab = addressed;
      state.by = true;
      shape();
      await render();
      expect(host.textContent).toContain(splitExplanation('sources_disagree'));
      expect(host.textContent).toContain(inKindDonationsNote('$25', true));
      expect(host.textContent).not.toContain('Who gave, by kind of donor');
      expect(request).not.toHaveBeenCalled();
    },
  );

  it('honors legacy spent and gave links, and displays official zero independently of its row comparison', async () => {
    payload = {
      ...payload,
      money_out: {
        ...payload.money_out!,
        reported_total: '0',
        stated_spending_state: 'reader_unproven',
      },
    };
    params.tab = 'spent';
    shape();
    await render();
    expect(tab('Expenditures')?.getAttribute('aria-selected')).toBe('true');
    expect(host.textContent).toContain(MONEY_OUT_ZERO_NOTE);
    params = { ...params, tab: 'gave' };
    await render();
    expect(tab('Individuals')?.getAttribute('aria-selected')).toBe('true');
  });

  it.each([undefined, -1, 0.5])(
    'never calls an absent or malformed outside count (%s) measured zero',
    async (count) => {
      payload = structuredClone(partyFinance.data) as ApiCommitteeMoneyPayload;
      payload.independent_spending!.supporting_payments = count;
      params.slug = 'mn-dfl-state-central-committee-20003';
      shape();
      await render();
      expect(host.textContent).not.toContain('No outside group reported spending anything');
      expect(host.textContent).toContain('We cannot show a figure right now');
    },
  );
});
