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
  byRows: [] as CommitteeOutsideSpendingRow[],
}));
const navigate = vi.hoisted(() => vi.fn());
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
        {
          state: state.by ? 'reported' : 'not_reported',
          rows: state.byRows,
          totalRows: state.by ? Math.max(1, state.byRows.length) : null,
          committeeCount: state.byRows.length ? 1 : null,
          spenderCount: null,
        },
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
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate }) }));
vi.mock('../../../data/api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  publicApiRequest: vi.fn(),
}));
vi.mock('../../../components/campaignMoney/TrackCommitteeButton', () => ({
  TrackCommitteeButton: ({ beside }: { beside: ReactNode }) => beside,
}));
vi.mock('../../../components/billDetail/SharePopover', () => ({
  SharePopover: ({ content }: { content: { url: string } }) => (
    <a data-testid="share-url" href={content.url}>
      Share
    </a>
  ),
}));
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
import type { RootScreenProps, RootStackParamList } from '../../../navigation/types';
import type { CommitteeOutsideSpendingRow } from '../../../data/types';
import {
  consumeWebHistoryReplaceMark,
  initializeWebHistory,
  replaceWebHistoryPath,
  pushWebHistory,
  readCurrentScrollPosition,
} from '../../../navigation/webHistory';
import { pathForRoute, stateFromPathname } from '../../../navigation/webRoutes';
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
let params: RootStackParamList['CommitteeMoney'];
const setParams = vi.fn((next: Partial<typeof params>) => {
  params = { ...params, ...next };
  root.render(screen());
  // RootNavigator writes address changes after rendering the route. Its replace
  // marker must retain this visit's history identity and saved scroll position.
  const path = pathForRoute({ name: 'CommitteeMoney', params });
  if (path !== window.location.pathname + window.location.search) {
    if (consumeWebHistoryReplaceMark()) replaceWebHistoryPath(path);
    else pushWebHistory(path);
  }
});
const navigation = { navigate, push: vi.fn(), setParams };
function screen() {
  return (
    <QueryClientProvider client={client}>
      <CommitteeMoneyScreen
        {...({ route: { params }, navigation } as unknown as RootScreenProps<'CommitteeMoney'>)}
      />
    </QueryClientProvider>
  );
}
function paramsFromAddress(path: string) {
  return stateFromPathname(path).routes.at(-1)!.params as typeof params;
}
const request = vi.mocked(publicApiRequest);
const rows = {
  '19193': { received: candidateReceived, made: candidateMade },
  '20003': { received: partyReceived, made: partyMade },
};
async function render() {
  await act(async () => root.render(screen()));
  // The first dynamic payment-reader import can outlast a fixed sleep on CI.
  // Wait for the actual read and its rendered result, including every page.
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(client.isFetching()).toBe(0);
    expect(host.textContent).not.toContain('Loading the complete payment list…');
  });
}
function shape() {
  state.money = committeeFinanceFromPayload(payload, { servedAgeMs: 0 });
}
function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  act(() => element!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
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
  state.byRows = [];
  navigate.mockClear();
  setParams.mockClear();
  consumeWebHistoryReplaceMark();
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
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('one committee shares the donation browser', () => {
  it('restores the prior committee’s donor kind, sort and position on Back', async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const flushFrames = () =>
      act(() => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((frame) => frame(0));
      });
    window.history.replaceState({}, '', `/money/committees/${params.slug}?year=2025`);
    initializeWebHistory();
    await render();
    flushFrames();
    const initialEntry = window.history.state;
    const sourceScroll = host.querySelector<HTMLElement>('[data-testid="committee-money-scroll"]')!;
    act(() => {
      sourceScroll.scrollTop = 640;
      sourceScroll.dispatchEvent(new Event('scroll'));
    });
    await vi.waitFor(() => expect(readCurrentScrollPosition()).toBe(640));
    // No scroll event follows the control choices. Replacing the address must
    // preserve the entry that already holds 640, rather than create an empty one.
    click(tab('Committees & Funds'));
    click(host.querySelector('[aria-label^="Sort names, currently"]'));
    click(host.querySelector('[aria-label="Smallest first"]'));
    expect(window.history.state).toEqual(initialEntry);
    expect(readCurrentScrollPosition()).toBe(640);
    const sourcePath = window.location.pathname + window.location.search;
    expect(sourcePath).toContain('category=committees&sort=smallest');
    const sourceEntry = window.history.state;

    const spenderLink = [...host.querySelectorAll('a')].find(
      (node) => node.textContent === 'MN DFL State Central Committee',
    );
    expect(spenderLink?.getAttribute('href')).toBe(
      '/money/committees/mn-dfl-state-central-committee-20003?year=2025',
    );
    click(spenderLink);
    expect(navigate).toHaveBeenLastCalledWith('CommitteeMoney', {
      slug: 'mn-dfl-state-central-committee-20003',
      year: '2025',
    });
    payload = structuredClone(partyFinance.data) as ApiCommitteeMoneyPayload;
    params = navigate.mock.lastCall![1];
    shape();
    await render();
    // RootNavigator writes the destination history entry after the new screen
    // renders. Restoration must wait for that entry, not read the source's 640.
    pushWebHistory(`/money/committees/${params.slug}?year=2025`);
    flushFrames();
    const targetScroll = host.querySelector<HTMLElement>('[data-testid="committee-money-scroll"]')!;
    expect(targetScroll.scrollTop).toBe(0);
    expect(host.textContent).toContain('MN DFL State Central Committee');
    expect(button('2025')?.getAttribute('aria-pressed')).toBe('true');

    // A list control stays on this committee and must not jump to its title.
    act(() => {
      targetScroll.scrollTop = 420;
    });
    click(tab('Expenditures'));
    click(host.querySelector('[aria-label^="Sort names, currently"]'));
    click(host.querySelector('[aria-label="Name A to Z"]'));
    flushFrames();
    expect(targetScroll.scrollTop).toBe(420);
    expect(tab('Expenditures')?.getAttribute('aria-selected')).toBe('true');

    window.history.replaceState(sourceEntry, '', sourcePath);
    payload = structuredClone(candidateFinance.data) as ApiCommitteeMoneyPayload;
    params = paramsFromAddress(sourcePath);
    shape();
    await render();
    flushFrames();
    expect(
      host.querySelector<HTMLElement>('[data-testid="committee-money-scroll"]')?.scrollTop,
    ).toBe(640);
    expect(tab('Committees & Funds')?.getAttribute('aria-selected')).toBe('true');
    expect(
      host.querySelector('[aria-label^="Sort names, currently"]')?.getAttribute('aria-label'),
    ).toContain('Smallest first');
  });

  it('opens a shared donor view on reload and starts an unrelated committee with defaults', async () => {
    const shared = `/money/committees/${params.slug}?year=2025&category=committees&sort=smallest`;
    window.history.replaceState({}, '', shared);
    initializeWebHistory();
    params = paramsFromAddress(shared);
    await render();
    expect(tab('Committees & Funds')?.getAttribute('aria-selected')).toBe('true');
    expect(
      host.querySelector('[aria-label^="Sort names, currently"]')?.getAttribute('aria-label'),
    ).toContain('Smallest first');
    const share = new URL(host.querySelector('[data-testid="share-url"]')!.getAttribute('href')!);
    expect(share.searchParams.get('category')).toBe('committees');
    expect(share.searchParams.get('sort')).toBe('smallest');
    expect(share.searchParams.get('year')).toBe('2025');
    act(() => root.unmount());
    root = createRoot(host);
    params = paramsFromAddress(shared);
    await render();
    expect(tab('Committees & Funds')?.getAttribute('aria-selected')).toBe('true');
    expect(
      host.querySelector('[aria-label^="Sort names, currently"]')?.getAttribute('aria-label'),
    ).toContain('Smallest first');

    payload = structuredClone(partyFinance.data) as ApiCommitteeMoneyPayload;
    params = { slug: 'mn-dfl-state-central-committee-20003', year: '2025' };
    shape();
    await render();
    expect(tab('Individuals')?.getAttribute('aria-selected')).toBe('true');
    expect(
      host.querySelector('[aria-label^="Sort names, currently"]')?.getAttribute('aria-label'),
    ).toContain('Largest first');
  });

  it('keeps explicit donor choices when an old committee name is corrected in the address and Share', async () => {
    params = { slug: 'old-name-19193', year: '2025', category: 'committees', sort: 'smallest' };
    window.history.replaceState({}, '', pathForRoute({ name: 'CommitteeMoney', params }));
    initializeWebHistory();
    const entry = window.history.state;
    await render();
    expect(window.history.state).toEqual(entry);
    expect(params).toMatchObject({
      slug: 'gottfried-david-house-committee-19193',
      category: 'committees',
      sort: 'smallest',
    });
    expect(window.location.pathname).toBe(
      '/money/committees/gottfried-david-house-committee-19193',
    );
    expect(window.location.search).toContain('category=committees&sort=smallest');
    expect(host.querySelector('[data-testid="share-url"]')?.getAttribute('href')).toContain(
      '/gottfried-david-house-committee-19193?',
    );
    expect(tab('Committees & Funds')?.getAttribute('aria-selected')).toBe('true');
  });

  it('keeps legacy Expenditures through section and year controls, while explicit choices override the legacy address', async () => {
    params.tab = 'spent';
    await render();
    expect(tab('Expenditures')?.getAttribute('aria-selected')).toBe('true');
    click(button('Filings'));
    expect(params).toMatchObject({ tab: 'filings', category: 'expenditures' });
    click(button('Campaign money'));
    expect(tab('Expenditures')?.getAttribute('aria-selected')).toBe('true');
    click(button('2026'));
    expect(params).toMatchObject({ year: '2026', category: 'expenditures' });

    params = { ...params, year: '2025', tab: 'spent', category: 'committees', sort: 'smallest' };
    await render();
    expect(tab('Committees & Funds')?.getAttribute('aria-selected')).toBe('true');
    click(tab('Individuals'));
    expect(params.tab).toBe('gave');
    expect(params.category).toBeUndefined();
    expect(params.sort).toBe('smallest');
    click(host.querySelector('[aria-label^="Sort names, currently"]'));
    click(host.querySelector('[aria-label="Largest first"]'));
    expect(window.location.search).not.toMatch(/category=|sort=/);
  });

  it('does not leave a replace mark when the chosen category is selected again', async () => {
    window.history.replaceState({}, '', pathForRoute({ name: 'CommitteeMoney', params }));
    initializeWebHistory();
    await render();
    click(tab('Individuals'));
    expect(setParams).not.toHaveBeenCalled();
    expect(consumeWebHistoryReplaceMark()).toBe(false);
    const entry = window.history.state;
    click(button('2026'));
    expect(window.history.state).not.toEqual(entry);
  });

  it('labels Spent by them as all years and keeps payments outside the cards’ selected year', async () => {
    params.tab = 'by';
    state.by = true;
    state.byRows = [2026, 2024].map((year) => ({
      spender: 'Example spender',
      spenderRegistrationNumber: '20003',
      spenderInRegister: true,
      spenderLinkable: true,
      aboutCommitteeName: 'Example candidate',
      aboutCommitteeRegistrationNumber: '19193',
      aboutCommitteeInRegister: true,
      aboutCommitteeLinkable: false,
      direction: 'For',
      directionAsFiled: 'For',
      purpose: 'Printing',
      vendorName: 'Example printer',
      expenditureType: 'Advertising',
      inKind: false,
      paidOn: `${year}-01-12`,
      year,
      amount: '25',
      unpaidAmount: null,
      recordNumber: year,
    }));
    await render();
    expect(host.textContent).toContain(
      'This list shows payments from all years in the state’s file.',
    );
    expect(host.textContent).toContain('PAID JAN 12, 2026');
    expect(host.textContent).toContain('PAID JAN 12, 2024');
    expect(vi.mocked(useOutsideSpending).mock.lastCall).toEqual([{ spender: '19193' }, 'newest']);
    params = { ...params, tab: 'gave' };
    await render();
    expect(host.textContent).not.toContain(
      'This list shows payments from all years in the state’s file.',
    );
  });

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
