// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));

vi.mock('react-native-svg', () => ({
  default: ({ children, ...props }: React.SVGProps<SVGSVGElement>) => (
    <svg {...props}>{children}</svg>
  ),
  Circle: (props: React.SVGProps<SVGCircleElement>) => <circle {...props} />,
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
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
  isBallot = false,
} = {}) {
  return (
    <DonorBreakdown
      payments={payments}
      split={split}
      year={2025}
      complete={complete}
      failed={failed}
      isBallot={isBallot}
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
  it('groups every candidate committee into one legend row rather than naming each', () => {
    const view = markup(breakdown());
    expect(view.textContent).toContain('Committees & Funds');
    expect(view.textContent).toContain('35 names');
    expect(view.textContent).not.toContain('Candidate Committee');
  });

  it('leaves the legend a list: no row is a control and none takes a tab stop', () => {
    const view = mount(breakdown());
    // Reaching a kind's names is the tab strip's job, directly below the legend (#2182).
    const legend = view.querySelectorAll(
      '[role="button"], button, a, [tabindex], [aria-label*="Open this contribution tab"]',
    );
    expect(legend).toHaveLength(0);
    // What a screen reader is handed for the picture, now that the rows carry nothing.
    const alt = view.querySelector('svg')!.getAttribute('aria-label')!;
    expect(alt).toContain('Who gave:');
    expect(alt).toContain('Committees & Funds');
    expect(alt).toMatch(/\d%/);
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
    expect(view.textContent).toContain('Who gave (named donations only)');
    expect(view.textContent).toContain(
      'Shares of the named donations this year, excluding donated goods and services.',
    );
    // No reported total here, so no non-itemized figure and nothing to define.
    expect(view.textContent).not.toContain('$200');
    expect(view.textContent).not.toContain('Itemized contributions list donor names');
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
    expect(view.textContent).toContain('Non-itemized contributions');
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
    expect(view.textContent?.match(/came as goods and services rather than money/g)).toHaveLength(
      1,
    );
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
  it.each([2, 12])('draws dividers only between the visible names in a %i-name list', (count) => {
    const groups = groupContributionPayments(
      Array.from({ length: count }, (_, index) => gift({ contributor: `Example ${index}` })),
    );
    const view = mount(list({ groups }));
    const paymentList = view.querySelector('[data-testid="payment-list-summary"]')!
      .nextElementSibling as HTMLElement;
    expect(getComputedStyle(paymentList).borderTopWidth).toBe('1px');
    expect(getComputedStyle(paymentList).borderTopColor).toBe('rgba(17, 21, 15, 0.08)');
    const expanders = [...view.querySelectorAll('[aria-label^="Show the "]')];
    const rows = expanders.map((button) => button.parentElement!.parentElement!);
    expect(rows).toHaveLength(Math.min(count, 10));
    for (const [index, row] of rows.entries()) {
      expect(getComputedStyle(row).borderTopWidth === '1px').toBe(index > 0);
      expect(getComputedStyle(row).borderBottomWidth).not.toBe('1px');
    }
    const button = [...view.querySelectorAll('[role="button"]')].find((node) =>
      node.textContent?.startsWith('Show the other'),
    );
    expect(Boolean(button)).toBe(count > 10);
    if (button) expect(getComputedStyle(button.parentElement!).gap).toBe('14px');
  });

  it('keeps a row employer and payment count at ordinary weight', () => {
    const view = mount(
      list({ groups: groupContributionPayments([gift({ employer: 'Twin Pines Insurance' })]) }),
    );
    const line = [...view.querySelectorAll('*')]
      .filter((node) => node.textContent === 'Twin Pines Insurance · 1 payment')
      .at(-1)!;
    expect(getComputedStyle(line).fontWeight).toBe('400');
  });

  it('keeps the 5 fixed tabs when empty without inventing an Other category', () => {
    const view = markup(list({ groups: [] }));
    const tabs = Array.from(view.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent);
    expect(tabs).toEqual([
      'Individuals 0',
      'Lobbyists 0',
      'Committees & Funds 0',
      'Party Units 0',
      'Expenditures 0',
    ]);
    expect(view.textContent).toContain('names no individual');
  });

  it('keeps Other kinds with the contribution tabs and Expenditures last', () => {
    const view = markup(
      list({ groups: groupContributionPayments([gift({ contributorType: 'Future kind' })]) }),
    );
    expect(Array.from(view.querySelectorAll('[role="tab"]'), (tab) => tab.textContent)).toEqual([
      'Individuals 0',
      'Lobbyists 0',
      'Committees & Funds 0',
      'Party Units 0',
      'Other kinds 1',
      'Expenditures 0',
    ]);
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
    expect(view.textContent).toContain('1 name · 2 payments');
    expect(view.textContent).toContain('Total itemized expenditures');
    click(view.querySelector('[aria-label="Show the 2 payments from Example Printer"]'));
    expect(view.textContent?.match(/Date not given in the public file/g)).toHaveLength(2);
    expect(view.textContent?.match(/Print leaflets/g)).toHaveLength(2);
    expect(view.textContent?.match(/Anoka, MN/g)).toHaveLength(2);
    expect(view.querySelector('a')).toBeNull();
  });

  it('labels real-sample printed names and payment rows separately', () => {
    const view = markup(list());
    expect(view.textContent).toContain('Individuals 74');
    expect(view.textContent).toContain('74 names · 82 payments');
    expect(view.textContent).toContain('Total itemized contributions');
  });

  it('does not print partial counts or totals while pages are missing', () => {
    const view = markup(list({ ready: false, failed: true }));
    expect(view.textContent).toContain('Totals and name counts are withheld');
    expect(view.textContent).not.toContain('74 names');
    expect(view.textContent).not.toContain('Individuals (');
    expect(view.textContent).not.toContain('Total itemized contributions');
  });

  it('keeps private names plain and gives known committees ordinary links', () => {
    const privateView = markup(list({ groups: groupContributionPayments([gift()]) }));
    expect(privateView.textContent).toContain('Amy Example');
    expect(privateView.textContent).toContain('1 name · 1 payment');
    expect(privateView.textContent).not.toContain('1 payments');
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
    const before = view.querySelector('[data-testid="payment-list-total"]')?.textContent;
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

  it('aligns the summary with payment amounts and washes it in the selected kind color', () => {
    const view = mount(
      list({
        groups: groupContributionPayments([gift({ inKind: 'Yes' })]),
      }),
    );
    const summary = view.querySelector<HTMLElement>('[data-testid="payment-list-summary"]')!;
    const total = view.querySelector<HTMLElement>('[data-testid="payment-list-total"]')!;
    expect(getComputedStyle(summary).backgroundColor).toBe('rgba(20, 157, 91, 0.12)');
    expect(getComputedStyle(summary).borderWidth).toBe('0px');
    expect(getComputedStyle(summary).borderTopLeftRadius).toBe('10px');
    expect(getComputedStyle(summary).paddingLeft).toBe('14px');
    expect(getComputedStyle(summary).paddingRight).toBe('70px');
    expect(getComputedStyle(total).fontWeight).toBe('800');
    expect(view.textContent).toContain('of which $100 goods and services');
    expect(total.textContent).toBe('$100');
  });

  it('uses the quiet neutral wash for expenditure totals', () => {
    const expenditures = mount(
      list({
        groups: groupExpenditurePayments([
          {
            vendorName: 'Example Printer',
            vendorCity: null,
            vendorState: null,
            affectedCommitteeName: null,
            affectedCommitteeRegistrationNumber: null,
            amount: '75.00',
            paidOn: '2025-01-10',
            expenditureType: 'Campaign Expenditure',
            purpose: null,
            inKind: 'No',
          },
        ]),
        tab: 'expenditures',
      }),
    );
    expect(
      getComputedStyle(
        expenditures.querySelector<HTMLElement>('[data-testid="payment-list-summary"]')!,
      ).backgroundColor,
    ).toBe('rgba(79, 86, 81, 0.12)');
  });

  it('keeps missing-name rows readable without counting a person', () => {
    const view = markup(list({ groups: groupContributionPayments([gift({ contributor: null })]) }));
    expect(view.textContent).toMatch(/0 names · 1 payment/);
    expect(view.textContent).toContain('Name not given in the filing');
  });
});

describe('the accepted names-section controls', () => {
  it('uses one tab stop and keeps a visible underline while arrow keys move through tabs', () => {
    function InteractiveList() {
      const [tab, setTab] = React.useState<MoneyDetailsTab>('individuals');
      return (
        <DonorPaymentList
          groups={groupContributionPayments([
            ...realPayments,
            gift({ contributorType: 'Future kind' }),
          ])}
          tab={tab}
          year={2025}
          ready
          failed={false}
          onSelectTab={setTab}
          onRetry={vi.fn()}
        />
      );
    }
    const view = mount(<InteractiveList />);
    const tabs = Array.from(view.querySelectorAll<HTMLElement>('[role="tab"]'));
    const expectChosen = (index: number) => {
      expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([tabs[index]]);
      expect(tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true')).toEqual([
        tabs[index],
      ]);
      expect(getComputedStyle(tabs[index]).borderBottomWidth).toBe('3px');
      expect(getComputedStyle(tabs[index]).borderBottomColor).toBe('rgb(17, 21, 15)');
    };
    expectChosen(0);
    expect(tabs[0].textContent).toBe('Individuals 74');
    expect(tabs[4].textContent).toBe('Other kinds 1');
    expect(tabs[5].textContent).toBe('Expenditures 0');
    expect(getComputedStyle(view.querySelector('[role="tablist"]')!).flexWrap).toBe('nowrap');
    const scroll = vi.fn();
    tabs[1].scrollIntoView = scroll;
    act(() =>
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    );
    expectChosen(1);
    expect(document.activeElement).toBe(tabs[1]);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    act(() => tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expectChosen(tabs.length - 1);
    act(() =>
      tabs
        .at(-1)!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    );
    expectChosen(0);
    act(() =>
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })),
    );
    expectChosen(tabs.length - 1);
    act(() =>
      tabs.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })),
    );
    expectChosen(0);
  });

  it('keeps the employer and singular payment count in one quiet second line', () => {
    const view = mount(
      list({ groups: groupContributionPayments([gift({ employer: 'Self Employed' })]) }),
    );
    const details = Array.from(view.querySelectorAll('div')).find(
      (element) => element.textContent === 'Self Employed · 1 payment',
    );
    expect(details).toBeDefined();
    expect(getComputedStyle(details!).fontSize).toBe('15px');
    expect(['400', 'normal']).toContain(getComputedStyle(details!).fontWeight);
    expect(getComputedStyle(details!).color).toBe('rgb(107, 113, 107)');
    const expand = view.querySelector<HTMLElement>(
      '[aria-label="Show the 1 payment from Amy Example"]',
    )!;
    expect(expand.textContent).not.toMatch(/[+−]/);
    expect(expand.querySelector('svg')).not.toBeNull();
    expect(getComputedStyle(expand).width).toBe('44px');
    click(expand);
    expect(expand.getAttribute('aria-expanded')).toBe('true');
    expect(view.textContent).toContain('Jan 10, 2025');
  });

  it('prints a committee name with no available page as plain text', () => {
    const committee = realGroups.find((group) => group.linkableRegistrationNumber)!;
    const view = markup(
      list({ groups: [{ ...committee, linkableRegistrationNumber: null }], tab: committee.tab }),
    );
    expect(view.textContent).toContain(committee.name);
    expect(view.querySelector('a')).toBeNull();
  });

  it('marks the chosen sort with a check independently of keyboard focus and closes with Escape', () => {
    const view = mount(list());
    const button = view.querySelector<HTMLElement>('[aria-haspopup="menu"]')!;
    click(button);
    const options = Array.from(view.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    expect(options[0].querySelector('path[stroke="#0f7a45"]')).not.toBeNull();
    act(() =>
      options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    );
    expect(document.activeElement).toBe(options[1]);
    expect(options[0].querySelector('path[stroke="#0f7a45"]')).not.toBeNull();
    expect(options[1].querySelector('svg')).toBeNull();
    act(() =>
      options[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(view.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button);
    click(button);
    click(view.querySelectorAll('[role="menuitem"]')[1]);
    expect(button.textContent).toBe('Smallest first');
  });
});
