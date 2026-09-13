// @vitest-environment jsdom
/**
 * What a reader meets, and in what order, on a legislator's Campaign money tab (#2186).
 *
 * Everything about one committee stays together: its own card, then the same donor
 * picture drawn across years, then the refunds Minnesota paid its donors. Outside
 * spending draws once, below every committee block, because it covers all of them at
 * once and cannot sit inside one.
 *
 * Asserted on the rendered output, never on the source, for the reason
 * `campaignMoneyTabDrawsOutsideSpending.test.tsx` gives: a check on an import passes
 * while a reader sees nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CampaignCommitteeMoney, LegislatorCampaignMoney } from '../../../data/types';
import { refundFixture } from './refundFixtures';

vi.mock('../MoneyDetailsOnDemand', () => import('../MoneyDetailsBundle'));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
  Path: () => <path />,
}));
vi.mock('../../../hooks/useAppQueries', () => ({
  useLegislatorOutsideSpending: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock(
  '../../../hooks/useCampaignMoneyYearStates',
  () => import('../../../hooks/useCampaignMoneyDetails'),
);
// A complete history for the selected release, so each committee's year-by-year chart
// really draws. With it withheld the chart renders nothing and this file would pass
// while proving only where the refunds card sits.
vi.mock('../../../hooks/useCampaignMoneyDetails', () => ({
  useCampaignMoneyYearStates: () => ({ data: [] }),
  useCampaignMoneyDetails: () => ({
    received: { data: undefined, isSuccess: false, isError: false },
    made: { data: undefined, isSuccess: false, isError: false },
    selectedComplete: true,
    historyComplete: true,
    history: { data: { releaseId: 'release-1', years: [{ year: 2025, payments: [] }] } },
    releaseMismatch: false,
  }),
}));

import { CampaignMoneyTab } from '../CampaignMoneyTab';

const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server');

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

function render(
  committees: CampaignCommitteeMoney[],
  reportTotalsCopiedAt?: string | null,
): string {
  const money: LegislatorCampaignMoney = {
    legislatorId: 'fixture-member',
    year: 2025,
    linkState: 'confirmed',
    releaseId: 'release-1',
    currentClaim: { servedAgeMs: 0, validatedAt: '2026-09-12T12:00:00Z' },
    committees,
    committeesOutsideThisYear: [],
    otherOfficeCommittees: 0,
    fetchedAt: '2026-09-12T12:00:00Z',
    reportTotalsCopiedAt,
  } as LegislatorCampaignMoney;
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <CampaignMoneyTab
        legislatorName="Fixture member"
        legislatorId="fixture-member"
        year={2025}
        onSelectYear={vi.fn()}
        money={money}
        isLoading={false}
        isError={false}
        moneyUpdatedAt={Date.now()}
        refetchMoney={vi.fn()}
        isDesktop
        onOpenSource={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

const MIX = 'How the mix of itemized contributions changed by year';
// Static markup escapes the apostrophe, so the heading is matched as it is served.
const REFUNDS = 'Refunds Minnesota paid this committee&#x27;s donors';
const OUTSIDE = 'Spending by outside groups';

describe('the order of the Campaign money tab', () => {
  it('keeps one committee together: its card, its chart, then its refunds', () => {
    const html = render([committee('17868')]);
    const order = [
      html.indexOf('Fixture Senate committee 17868'),
      html.indexOf(MIX),
      html.indexOf('committee-17868-refunds'),
      html.indexOf(OUTSIDE),
    ];
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain(REFUNDS);
  });

  it('repeats the block per committee and still draws outside spending once, last', () => {
    const html = render([committee('17868'), committee('15667')]);
    const at = (needle: string, from = 0) => html.indexOf(needle, from);
    const second = at('Fixture Senate committee 15667');
    // The first committee's chart and refunds both land before the second one starts,
    // so no committee's block is split by another committee's.
    expect(at(MIX)).toBeLessThan(second);
    expect(at('committee-17868-refunds')).toBeLessThan(second);
    expect(at(MIX, second)).toBeGreaterThan(second);
    expect(at('committee-15667-refunds')).toBeGreaterThan(second);
    // It covers both committees at once, so it draws once and below all of them.
    expect(html.split(OUTSIDE)).toHaveLength(2);
    expect(at(OUTSIDE)).toBeGreaterThan(at('committee-15667-refunds'));
  });
});

describe('the tab dates both sources at its foot', () => {
  it('prints the separately copied totals date in Minnesota time', () => {
    const html = render([committee('17868')], '2026-08-12T02:00:00Z');
    expect(html).toContain('and its report totals on Aug 11,\u00a02026.');
    expect(html).toContain('Neither is the period the money covers.');
    expect(html).not.toContain('The report totals were copied separately.');
  });

  it('retains the honest one-date line when the response has no report date', () => {
    const html = render([committee('17868')]);
    expect(html).toContain('The report totals were copied separately.');
    expect(html).not.toContain('and its report totals on');
  });
});
