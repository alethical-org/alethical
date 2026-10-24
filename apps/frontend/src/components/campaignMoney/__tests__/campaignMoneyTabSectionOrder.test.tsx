// @vitest-environment jsdom
/**
 * What a reader meets, and in what order, on a legislator's Campaign money tab (#2186).
 *
 * Everything about one committee stays together: its own card, then the 3 donation cards, then the donor
 * picture drawn across years, then the refunds Minnesota paid its donors. Outside
 * spending draws once, below every committee block, because it covers all of them at
 * once and cannot sit inside one.
 *
 * Asserted on the rendered output, never on the source, for the reason
 * `campaignMoneyTabDrawsOutsideSpending.test.tsx` gives: a check on an import passes
 * while a reader sees nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CampaignCommitteeMoney, LegislatorCampaignMoney } from '../../../data/types';
import { refundFixture } from './refundFixtures';
import type { OutsideSpendingYear } from '../../../lib/outsideSpending';

const outsideSpending = vi.hoisted(() => ({ years: [] as OutsideSpendingYear[] }));
afterEach(() => {
  outsideSpending.years = [];
});

vi.mock('../MoneyDetailsOnDemand', () => import('../MoneyDetailsBundle'));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
  Path: () => <path />,
}));
vi.mock('../../../hooks/useAppQueries', () => ({
  useLegislatorOutsideSpending: () => ({
    data: outsideSpending.years,
    isLoading: false,
    isError: false,
  }),
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
  filingsCopiedAt?: string | null,
  servedAgeMs = 0,
  paymentCopiedAt: LegislatorCampaignMoney['paymentCopiedAt'] = {
    contributions: '2026-09-12T12:00:00Z',
    expenditures: '2026-09-12T12:00:00Z',
    independentExpenditures: '2026-09-12T12:00:00Z',
  },
): string {
  const money: LegislatorCampaignMoney = {
    legislatorId: 'fixture-member',
    year: 2025,
    linkState: 'confirmed',
    releaseId: 'release-1',
    currentClaim: { servedAgeMs, validatedAt: '2026-09-12T12:00:00Z' },
    committees,
    committeesOutsideThisYear: [],
    otherOfficeCommittees: 0,
    fetchedAt: '2026-09-12T12:00:00Z',
    filingsCopiedAt,
    paymentCopiedAt,
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
const REFUNDS = 'Refunds Minnesota paid to this committee&#x27;s donors';
const OUTSIDE = 'Spending by outside groups';
const LOCATIONS = 'Where itemized individual contributions came from';

describe('the order of the Campaign money tab', () => {
  it('keeps one committee together: card, locations, the panel, its chart, then refunds', () => {
    const html = render([committee('17868')]);
    // The location card sits OUTSIDE the panel and above it, so it lands before the
    // panel's own first row rather than between 2 of them.
    const order = [
      html.indexOf('Fixture Senate committee 17868'),
      html.indexOf(LOCATIONS),
      html.indexOf('More on this year'),
      html.indexOf('committee-17868-donation-card-0'),
      html.indexOf('committee-17868-donation-card-2'),
      html.indexOf(MIX),
      html.indexOf('committee-17868-refunds'),
      html.indexOf(OUTSIDE),
    ];
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain(REFUNDS);
    // The row the location block used to be is gone from the panel, and its address is
    // not reused: a saved link to row 2 still opens the name matches.
    expect(html).not.toContain('committee-17868-donation-card-1');
  });

  it('repeats the block per committee and still draws outside spending once, last', () => {
    const html = render([committee('17868'), committee('15667')]);
    const at = (needle: string, from = 0) => html.indexOf(needle, from);
    const second = at('Fixture Senate committee 15667');
    // The first committee's chart and refunds both land before the second one starts,
    // so no committee's block is split by another committee's.
    for (const index of [0, 2]) {
      expect(at(`committee-17868-donation-card-${index}`)).toBeLessThan(at(MIX));
      expect(at(`committee-15667-donation-card-${index}`)).toBeGreaterThan(second);
      expect(at(`committee-15667-donation-card-${index}`)).toBeLessThan(at(MIX, second));
    }
    // Each committee gets its own location card, never one combined figure.
    expect(html.split(LOCATIONS)).toHaveLength(3);
    expect(at(LOCATIONS)).toBeLessThan(at('committee-17868-donation-card-0'));
    expect(at(LOCATIONS, second)).toBeGreaterThan(second);
    expect(at(LOCATIONS, second)).toBeLessThan(at('committee-15667-donation-card-0'));
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
    const html = render(
      [{ ...committee('17868'), filingsCopiedAt: '2026-08-12T02:00:00Z' }],
      '2026-10-24T12:00:00Z',
    );
    expect(html).toContain('report totals copied Aug 11,\u00a02026.');
    expect(html).toContain('These are copy dates, not reporting periods.');
    expect(html).not.toContain('The report totals were copied separately.');
  });

  it('retains the honest one-date line when the response has no report date', () => {
    const html = render([committee('17868')], '2026-10-24T12:00:00Z');
    expect(html).toContain('The report totals were copied separately.');
    expect(html).not.toContain('report totals copied');
    expect(html).toContain('The report totals’ copy date is unavailable');
    expect(html).not.toContain('Oct 24');
  });

  it('keeps mixed dates beside their own committee, without a borrowed shared date', () => {
    const html = render(
      [
        { ...committee('17868'), filingsCopiedAt: '2026-10-07T21:00:00Z' },
        { ...committee('15667'), filingsCopiedAt: '2026-10-24T19:00:00Z' },
      ],
      '2026-10-24T19:00:00Z',
    );
    const second = html.indexOf('Fixture Senate committee 15667');
    expect(html.indexOf('Report totals copied Oct 7, 2026.')).toBeGreaterThan(0);
    expect(html.indexOf('Report totals copied Oct 7, 2026.')).toBeLessThan(second);
    expect(html.indexOf('Report totals copied Oct 24, 2026.')).toBeGreaterThan(second);
    expect(html).not.toContain('report totals copied');
  });

  it('groups different times on the same Minnesota day once', () => {
    const html = render([
      { ...committee('17868'), filingsCopiedAt: '2026-08-11T22:00:00Z' },
      { ...committee('15667'), filingsCopiedAt: '2026-08-12T02:00:00Z' },
    ]);
    expect(html.split('report totals copied Aug 11,\u00a02026.')).toHaveLength(2);
    expect(html).not.toContain('Report totals copied');
  });

  it.each(['2026-10-24T19:00:00Z', null])(
    'keeps the shared report date when outside payment dates differ or are missing: %s',
    (fetchedAt) => {
      outsideSpending.years = [
        {
          year: 2025,
          state: 'reported',
          snapshotId: 'outside-snapshot',
          committees: [],
          supporting: 100,
          opposing: 0,
          directionNotRecorded: 0,
          supportingPayments: 1,
          opposingPayments: 0,
          directionNotRecordedPayments: 0,
          firstPaymentOn: '2025-01-01',
          lastPaymentOn: '2025-12-31',
          sourceUrl: 'https://cfb.mn.gov/',
          fetchedAt,
        },
      ];
      const html = render([
        { ...committee('17868'), filingsCopiedAt: '2026-08-11T22:00:00Z' },
        { ...committee('15667'), filingsCopiedAt: '2026-08-12T02:00:00Z' },
      ]);
      expect(html.split('Report totals copied Aug 11, 2026.')).toHaveLength(2);
      expect(html).toContain('Their recorded dates differ or a date is missing.');
      expect(html).toContain('Try again');
      expect(html).not.toContain('report totals copied');
    },
  );

  it('keeps a known date local when another committee has no date', () => {
    const html = render([
      { ...committee('17868'), filingsCopiedAt: '2026-10-07T21:00:00Z' },
      committee('15667'),
    ]);
    const second = html.indexOf('Fixture Senate committee 15667');
    expect(html.indexOf('Report totals copied Oct 7, 2026.')).toBeLessThan(second);
    expect(html.indexOf('The report totals’ copy date is unavailable')).toBeGreaterThan(second);
    expect(html).not.toContain('report totals copied');
  });

  it('withholds committee copy dates when the committee association has expired', () => {
    const html = render(
      [{ ...committee('17868'), filingsCopiedAt: '2026-10-07T21:00:00Z' }],
      '2026-10-24T19:00:00Z',
      24 * 60 * 60 * 1000,
    );
    expect(html).not.toContain('Fixture Senate committee 17868');
    expect(html).not.toContain('Oct 7');
    expect(html).not.toContain('Oct 24');
    expect(html).not.toContain('Report totals copied');
  });
});

describe('independent payment file dates in the rendered tab', () => {
  it('keeps newer contributions distinct from retained spending', () => {
    const html = render([committee('17868')], null, 0, {
      contributions: '2026-10-24T18:00:00Z',
      expenditures: '2026-10-09T18:00:00Z',
      independentExpenditures: '2026-10-09T18:00:00Z',
    });
    expect(html).toContain('Contributions file copied Oct 24,\u00a02026');
    expect(html).toContain('Spending file copied Oct 9,\u00a02026');
    expect(html).toContain('Outside-spending file copied Oct 9,\u00a02026');
    expect(html).not.toContain('Try again');
    expect(html).not.toContain('Minnesota’s payment files copied');
  });
  it('does not turn an old response’s root date into a known source date', () => {
    const html = render([committee('17868')], null, 0, {
      contributions: null,
      expenditures: null,
      independentExpenditures: null,
    });
    expect(html).toContain('Contributions file copy date unavailable');
    expect(html).toContain('Spending file copy date unavailable');
    expect(html).not.toContain('file copied Sep 12');
    expect(html).not.toContain('Minnesota’s payment files copied Sep 12');
  });
});
