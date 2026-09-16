// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../data/groupedOutsideSpending', () => ({
  getGroupedOutsideSpending: vi.fn(),
  getCompleteOutsideSpendingPayments: vi.fn(),
}));
const band = vi.hoisted(() => ({ isMobile: false, isTablet: false }));
vi.mock('../../../hooks/useResponsive', () => ({ useResponsive: () => band }));
vi.mock('../../LinkArrow', () => ({ LinkArrow: () => null }));
vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Path: () => <path />,
}));
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
  // The address the server really sends: the bulk download itself, query and all.
  sourceUrl:
    'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/?download=-617535497',
  fetchedAt: '2026-09-01',
};

/** The one state where every figure is a checked 0: the link is confirmed, the
 *  download covers the year, and no group filed a payment. */
const checkedZero: OutsideSpendingYear = {
  ...year,
  supporting: 0,
  supportingPayments: 0,
  opposing: 0,
  opposingPayments: 0,
  directionNotRecordedPayments: 0,
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

async function render(selected = year, notOnTheBallot = false) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <GroupedOutsideSpending
          year={selected}
          onOpenSource={vi.fn()}
          notOnTheBallot={notOnTheBallot}
        />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

function expand(): HTMLElement {
  const button = mount.querySelector(
    '[aria-label="Show 2 payments from Example Fund, Supporting"]',
  );
  expect(button).not.toBeNull();
  return button as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  band.isMobile = false;
  band.isTablet = false;
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
  function textLine(text: string) {
    return [...mount.querySelectorAll<HTMLElement>('*')]
      .filter((node) => node.textContent === text)
      .at(-1)!;
  }

  it.each([
    ['computer', false, false, '104px', '120px'],
    ['tablet', false, true, '100px', '110px'],
    ['phone', true, false, null, null],
  ] as const)(
    'keeps stance and amount columns aligned on %s',
    async (_label, mobile, tablet, stanceWidth, amountWidth) => {
      band.isMobile = mobile;
      band.isTablet = tablet;
      await render();
      const stance = textLine('Supporting');
      const identity = mount.querySelector(
        'a[href="/money/committees/example-fund-900?year=2025"]',
      )!.parentElement!;
      if (mobile) {
        expect(stance.parentElement).toBe(identity);
        expect(getComputedStyle(identity.parentElement!).flexBasis).toBe('220px');
      } else {
        expect(stance.parentElement).not.toBe(identity);
        expect(getComputedStyle(stance.parentElement!).minWidth).toBe(stanceWidth);
        expect(getComputedStyle(stance.parentElement!).flexShrink).toBe('0');
        const amount = [...expand().querySelectorAll('*')].find(
          (node) => node.textContent === '$10',
        )!;
        expect(getComputedStyle(amount).minWidth).toBe(amountWidth);
        expect(getComputedStyle(amount).textAlign).toBe('right');
      }
    },
  );

  it('uses neutral outlined, filled and dashed stance chips', async () => {
    await render();
    const support = getComputedStyle(textLine('Supporting'));
    const oppose = getComputedStyle(textLine('Opposing'));
    const unstated = getComputedStyle(textLine('Not stated'));
    expect(support.color).toBe('rgb(17, 21, 15)');
    expect(support.borderColor).toBe('rgba(17, 21, 15, 0.4)');
    expect(oppose.color).toBe('rgb(255, 255, 255)');
    expect(oppose.backgroundColor).toBe('rgb(17, 21, 15)');
    expect(oppose.borderColor).toBe('rgb(17, 21, 15)');
    expect(unstated.color).toBe('rgb(107, 113, 107)');
    expect(unstated.borderStyle).toBe('dashed');
    expect(unstated.fontWeight).toBe('700');
  });

  it('puts ordinary-weight payment dates below the list and 14px before its source block', async () => {
    band.isMobile = true;
    await render();
    const date = textLine('Payments made Jan 1, 2025 to Feb 1, 2025');
    const meta = textLine('Registration 900 · 2 payments');
    expect(date).toBeDefined();
    expect(meta.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(date).fontWeight).toBe('400');
    // jsdom lets RN Web's default font shorthand override inline size.
    // The browser check also pins the computed size; here pin the actual output.
    expect(date.style.fontSize).toBe('15px');
    expect(getComputedStyle(meta).fontWeight).toBe('400');
    expect(meta.style.fontSize).toBe('15px');
    expect(getComputedStyle(date.parentElement!).gap).toBe('14px');
    expect(date.nextElementSibling?.textContent).toContain(
      'Minnesota’s campaign-finance downloads',
    );
  });

  it('renders distinct directions, links only linkable groups, and loads payment details on expansion', async () => {
    await render();
    expect(loadGroups).toHaveBeenCalledTimes(1);
    expect(loadPayments).not.toHaveBeenCalled();
    expect(mount.textContent).toContain('Spending by outside groups');
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
    await render(checkedZero);
    expect(mount.textContent).toContain(
      'The state’s file lists no independent expenditures supporting or opposing this candidate in 2025',
    );
    // A card that defines outside spending and then says there was none of it hands the
    // reader a definition of something not on the page.
    expect(mount.textContent).not.toContain('This money does not go to the candidate');
    expect(loadGroups).not.toHaveBeenCalled();
    expect(mount.textContent).toContain(
      'Source file: “Itemized independent expenditures of over $200”',
    );
    expect(
      mount.querySelector(
        'a[href="https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/"]',
      ),
    ).not.toBeNull();
  });

  it('names the ballot only in a year whose own filing record says they were off it', async () => {
    await render(checkedZero, true);
    expect(mount.textContent).toContain(
      'The state’s file lists no independent expenditures supporting or opposing this candidate in 2025, a year they ' +
        'were not on the ballot',
    );
  });

  it('prints $0 and 0 payments on a side no group filed, rather than a sentence', async () => {
    loadGroups.mockResolvedValue({
      ...grouped,
      groups: grouped.groups.filter((group) => group.direction === 'For'),
      figures: outsideSpenderFigures(grouped.groups.filter((row) => row.direction === 'For')),
    });
    await render();
    expect(mount.textContent).toContain('Spent supporting them');
    expect(mount.textContent).toContain('Spent opposing them');
    // A checked zero reads as 0 (`.claude/rules/grounded-answers.md` rule 12), and
    // replacing one figure with a sentence breaks the pair a reader is comparing.
    expect(mount.textContent).toContain('$0');
    expect(mount.textContent).toContain('0 payments');
    expect(mount.textContent).not.toContain('No group reported spending to support them');
  });

  it('says Supporting and Opposing on the chip and in the row a screen reader hears', async () => {
    await render();
    expect(mount.textContent).toContain('Supporting');
    expect(mount.textContent).toContain('Opposing');
    // The 2 figures above already read "Spent supporting them" and "Spent opposing
    // them", so the filing's own For and Against never reach a reader.
    expect(mount.textContent).not.toContain('For');
    expect(mount.textContent).not.toContain('Against');
    const spoken = [...mount.querySelectorAll('[aria-label]')].map((node) =>
      node.getAttribute('aria-label'),
    );
    expect(spoken).toContain('Show 2 payments from Example Fund, Supporting');
    expect(spoken.some((label) => label?.includes(', For'))).toBe(false);
  });

  it('defines independent expenditures, links the downloads page and names the file', async () => {
    await render();
    expect(mount.textContent).toContain(
      "Independent expenditures are money outside groups reported spending to support or oppose this candidate. This money does not go to the candidate's campaign.",
    );
    const link = mount.querySelector<HTMLAnchorElement>(
      'a[href="https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/"]',
    );
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('Minnesota’s campaign-finance downloads');
    expect(mount.textContent).toContain(
      'Source file: “Itemized independent expenditures of over $200”',
    );
  });
});
