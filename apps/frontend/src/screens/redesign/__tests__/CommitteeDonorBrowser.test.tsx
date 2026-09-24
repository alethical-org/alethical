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
  mobile: false,
  money: {} as unknown,
  confirmation: undefined as CommitteeConfirmation | undefined,
  confirmationPending: false,
  pending: false,
  expired: false,
  by: false,
  byRows: [] as CommitteeOutsideSpendingRow[],
  filings: null as unknown,
  filingsQuery: {} as Record<string, unknown>,
}));
const filingsRefetch = vi.hoisted(() => vi.fn());
const filingsFetchNextPage = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({
    width: state.mobile ? 375 : 1024,
    isMobile: state.mobile,
    isTablet: !state.mobile,
    isDesktop: false,
  }),
}));
vi.mock(
  '../../../components/campaignMoney/MoneyDetailsOnDemand',
  () => import('../../../components/campaignMoney/MoneyDetailsBundle'),
);

vi.mock('../../../hooks/useAppQueries', () => ({
  useCommitteeConfirmation: () => ({
    data: state.confirmation,
    isPending: state.confirmationPending,
    refetch: vi.fn(),
  }),
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
    data: { pages: [state.filings ?? { state: 'not_reported', filings: [] }] },
    isPending: false,
    isError: false,
    isFetching: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    hasNextPage: false,
    refetch: filingsRefetch,
    fetchNextPage: filingsFetchNextPage,
    ...state.filingsQuery,
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

import { CommitteeMoneyScreen, FilingsList } from '../CommitteeMoneyScreen';
import {
  committeeFinanceFromPayload,
  publicApiRequest,
  type ApiCommitteeMoneyPayload,
} from '../../../data/api';
import {
  committeeConfirmationFromPayload,
  CONFIRMATION_LOADING_LINE,
  CONFIRMATION_UNAVAILABLE_LINE,
} from '../../../lib/committeeConfirmation';
import { useOutsideSpending } from '../../../hooks/useAppQueries';
import { CONFIRMED_MEMBER_WITHHELD_LINE } from '../../../lib/committeeMoney';
import { downloadsPageUrl, MONEY_OUT_ZERO_NOTE } from '../../../lib/committeeMoneyShared';
import { inKindDonationsNote } from '../../../lib/contributionFigures';
import { splitExplanation } from '../../../lib/legislatorCampaignMoney';
import type { RootScreenProps, RootStackParamList } from '../../../navigation/types';
import type { CommitteeConfirmation, CommitteeOutsideSpendingRow } from '../../../data/types';
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
  state.money = committeeFinanceFromPayload(payload);
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
  state.mobile = false;
  payload = structuredClone(candidateFinance.data) as ApiCommitteeMoneyPayload;
  params = { slug: 'gottfried-david-house-committee-19193', year: '2025' };
  state.pending = false;
  state.expired = false;
  state.confirmationPending = false;
  state.confirmation = committeeConfirmationFromPayload(candidateFinance.data, { servedAgeMs: 0 });
  state.by = false;
  state.byRows = [];
  state.filings = null;
  state.filingsQuery = {};
  filingsRefetch.mockClear();
  filingsFetchNextPage.mockClear();
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
  vi.restoreAllMocks();
});

describe('one committee shares the donation browser', () => {
  function missingReports(year = 2025) {
    payload.year = year;
    params.year = String(year);
    payload.split = {
      ...payload.split,
      reported_total: null,
      named_total: null,
      named_cash_total: null,
      state: 'no_reported_total',
    };
    payload.money_in = { ...payload.money_in, state: 'not_reported', other_receipts: [] };
    payload.money_out = {
      ...payload.money_out,
      state: 'not_reported',
      reported_total: null,
      by_type: [],
    };
    shape();
  }

  function emptyPaymentReads(options: { failed?: boolean; mismatch?: boolean } = {}) {
    request.mockImplementation(async (path) => {
      if (path.includes('outside-spending')) return structuredClone(candidateGroups) as never;
      if (options.failed) throw new Error('payment read failed');
      return {
        data: {
          registration_number: '19193',
          year: payload.year,
          state: 'not_reported',
          payments: [],
          release_id: options.mismatch ? 'another-release' : payload.release_id,
        },
      } as never;
    });
  }

  it.each([2025, 2026])(
    'compacts a complete empty %i year and links to filed reports',
    async (year) => {
      missingReports(year);
      state.confirmation = { ...state.confirmation!, confirmedFor: null };
      emptyPaymentReads();
      await render();
      expect(host.textContent).toContain(
        `No ${year} report figures in our copy of the state’s files`,
      );
      expect(
        host.textContent?.match(/Figures from another year are not substituted/g),
      ).toHaveLength(1);
      expect(host.textContent).toContain(
        'No itemized receipts or expenditures in our copy for this year',
      );
      expect(host.textContent).not.toContain('Who gave');
      expect(
        [...host.querySelectorAll('[role="heading"]')].map((node) => node.textContent),
      ).not.toContain('Money in');
      expect(host.textContent).not.toContain('More on this year’s contributions');
      expect(host.textContent).not.toContain('These are this committee’s own figures');
      expect(host.textContent).not.toContain('linked them to a person');
      expect(host.querySelector('a[href*="/legislators/"]')).toBeNull();
      expect(host.querySelector('input')).toBeNull();
      expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
      expect(host.textContent).toContain('Spending by outside groups');
      const reports = [...host.querySelectorAll('a')].find(
        (node) => node.textContent === 'View filed reports',
      );
      expect(reports?.getAttribute('href')).toContain(`tab=filings&year=${year}`);
      click(reports);
      expect(params.tab).toBe('filings');
      await render();
      expect(host.textContent).toContain('Reports this committee has filed');
    },
  );

  it('keeps itemized records when the official report is absent', async () => {
    missingReports();
    await render();
    expect(host.textContent).toContain('DFL House Caucus');
    expect(host.textContent).toContain('Who gave (itemized contributions only)');
    expect(host.textContent).toContain('Report total unavailable');
    expect(host.textContent).not.toContain(
      'No itemized receipts or expenditures in our copy for this year',
    );
  });

  it('does not call a committee with an itemized loan empty', async () => {
    missingReports();
    request.mockImplementation(async (path) => {
      if (path.includes('outside-spending')) return structuredClone(candidateGroups) as never;
      const received = path.includes('direction=received');
      return {
        data: {
          registration_number: '19193',
          year: 2025,
          state: received ? 'reported' : 'not_reported',
          payments: received
            ? [{ ...candidateReceived[0].data.payments[0], receipt_type: 'Loan' }]
            : [],
          page: { offset: 0, limit: 250, has_more: false, total_payments: received ? 1 : 0 },
          release_id: payload.release_id,
        },
      } as never;
    });
    await render();
    expect(host.textContent).not.toContain(
      'No itemized receipts or expenditures in our copy for this year',
    );
    expect(host.textContent).toContain(
      'No itemized contributions or expenditures in our copy for this year',
    );
    expect(host.textContent).toContain('View receipts and expenditures');
  });

  it.each([{ failed: true }, { mismatch: true }])(
    'never calls an unsuccessful payment read empty: %j',
    async (options) => {
      missingReports();
      emptyPaymentReads(options);
      await render();
      expect(host.textContent).not.toContain(
        'No itemized receipts or expenditures in our copy for this year',
      );
      expect(host.textContent).toContain('We could not load the complete payment list');
      expect(button('Try again')).toBeTruthy();
    },
  );

  it('preserves an official zero when itemized lists are empty', async () => {
    missingReports();
    payload.split = { ...payload.split, state: 'shown', reported_total: '0.0000' };
    payload.money_out = { ...payload.money_out!, reported_total: '0.0000' };
    shape();
    emptyPaymentReads();
    await render();
    expect(host.textContent).toContain('Money in');
    expect(host.textContent).toContain('Money out');
    expect(host.textContent).toContain('$0');
    expect(host.textContent).toContain(MONEY_OUT_ZERO_NOTE);
  });

  it('lets phone money boxes grow around every income row and keeps their source outside', async () => {
    state.mobile = true;
    payload = structuredClone(partyFinance.data) as ApiCommitteeMoneyPayload;
    params = { slug: 'mn-dfl-state-central-committee-20003', year: '2025' };
    state.confirmation = committeeConfirmationFromPayload(partyFinance.data, { servedAgeMs: 0 });
    shape();
    await render();
    const headings = [...host.querySelectorAll('[role="heading"]')];
    const moneyIn = headings.find((node) => node.textContent === 'Money in')!.parentElement!
      .parentElement!;
    const moneyOut = headings.find((node) => node.textContent === 'Money out')!.parentElement!
      .parentElement!;
    for (const box of [moneyIn, moneyOut]) {
      // A zero flex basis sized these boxes to their padding, leaving rows on top of the next box.
      const style = getComputedStyle(box);
      expect(style.flexBasis).toBe('auto');
      expect(style.flexShrink).toBe('0');
    }
    expect(moneyIn.textContent).toContain('Miscellaneous Income');
    expect(moneyIn.textContent).toContain('$50,801');
    expect(moneyIn.querySelector('a')).toBeNull();
    const sources = [...host.querySelectorAll('a')].filter((node) =>
      node.textContent?.includes('Minnesota’s campaign-finance downloads'),
    );
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((node) => !moneyIn.contains(node) && !moneyOut.contains(node))).toBe(true);
  });

  it('restores the prior committee’s donor kind, sort and position on Back', async () => {
    // jsdom has no layout; this mounted screen's scroller is visible in the browser.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (
      this: HTMLElement,
    ) {
      return (this.dataset.testid === 'committee-money-scroll'
        ? [{}]
        : []) as unknown as DOMRectList;
    });
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
    click(button('Filed reports'));
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

  it('keeps independent spending order in its address and Share without changing donor choices', async () => {
    state.by = true;
    params = { ...params, tab: 'by', category: 'committees', sort: 'smallest' };
    window.history.replaceState({}, '', pathForRoute({ name: 'CommitteeMoney', params }));
    initializeWebHistory();
    await render();
    expect(button('NEWEST FIRST')?.getAttribute('aria-pressed')).toBe('true');
    click(button('LARGEST FIRST'));
    expect(params).toMatchObject({
      tab: 'by',
      spendingSort: 'largest',
      category: 'committees',
      sort: 'smallest',
    });
    expect(new URLSearchParams(window.location.search).get('spendingSort')).toBe('largest');
    const share = host.querySelector<HTMLAnchorElement>('[data-testid="share-url"]')!;
    const sharedAddress = new URL(share.href);
    expect(sharedAddress.searchParams.get('spendingSort')).toBe('largest');
    expect(sharedAddress.searchParams.get('sort')).toBe('smallest');
    expect(sharedAddress.searchParams.get('category')).toBe('committees');
    expect(vi.mocked(useOutsideSpending).mock.lastCall).toEqual([{ spender: '19193' }, 'largest']);

    click(button('Campaign money'));
    await render();
    expect(params).toMatchObject({
      spendingSort: 'largest',
      category: 'committees',
      sort: 'smallest',
    });
    expect(tab('Committees & Funds')?.getAttribute('aria-selected')).toBe('true');
    expect(
      host.querySelector('[aria-label="Sort names, currently Smallest first"]'),
    ).not.toBeNull();

    // A fresh mount receives the saved shared address rather than surviving local state.
    act(() => root.unmount());
    root = createRoot(host);
    params = paramsFromAddress(sharedAddress.pathname + sharedAddress.search);
    await render();
    expect(button('LARGEST FIRST')?.getAttribute('aria-pressed')).toBe('true');
    expect(vi.mocked(useOutsideSpending).mock.lastCall).toEqual([{ spender: '19193' }, 'largest']);
    expect(params).toMatchObject({
      spendingSort: 'largest',
      category: 'committees',
      sort: 'smallest',
    });
  });

  it('labels Independent spending as all years and keeps payments outside the cards’ selected year', async () => {
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
    expect(host.textContent).toContain('Payments from all years in the state’s file');
    expect(host.textContent).toContain('PAID JAN 12, 2026');
    expect(host.textContent).toContain('PAID JAN 12, 2024');
    expect(vi.mocked(useOutsideSpending).mock.lastCall).toEqual([{ spender: '19193' }, 'newest']);
    params = { ...params, tab: 'gave' };
    await render();
    expect(host.textContent).not.toContain('Payments from all years in the state’s file');
  });

  it('reads only the candidate year, prints its real rows and groups ABOUT spending once', async () => {
    await render();
    expect(host.textContent).toContain('Who gave (itemized contributions only)');
    expect(
      [...host.querySelectorAll('[role=heading]')]
        .find((node) => node.textContent?.startsWith('Who gave'))
        ?.getAttribute('aria-level'),
    ).toBe('2');
    expect(host.textContent).toContain('Total itemized contributions');
    expect(host.textContent).toContain('$173,279');
    expect(host.textContent).toContain('DFL House Caucus');
    expect(host.textContent).not.toContain("this legislator's campaign");
    expect(host.textContent).not.toContain('Covers the one committee somebody has confirmed');
    // Payments, outside spending, and the year's notices and statements (#2347).
    expect(request.mock.calls.map(([path]) => path)).toHaveLength(5);
    expect(request.mock.calls.filter(([path]) => path.includes('/notices?'))).toHaveLength(1);
    expect(
      request.mock.calls.filter(([path]) => path.includes('/disclosure-statements?')),
    ).toHaveLength(1);
    expect(request.mock.calls.every(([path]) => path.includes('year=2025'))).toBe(true);
    expect(request.mock.calls.filter(([path]) => path.includes('group_by=spender'))).toHaveLength(
      1,
    );
    expect(request.mock.calls.some(([path]) => path.includes('about=19193'))).toBe(true);
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(5);
    expect(host.textContent).not.toContain('FILING YEAR');
    // The served address is the bulk download itself; the link lands on the page that
    // download sits on, derived from it rather than typed in (#2186).
    const source = [...host.querySelectorAll('a')].find((node) =>
      node.textContent?.includes('Minnesota’s campaign-finance downloads'),
    );
    expect(source?.getAttribute('href')).toBe(
      downloadsPageUrl(candidateFinance.data.independent_spending.source_url),
    );
    expect(host.textContent).toContain(
      'Source file: “Itemized independent expenditures of over $200”',
    );
    const fullLinks = [...host.querySelectorAll('a')].filter((node) =>
      node.textContent?.startsWith('View receipts and expenditures'),
    );
    expect(fullLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/money/committees/gottfried-david-house-committee-19193/payments?tab=gave&year=2025',
    ]);
    click(tab('Expenditures'));
    expect(host.textContent).toContain('Total itemized expenditures$104,004');
    expect(host.textContent?.match(/Total itemized expenditures/g)).toHaveLength(1);
  });

  it('puts contributor locations in their own card above the panel, open from load', async () => {
    // The card draws only where the year's contributions agree with a filed report.
    payload.split = { ...payload.split!, stated_split_state: 'agrees' };
    (payload as unknown as Record<string, unknown>).donor_states = {
      state: 'reported',
      year: 2025,
      rows: [
        { state: 'MN', names: 71, cash_total: '38700.0000' },
        { state: 'WI', names: 2, cash_total: '1200.0000' },
        { state: 'unknown', names: 3, cash_total: '1250.0000' },
      ],
      summary: {
        minnesota: { names: 71, cash_total: '38700.0000' },
        other_states: { names: 2, cash_total: '1200.0000' },
        unknown: { names: 3, cash_total: '1250.0000' },
      },
      reference: {
        source_url: 'https://www.huduser.gov/portal/datasets/usps_crosswalk.html',
        as_of: '2026-06-30',
        copied_at: '2026-09-13T12:19:46.695703+00:00',
        content_hash: 'f'.repeat(64),
      },
    };
    shape();
    await render();
    const heading = 'Where itemized individual contributions came from';
    const card = [...host.querySelectorAll<HTMLElement>('[role="region"]')].find(
      (region) => region.querySelector('h2')?.textContent === heading,
    )!;
    expect(card).toBeTruthy();
    // Outside the panel, not a row inside it, and nothing to click to reach the figures.
    const panelHeading = [...host.querySelectorAll('h2')].find(
      (node) => node.textContent === 'More on this year\u2019s contributions',
    )!;
    expect(card.contains(panelHeading)).toBe(false);
    expect(
      card.compareDocumentPosition(panelHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The only control is the Other states group, and it arrives open, so every figure
    // is already on screen without a press.
    const controls = [...card.querySelectorAll('button')];
    expect(controls).toHaveLength(1);
    expect(controls[0].getAttribute('aria-expanded')).toBe('true');
    expect(controls[0].getAttribute('aria-label')).toBe('Hide the state in Other states');
    expect(card.querySelector('table')).not.toBeNull();
    const figures = [...card.querySelectorAll<HTMLTableRowElement>('tbody tr')].map((row) =>
      [...row.cells].map((cell) => cell.textContent),
    );
    expect(figures).toEqual([
      ['Minnesota', '71', '$38,700', '94.0%'],
      ['Other states', '2', '$1,200', '2.9%'],
      ['Wisconsin', '2', '$1,200', '2.9%'],
      ['Unknown', '3', '$1,250', '3.0%'],
    ]);
    // The panel keeps its 2 rows, in order, each still expandable.
    expect(
      [...host.querySelectorAll('[data-testid*="-donation-card-"]')].map(
        (row) => row.querySelector('h3')?.textContent,
      ),
    ).toEqual([
      'What the committee\u2019s own report says',
      'Contributor names also listed for other candidates',
    ]);
  });

  it('shows an unconfirmed party unit with its unnamed slice, all payments, and authoritative outside zero', async () => {
    payload = structuredClone(partyFinance.data) as ApiCommitteeMoneyPayload;
    params.slug = 'mn-dfl-state-central-committee-20003';
    state.confirmation = committeeConfirmationFromPayload(partyFinance.data, { servedAgeMs: 0 });
    state.by = true;
    shape();
    await render();
    expect(partyFinance.data.confirmed_for).toBeNull();
    expect(host.textContent).toContain('Non-itemized contributions');
    expect(host.textContent).toContain('$5,996');
    expect(host.textContent).toContain(
      'No outside group reported spending to support or oppose this committee in 2025',
    );
    expect(host.textContent).toContain('Independent spending');
    // A party unit reads no notices, and does read its statements (#2347).
    expect(request.mock.calls).toHaveLength(10);
    expect(
      request.mock.calls.every(
        ([path]) =>
          path.includes('/20003/payments') || path.includes('/20003/disclosure-statements?'),
      ),
    ).toBe(true);
    expect(request.mock.calls.some(([path]) => path.includes('/notices?'))).toBe(false);
    click(tab('Expenditures'));
    expect(host.textContent).toContain('Total itemized expenditures$5,150,294');
    expect(vi.mocked(useOutsideSpending)).toHaveBeenCalledWith({ spender: '20003' }, 'newest');
  });

  it.each([true, false])(
    'keeps figures and rows with no ownership answer, pending=%s',
    async (pending) => {
      state.confirmation = undefined;
      state.confirmationPending = pending;
      await render();
      expect(host.textContent).toContain(
        pending ? CONFIRMATION_LOADING_LINE : CONFIRMATION_UNAVAILABLE_LINE,
      );
      expect(host.textContent).not.toContain(CONFIRMED_MEMBER_WITHHELD_LINE);
      expect(host.textContent).not.toContain('Nobody at Alethical');
      expect(host.textContent).toContain('$59,950');
      expect(host.textContent).toContain('DFL House Caucus');
      expect(host.querySelector('a[href*="/legislators/"]')).toBeNull();
    },
  );

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
    expect(params.category).toBe('expenditures');
    expect(params.sort).toBe('name');
    expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('[aria-label^="Sort names, currently"]')).toBeNull();
    expect(host.querySelectorAll('[aria-expanded="true"]')).toHaveLength(0);
    expect(host.textContent).toContain(
      'No itemized contributions or expenditures in our copy for this year',
    );
  });

  it.each(['filings', 'by'])(
    'keeps selected-year figures and explanations out of the all-years %s section',
    async (addressed) => {
      payload = {
        ...payload,
        split: { ...payload.split, state: 'sources_disagree', named_in_kind_total: '25' },
      };
      params.tab = addressed;
      state.by = true;
      shape();
      await render();
      expect(host.textContent).not.toContain(splitExplanation('sources_disagree'));
      expect(host.textContent).not.toContain(inKindDonationsNote('$25'));
      const headings = [...host.querySelectorAll('[role=heading]')].map((node) => node.textContent);
      expect(headings).not.toContain('Money in');
      expect(headings).not.toContain('Money out');
      expect(button('2026')).toBeUndefined();
      expect(host.textContent).not.toContain('Who gave');
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
      expect(host.textContent).not.toContain('No outside group reported spending to support');
      expect(host.textContent).toContain('We cannot show a figure right now');
    },
  );
});

describe('committee refinement preserves the record', () => {
  it('keeps a historical year selected and lets readers return to recent records', async () => {
    params.year = '2017';
    await render();
    const historical = button('2017');
    expect(historical?.getAttribute('aria-pressed')).toBe('true');
    const current = String(new Date().getFullYear());
    click(button(current));
    await render();
    expect(params.year).toBe(current);
    expect(button(current)?.getAttribute('aria-pressed')).toBe('true');
  });

  it.each([false, true])(
    'keeps the confirmation and readable dates together at phone=%s',
    async (mobile) => {
      state.mobile = mobile;
      payload.split = { ...payload.split!, reported_through: '2025-12-31' };
      shape();
      await render();
      const link = host.querySelector('a[href*="/legislators/"]')!;
      expect(link).not.toBeNull();
      const block = link.parentElement!;
      expect(block.textContent).toContain('Checked ');
      expect(block.textContent).not.toContain('Checked by Alethical');
      expect(block.querySelector('[role="list"]')).not.toBeNull();
      expect(block.textContent?.indexOf('Checked ')).toBeLessThan(
        block.textContent!.indexOf('See '),
      );
      expect(parseFloat(getComputedStyle(link).minHeight)).toBeGreaterThanOrEqual(44);
      expect(host.textContent).toContain('the candidate may have others');
      expect(host.textContent).toContain('Campaign finance figures in our copy start in 2015');
      expect(host.textContent).not.toContain('Unions don’t report');
      const period = [...host.querySelectorAll('div')].find((node) =>
        /^Figures (for|through) [^\n]+2025$/.test(node.textContent ?? ''),
      );
      expect(period).toBeTruthy();
      expect(parseFloat(getComputedStyle(period!).fontSize)).toBeGreaterThanOrEqual(18);
      expect(getComputedStyle(period!).fontFamily).not.toContain('Mono');
    },
  );

  it('keeps only the stored confirmation evidence and hides all of it on expiry', async () => {
    state.confirmation!.confirmedFor!.checked = {
      checkedOn: '2026-08-31',
      nameEvidence: 'full_name',
      registerVerdict: null,
      partyAgreement: null,
    };
    await render();
    expect(host.textContent).toContain('Checked Aug 31, 2026');
    expect(host.textContent).not.toContain('Party organisations of their own party pay into it');
    state.expired = true;
    await render();
    expect(host.textContent).not.toContain('Checked Aug 31, 2026');
    expect(host.querySelector('a[href*="/legislators/"]')).toBeNull();
    expect(host.textContent).toContain('$59,950');
  });

  it('shows mixed report dates without fabricating an amendment date or direct report links', async () => {
    params.tab = 'filings';
    state.filings = {
      state: 'reported',
      orderedBy: 'filed_date_then_period_end',
      total: 2,
      cataloguedWithoutRecord: 1,
      filings: [
        {
          filingYear: 2025,
          reportType: 'year_end',
          reportName: 'Year-end report',
          periodStart: '2025-01-01',
          periodEnd: '2025-12-31',
          filedDate: '2026-01-29',
          effectiveAmendmentIndex: 1,
        },
        {
          filingYear: 2024,
          reportType: 'pre_general',
          reportName: 'Pre-general report',
          periodStart: null,
          periodEnd: '2024-10-22',
          filedDate: null,
          effectiveAmendmentIndex: 0,
        },
      ],
    };
    await render();
    expect(host.textContent).toContain('when no filing date is available');
    expect(host.textContent).toContain('FILED JAN 29, 2026');
    expect(host.textContent).toContain('Covers through Oct 22, 2024');
    expect(host.textContent).not.toContain('FILED OCT 22, 2024');
    expect(host.textContent).toContain('AMENDED');
    expect(host.textContent).not.toContain('AMENDED JAN');
    const content = host.textContent!;
    expect(content.indexOf("The Board's catalogue lists")).toBeGreaterThan(
      content.indexOf('Year-end report'),
    );
    expect(content.indexOf('End dates come from the reports')).toBeGreaterThan(
      content.indexOf('Pre-general report'),
    );
    const filed = [...host.querySelectorAll('div')].find(
      (node) => node.textContent === 'FILED JAN 29, 2026',
    );
    expect(parseFloat(getComputedStyle(filed!).fontSize)).toBeGreaterThanOrEqual(15);
    expect(getComputedStyle(filed!).fontFamily).not.toContain('Mono');
    expect([...host.querySelectorAll('a')].some((a) => a.textContent === 'OPEN')).toBe(false);
  });
});

describe('filed reports keep their source and recover without losing rows', () => {
  const boardUrl =
    'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/19019/2026/';
  const filing = (index = 0) => ({
    filingYear: 2026 - index,
    reportType: 'year_end',
    reportName: `Report ${index + 1}`,
    periodStart: '2025-01-01',
    periodEnd: '2025-12-31',
    filedDate: '2026-01-29',
    effectiveAmendmentIndex: 0,
  });
  const reportPage = (count = 1) => ({
    state: 'reported',
    orderedBy: 'filed_date_then_period_end',
    total: count,
    cataloguedWithoutRecord: 0,
    asOf: '2026-08-12',
    filings: Array.from({ length: count }, (_, index) => filing(index)),
  });
  function draw() {
    act(() => root.render(<FilingsList registrationNumber="19019" boardUrl={boardUrl} />));
  }
  function sourceAndHeadingRemain() {
    expect(host.querySelector('[role="heading"]')?.textContent).toBe(
      'Reports this committee has filed',
    );
    expect(host.textContent).toContain('All years in our copy');
    const link = host.querySelector('a')!;
    expect(link.textContent).toBe('The Board’s record for this committee');
    expect(link.getAttribute('href')).toBe(boardUrl);
  }

  it.each(['loading', 'empty', 'failed'])(
    'keeps the source and section title available while %s',
    (result) => {
      state.filingsQuery =
        result === 'loading'
          ? { data: undefined, isPending: true, isFetching: true }
          : result === 'failed'
            ? { data: undefined, isError: true }
            : { data: { pages: [reportPage(0)] } };
      draw();
      sourceAndHeadingRemain();
      if (result === 'loading') {
        expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading reports');
        expect(host.textContent).not.toContain('reports filed');
      } else if (result === 'failed') {
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('gap on our side');
        click(button('Try again'));
        expect(filingsRefetch).toHaveBeenCalledTimes(1);
      } else {
        expect(host.textContent).toContain('No filed reports in our copy');
        expect(host.textContent).toContain('not a statement about the committee');
        expect(button('Try again')).toBeUndefined();
      }
    },
  );

  it('uses the catalogue response copy date and omits missing or invalid dates', () => {
    for (const asOf of [undefined, null, 'invalid', '2026-08-12']) {
      state.filings = { ...reportPage(), asOf };
      draw();
      expect(host.textContent?.includes('Minnesota’s report catalogue copied')).toBe(
        asOf === '2026-08-12',
      );
      if (asOf === '2026-08-12') expect(host.textContent).toContain('copied Aug 12, 2026');
    }
    state.filingsQuery = { data: undefined, isError: true };
    draw();
    expect(host.textContent).not.toContain('catalogue copied');
  });

  it('retains a successful copy date and rows when a later request fails', () => {
    state.filings = reportPage();
    state.filingsQuery = { isError: true, isFetchNextPageError: true, hasNextPage: true };
    draw();
    expect(host.textContent).toContain('Report 1');
    expect(host.textContent).toContain('catalogue copied Aug 12, 2026');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'We couldn’t load more reports. The reports already shown are still available.',
    );
    click(button('Try again'));
    expect(filingsFetchNextPage).toHaveBeenCalledTimes(1);
    expect(filingsRefetch).not.toHaveBeenCalled();
  });

  it('keeps a filing date and amendment label together and explains only present gaps', () => {
    state.filings = { ...reportPage(), filings: [{ ...filing(), effectiveAmendmentIndex: 1 }] };
    draw();
    const filedDate = [...host.querySelectorAll('div')].find(
      (node) => node.textContent === 'FILED JAN 29, 2026',
    )!;
    expect(filedDate.parentElement?.textContent).toBe('FILED JAN 29, 2026AMENDED');
    expect(host.textContent).toContain('Amended means the committee filed a revised version');
    expect(host.textContent).not.toContain('Filing dates appear only');
    state.filings = { ...reportPage(), filings: [{ ...filing(), filedDate: null }] };
    draw();
    expect(host.textContent).not.toContain('AMENDED');
    expect(host.textContent).not.toContain('Amended means');
    expect(host.textContent).toContain('Filing dates appear only where our records include them');
    expect(host.textContent).not.toContain('FILED DEC 31, 2025');
  });

  it('prints the unestablished-status note only for a known positive count', () => {
    for (const cataloguedWithoutRecord of [undefined, null, 0, 2]) {
      state.filings = { ...reportPage(), cataloguedWithoutRecord };
      draw();
      expect(host.textContent?.includes('without saying whether')).toBe(
        cataloguedWithoutRecord === 2,
      );
      expect(host.textContent).toContain('1 report filed');
    }
  });

  it('disables retry and next-page controls during a request', () => {
    state.filingsQuery = { data: undefined, isError: true, isFetching: true };
    draw();
    expect(button('Try again')?.getAttribute('aria-disabled')).toBe('true');
    click(button('Try again'));
    expect(filingsRefetch).not.toHaveBeenCalled();
    state.filings = { ...reportPage(), total: 8 };
    state.filingsQuery = { hasNextPage: true, isFetching: true, isFetchingNextPage: true };
    draw();
    const more = button('Loading more reports')!;
    expect(more.getAttribute('aria-disabled')).toBe('true');
    click(more);
    expect(filingsFetchNextPage).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Report 1');
    expect(host.textContent).toContain('Showing 1 of 8 reports filed');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading more reports');
  });

  it('shows a complete 6-report list with one count and no more button', () => {
    state.filings = reportPage(6);
    draw();
    expect(host.textContent?.match(/6 reports filed/g)).toHaveLength(1);
    expect(button('Show more reports')).toBeUndefined();
    expect(button('Try again')).toBeUndefined();
    expect(host.textContent).not.toContain('couldn’t load more');
    expect(host.querySelectorAll('a')).toHaveLength(1);
    const firstReport = [...host.querySelectorAll('div')].find(
      (node) => node.textContent === 'Report 1',
    )!;
    expect(
      host.querySelector('a')!.compareDocumentPosition(firstReport) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
