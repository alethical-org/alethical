// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));

vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
}));

import { committeePaymentsReceivedFromPayload } from '../../../data/api';
import fixture from '../../../lib/__tests__/fixtures/campaign-money-17868-2025.json';
import {
  groupContributionPayments,
  groupExpenditurePayments,
  type DetailedReceivedPayment,
  type MoneyDetailsTab,
} from '../../../lib/campaignMoneyDetails';
import { splitExplanation, type SplitState } from '../../../lib/legislatorCampaignMoney';
import { DonorBreakdown } from '../DonorBreakdown';
import { DonorPaymentList } from '../DonorPaymentList';

const realPayments = committeePaymentsReceivedFromPayload(fixture.data).payments;
const realGroups = groupContributionPayments(
  realPayments,
  fixture.data.linkable_registration_numbers,
);
const gift = (patch: Partial<DetailedReceivedPayment> = {}): DetailedReceivedPayment => ({
  contributor: 'Amy Example',
  contributorRegistrationNumber: null,
  contributorType: 'Individual',
  employer: 'Retired',
  amount: '100.00',
  receivedOn: '2025-01-10',
  receiptType: 'Contribution',
  inKind: 'No',
  ...patch,
});
const namedSplit: React.ComponentProps<typeof DonorBreakdown>['split'] = {
  state: 'no_reported_total' as SplitState,
  reportedTotal: null,
  namedCashTotal: null,
  namedInKindTotal: null,
  unnamedTotal: null,
};
function markup(node: React.ReactNode) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(node);
  return container;
}
function breakdown({
  payments = realPayments,
  split = namedSplit,
  complete = true,
  failed = false,
} = {}) {
  return (
    <DonorBreakdown
      payments={payments}
      split={split}
      year={2025}
      complete={complete}
      failed={failed}
      onSelectTab={vi.fn()}
    />
  );
}
function list({
  groups = realGroups,
  tab = 'individuals' as MoneyDetailsTab,
  ready = true,
  failed = false,
} = {}) {
  return (
    <DonorPaymentList
      groups={groups}
      tab={tab}
      year={2025}
      ready={ready}
      failed={failed}
      onSelectTab={vi.fn()}
      onRetry={vi.fn()}
    />
  );
}
let root: Root | undefined;
let mounted: HTMLDivElement | undefined;
function mount(node: React.ReactNode) {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mounted = document.createElement('div');
  document.body.appendChild(mounted);
  root = createRoot(mounted);
  act(() => root!.render(node));
  return mounted;
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  mounted?.remove();
  root = undefined;
  mounted = undefined;
});
function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  act(() => element!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('the donor chart explains what its cash shares represent', () => {
  it('opens the combined committee tab from the combined cash slice', () => {
    const onSelect = vi.fn();
    const view = mount(
      <DonorBreakdown
        payments={realPayments}
        split={namedSplit}
        year={2025}
        complete
        failed={false}
        onSelectTab={onSelect}
      />,
    );
    const button = view.querySelector('[aria-label^="Committees & Funds, 35 names, $16,550"]');
    click(button);
    expect(onSelect).toHaveBeenCalledWith('committees');
    expect(view.querySelector('[aria-label^="Candidate Committee,"]')).toBeNull();
  });

  it('does not describe an unnamed slice when the reported total is entirely named', () => {
    const view = markup(
      breakdown({
        payments: [gift()],
        split: {
          ...namedSplit,
          state: 'shown',
          reportedTotal: '100.00',
          namedCashTotal: '100.00',
          unnamedTotal: '0.00',
        },
      }),
    );
    expect(view.querySelector('svg')).not.toBeNull();
    expect(view.textContent).not.toContain('last slice');
    expect(view.textContent).not.toContain('Non-itemized contributions');
  });

  it('opens the matching list when the reader selects a named chart category', () => {
    const onSelect = vi.fn();
    const view = mount(
      <DonorBreakdown
        payments={[gift()]}
        split={namedSplit}
        year={2025}
        complete
        failed={false}
        onSelectTab={onSelect}
      />,
    );
    click(view.querySelector('[aria-label*="Open this contribution tab"]'));
    expect(onSelect).toHaveBeenCalledWith('individuals');
  });

  it('does not draw the chart or its percentages before every donation page arrives', () => {
    for (const failed of [false, true]) {
      const view = markup(breakdown({ complete: false, failed }));
      expect(view.querySelector('svg')).toBeNull();
      expect(view.textContent).not.toMatch(/\d%/);
      expect(view.textContent).toContain(failed ? 'chart is withheld' : 'Loading');
    }
  });

  it('draws the real sample as named cash only when no official total is held', () => {
    const view = markup(breakdown());
    expect(view.querySelector('svg')).not.toBeNull();
    expect(view.textContent).toContain('named donations only');
    expect(view.textContent).toContain('named cash donations');
    expect(view.querySelectorAll('circle').length).toBeGreaterThan(0);
  });

  it('draws unnamed cash against the reported base without inventing named donors', () => {
    const view = markup(
      breakdown({
        payments: [gift()],
        split: {
          ...namedSplit,
          state: 'shown',
          reportedTotal: '200.00',
          namedCashTotal: '100.00',
          unnamedTotal: '100.00',
        },
      }),
    );
    expect(view.querySelector('svg')).not.toBeNull();
    expect(view.textContent).toContain('50%');
    expect(view.textContent).toContain('1 name');
    // The unnamed half has no button promising a list of identifiable donors.
    expect(view.querySelectorAll('[aria-label*="Open this contribution tab"]')).toHaveLength(1);
  });

  it.each<SplitState>([
    'periods_differ',
    'sources_disagree',
    'no_named_payments',
    'named_payments_not_in_our_copy',
    'reported_total_predates_a_correction',
    'figures_do_not_line_up',
  ])('retains the evidence-specific explanation for %s', (state) => {
    for (const payments of [realPayments, []]) {
      const view = markup(breakdown({ payments, split: { ...namedSplit, state } }));
      expect(view.querySelector('svg')).toBeNull();
      expect(view.textContent).toContain(splitExplanation(state));
      expect(view.textContent).not.toContain('names no donor for this committee');
    }
  });

  it('distinguishes an empty named list from a reported zero', () => {
    const view = markup(breakdown({ payments: [] }));
    expect(view.querySelector('svg')).toBeNull();
    expect(view.textContent).toContain('names no donor');
    expect(view.textContent).not.toContain('$0');
  });

  it('keeps goods out of cash shares and gives the goods explanation once', () => {
    const view = markup(
      breakdown({
        payments: [gift({ inKind: 'Yes' })],
        split: {
          ...namedSplit,
          namedCashTotal: '0.00',
          namedInKindTotal: '100.00',
        },
      }),
    );
    expect(view.querySelector('svg')).toBeNull();
    expect(view.textContent).not.toContain('$0');
    expect(view.textContent?.match(/were goods and services rather than money/g)).toHaveLength(1);
  });

  it('withholds a cash chart whose complete rows do not match the served named amount', () => {
    const view = markup(
      breakdown({ payments: [gift()], split: { ...namedSplit, namedCashTotal: '99.00' } }),
    );
    expect(view.querySelector('svg')).toBeNull();
    expect(view.textContent).toContain('cannot draw this breakdown');
  });
});

describe('the donor list preserves the complete filed record', () => {
  it('keeps the 5 fixed tabs when empty without inventing an Other category', () => {
    const view = markup(list({ groups: [] }));
    const tabs = Array.from(view.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent);
    expect(tabs).toEqual([
      'Individuals (0)',
      'Lobbyists (0)',
      'Committees & Funds (0)',
      'Party Units (0)',
      'Expenditures (0)',
    ]);
    expect(view.textContent).toContain('names no individual');
  });

  it('opens all remaining real-sample groups without changing the complete counts', () => {
    const view = mount(list());
    expect(view.querySelectorAll('[aria-label^="Show the "]')).toHaveLength(10);
    const showRest = Array.from(view.querySelectorAll('[role="button"]')).find((button) =>
      button.textContent?.startsWith('Show the other'),
    );
    click(showRest);
    expect(view.querySelectorAll('[aria-label^="Show the "]')).toHaveLength(74);
    expect(view.textContent).toContain('74 names · 82 payments');
  });

  it('keeps duplicate payments out and shows their filed details on expansion', () => {
    const payment = {
      vendorName: 'Example Printer',
      vendorCity: 'Anoka',
      vendorState: 'MN',
      affectedCommitteeName: null,
      affectedCommitteeRegistrationNumber: null,
      amount: '75.00',
      paidOn: null,
      expenditureType: 'Campaign Expenditure',
      purpose: 'Print leaflets',
      inKind: 'No',
    };
    const view = mount(
      list({ groups: groupExpenditurePayments([payment, payment]), tab: 'expenditures' }),
    );
    expect(view.textContent).toContain('2 payments');
    expect(view.textContent).toContain('Total of listed payments in this tab:');
    click(view.querySelector('[aria-label="Show the 2 payments from Example Printer"]'));
    expect(view.textContent?.match(/Date not given in the public file/g)).toHaveLength(2);
    expect(view.textContent?.match(/Print leaflets/g)).toHaveLength(2);
    expect(view.textContent?.match(/Anoka, MN/g)).toHaveLength(2);
    expect(view.querySelector('a')).toBeNull();
  });

  it('labels real-sample printed names and payment rows separately', () => {
    const view = markup(list());
    expect(view.textContent).toContain('Individuals (74)');
    expect(view.textContent).toContain('74 names · 82 payments');
    expect(view.textContent).toContain('Named total in this tab:');
  });

  it('does not print partial counts or totals while pages are missing', () => {
    const view = markup(list({ ready: false, failed: true }));
    expect(view.textContent).toContain('Totals and name counts are withheld');
    expect(view.textContent).not.toContain('74 names');
    expect(view.textContent).not.toContain('Individuals (');
    expect(view.textContent).not.toContain('Named total in this tab:');
  });

  it('keeps private names plain and gives known committees ordinary links', () => {
    const privateView = markup(list({ groups: groupContributionPayments([gift()]) }));
    expect(privateView.textContent).toContain('Amy Example');
    expect(privateView.querySelector('a')).toBeNull();
    const publicView = markup(list({ tab: 'committees' }));
    const known = Array.from(publicView.querySelectorAll('a')).find(
      (a) => a.textContent === 'Bakk Thomas M Gov Committee',
    );
    expect(known).toBeDefined();
    expect(new URL(known!.getAttribute('href')!, 'https://www.alethical.com').pathname).toMatch(
      /^\/money\/committees\/.*-16775$/,
    );
  });

  it('preserves identical gifts and distinct spellings when opening a group', () => {
    const groups = groupContributionPayments([
      gift(),
      gift(),
      gift({ contributor: 'Amy R Example' }),
    ]);
    const view = mount(list({ groups }));
    expect(view.textContent).toContain('2 names · 3 payments');
    click(view.querySelector('[aria-label="Show the 2 payments from Amy Example"]'));
    expect(view.textContent?.match(/Jan 10, 2025/g)).toHaveLength(2);
    expect(view.querySelector('[aria-expanded="true"]')).not.toBeNull();
  });

  it('keeps the whole-tab count and amount when search narrows the visible groups', () => {
    const groups = groupContributionPayments([
      gift(),
      gift({ contributor: 'Beth Example', amount: '200.00' }),
    ]);
    const view = mount(list({ groups }));
    const before = view.textContent?.match(/Named total in this tab: [^A-Za-z]+/)?.[0];
    const input = view.querySelector('input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Amy');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(view.textContent).toContain('2 names · 2 payments');
    expect(view.textContent).toContain(before);
    expect(view.textContent).toContain('Amy Example');
    expect(view.textContent).not.toContain('Beth Example');
  });

  it('keeps missing-name rows readable without counting a person', () => {
    const view = markup(list({ groups: groupContributionPayments([gift({ contributor: null })]) }));
    expect(view.textContent).toMatch(/0 names · 1 payment/);
    expect(view.textContent).toContain('Name not given in the filing');
  });
});
