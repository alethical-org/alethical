// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { CampaignCommitteeMoney, LegislatorCampaignMoney } from '../../../data/types';
import { CampaignMoneyTab } from '../CampaignMoneyTab';
import { CURRENT_CLAIM_MAX_AGE_MS } from '../../../lib/currentClaimFreshness';
import { refundFixture } from './refundFixtures';

vi.mock('../MoneyDetailsOnDemand', () => import('../MoneyDetailsBundle'));

vi.mock(
  '../../../hooks/useCampaignMoneyYearStates',
  () => import('../../../hooks/useCampaignMoneyDetails'),
);

vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
  Path: () => <path />,
}));
vi.mock('../../../hooks/useAppQueries', () => ({
  useLegislatorOutsideSpending: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock('../../../hooks/useCampaignMoneyDetails', () => ({
  useCampaignMoneyYearStates: () => ({ data: [] }),
  useCampaignMoneyDetails: () => ({
    received: { data: undefined, isSuccess: false, isError: false },
    made: { data: undefined, isSuccess: false, isError: false },
    selectedComplete: false,
    historyComplete: false,
    history: { data: undefined },
    releaseMismatch: false,
  }),
}));
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server');

// Ownership is synthetic here. The refund blocks retain each real committee's figures;
// this combined response tests separation, not a claim that both belong to one person.
function committee(registration: '17868' | '15667'): CampaignCommitteeMoney {
  return {
    registrationNumber: registration,
    committeeNameAsReviewed: `Fixture Senate committee ${registration}`,
    committeeName: `Fixture Senate committee ${registration}`,
    office: 'Senate',
    registerKind: 'candidate_committee',
    checked: null,
    moneyIn: null,
    moneyOut: null,
    refunds: refundFixture(registration),
    split: {
      state: 'no_reported_total',
      reportedTotal: null,
      reportedThrough: null,
      namedTotal: null,
      namedPayments: null,
      namedCashTotal: null,
      namedInKindTotal: null,
      unnamedTotal: null,
      statedSplitState: 'not_checked',
      firstPaymentOn: null,
      lastPaymentOn: null,
    },
    filingSchedule: {
      state: 'filings_cannot_answer',
      nextReportName: null,
      nextReportDueOn: null,
      periodStart: null,
      periodEnd: null,
      condition: null,
      terminatedOn: null,
    },
  };
}
function outsideCommittee(registration: '17868' | '15667') {
  return {
    registrationNumber: registration,
    committeeNameAsReviewed: `Fixture Senate committee ${registration}`,
    closedOn: null,
    refunds: refundFixture(registration),
  };
}
function money(overrides: Partial<LegislatorCampaignMoney> = {}): LegislatorCampaignMoney {
  return {
    legislatorId: 'fixture-member',
    year: 2025,
    linkState: 'confirmed',
    currentClaim: { servedAgeMs: 0, validatedAt: '2026-09-12T12:00:00Z' },
    committees: [committee('17868'), committee('15667')],
    committeesOutsideThisYear: [],
    otherOfficeCommittees: 0,
    fetchedAt: '2026-09-12T12:00:00Z',
    ...overrides,
  };
}
function render(options: {
  money?: LegislatorCampaignMoney;
  year?: 2025 | 2026;
  isLoading?: boolean;
  isError?: boolean;
  moneyUpdatedAt?: number;
}) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <CampaignMoneyTab
      legislatorName="Fixture member"
      legislatorId="fixture-member"
      year={options.year ?? 2025}
      onSelectYear={vi.fn()}
      money={options.money}
      isLoading={options.isLoading ?? false}
      isError={options.isError ?? false}
      moneyUpdatedAt={options.moneyUpdatedAt ?? Date.now()}
      refetchMoney={vi.fn()}
      isDesktop
      onOpenSource={vi.fn()}
    />,
  );
  return container;
}
function refundCards(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[data-testid$="-refunds"]')];
}
function assertSeparatedCards(container: HTMLElement) {
  const cards = refundCards(container);
  expect(cards).toHaveLength(2);
  const html = container.innerHTML;
  for (const registration of ['17868', '15667']) {
    const card = container.querySelector<HTMLElement>(
      `[data-testid="committee-${registration}-refunds"]`,
    )!;
    expect(card).not.toBeNull();
    expect(card.querySelector('[data-testid$="-refunds"]')).toBeNull();
    // Its own committee is named above it and outside spending sits below every block,
    // whether or not that committee's year-by-year chart has arrived between the 2.
    expect(html.indexOf(`Fixture Senate committee ${registration}`)).toBeLessThan(
      html.indexOf(card.outerHTML),
    );
    expect(html.indexOf(card.outerHTML)).toBeLessThan(html.indexOf('Spending by outside groups'));
  }
  expect(cards[0].textContent).toContain('$14,216');
  expect(cards[0].textContent).not.toContain('$1,448');
  expect(cards[1].textContent).toContain('$1,448');
  expect(cards[1].textContent).not.toContain('$14,216');
}

describe('refund history on the Campaign money tab', () => {
  it('places each refund card after its own committee and before outside spending', () => {
    assertSeparatedCards(render({ money: money() }));
  });

  it('keeps the same all-year refund history when the selected campaign year changes', () => {
    const first = refundCards(render({ money: money(), year: 2025 })).map(
      (card) => card.textContent,
    );
    const next = refundCards(render({ money: money({ year: 2026 }), year: 2026 })).map(
      (card) => card.textContent,
    );
    expect(next).toEqual(first);
    expect(next[0]).toContain('2021');
    expect(next[0]).toContain('$4,158');
  });

  it.each([false, true])(
    'keeps confirmed outside-year histories when the request error is %s',
    (isError) => {
      const container = render({
        money: money({
          committees: [],
          committeesOutsideThisYear: [outsideCommittee('17868'), outsideCommittee('15667')],
        }),
        isError,
      });
      assertSeparatedCards(container);
      expect(container.textContent).toContain('Nothing reported for 2025');
    },
  );

  it.each([false, true])(
    'keeps both active and outside-year committees when the request error is %s',
    (isError) => {
      const container = render({
        money: money({
          committees: [committee('17868')],
          committeesOutsideThisYear: [outsideCommittee('15667')],
        }),
        isError,
      });
      assertSeparatedCards(container);
    },
  );

  it('retains refund history when a recheck fails while ownership is still fresh', () => {
    const container = render({ money: money(), isError: true });
    assertSeparatedCards(container);
    expect(container.textContent).toContain('last figures we accepted');
  });

  it.each([
    {
      name: 'unconfirmed',
      money: money({ linkState: 'unconfirmed', committees: [], committeesOutsideThisYear: [] }),
    },
    { name: 'first loading', isLoading: true },
    { name: 'loading with held response', money: money(), isLoading: true },
    { name: 'first failed request', isError: true },
    {
      name: 'expired ownership',
      money: money(),
      moneyUpdatedAt: Date.now() - CURRENT_CLAIM_MAX_AGE_MS,
    },
    {
      name: 'expired outside-year ownership',
      money: money({ committees: [], committeesOutsideThisYear: [outsideCommittee('17868')] }),
      moneyUpdatedAt: Date.now() - CURRENT_CLAIM_MAX_AGE_MS,
    },
    {
      name: 'failed recheck with expired ownership',
      money: money(),
      isError: true,
      moneyUpdatedAt: Date.now() - CURRENT_CLAIM_MAX_AGE_MS,
    },
  ])('hides refund history for $name', (options) => {
    expect(refundCards(render(options))).toHaveLength(0);
  });
});

describe('historical filing schedules on the Campaign money tab', () => {
  it.each(['on_the_ballot', 'not_on_the_ballot'] as const)(
    'renders a known 2025 %s schedule with no upcoming report',
    (state) => {
      const historicalCommittee = committee('17868');
      historicalCommittee.filingSchedule.state = state;
      const container = render({ money: money({ committees: [historicalCommittee] }), year: 2025 });
      expect(container.textContent).toContain(
        state === 'on_the_ballot'
          ? "This committee was on the 2025 ballot and followed Minnesota's election-year filing schedule"
          : "This committee was not on the 2025 ballot. Minnesota's schedule for candidates not running required a year-end report.",
      );
      expect(container.textContent).not.toContain('We have not yet copied in');
      expect(container.textContent).not.toContain('Its next report');
      expect(container.textContent).not.toContain('New money appears here');
    },
  );
});
