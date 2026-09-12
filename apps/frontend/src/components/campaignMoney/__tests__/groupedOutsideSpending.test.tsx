// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../data/groupedOutsideSpending', () => ({
  getGroupedOutsideSpending: vi.fn(),
  getCompleteOutsideSpendingPayments: vi.fn(),
}));
vi.mock('../../../hooks/useResponsive', () => ({ useResponsive: () => ({ isMobile: false }) }));
vi.mock('../../LinkArrow', () => ({ LinkArrow: () => null }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate }) }));

import { GroupedOutsideSpending } from '../GroupedOutsideSpending';
import {
  getCompleteOutsideSpendingPayments,
  getGroupedOutsideSpending,
  type GroupedOutsideSpending as GroupedData,
} from '../../../data/groupedOutsideSpending';
import {
  outsideSpenderFigures,
  outsideSpenderIdentity,
  outsideSpenderKey,
  type OutsideSpenderGroup,
} from '../../../lib/groupedOutsideSpending';
import type { OutsideSpendingYear } from '../../../lib/outsideSpending';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
const loadGroups = vi.mocked(getGroupedOutsideSpending);
const loadPayments = vi.mocked(getCompleteOutsideSpendingPayments);
let root: Root;
let mount: HTMLDivElement;
let client: QueryClient;

const year: OutsideSpendingYear = {
  year: 2025,
  state: 'reported',
  snapshotId: 'download-1',
  committees: [{ registrationNumber: '1', name: 'Example candidate', office: 'Senate' }],
  supporting: 10,
  supportingPayments: 2,
  opposing: 3,
  opposingPayments: 1,
  directionNotRecorded: 0,
  directionNotRecordedPayments: 1,
  firstPaymentOn: '2025-01-01',
  lastPaymentOn: '2025-02-01',
  sourceUrl: 'https://cfb.mn.gov/reports-and-data/',
  fetchedAt: '2026-09-01',
};

const registeredIdentity = outsideSpenderIdentity('900', 'Example Fund');
const privateIdentity = outsideSpenderIdentity(null, 'Private filer');
const groups: OutsideSpenderGroup[] = [
  {
    key: outsideSpenderKey(registeredIdentity, 'For'),
    identity: registeredIdentity,
    name: 'Example Fund',
    registrationNumber: '900',
    linkable: true,
    groupingBasis: 'registration_number',
    direction: 'For',
    amount: '10',
    paymentCount: 2,
    aboutRegistrationNumbers: ['1'],
  },
  {
    key: outsideSpenderKey(registeredIdentity, 'Against'),
    identity: registeredIdentity,
    name: 'Example Fund',
    registrationNumber: '900',
    linkable: true,
    groupingBasis: 'registration_number',
    direction: 'Against',
    amount: '3',
    paymentCount: 1,
    aboutRegistrationNumbers: ['1'],
  },
  {
    key: outsideSpenderKey(privateIdentity, 'not recorded'),
    identity: privateIdentity,
    name: 'Private filer',
    registrationNumber: null,
    linkable: false,
    groupingBasis: 'exact_name',
    direction: 'not recorded',
    amount: '0',
    paymentCount: 1,
    aboutRegistrationNumbers: ['1'],
  },
];

const grouped: GroupedData = {
  year: 2025,
  snapshotId: 'download-1',
  releaseId: 'release-1',
  groups,
  figures: outsideSpenderFigures(groups),
  aboutPaymentCounts: { '1': 4 },
};

const payments = [1, 2].map((recordNumber) => ({
  aboutRegistrationNumber: '1',
  spender: 'Example Fund',
  spenderRegistrationNumber: '900',
  direction: 'For' as const,
  amount: '5',
  paidOn: '2025-01-01',
  purpose: 'Printed postcards',
  vendorName: 'Example Printer',
  recordNumber,
}));

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

async function render(selected = year) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <GroupedOutsideSpending year={selected} onOpenSource={vi.fn()} />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

function expand(): HTMLElement {
  const button = mount.querySelector('[aria-label="Show 2 payments from Example Fund, For"]');
  expect(button).not.toBeNull();
  return button as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  loadGroups.mockResolvedValue(grouped);
  loadPayments.mockResolvedValue(payments);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mount = document.createElement('div');
  document.body.append(mount);
  root = createRoot(mount);
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  mount.remove();
});

describe('outside spender list on the campaign money tab', () => {
  it('renders distinct directions, links only linkable groups, and loads payment details on expansion', async () => {
    await render();
    expect(loadGroups).toHaveBeenCalledTimes(1);
    expect(loadPayments).not.toHaveBeenCalled();
    expect(mount.textContent).toContain('Spending by Outside Groups');
    expect(mount.textContent).toContain('2 payments · 1 spender');
    expect(mount.textContent).toContain('Not stated');
    expect(mount.textContent).not.toContain('Copied from the state');
    expect(
      mount.querySelector('a[href="/money/committees/example-fund-900?year=2025"]'),
    ).not.toBeNull();
    await act(async () =>
      (
        mount.querySelector('a[href="/money/committees/example-fund-900?year=2025"]') as HTMLElement
      ).click(),
    );
    expect(navigate).toHaveBeenCalledWith('CommitteeMoney', {
      slug: 'example-fund-900',
      year: '2025',
    });
    expect(
      [...mount.querySelectorAll('a')].some((link) => link.textContent === 'Private filer'),
    ).toBe(false);
    expect(getComputedStyle(expand()).minHeight).toBe('44px');
    expect(expand().getAttribute('aria-expanded')).toBe('false');
    await act(async () => expand().click());
    await settle();
    expect(loadPayments).toHaveBeenCalledTimes(1);
    expect(mount.querySelector('[aria-expanded="true"]')).not.toBeNull();
    expect(mount.textContent?.match(/Printed postcards/g)).toHaveLength(2);
    expect(mount.textContent?.match(/Vendor: Example Printer/g)).toHaveLength(2);
  });

  it('uses a focusable native button for keyboard activation', async () => {
    await render();
    const control = expand();
    expect(control.tagName).toBe('BUTTON');
    expect(control.tabIndex).toBe(0);
    await act(async () => {
      control.focus();
      // jsdom does not synthesize a native button's click from keyboard events.
      // The browser owns that default; exercise the resulting activation here.
      control.click();
    });
    await settle();
    expect(mount.querySelector('[aria-expanded="true"]')).not.toBeNull();
    expect(loadPayments).toHaveBeenCalledTimes(1);
  });

  it('starts with a closed list again when the selected year changes', async () => {
    await render();
    await act(async () => expand().click());
    await settle();
    loadGroups.mockResolvedValue({ ...grouped, year: 2026 });
    await render({ ...year, year: 2026 });
    expect(mount.querySelector('[aria-expanded="true"]')).toBeNull();
    expect(mount.textContent).not.toContain('Printed postcards');
    expect(loadPayments).toHaveBeenCalledTimes(1);
  });

  it('keeps saved summary figures visible but does not invent spender counts on a failed list', async () => {
    loadGroups.mockRejectedValueOnce(new Error('network unavailable'));
    await render();
    expect(mount.textContent).toContain('$10');
    expect(mount.textContent).toContain('We could not load the list of outside spenders');
    expect(mount.textContent).not.toContain('· 1 spender');
    expect(mount.querySelector('[role="alert"]')).not.toBeNull();
    expect(loadPayments).not.toHaveBeenCalled();
  });

  it('shows a payment-read failure without showing partial payment rows', async () => {
    loadPayments.mockRejectedValueOnce(new Error('release changed'));
    await render();
    await act(async () => expand().click());
    await settle();
    expect(mount.textContent).toContain(
      'We could not load the complete payment details from the same state file',
    );
    expect(mount.textContent).not.toContain('Printed postcards');
    expect(mount.textContent).toContain('$10');
  });

  it('keeps the checked-zero sentence and makes no list request for it', async () => {
    await render({
      ...year,
      supporting: 0,
      supportingPayments: 0,
      opposing: 0,
      opposingPayments: 0,
      directionNotRecordedPayments: 0,
    });
    expect(mount.textContent).toContain(
      'No outside group reported spending anything to support or oppose this legislator in 2025.',
    );
    expect(loadGroups).not.toHaveBeenCalled();
    expect(mount.querySelector('a[href="https://cfb.mn.gov/reports-and-data/"]')).not.toBeNull();
  });
});
