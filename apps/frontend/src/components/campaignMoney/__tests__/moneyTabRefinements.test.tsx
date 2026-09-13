// @vitest-environment jsdom
/**
 * The 13 Sep 2026 design handoff's refinements to a legislator's Campaign money tab,
 * pinned where a later change would otherwise undo them quietly.
 *
 * Rendered rather than source-checked, for the reason `moneyCardsInventory` gives: a
 * constant can be exported and imported and still never reach a reader. What these
 * pin is what a reader meets — the registration number on the name line, the one
 * off-site link and where it goes, the heading outline the tab presents to a screen
 * reader now that it carries no visible heading of its own, and the arrow that has to
 * stay against the last word of a label wrapping to 2 lines on a phone.
 */
import { BOARD_RECORD_LINK_LABEL, BOARD_VIEWER_INDEX } from '../../../lib/boardRecordLink';
import { describe, expect, it, vi } from 'vitest';

vi.mock(
  '../../../hooks/useCampaignMoneyYearStates',
  () => import('../../../hooks/useCampaignMoneyDetails'),
);

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
import { FILING_SOURCE_BOTH_DATES } from '../../../lib/committeeMoneyShared';
import { moneyDetailsPageCopy } from '../../../lib/campaignMoneyDetailsPageCopy';

function committee(overrides: Partial<CampaignCommitteeMoney> = {}): CampaignCommitteeMoney {
  return {
    registrationNumber: '17868',
    committeeNameAsReviewed: 'Abeler, Jim Senate Committee',
    committeeName: 'Abeler, Jim Senate Committee',
    office: 'Senate',
    registerKind: 'candidate_committee',
    checked: null,
    moneyIn: {
      state: 'reported',
      itemizedContributionTotal: '151614.0000',
      itemizedContributionPayments: 212,
      otherReceipts: [],
      reportedPeriodStart: '2026-01-01',
      sourceUrl: 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/',
    },
    moneyOut: null,
    split: {
      state: 'shown',
      reportedTotal: '216054.0000',
      reportedThrough: '2026-07-20',
      namedTotal: '151614.0000',
      namedPayments: 212,
      namedCashTotal: '149214.0000',
      namedInKindTotal: '0.0000',
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

function render(committees: CampaignCommitteeMoney[]) {
  const money: LegislatorCampaignMoney = {
    legislatorId: 'jim-abeler',
    year: 2026,
    linkState: 'confirmed',
    currentClaim: { servedAgeMs: 0, validatedAt: '2026-09-01T18:33:35.639027Z' },
    committees,
    committeesOutsideThisYear: [],
    otherOfficeCommittees: 0,
    fetchedAt: '2026-09-01T18:33:35.639027Z',
  };
  return renderToStaticMarkup(
    <CampaignMoneyTab
      legislatorName="Sen. Jim Abeler"
      year={2026}
      onSelectYear={vi.fn()}
      money={money}
      isLoading={false}
      isError={false}
      moneyUpdatedAt={Date.now()}
      refetchMoney={() => {}}
      isDesktop
      legislatorId="jim-abeler"
      onOpenSource={vi.fn()}
    />,
  );
}

function doc(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
}

describe('the money tab after the 13 Sep refinements', () => {
  it('puts the registration number on the name line and drops the eyebrow above it', () => {
    const page = doc(render([committee()]));
    const heading = [...page.querySelectorAll('[role="heading"]')].find((node) =>
      node.textContent?.startsWith('Abeler, Jim Senate Committee'),
    )!;
    // The state's own listing format, and the space before the number is a no-break
    // space so a wrap can never leave the number on a line of its own.
    expect(heading.textContent).toBe('Abeler, Jim Senate Committee - 17868');
    // The chamber and the year were the eyebrow's other 2 facts, and the profile's
    // own h1 and the year control above the card already carry them.
    expect(page.body.textContent).not.toContain('REGISTRATION 17868');
    expect(page.body.textContent).not.toContain('SENATE · 2026');
  });

  it('has no visible heading of its own and names the region instead', () => {
    const page = doc(render([committee()]));
    const region = page.querySelector('[role="region"]')!;
    expect(region.getAttribute('aria-label')).toBe('Campaign money');
    // The tab bar above carries the word, and this is the selected tab.
    expect(
      [...page.querySelectorAll('[role="heading"]')].some(
        (node) => node.textContent === 'Campaign money',
      ),
    ).toBe(false);
    // The year control leads the tab, behind a visible label of its own.
    expect(page.body.textContent).toContain('Year');
  });

  it('starts the tab at level 2, so nothing jumps from the page title to level 3', () => {
    const page = doc(render([committee()]));
    const levels = [...page.querySelectorAll('[role="heading"]')].map((node) =>
      Number(node.getAttribute('aria-level')),
    );
    // A committee card's own name is the tab's top heading now.
    expect(Math.min(...levels)).toBe(2);
    const named = (text: string) =>
      [...page.querySelectorAll('[role="heading"]')]
        .filter((node) => node.textContent?.includes(text))
        .map((node) => node.getAttribute('aria-level'));
    expect(named('Abeler, Jim Senate Committee -')).toEqual(['2']);
    // And what sits inside that card moves up with it, rather than staying a step
    // below a heading that no longer exists.
    expect(named('Money in')).toEqual(['3']);
  });

  it('sends the one off-site link to this filer’s own record on the Board’s site', () => {
    const page = doc(render([committee()]));
    const inline = [...page.querySelectorAll('a')].find(
      (node) => node.textContent === BOARD_RECORD_LINK_LABEL,
    )!;
    expect(inline.getAttribute('href')).toBe(
      'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/17868/2026/',
    );
    expect(inline.getAttribute('target')).toBe('_blank');
    expect(inline.getAttribute('rel')).toBe('noopener noreferrer');
    // The sentence it opens, and the sentence above it, are the handoff's words.
    expect(page.body.textContent).toContain(FILING_SOURCE_BOTH_DATES);
    expect(page.body.textContent).toContain(
      `${BOARD_RECORD_LINK_LABEL} lists every report it filed, under Reports and Data.`,
    );
    // The standalone link under the stamp is gone, so the stamp carries one way out.
    expect(page.body.textContent).not.toContain('on the state’s own site');
  });

  it('falls back to the page listing all 3 searches when we do not hold the kind', () => {
    const page = doc(render([committee({ registerKind: null })]));
    const inline = [...page.querySelectorAll('a')].find(
      (node) => node.textContent === BOARD_RECORD_LINK_LABEL,
    )!;
    // Never a guessed segment: a party unit sent to the candidate name search cannot
    // be found there at all, which is the defect this replaces (#2179).
    expect(inline.getAttribute('href')).toBe(BOARD_VIEWER_INDEX);
  });

  it('keeps the arrow against the last word of a label that wraps to 2 lines', () => {
    const page = doc(render([committee()]));
    const row = [...page.querySelectorAll('a')].find((node) =>
      node.textContent?.startsWith(moneyDetailsPageCopy.fullRecord),
    )!;
    // Label and arrow are 1 inline run inside 1 element, with a no-break space
    // between them. A flex row holding the label and the arrow as 2 items is what
    // centres the arrow against a wrapped label and leaves roughly 140px of empty
    // space in front of it on a 375-wide canvas.
    const run = [...row.querySelectorAll('*')].find((node) =>
      node.textContent?.startsWith(moneyDetailsPageCopy.fullRecord),
    )!;
    expect(run.textContent).toBe(`${moneyDetailsPageCopy.fullRecord} `);
    expect(run.querySelector('svg')).not.toBeNull();
  });

  it('keeps the way to everything we hold even in a year with no filing', () => {
    const page = doc(
      render([
        committee({
          moneyIn: null,
          split: { ...committee().split, state: 'no_reported_total', reportedThrough: null },
        }),
      ]),
    );
    expect(page.body.textContent).toContain(moneyDetailsPageCopy.fullRecord);
    // No stamp draws, and the Board link lives inside the stamp's sentence.
    expect(page.body.textContent).not.toContain(BOARD_RECORD_LINK_LABEL);
  });
});
