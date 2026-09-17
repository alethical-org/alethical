// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareContent } from '../../../lib/share';
import type { RootScreenProps } from '../../../navigation/types';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const state = vi.hoisted(() => ({
  mobile: false,
  search: {} as Record<string, unknown>,
  payments: {} as Record<string, unknown>,
  committee: {} as Record<string, unknown>,
  races: {} as Record<string, unknown>,
  outside: {} as Record<string, unknown>,
  names: {} as Record<string, unknown>,
}));
vi.mock('../../../hooks/useAppQueries', () => ({
  useCampaignFinanceNameSearch: () => state.search,
  usePaymentsUnderName: () => state.payments,
  useCommitteePaymentsList: () => state.payments,
  useCommitteeMoney: () => state.committee,
  useCampaignFinanceRaces: () => state.races,
  useOutsideSpendingRecord: () => state.outside,
  usePrefetchCommitteeMoney: () => () => {},
}));
vi.mock('../../../hooks/useOutsideSpendingNames', () => ({
  useOutsideSpendingNames: () => state.names,
}));
vi.mock('../../../hooks/useOutsideSpendingReturn', () => ({
  useOutsideSpendingReturn: () => ({ href: '/money/outside-spending', onReturn: () => {} }),
  outsideSpendingReturnContext: () => ({}),
}));
vi.mock('../../../hooks/useHistoryScrollRestoration', () => ({
  useHistoryScrollRestoration: () => ({}),
}));
vi.mock('../../../hooks/useSearchMetric', () => ({ useSearchMetric: () => {} }));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: state.mobile, isDesktop: !state.mobile, isTablet: false }),
}));
vi.mock('../../../navigation/documentTitle', () => ({ useDocumentTitle: () => {} }));
vi.mock('../../../theme/primitives', () => ({
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PageBackground: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TopNav: () => null,
  Footer: () => null,
}));
vi.mock('react-native-svg', () => ({
  default: () => null,
  Circle: () => null,
  Path: () => null,
  Rect: () => null,
  Polygon: () => null,
  Polyline: () => null,
  Line: () => null,
  Ellipse: () => null,
  G: () => null,
  Defs: () => null,
  LinearGradient: () => null,
  Stop: () => null,
}));
vi.mock('../../../components/billDetail/SharePopover', () => ({
  SharePopover: ({ content }: { content: ShareContent }) => (
    <button data-share={JSON.stringify(content)}>Share</button>
  ),
}));

import { MoneySearchScreen } from '../MoneySearchScreen';
import { PaymentsUnderNameScreen } from '../PaymentsUnderNameScreen';
import { CommitteePaymentsScreen } from '../CommitteePaymentsScreen';
import { MoneyByRaceScreen } from '../MoneyByRaceScreen';
import { OutsideSpendingScreen } from '../OutsideSpendingScreen';
import { OutsideSpendingBrowseScreen } from '../OutsideSpendingBrowseScreen';
import { outsideSpendingRecordPageFromPayload } from '../../../lib/outsideSpending';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const navigation = { navigate: vi.fn(), setParams: vi.fn(), push: vi.fn() };
function draw(child: ReactNode) {
  act(() => root.render(child));
}
function props<
  Name extends
    'MoneySearch' | 'PaymentsUnderName' | 'CommitteePayments' | 'MoneyByRace' | 'OutsideSpending',
>(name: Name, params: RootScreenProps<Name>['route']['params']): RootScreenProps<Name> {
  return { navigation, route: { key: 'test', name, params } } as unknown as RootScreenProps<Name>;
}
function share(): ShareContent {
  const controls = host.querySelectorAll('[data-share]');
  expect(controls).toHaveLength(1);
  return JSON.parse(controls[0].getAttribute('data-share')!);
}
function noShare() {
  expect(host.querySelector('[data-share]')).toBeNull();
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  state.mobile = false;
  state.search = { data: { state: 'reported', query: 'Smith', groups: [] } };
  state.payments = {
    data: { pages: [{ state: 'reported', payments: [], linkableRegistrationNumbers: [] }] },
  };
  state.committee = { data: null, isPending: false };
  state.races = {
    data: {
      state: 'reported',
      year: 2024,
      office: 'House',
      offices: [{ office: 'House', committeeCount: 0 }],
      orderedBy: 'district_then_name',
      contests: [],
      contestCount: 0,
      committeeCount: 0,
    },
  };
  state.outside = {
    data: outsideSpendingRecordPageFromPayload({
      state: 'reported',
      year: 2024,
      sort: 'largest',
      snapshot_id: 'record',
      spender: { name: 'Example Fund', registration_number: '12' },
      page: { number: 2, size: 50, total_rows: 60, has_more: false },
    }),
  };
  state.names = {
    data: {
      state: 'reported',
      browse: 'groups',
      query: 'Example',
      year: 2024,
      names: [],
      years: [2024],
      snapshot_id: 'record',
      page: { number: 2, size: 50, total_names: 0, has_more: false },
    },
  };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe('results Share controls', () => {
  it.each([false, true])(
    'places one control beside or beneath the heading (mobile %s)',
    (mobile) => {
      state.mobile = mobile;
      draw(<MoneySearchScreen {...props('MoneySearch', { q: 'Smith' })} />);
      expect(share().title).toBe('Results for “Smith”');
      const heading = host.querySelector('h1')!;
      const headingRow = heading.parentElement!.parentElement!;
      expect(headingRow.querySelector('[data-share]')).not.toBeNull();
      expect(getComputedStyle(headingRow).flexDirection).toBe(mobile ? 'column' : 'row');
    },
  );

  it('removes Share while a different search is loading or no usable search is present', () => {
    draw(<MoneySearchScreen {...props('MoneySearch', { q: 'Smith' })} />);
    share();
    state.search.isPlaceholderData = true;
    draw(<MoneySearchScreen {...props('MoneySearch', { q: 'Jones' })} />);
    noShare();
    state.search = { isError: true };
    draw(<MoneySearchScreen {...props('MoneySearch', { q: 'Jones' })} />);
    noShare();
    state.search = { data: { state: 'reported', groups: [] } };
    draw(<MoneySearchScreen {...props('MoneySearch', { q: '' })} />);
    noShare();
  });

  it('shares payment name and role but hides unavailable or invalid requests', () => {
    const valid = props('PaymentsUnderName', {
      name: 'A & B',
      role: 'independent_vendor',
      q: 'A & B',
    });
    draw(<PaymentsUnderNameScreen {...valid} />);
    expect(new URL(share().url).searchParams.get('role')).toBe('independent_vendor');
    state.payments = {
      data: { pages: [{ state: 'unavailable', payments: [], linkableRegistrationNumbers: [] }] },
    };
    draw(<PaymentsUnderNameScreen {...valid} />);
    noShare();
    draw(<PaymentsUnderNameScreen {...props('PaymentsUnderName', { name: '', role: 'vendor' })} />);
    noShare();
  });

  it('shares a known committee number with its tab and resolved year', () => {
    draw(
      <CommitteePaymentsScreen
        {...props('CommitteePayments', { slug: '1234', tab: 'spent', year: '2024' })}
      />,
    );
    expect(new URL(share().url).searchParams.get('year')).toBe('2024');
    expect(share().title).toContain('Committee 1234');
    state.payments = { data: { pages: [null] }, isPending: false };
    draw(
      <CommitteePaymentsScreen
        {...props('CommitteePayments', { slug: '1234', tab: 'spent', year: '2024' })}
      />,
    );
    noShare();
  });

  it('shares accepted race results and hides old rows under a newly requested year', () => {
    draw(<MoneyByRaceScreen {...props('MoneyByRace', { office: 'House', year: '2024' })} />);
    expect(new URL(share().url).searchParams.get('year')).toBe('2024');
    state.races.isPlaceholderData = true;
    draw(<MoneyByRaceScreen {...props('MoneyByRace', { office: 'House', year: '2026' })} />);
    noShare();
  });

  it('shares held outside results using their own subject, period, sort and page', () => {
    draw(
      <OutsideSpendingScreen
        {...props('OutsideSpending', { spender: '12', year: '2024', sort: 'largest', page: '2' })}
      />,
    );
    const accepted = share();
    state.outside = { isError: true };
    draw(
      <OutsideSpendingScreen
        {...props('OutsideSpending', { spender: '99', year: '2026', sort: 'newest' })}
      />,
    );
    expect(share()).toEqual(accepted);
    expect(accepted.title).toBe('Example Fund');
    expect(new URL(accepted.url).searchParams.get('spender')).toBe('12');
    expect(new URL(accepted.url).searchParams.get('year')).toBe('2024');
  });

  it('shares accepted outside browse filters and hides the control during year changes', () => {
    draw(
      <OutsideSpendingBrowseScreen
        {...props('OutsideSpending', { q: 'Example', year: '2024', page: '2' })}
      />,
    );
    const url = new URL(share().url);
    expect(url.searchParams.get('q')).toBe('Example');
    expect(url.searchParams.get('page')).toBe('2');
    state.outside.isPlaceholderData = true;
    draw(
      <OutsideSpendingBrowseScreen {...props('OutsideSpending', { q: 'Example', year: '2026' })} />,
    );
    noShare();
  });
});
