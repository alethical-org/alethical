// @vitest-environment jsdom
/**
 * The Campaign money tab draws the outside-spending card (#1932).
 *
 * **This test mounts the tab and asserts the card's own heading is in the output,
 * because asserting anything cheaper is what let the card go missing for 15 days.**
 * `CampaignMoneyTab` imported `OutsideSpendingCard` and called
 * `useLegislatorOutsideSpending` the whole time, so a check on the import, the hook
 * call, or the card's own unit tests all passed while every reader saw nothing. Only
 * the rendered output can tell the difference.
 *
 * So: never weaken these to a source-text or import assertion. The card's unit tests
 * live beside it and cover its wording and its states; what this file exists for is
 * the single fact that the tab puts it on the page.
 */
import { describe, expect, it, vi } from 'vitest';

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
  Path: () => <path />,
}));

const outsideSpending = vi.hoisted(() => ({
  current: { data: undefined, isLoading: false, isError: false } as {
    data: unknown;
    isLoading: boolean;
    isError: boolean;
  },
}));

vi.mock('../../../hooks/useAppQueries', () => ({
  useLegislatorOutsideSpending: () => outsideSpending.current,
}));

import { CampaignMoneyTab } from '../CampaignMoneyTab';
import { OUTSIDE_SPENDING_HEADING } from '../../legislator/OutsideSpendingCard';
import type { OutsideSpendingYear } from '../../../lib/outsideSpending';
import type { LegislatorCampaignMoney } from '../../../data/types';

/** Sen. Aric Putnam's 2026, from the live API on 2 Sep 2026. */
function reportedYear(overrides: Partial<OutsideSpendingYear> = {}): OutsideSpendingYear {
  return {
    year: 2026,
    state: 'reported',
    snapshotId: '589ef156-a1ee-4806-a01d-1588a98bd65a',
    committees: [
      { registrationNumber: '18430', name: 'Putnam, Aric Senate Committee', office: 'Senate' },
    ],
    supporting: 29482.5,
    opposing: 2000,
    directionNotRecorded: 0,
    supportingPayments: 4,
    opposingPayments: 2,
    directionNotRecordedPayments: 0,
    firstPaymentOn: '2026-04-13',
    lastPaymentOn: '2026-07-01',
    sourceUrl: 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/',
    fetchedAt: '2026-09-01T18:33:35.639027Z',
    ...overrides,
  };
}

function linkUnconfirmedYear(year: number): OutsideSpendingYear {
  return {
    ...reportedYear(),
    year,
    state: 'link_unconfirmed',
    committees: [],
    supporting: null,
    opposing: null,
    directionNotRecorded: null,
    supportingPayments: null,
    opposingPayments: null,
    directionNotRecordedPayments: null,
    firstPaymentOn: null,
    lastPaymentOn: null,
  };
}

/** A member whose committee money is unconfirmed, which is the tab's own empty state. */
const unconfirmedMoney: LegislatorCampaignMoney = {
  legislatorId: 'aric-putnam',
  year: 2026,
  linkState: 'unconfirmed',
  committees: [],
  committeesOutsideThisYear: [],
  otherOfficeCommittees: 0,
  fetchedAt: '2026-09-01T18:33:35.639027Z',
};

function renderTab({
  years,
  isLoading = false,
  isError = false,
  money = unconfirmedMoney,
  isDesktop = true,
}: {
  years: OutsideSpendingYear[];
  isLoading?: boolean;
  isError?: boolean;
  money?: LegislatorCampaignMoney | undefined;
  isDesktop?: boolean;
}) {
  outsideSpending.current = { data: years, isLoading, isError };
  return renderToStaticMarkup(
    <CampaignMoneyTab
      legislatorName="Sen. Aric Putnam"
      year={2026}
      onSelectYear={vi.fn()}
      money={money}
      isLoading={false}
      isError={false}
      isDesktop={isDesktop}
      legislatorId="aric-putnam"
      onOpenSource={vi.fn()}
    />,
  );
}

describe('the Campaign money tab draws outside spending', () => {
  it('keeps the shipped heading, which is what the render assertions look for', () => {
    // The approved money design draws this section headed "Independent spending".
    // Changing the shipped string is a copy decision, so it fails here rather than
    // passing quietly because a drawing showed something else.
    expect(OUTSIDE_SPENDING_HEADING).toBe('Spending by Outside Groups');
  });

  it('puts the card on the page with its figures', () => {
    const html = renderTab({ years: [reportedYear()] });
    expect(html).toContain(OUTSIDE_SPENDING_HEADING);
    expect(html).toContain('Spent supporting them');
    expect(html).toContain('Spent opposing them');
  });

  it('draws it at the phone width from the same one render', () => {
    // One render serves both widths, so losing it on one screen is impossible.
    const html = renderTab({ years: [reportedYear()], isDesktop: false });
    expect(html).toContain(OUTSIDE_SPENDING_HEADING);
    expect(html).toContain('Spent supporting them');
  });

  it('reaches the card rather than drawing nothing when no committee is confirmed', () => {
    // The state a reader gets when nobody has confirmed which committee is theirs.
    // Rule 12: this is a gap in our records and must never render as a zero, so the
    // card has to be on the page saying so rather than absent.
    const html = renderTab({ years: [linkUnconfirmedYear(2026), linkUnconfirmedYear(2025)] });
    expect(html).toContain(OUTSIDE_SPENDING_HEADING);
    expect(html).toContain('Nobody has confirmed theirs yet');
    expect(html).not.toContain('$0');
  });

  it('draws it while the request is still in flight', () => {
    const html = renderTab({ years: [], isLoading: true });
    expect(html).toContain(OUTSIDE_SPENDING_HEADING);
  });

  it('draws it even when the committee money failed to load', () => {
    // Two different records answering two different requests. The card must not be
    // gated on the committee money's state, which is how it went missing.
    const html = renderTab({ years: [reportedYear()], money: undefined });
    expect(html).toContain(OUTSIDE_SPENDING_HEADING);
    expect(html).toContain('Spent supporting them');
  });

  it('prints its figures in whole dollars, cut rather than rounded', () => {
    // The shared money formatter, so this card states an amount the same way as the
    // money-in and money-out cards above it (#1929/#1931). $29,482.50 must not round
    // up to $29,483: reading high about a named politician's money is the direction
    // that does damage.
    const html = renderTab({ years: [reportedYear()] });
    expect(html).toContain('$29,482');
    expect(html).not.toContain('$29,482.50');
    expect(html).not.toContain('$29,483');
    expect(html).toContain('$2,000');
  });
});
