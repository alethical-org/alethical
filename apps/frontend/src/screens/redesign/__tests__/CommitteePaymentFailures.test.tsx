// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const state = vi.hoisted(() => ({ query: {} as Record<string, unknown>, money: {} as unknown }));
vi.mock(
  '../../../components/campaignMoney/MoneyDetailsOnDemand',
  () => import('../../../components/campaignMoney/MoneyDetailsBundle'),
);

vi.mock('../../../hooks/useAppQueries', () => ({
  useCommitteeConfirmation: () => ({ data: undefined, isPending: false }),
  useCommitteeMoney: () => ({ data: state.money, isPending: false, isError: false }),
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
vi.mock('../../../hooks/useResponsive', () => ({ useResponsive: () => ({ isMobile: false }) }));
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
