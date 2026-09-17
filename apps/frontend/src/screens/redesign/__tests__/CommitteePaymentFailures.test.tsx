// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const state = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  money: {} as unknown,
  report: {} as Record<string, unknown>,
  mobile: false,
  tablet: false,
}));
vi.mock(
  '../../../components/campaignMoney/MoneyDetailsOnDemand',
  () => import('../../../components/campaignMoney/MoneyDetailsBundle'),
);

vi.mock('../../../hooks/useAppQueries', () => ({
  useCommitteeConfirmation: () => ({ data: undefined, isPending: false }),
  useCommitteeMoney: () => ({
    data: state.money,
    isPending: false,
    isError: false,
    ...state.report,
  }),
  useCommitteePaymentsList: () => state.query,
  useOutsideSpending: () => ({ data: { pages: [] }, isPending: false, isError: false }),
  usePrefetchCommitteeMoney: () => () => {},
  usePrefetchLegislator: () => () => {},
}));
vi.mock('../../../hooks/useCurrentClaimExpiry', () => ({ useCurrentClaimExpiry: () => false }));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock('../../../data/api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  publicApiRequest: vi.fn(),
}));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: state.mobile, isTablet: state.tablet }),
}));
vi.mock('../../../navigation/documentTitle', () => ({ useDocumentTitle: () => {} }));
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
vi.mock('react-native-svg', () => ({ default: () => null, Path: () => null, Circle: () => null }));
import { CommitteePaymentsScreen } from '../CommitteePaymentsScreen';
import { CommitteeMoneyScreen } from '../CommitteeMoneyScreen';
import { committeeFinanceFromPayload, publicApiRequest } from '../../../data/api';
import type { RootScreenProps } from '../../../navigation/types';
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  client?.clear();
  state.report = {};
  state.mobile = false;
  state.tablet = false;
  vi.clearAllMocks();
});

describe.each(['full', 'browser'])('%s payment list', (view) => {
  it.each([
    ['gave', 'rejected'],
    ['spent', 'rejected'],
    ['gave', 'unavailable'],
    ['spent', 'unavailable'],
    ['gave', 'missing'],
  ])('shows the existing error words on a %s %s read', async (tab, failure) => {
    state.money = committeeFinanceFromPayload({
      registration_number: '20003',
      committee_name: 'MN DFL State Central Committee',
      entity_type: 'PTY',
      year: 2025,
      register: { state: 'reported', name: 'MN DFL State Central Committee', kind: 'party_unit' },
      split: { state: 'shown', reported_total: '100', named_total: '100' },
      money_in: { state: 'reported' },
      money_out: { state: 'reported' },
    });
    const page = failure === 'missing' ? null : { state: 'unavailable', payments: [] };
    state.query = {
      data: failure === 'rejected' ? undefined : view === 'full' ? { pages: [page] } : page,
      isPending: false,
      isError: failure === 'rejected',
    };
    vi.mocked(publicApiRequest).mockReset();
    if (failure === 'rejected') vi.mocked(publicApiRequest).mockRejectedValue(new Error('offline'));
    else vi.mocked(publicApiRequest).mockResolvedValue({ data: page });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const props = {
      navigation: { navigate: vi.fn(), setParams: vi.fn() },
      route: { params: { slug: 'mn-dfl-state-central-committee-20003', year: '2025', tab } },
    };
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          {view === 'full' ? (
            <CommitteePaymentsScreen
              {...(props as unknown as RootScreenProps<'CommitteePayments'>)}
            />
          ) : (
            <CommitteeMoneyScreen {...(props as unknown as RootScreenProps<'CommitteeMoney'>)} />
          )}
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(host.textContent).toContain(
        view === 'full'
          ? 'We couldn’t load these payments right now.'
          : 'We could not load the complete payment list',
      );
    });
    expect(host.textContent).not.toContain('No donors named');
    expect(host.textContent).not.toContain('No payments named');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
});

const received = {
  contributor: 'Example donor',
  contributorRegistrationNumber: null,
  contributorType: 'Individual',
  employer: null,
  amount: '25.0000',
  receivedOn: '2026-01-02',
  receiptType: 'Contribution',
  inKind: 'No',
};
const successfulPage = {
  state: 'reported',
  payments: [received],
  linkableRegistrationNumbers: [],
  totalPayments: 1,
  hasMore: false,
  fetchedAt: '2026-09-01T12:00:00Z',
};
const retryReport = vi.fn();
const retryRows = vi.fn();
const fetchMore = vi.fn();
const setParams = vi.fn();
function drawFull() {
  act(() =>
    root.render(
      <CommitteePaymentsScreen
        {...({
          navigation: { navigate: vi.fn(), push: vi.fn(), setParams },
          route: { params: { slug: 'example-20003', year: '2026', tab: 'gave' } },
        } as unknown as RootScreenProps<'CommitteePayments'>)}
      />,
    ),
  );
}
function openFull(report = {}, query = {}) {
  state.money = committeeFinanceFromPayload({
    registration_number: '20003',
    committee_name: 'Example committee',
    year: 2026,
    entity_type: 'PTY',
    register: { state: 'reported', name: 'Example committee', kind: 'party_unit' },
    split: {
      state: 'shown',
      reported_total: '100',
      reported_through: '2026-07-20',
      named_total: '100',
    },
    money_in: { state: 'reported', reported_period_start: '2026-01-01' },
    money_out: { state: 'reported' },
  });
  state.report = { refetch: retryReport, ...report };
  state.query = {
    data: { pages: [successfulPage] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetching: false,
    isFetchNextPageError: false,
    refetch: retryRows,
    fetchNextPage: fetchMore,
    ...query,
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  drawFull();
}
describe('independent report and payments states', () => {
  it('keeps payment rows while report information is loading without claiming no figures', () => {
    openFull({ data: undefined, isPending: true });
    expect(host.textContent).toContain('Loading report information');
    expect(host.textContent).toContain('Example donor');
    expect(host.textContent).not.toContain('We have no report figures');
  });
  it('keeps payments and retries a failed report request', () => {
    openFull({ data: undefined, isError: true });
    expect(host.textContent).toContain('Payment records for this filing year are still shown.');
    expect(host.textContent).toContain('Example donor');
    expect(host.textContent).not.toContain('We have no report figures');
    expect(host.textContent).not.toContain('Donors who gave $200');
    expect(host.textContent).toContain('Find this committee in the Board’s records');
    expect(host.textContent).not.toContain('lists every report it filed');
    const retry = [...host.querySelectorAll('[role="button"]')].find(
      (b) => b.textContent === 'Try again',
    ) as HTMLElement;
    act(() => retry.click());
    expect(retryReport).toHaveBeenCalledTimes(1);
    expect(retryRows).not.toHaveBeenCalled();
  });
  it('does not claim rows remain when both requests fail', () => {
    openFull({ data: undefined, isError: true }, { data: undefined, isError: true });
    expect(host.textContent).toContain('We couldn’t load the report information');
    expect(host.textContent).not.toContain('Payment records for this filing year are still shown');
    expect(host.textContent).not.toContain('We have no report figures');
  });
  it('keeps the real report dates when the payment request fails', () => {
    openFull({}, { data: undefined, isError: true });
    expect(host.textContent).toContain('Report figures for Jan 1, 2026 – Jul 20, 2026');
    expect(host.textContent).toContain('Board’s disclosure calendar');
    expect(host.textContent).not.toContain('No donors named');
  });
  it('does not declare an unknown committee while either source is still loading', () => {
    openFull({ data: null }, { data: undefined, isPending: true });
    expect(host.textContent).not.toContain('This number isn’t in the register');
    expect(host.textContent).toContain('Loading payments');
  });
  it('does not erase valid payments when the register response is null', () => {
    openFull({ data: null });
    expect(host.textContent).toContain('Example donor');
    expect(host.textContent).not.toContain('This number isn’t in the register');
  });
  it('keeps rows and exposes a retry when an unknown-total continuation fails', () => {
    openFull(
      {},
      {
        data: { pages: [{ ...successfulPage, totalPayments: null, hasMore: true }] },
        hasNextPage: true,
        isFetchNextPageError: true,
        isError: true,
      },
    );
    expect(host.textContent).toContain('Showing 1 payment for filing year 2026');
    expect(host.textContent).toContain(
      'We couldn’t load more payments. The payments already loaded are still shown.',
    );
    expect(host.textContent).toContain('Example donor');
    const retry = [...host.querySelectorAll('[role="button"]')].find(
      (b) => b.textContent === 'Try again',
    ) as HTMLElement;
    act(() => retry.click());
    expect(fetchMore).toHaveBeenCalledTimes(1);
  });
  it('shows the next-load action even when the total is unknown', async () => {
    let finish: () => void = () => {};
    fetchMore.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    openFull(
      {},
      {
        data: { pages: [{ ...successfulPage, totalPayments: null, hasMore: true }] },
        hasNextPage: true,
      },
    );
    const more = [...host.querySelectorAll('[role="button"]')].find(
      (b) => b.textContent === 'Show more payments',
    ) as HTMLElement;
    act(() => {
      more.click();
      more.click();
    });
    expect(fetchMore).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });
  it('presents report information before the list on phone and tablet', () => {
    openFull();
    for (const mobile of [true, false]) {
      state.mobile = mobile;
      state.tablet = !mobile;
      drawFull();
      expect(host.textContent!.indexOf('Report figures for')).toBeLessThan(
        host.textContent!.indexOf('Example donor'),
      );
    }
  });
  it('keeps a selected historical year in the available choices', () => {
    openFull();
    act(() =>
      root.render(
        <CommitteePaymentsScreen
          {...({
            navigation: { navigate: vi.fn(), push: vi.fn(), setParams },
            route: { params: { slug: 'example-20003', year: '2017', tab: 'gave' } },
          } as unknown as RootScreenProps<'CommitteePayments'>)}
        />,
      ),
    );
    const old = [...host.querySelectorAll('[role="button"]')].find(
      (b) => b.getAttribute('aria-label') === '2017',
    );
    expect(old?.getAttribute('aria-pressed')).toBe('true');
  });
});
