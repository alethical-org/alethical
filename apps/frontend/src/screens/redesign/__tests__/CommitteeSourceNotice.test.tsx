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

const NOTICE =
  'Minnesota’s Campaign Finance Board spending file lists only part of this committee’s ' +
  '2017 payments.';

async function render(view: 'full' | 'browser', tab: string) {
  state.money = committeeFinanceFromPayload({
    registration_number: '18127',
    committee_name: 'Coleman, Christopher B Gov Committee',
    entity_type: 'PCC',
    year: 2017,
    register: {
      state: 'reported',
      name: 'Coleman, Christopher B Gov Committee',
      kind: 'candidate',
    },
    split: { state: 'shown', reported_total: '100', named_total: '100' },
    money_in: { state: 'reported' },
    money_out: { state: 'reported' },
    source_notices: [
      { key: 'coleman-2017-expenditures-partial', dataset: 'expenditures', text: NOTICE },
    ],
  });
  const page = { state: 'unavailable', payments: [] };
  state.query = {
    data: view === 'full' ? { pages: [page] } : page,
    isPending: false,
    isError: false,
  };
  vi.mocked(publicApiRequest).mockReset();
  vi.mocked(publicApiRequest).mockResolvedValue({ data: page });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const props = {
    navigation: { navigate: vi.fn(), setParams: vi.fn() },
    route: { params: { slug: 'coleman-christopher-b-gov-committee-18127', year: '2017', tab } },
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
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('a reviewed notice about the Board’s own file', () => {
  it('prints beside the committee page’s filing stamp for that year', async () => {
    await render('browser', 'gave');
    expect(host.textContent).toContain(NOTICE);
  });

  it('prints on the full spending list, where the spending file’s rows are', async () => {
    await render('full', 'spent');
    expect(host.textContent).toContain(NOTICE);
  });

  it('stays off the donor list, which comes from a different file', async () => {
    await render('full', 'gave');
    expect(host.textContent).not.toContain(NOTICE);
  });
});
