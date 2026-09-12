// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const state = vi.hoisted(() => ({ query: {} as Record<string, unknown>, money: {} as unknown }));
vi.mock('../../../hooks/useAppQueries', () => ({
  useCommitteeMoney: () => ({ data: state.money, isPending: false, isError: false }),
  useCommitteePaymentsList: () => state.query,
  useCommitteePaymentsReceived: () => state.query,
  useCommitteePaymentsMade: () => state.query,
  useOutsideSpending: () => ({ data: { pages: [] }, isPending: false, isError: false }),
  usePrefetchCommitteeMoney: () => () => {},
  usePrefetchLegislator: () => () => {},
}));
vi.mock('../../../hooks/useCurrentClaimExpiry', () => ({ useCurrentClaimExpiry: () => false }));
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
import { committeeFinanceFromPayload } from '../../../data/api';
import type { RootScreenProps } from '../../../navigation/types';
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
});

describe.each(['full', 'short'])('%s payment list', (view) => {
  it.each([
    ['gave', 'rejected'],
    ['spent', 'rejected'],
    ['gave', 'unavailable'],
    ['spent', 'unavailable'],
    ['gave', 'missing'],
  ])('shows the existing error words on a %s %s read', (tab, failure) => {
    state.money = committeeFinanceFromPayload(
      {
        registration_number: '20003',
        committee_name: 'MN DFL State Central Committee',
        entity_type: 'PTY',
        year: 2025,
        register: { state: 'reported', name: 'MN DFL State Central Committee', kind: 'party_unit' },
        split: { state: 'shown', reported_total: '100', named_total: '100' },
        money_in: { state: 'reported' },
        money_out: { state: 'reported' },
      },
      { servedAgeMs: 0 },
    );
    const page = failure === 'missing' ? null : { state: 'unavailable', payments: [] };
    state.query = {
      data: failure === 'rejected' ? undefined : view === 'full' ? { pages: [page] } : page,
      isPending: false,
      isError: failure === 'rejected',
    };
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const props = {
      navigation: { navigate: vi.fn(), setParams: vi.fn() },
      route: { params: { slug: 'mn-dfl-state-central-committee-20003', year: '2025', tab } },
    };
    act(() =>
      root.render(
        view === 'full' ? (
          <CommitteePaymentsScreen
            {...(props as unknown as RootScreenProps<'CommitteePayments'>)}
          />
        ) : (
          <CommitteeMoneyScreen {...(props as unknown as RootScreenProps<'CommitteeMoney'>)} />
        ),
      ),
    );
    expect(host.textContent).toContain('We couldn’t load these payments right now.');
    expect(host.textContent).not.toContain('No donors named');
    expect(host.textContent).not.toContain('No payments named');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
});
