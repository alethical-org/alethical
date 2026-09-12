// @vitest-environment jsdom
/**
 * A failed recheck must not throw away figures we are still holding.
 *
 * WHY THIS BECAME REACHABLE. Issue 2023 made returning to a money tab recheck the
 * reads that claim something current. Before that nothing refetched this read at
 * all, so a failed recheck could not happen and this tab's `isError` branch only
 * ever fired on a first load with nothing to show. With a recheck, one failed
 * request replaced a correct current page of a named person's figures with an
 * apology. The committee page already handled this correctly (`isHoldingStale` in
 * CommitteeMoneyScreen.tsx); this tab did not. Found by the session on issue 2020
 * while checking what the recheck would do to its own screen, and fixed here
 * because this surface belongs to 2023.
 *
 * The rule is the one the campaign-finance design already states: older and
 * labelled beats blank. A held figure carries the period it covers and the day we
 * copied it, so saying so is honest and dropping it is not.
 *
 * Rendered rather than source-checked, and the reason is the one
 * `campaignMoneyTabDrawsOutsideSpending` gives: an element can be imported and
 * called and still never reach a reader.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

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

import { CampaignMoneyTab } from '../CampaignMoneyTab';
import type { CampaignCommitteeMoney, LegislatorCampaignMoney } from '../../../data/types';

/** A confirmed committee with a full year of figures, shaped like the live API. */
function committee(overrides: Partial<CampaignCommitteeMoney> = {}): CampaignCommitteeMoney {
  return {
    registrationNumber: '18430',
    committeeNameAsReviewed: 'Putnam, Aric Senate Committee',
    committeeName: 'Putnam, Aric Senate Committee',
    office: 'Senate',
    checked: {
      checkedOn: '2026-08-30',
      nameEvidence: 'exact',
      registerVerdict: 'same_seat',
      partyAgreement: 'agrees',
    },
    moneyIn: {
      state: 'reported',
      itemizedContributionTotal: '151614.0000',
      itemizedContributionPayments: 212,
      otherReceipts: [{ receiptType: 'Public Subsidy', total: '3000.0000', payments: 1 }],
      reportedPeriodStart: '2026-01-01',
      sourceUrl: 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/',
    },
    moneyOut: {
      state: 'reported',
      itemizedPaymentTotal: '131882.0000',
      itemizedPayments: 90,
      inKindTotal: '0.0000',
      reportedTotal: '168220.0000',
      reportedThrough: '2026-07-20',
      statedSpendingState: 'agrees',
      byType: [
        { type: 'Campaign Expenditure', total: '119302.0000', payments: 84 },
        { type: 'Contribution', total: '12580.0000', payments: 6 },
      ],
      sourceUrl: 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/',
    },
    split: {
      state: 'shown',
      reportedTotal: '216054.0000',
      reportedThrough: '2026-07-20',
      namedTotal: '151614.0000',
      namedPayments: 212,
      namedCashTotal: '149214.0000',
      namedInKindTotal: '2400.0000',
      unnamedTotal: '66840.0000',
      statedSplitState: 'agrees',
      firstPaymentOn: '2026-01-06',
      lastPaymentOn: '2026-07-20',
    },
    filingSchedule: {
      state: 'on_the_ballot',
      nextReportName: 'Pre-general report of receipts and expenditures',
      nextReportDueOn: '2026-10-26',
      periodStart: '2026-07-21',
      periodEnd: '2026-10-19',
      condition: null,
      terminatedOn: null,
    },
    ...overrides,
  };
}

function money(): LegislatorCampaignMoney {
  return {
    legislatorId: 'aric-putnam',
    year: 2026,
    linkState: 'confirmed',
    // Freshly validated, so nothing here is withheld for age. This case is about a
    // failed REQUEST, which is a different thing from an expired claim.
    currentClaim: { servedAgeMs: 0, validatedAt: '2026-09-01T18:33:35.639027Z' },
    committees: [committee()],
    committeesOutsideThisYear: [],
    otherOfficeCommittees: 0,
    fetchedAt: '2026-09-01T18:33:35.639027Z',
  } as unknown as LegislatorCampaignMoney;
}

function render(options: { isError: boolean; hasMoney: boolean }) {
  return renderToStaticMarkup(
    <CampaignMoneyTab
      legislatorName="Sen. Aric Putnam"
      year={2026}
      onSelectYear={vi.fn()}
      money={options.hasMoney ? money() : undefined}
      isLoading={false}
      isError={options.isError}
      moneyUpdatedAt={options.hasMoney ? Date.now() : undefined}
      refetchMoney={() => {}}
      isDesktop
      legislatorId="aric-putnam"
      onOpenSource={vi.fn()}
    />,
  );
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2019;/g, '’')
    .replace(/\s+/g, ' ');

describe('a failed recheck of a member’s campaign money', () => {
  it('keeps the figures on screen and says they are held', () => {
    const drawn = text(render({ isError: true, hasMoney: true }));

    // The figure survives. This is the assertion the defect failed.
    expect(drawn).toContain('$151,614');
    // And the reader is told why it is not being refreshed, in the same words the
    // committee page already uses for this state rather than a new sentence.
    expect(drawn).toContain('could not reach our own data service just now');
    expect(drawn).toContain('last figures we accepted');
    // Never the apology that replaces everything.
    expect(drawn).not.toContain('This is a problem on our side');
  });

  it('still apologises when a first load fails with nothing to hold', () => {
    const drawn = text(render({ isError: true, hasMoney: false }));

    expect(drawn).toContain('This is a problem on our side');
    expect(drawn).not.toContain('$151,614');
  });

  it('says nothing about holding anything when the read succeeded', () => {
    const drawn = text(render({ isError: false, hasMoney: true }));

    expect(drawn).toContain('$151,614');
    expect(drawn).not.toContain('could not reach our own data service just now');
    expect(drawn).not.toContain('This is a problem on our side');
  });
});
