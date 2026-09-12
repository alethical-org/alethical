// @vitest-environment jsdom
/**
 * The money cards draw the final 8-element inventory on the profile's Campaign money
 * tab, from the one component the committee page also draws them with.
 *
 * Rendered, not source-checked, for the reason `campaignMoneyTabDrawsOutsideSpending`
 * gives: an element can be imported and called and still never reach a reader. What
 * these tests pin is what a reader meets — the named figure that is never blank, the
 * filing's link stated once, the label "Not a donation" over every receipt kind but
 * `Miscellaneous`, a money-out card that is the filing's own figure alone, and the
 * evidence block at the card's foot.
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
import {
  FILED_REPORTS_LINK_LABEL,
  itemizedContributionsNote,
  MONEY_IN_NAMED_LABEL,
  MONEY_IN_REPORTED_LABEL,
  MONEY_OUT_REPORTED_LABEL,
  NAMED_DONATIONS_LINK_LABEL,
  NOT_A_DONATION_HEADING,
} from '../../../lib/committeeMoney';
import { MATCH_CHECK_LABEL, reportedThroughLabel } from '../../../lib/legislatorCampaignMoney';

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
      otherReceipts: [
        { receiptType: 'Public Subsidy', total: '3000.0000', payments: 1 },
        { receiptType: 'Miscellaneous', total: '307.2600', payments: 2 },
      ],
      reportedPeriodStart: '2026-01-01',
      // The served address is the bulk download itself, as the live route sends it.
      sourceUrl:
        'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/?download=-2113865252',
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

function money(committees: CampaignCommitteeMoney[]): LegislatorCampaignMoney {
  return {
    legislatorId: 'aric-putnam',
    year: 2026,
    linkState: 'confirmed',
    // Just validated, so nothing on the card is withheld for age (issue 2023).
    currentClaim: { servedAgeMs: 0, validatedAt: '2026-09-01T18:33:35.639027Z' },
    committees,
    committeesOutsideThisYear: [],
    otherOfficeCommittees: 0,
    fetchedAt: '2026-09-01T18:33:35.639027Z',
  };
}

function render(committees: CampaignCommitteeMoney[]) {
  return renderToStaticMarkup(
    <CampaignMoneyTab
      legislatorName="Sen. Aric Putnam"
      year={2026}
      onSelectYear={vi.fn()}
      money={money(committees)}
      isLoading={false}
      isError={false}
      moneyUpdatedAt={Date.now()}
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
    .replace(/\s+/g, ' ');

/** The 2 money cards alone: from the money-in heading to the outside-spending card. */
const cards = (html: string) => {
  const plain = text(html);
  return plain.slice(plain.indexOf('Money in'), plain.indexOf('Spending by Outside Groups'));
};

describe('the money cards on the profile, at the final inventory', () => {
  it('draws the filing’s period and link once, in the stamp, and not under a figure', () => {
    const html = text(render([committee()]));
    expect(html.split(FILED_REPORTS_LINK_LABEL).length - 1).toBe(1);
    expect(html).toContain('Figures for Jan 1, 2026 – Jul 20, 2026');
    // Both figures run to the stamp's date, so neither repeats it.
    expect(html).not.toContain(reportedThroughLabel('2026-07-20') as string);
  });

  it('a figure whose report runs to a different day says so under itself', () => {
    const html = text(
      render([
        committee({
          moneyOut: { ...committee().moneyOut!, reportedThrough: '2026-03-31' },
        }),
      ]),
    );
    expect(html).toContain(reportedThroughLabel('2026-03-31') as string);
  });

  it('the named figure is always present: a null money-in block reads "Not reported"', () => {
    const html = text(
      render([
        committee({
          moneyIn: null,
          moneyOut: null,
          split: {
            ...committee().split,
            state: 'no_reported_total',
            reportedTotal: null,
            reportedThrough: null,
            namedTotal: null,
            unnamedTotal: null,
          },
        }),
      ]),
    );
    expect(html).toContain(`${MONEY_IN_NAMED_LABEL} Not reported`);
    // And the reported-total slot is simply absent, never a second "Not reported".
    expect(html).not.toContain(MONEY_IN_REPORTED_LABEL);
    expect(html).toContain(FILED_REPORTS_LINK_LABEL);
    expect(html).not.toContain('The committee’s own report to the state covers');
  });

  it('labels the rows that are not donations "Not a donation", and hides Miscellaneous', () => {
    const html = text(render([committee()]));
    expect(html).toContain(`${NOT_A_DONATION_HEADING} Public Subsidy`);
    expect(html).not.toContain('Miscellaneous');
    // With only the hidden kind served, the heading does not draw either.
    const onlyMisc = text(
      render([
        committee({
          moneyIn: {
            ...committee().moneyIn!,
            otherReceipts: [{ receiptType: 'Miscellaneous', total: '307.2600', payments: 2 }],
          },
        }),
      ]),
    );
    expect(onlyMisc).not.toContain(NOT_A_DONATION_HEADING);
  });

  // Ruled by Eugene, 11 Sep 2026: heading, "Expenditures", the filing's amount. None
  // of our own figures, rows or links beside it.
  it('draws money out as the filing’s Expenditures figure and nothing else', () => {
    const html = cards(render([committee()]));
    expect(html).toContain(`${MONEY_OUT_REPORTED_LABEL} $168,220`);
    expect(html).not.toContain('$131,882');
    expect(html).not.toContain('Payments we can list');
    expect(html).not.toContain('Given to other campaigns');
    expect(html).not.toContain('Campaign Expenditure');
    expect(html).not.toContain('never subtract');
    expect(html).not.toContain('Minnesota’s list of payments out');
  });

  it('reads "Not reported" for money out with no served total, never $0', () => {
    const html = cards(
      render([committee({ moneyOut: { ...committee().moneyOut!, reportedTotal: null } })]),
    );
    expect(html).toContain(`${MONEY_OUT_REPORTED_LABEL} Not reported`);
    expect(html).not.toContain(`${MONEY_OUT_REPORTED_LABEL} $0`);
    // And a null block is the same absence.
    expect(cards(render([committee({ moneyOut: null })]))).toContain(
      `${MONEY_OUT_REPORTED_LABEL} Not reported`,
    );
  });

  it('links money in to the Board’s downloads page, not to the download itself', () => {
    const raw = render([committee()]);
    expect(raw).toContain(NAMED_DONATIONS_LINK_LABEL);
    expect(raw).toContain(
      'href="https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/"',
    );
    expect(raw).not.toContain('?download=');
  });

  // Ruled by Eugene, 11 Sep 2026: the naming rule is stated once on the card, in the
  // sentence under the itemized figure, and the non-itemized sentence repeats no figure.
  it('states the $200 naming rule exactly once, under the itemized figure', () => {
    const html = cards(render([committee()]));
    expect(html).toContain(itemizedContributionsNote(false));
    expect(html.split('$200').length - 1).toBe(1);
    expect(html).toContain('whose givers the state’s public file does not name');
  });

  it('leaves the unnamed share in the lead chart instead of repeating it under the figure', () => {
    expect(text(render([committee()]))).not.toContain(
      '31% of the donations the committee reported',
    );
  });

  it('closes each card with what a person checked, under its own label', () => {
    const html = text(render([committee()]));
    expect(html).toContain(MATCH_CHECK_LABEL.toUpperCase());
    expect(html).toContain('Checked by Alethical on Aug 30, 2026');
  });

  it('never calls money out spent, and offers no see-all control', () => {
    // The 2 cards only: the outside-spending card below them IS spending by others
    // and says so, which is the one place the word is right.
    const html = cards(render([committee()]));
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toMatch(/\bspen[dt]\b|spending|expenses/i);
    expect(html).not.toContain('See all');
  });
});
