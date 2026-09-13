// @vitest-environment jsdom
/** A new year may unmount the cards while it loads; reader preferences survive that gap. */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock(
  '../../../hooks/useCampaignMoneyYearStates',
  () => import('../../../hooks/useCampaignMoneyDetails'),
);

vi.mock('../MoneyDetailsOnDemand', () => import('../MoneyDetailsBundle'));

vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
  Path: () => <path />,
}));
const outsideQuery = vi.hoisted(() => ({
  data: [] as import('../../../lib/outsideSpending').OutsideSpendingYear[],
  isLoading: false,
  isError: false,
  dataUpdatedAt: 0,
  refetch: vi.fn(),
}));
const refetchMoney = vi.hoisted(() => vi.fn());
const groupRead = vi.hoisted(() => ({
  data: undefined as
    import('../../../data/groupedOutsideSpending').GroupedOutsideSpending | undefined,
}));
vi.mock('../../../hooks/useAppQueries', () => ({
  useLegislatorOutsideSpending: () => outsideQuery,
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey[0] === 'campaign-money-outside-groups' ? groupRead.data : undefined,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('../../../hooks/useCampaignMoneyDetails', () => ({
  useCampaignMoneyYearStates: () => ({ data: [] }),
  useCampaignMoneyDetails: (registration: string, year: number) => ({
    received: {
      data: {
        state: 'reported',
        releaseId: 'release',
        linkableRegistrationNumbers: [],
        payments: Array.from({ length: 12 }, (_, index) => ({
          contributor: `Group ${registration} ${String(index + 1).padStart(2, '0')}`,
          contributorRegistrationNumber: null,
          contributorType: 'Political Committee/Fund',
          employer: null,
          amount: '100.00',
          receivedOn: `${year}-01-${String(index + 1).padStart(2, '0')}`,
          receiptType: 'Contribution',
          inKind: 'No',
        })),
      },
      isSuccess: true,
      isError: false,
      refetch: vi.fn(),
    },
    made: {
      data: {
        state: 'reported',
        releaseId: 'release',
        payments: [],
        linkableRegistrationNumbers: [],
      },
      isSuccess: true,
      isError: false,
      refetch: vi.fn(),
    },
    selectedComplete: true,
    releaseMismatch: false,
    historyComplete: false,
    history: { data: undefined },
  }),
}));

import type { CampaignCommitteeMoney, LegislatorCampaignMoney } from '../../../data/types';
import { CampaignMoneyTab } from '../CampaignMoneyTab';
import { moneyDetailsCopy } from '../../../lib/campaignMoneyDetailsCopy';
import {
  confirmedCommitteesWithheldLine,
  confirmedElsewhereExplanation,
  LINK_UNCONFIRMED_EXPLANATION,
  otherOfficeNote,
} from '../../../lib/legislatorCampaignMoney';
import {
  outsideSpenderFigures,
  outsideSpenderIdentity,
  outsideSpenderKey,
  type OutsideSpenderGroup,
} from '../../../lib/groupedOutsideSpending';
import type { OutsideSpendingYear } from '../../../lib/outsideSpending';

function setOutside(overrides: Partial<OutsideSpendingYear> = {}) {
  outsideQuery.data = [
    {
      year: 2025,
      state: 'reported',
      snapshotId: 'outside-release',
      currentClaim: { servedAgeMs: 0, validatedAt: new Date().toISOString() },
      committees: [{ registrationNumber: '17868', name: 'Committee 17868', office: 'Senate' }],
      supporting: 100,
      opposing: 0,
      directionNotRecorded: 0,
      supportingPayments: 1,
      opposingPayments: 0,
      directionNotRecordedPayments: 0,
      firstPaymentOn: '2025-01-01',
      lastPaymentOn: '2025-01-01',
      sourceUrl: 'https://cfb.mn.gov/reports-and-data/',
      fetchedAt: '2026-09-12T10:00:00Z',
      ...overrides,
    },
  ];
  outsideQuery.dataUpdatedAt = Date.now();
  const identity = outsideSpenderIdentity('900', 'Outside Example Fund');
  const groups: OutsideSpenderGroup[] = [
    {
      key: outsideSpenderKey(identity, 'For'),
      identity,
      name: 'Outside Example Fund',
      registrationNumber: '900',
      linkable: true,
      groupingBasis: 'registration_number',
      direction: 'For',
      amount: '100',
      paymentCount: 1,
      aboutRegistrationNumbers: ['17868'],
    },
  ];
  groupRead.data = {
    year: 2025,
    snapshotId: 'outside-release',
    releaseId: 'release',
    groups,
    figures: outsideSpenderFigures(groups),
    aboutPaymentCounts: { '17868': 1 },
  };
}

function committee(registration: string): CampaignCommitteeMoney {
  return {
    registrationNumber: registration,
    committeeName: `Committee ${registration}`,
    committeeNameAsReviewed: `Committee ${registration}`,
    office: 'Senate',
    checked: null,
    moneyIn: null,
    moneyOut: null,
    split: {
      state: 'no_reported_total',
      reportedTotal: null,
      reportedThrough: null,
      namedTotal: '1200.00',
      namedPayments: 12,
      namedCashTotal: '1200.00',
      namedInKindTotal: '0.00',
      unnamedTotal: null,
      statedSplitState: 'not_checked',
      firstPaymentOn: null,
      lastPaymentOn: null,
    },
    filingSchedule: {
      state: 'calendar_not_transcribed',
      nextReportName: null,
      nextReportDueOn: null,
      periodStart: null,
      periodEnd: null,
      condition: null,
      terminatedOn: null,
    },
  };
}
function data(year: number, registrations = ['17868']): LegislatorCampaignMoney {
  return {
    legislatorId: 'sample',
    year,
    linkState: 'confirmed',
    releaseId: 'release',
    currentClaim: { servedAgeMs: 0, validatedAt: new Date().toISOString() },
    committees: registrations.map(committee),
    committeesOutsideThisYear: [],
    otherOfficeCommittees: 0,
    fetchedAt: '2026-09-12T10:00:00Z',
  };
}
let root: Root | undefined;
let container: HTMLDivElement;
function render(year: number, money: LegislatorCampaignMoney | undefined, isError = false) {
  if (!root) {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() =>
    root!.render(
      <CampaignMoneyTab
        legislatorName="Sample member"
        legislatorId="sample"
        year={year}
        onSelectYear={vi.fn()}
        money={money}
        isLoading={!money}
        isError={isError}
        moneyUpdatedAt={money ? Date.now() : undefined}
        refetchMoney={refetchMoney}
        isDesktop
        onOpenSource={vi.fn()}
      />,
    ),
  );
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
  outsideQuery.data = [];
  groupRead.data = undefined;
  vi.clearAllMocks();
});
function list(index = 0): HTMLElement {
  const tabs = container.querySelectorAll(
    '[role="tablist"][aria-label="Contribution kinds and expenditures"]',
  );
  expect(tabs[index]).toBeDefined();
  return tabs[index].parentElement!;
}
function click(target: Element | undefined | null) {
  expect(target).toBeTruthy();
  act(() => target!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
function chooseTab(scope: HTMLElement, label: string) {
  click(
    Array.from(scope.querySelectorAll('[role="tab"]')).find((tab) =>
      tab.textContent?.startsWith(label),
    ),
  );
}
function chooseSort(scope: HTMLElement, label: string) {
  click(scope.querySelector('[aria-label^="Sort names, currently"]'));
  click(
    Array.from(scope.querySelectorAll('[role="menuitem"]')).find(
      (item) => item.textContent === label,
    ),
  );
}
function selectedTab(scope: HTMLElement) {
  return scope.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
}
function selectedSort(scope: HTMLElement) {
  return scope.querySelector('[aria-label^="Sort names, currently"]')?.getAttribute('aria-label');
}

describe('reader choices across a campaign-money year change', () => {
  it.each([false, true])(
    'withholds expired ownership statements for an empty year and other races (failed recheck: %s)',
    (failedRecheck) => {
      const cached = data(2023, []);
      cached.committeesOutsideThisYear = [
        { registrationNumber: '17868', committeeNameAsReviewed: 'Committee 17868', closedOn: null },
      ];
      cached.otherOfficeCommittees = 2;
      const confirmedElsewhere = confirmedElsewhereExplanation(
        2023,
        cached.committeesOutsideThisYear,
      );
      const otherRace = otherOfficeNote(2)!;

      render(2023, cached);
      expect(container.textContent).toContain(confirmedElsewhere);
      expect(container.textContent).toContain(otherRace);

      cached.currentClaim.servedAgeMs = 21 * 60 * 1000;
      render(2023, cached, failedRecheck);
      expect(container.textContent).toContain(confirmedCommitteesWithheldLine('Sample member'));
      expect(container.textContent).not.toContain(confirmedElsewhere);
      expect(container.textContent).not.toContain(otherRace);
    },
  );

  it.each(['unconfirmed', 'reviewed_none_confirmed'] as const)(
    'keeps the %s panel distinct from an expired positive match',
    (linkState) => {
      const cached = data(2023, []);
      cached.linkState = linkState;
      cached.currentClaim.servedAgeMs = 21 * 60 * 1000;
      render(2023, cached);
      expect(container.textContent).toContain(LINK_UNCONFIRMED_EXPLANATION);
      expect(container.textContent).not.toContain(confirmedCommitteesWithheldLine('Sample member'));
    },
  );

  it('withholds an expired committee match even when failed refreshes leave cached figures', () => {
    const cached = data(2025);
    cached.currentClaim.servedAgeMs = 21 * 60 * 1000;
    render(2025, cached, true);
    expect(
      container.querySelector('[role="tablist"][aria-label="Contribution kinds and expenditures"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain('Committee 17868');
    expect(container.textContent).not.toContain('Group 17868');
    expect(container.textContent).toContain('not showing');
  });

  it('keeps the chosen tab and order after an uncached year removes the cards, while clearing temporary list state', () => {
    render(2025, data(2025));
    chooseTab(list(), 'Committees & Funds');
    chooseSort(list(), 'Newest first');
    const input = list().querySelector('input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Group',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(
      Array.from(list().querySelectorAll('[role="button"]')).find((button) =>
        button.textContent?.startsWith('Show the other'),
      ),
    );
    expect(list().querySelectorAll('[aria-label^="Show the "]')).toHaveLength(12);
    click(list().querySelector('[aria-label="Show the 1 payment from Group 17868 12"]'));
    expect(list().querySelector('[aria-label^="Hide the "]')).not.toBeNull();
    click(list().querySelector('[aria-label^="Sort names, currently"]'));
    expect(list().querySelector('[role="menu"]')).not.toBeNull();

    render(2024, undefined);
    expect(container.textContent).toContain('Loading campaign money');
    expect(
      container.querySelector('[role="tablist"][aria-label="Contribution kinds and expenditures"]'),
    ).toBeNull();
    render(2024, data(2024));

    expect(selectedTab(list())).toBe('Committees & Funds (12)');
    expect(selectedSort(list())).toContain('Newest first');
    expect(list().querySelector('input')?.value).toBe('');
    expect(list().querySelector('[role="menu"]')).toBeNull();
    expect(list().querySelector('[aria-label^="Hide the "]')).toBeNull();
    expect(list().querySelectorAll('[aria-label^="Show the "]')).toHaveLength(10);
    expect(list().textContent).toContain('Show the other 2 names');
  });

  it('stores choices per committee rather than giving every card the most recent choice', () => {
    render(2025, data(2025, ['17868', '18430']));
    chooseTab(list(0), 'Committees & Funds');
    chooseSort(list(0), 'Newest first');
    chooseTab(list(1), 'Expenditures');
    chooseSort(list(1), 'Oldest first');
    expect(selectedTab(list(0))).toBe('Committees & Funds (12)');
    expect(selectedSort(list(0))).toContain('Newest first');
    expect(selectedTab(list(1))).toBe('Expenditures (0)');
    expect(selectedSort(list(1))).toContain('Oldest first');

    render(2024, undefined);
    // Reverse the returned order to prove the saved choices follow registration, not position.
    render(2024, data(2024, ['18430', '17868']));
    expect(selectedTab(list(0))).toBe('Expenditures (0)');
    expect(selectedSort(list(0))).toContain('Oldest first');
    expect(selectedTab(list(1))).toBe('Committees & Funds (12)');
    expect(selectedSort(list(1))).toContain('Newest first');
  });
});

describe('independent outside-money confirmation and shared download dates', () => {
  it('withholds outside spender names when only the outside ownership confirmation has expired', () => {
    setOutside({
      currentClaim: { servedAgeMs: 21 * 60 * 1000, validatedAt: new Date().toISOString() },
    });
    render(2025, data(2025));
    // Own-money ownership is fresh, so that committee remains readable.
    expect(container.textContent).toContain('Committee 17868');
    expect(container.textContent).not.toContain('Outside Example Fund');
    expect(container.querySelector('a[href*="outside-example-fund"]')).toBeNull();
    expect(container.textContent).not.toContain('Spent supporting them');
  });

  it('shows the outside group and direction summary while its own ownership check is fresh', () => {
    setOutside();
    render(2025, data(2025));
    expect(container.textContent).toContain('Spending by Outside Groups');
    expect(container.textContent).toContain('Outside Example Fund');
    expect(container.textContent).toContain('Spent supporting them');
  });

  it('does not assign one download date to records copied on different days, and retries both reads', () => {
    setOutside({ fetchedAt: '2026-09-11T10:00:00Z' });
    render(2025, data(2025));
    expect(container.textContent).toContain(moneyDetailsCopy.freshnessMismatch);
    expect(container.textContent).not.toContain('We last downloaded Minnesota');
    expect(container.textContent).not.toContain('Copied from the state on');
    click(
      Array.from(container.querySelectorAll('[role="button"]')).find(
        (button) => button.textContent === 'Check these records again',
      ),
    );
    expect(refetchMoney).toHaveBeenCalledTimes(1);
    expect(outsideQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it('dates the payment files once without assigning that date to report totals', () => {
    setOutside();
    render(2025, data(2025));
    expect(container.textContent?.match(/We last downloaded Minnesota/g)).toHaveLength(1);
    expect(container.textContent).toContain('Minnesota’s payment files');
    expect(container.textContent).toContain('The report totals are copied separately');
    expect(container.textContent).toContain('not the period the money covers');
    expect(container.textContent).not.toContain(moneyDetailsCopy.freshnessMismatch);
    expect(container.textContent).not.toContain('Check these records again');
    expect(container.textContent).not.toContain('Copied from the state on');
  });
});
