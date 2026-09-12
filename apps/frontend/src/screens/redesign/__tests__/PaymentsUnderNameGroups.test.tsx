// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const state = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  mobile: false,
  tablet: false,
}));
vi.mock('../../../hooks/useAppQueries', () => ({ usePaymentsUnderName: () => state.query }));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: state.mobile, isTablet: state.tablet }),
}));
vi.mock('../../../navigation/documentTitle', () => ({ useDocumentTitle: () => {} }));
vi.mock('../../../theme/primitives', () => ({
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PageBackground: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TopNav: () => null,
  Footer: () => null,
}));
vi.mock('react-native-svg', () => ({ default: () => null, Path: () => null, Circle: () => null }));
import { PaymentsUnderNameScreen } from '../PaymentsUnderNameScreen';
import { paymentUnderName } from '../../../data/api';
import source from '../../../lib/__tests__/fixtures/payments-under-name-nystrom.json';
import {
  CAP_NOTE,
  LIST_NOTE,
  LOAD_ERROR,
  NOTHING_FILED_WHY,
  RECORDS_UNAVAILABLE_TITLE,
  YEAR_MAY_CONTINUE,
} from '../../../lib/paymentsUnderName';
import type { RootScreenProps } from '../../../navigation/types';

const rows = source.data.payments.map((p) => paymentUnderName(p, 'contributor'));
const page = (payments = rows, extra = {}) => ({
  state: 'reported',
  payments,
  linkableRegistrationNumbers: source.data.linkable_registration_numbers,
  fetchedAt: source.data.fetched_at,
  releaseId: source.data.release_id,
  ...extra,
});
const fetchMore = vi.fn();
const refetch = vi.fn();
const push = vi.fn();
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function draw(role = 'contributor') {
  act(() =>
    root.render(
      <PaymentsUnderNameScreen
        {...({
          navigation: { navigate: vi.fn(), push },
          route: { params: { name: 'Nystrom, Mary Ann', role } },
        } as unknown as RootScreenProps<'PaymentsUnderName'>)}
      />,
    ),
  );
}
function open(extra = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  state.mobile = false;
  state.tablet = false;
  state.query = {
    data: { pages: [page()] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: fetchMore,
    refetch,
    ...extra,
  };
  draw();
}
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  vi.clearAllMocks();
});

it('shows the real grouped years, exact employer text, registered anchors and every payment', () => {
  open();
  expect([...host.querySelectorAll('[aria-level="2"]')].map((e) => e.textContent)).toEqual([
    '2026',
    '2025',
    '2024',
    '2023',
    '2022',
    '2021',
    '2020',
    '2018',
    '2017',
    '2016',
  ]);
  expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(29);
  expect(host.textContent).toContain('7 payments to 5 committees');
  expect(host.textContent).toContain('Nystrom & Associates');
  const anchor = [...host.querySelectorAll('a')].find(
    (a) => a.textContent === 'Abeler, Jim Senate Committee',
  );
  expect(anchor?.getAttribute('href')).toBe('/money/committees/abeler-jim-senate-committee-17868');
  expect(host.textContent).toContain(LIST_NOTE);
});

it('a single payment has no duplicated subtotal and a nonlinkable name is plain text', () => {
  open({ data: { pages: [page([rows[0]], { linkableRegistrationNumbers: [] })] } });
  expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(1);
  expect(host.textContent?.match(/\$25,000/g)).toHaveLength(1);
  expect([...host.querySelectorAll('a')].some((a) => a.textContent === rows[0].filerName)).toBe(
    false,
  );
});

it('merges an extra page into an existing year and filer while keeping duplicate gifts', () => {
  const one = { ...rows[0], year: 2025, paidOn: '2025-05-01', amount: '100.0000' };
  open({ data: { pages: [page([one])] }, hasNextPage: true });
  expect(host.textContent).toContain('1 payment so far');
  expect(host.textContent).toContain(YEAR_MAY_CONTINUE);
  expect(host.textContent).toContain('Showing the first 1 payment, newest first');
  expect(host.textContent).not.toContain('NEWEST FIRST');
  expect(host.textContent).toContain(CAP_NOTE);
  const more = [...host.querySelectorAll('[role="button"]')].find(
    (b) => b.textContent === 'Show more payments',
  ) as HTMLElement;
  act(() => more.click());
  expect(fetchMore).toHaveBeenCalledTimes(1);
  state.query = { ...state.query, data: { pages: [page([one]), page([one])] }, hasNextPage: false };
  draw();
  expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(2);
  expect(host.textContent).toContain('$200');
  expect(host.textContent).toContain('2 payments to 1 committee');
  expect(host.textContent).not.toContain(YEAR_MAY_CONTINUE);
});

it.each(['vendor', 'independent_vendor'])(
  'uses the exact purpose and served party kind for %s',
  (role) => {
    open({
      data: {
        pages: [
          page([
            {
              ...rows[0],
              employer: 'Must not print',
              purpose: '  Exact filed purpose  ',
              filerKind: 'party_unit',
            },
          ]),
        ],
      },
    });
    draw(role);
    expect(host.textContent).toContain('Exact filed purpose');
    expect(host.textContent).not.toContain('Must not print');
    expect(host.textContent).toContain('Party unit');
    expect(host.textContent).toContain(
      role === 'vendor' ? '1 payment from 1 committee' : '1 payment from 1 spender',
    );
  },
);

it('retains loan and goods labels, missing dates, and phone reading order', () => {
  open({
    data: {
      pages: [
        page([
          {
            ...rows[0],
            paidOn: null,
            receiptType: 'Loan',
            inKind: 'Yes',
            employer: 'Filed employer',
            amount: '20.0000',
          },
        ]),
      ],
    },
  });
  state.mobile = true;
  draw();
  expect(host.textContent).toContain('Loan — reported on its own schedule, not a donation');
  expect(host.textContent).toContain('DONATED GOODS OR SERVICES');
  const payment = host.querySelector('[role="listitem"]')!;
  expect(payment.textContent?.indexOf('$20')).toBeLessThan(
    payment.textContent!.indexOf('Filed employer'),
  );
});

it('shows the existing error after a failed next-page read and retries the complete reading', () => {
  open({ hasNextPage: true, isFetchNextPageError: true });
  expect(host.textContent).toContain(LOAD_ERROR);
  const more = [...host.querySelectorAll('[role="button"]')].find(
    (b) => b.textContent === 'Show more payments',
  ) as HTMLElement;
  act(() => more.click());
  expect(refetch).toHaveBeenCalledTimes(1);
  expect(fetchMore).not.toHaveBeenCalled();
});

describe('existing whole-page states', () => {
  it('announces loading without showing old rows', () => {
    open({ data: undefined, isPending: true });
    expect(host.textContent).toContain('Loading these payments');
    expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(0);
  });
  it('keeps the exact-spelling empty explanation', () => {
    open({ data: { pages: [page([], { state: 'not_reported' })] } });
    expect(host.textContent).toContain('Nothing is filed under “Nystrom, Mary Ann” as spelled');
    expect(host.textContent).toContain(NOTHING_FILED_WHY);
  });
  it('distinguishes unavailable records from an empty name', () => {
    open({ data: { pages: [page([], { state: 'unavailable' })] } });
    expect(host.textContent).toContain(RECORDS_UNAVAILABLE_TITLE);
    expect(host.textContent).not.toContain('Nothing is filed');
  });
  it('keeps the existing failure explanation', () => {
    open({ data: undefined, isError: true });
    expect(host.textContent).toContain(LOAD_ERROR);
  });
});
