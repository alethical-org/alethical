// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const queries = vi.hoisted(() => ({
  summary: vi.fn(),
  filings: vi.fn(),
  lobbying: vi.fn(),
}));
vi.mock('../../../hooks/useAppQueries', () => ({
  useCampaignFinanceSummary: queries.summary,
  useCampaignFinanceFilings: queries.filings,
  useWarmMoneyDestinations: () => {},
}));
vi.mock('../../../hooks/useLobbying', () => ({ useLobbyingSummary: queries.lobbying }));
vi.mock('../../../hooks/useResponsive', () => ({ useResponsive: () => ({ isMobile: false }) }));
vi.mock('../../../theme/primitives', async () => {
  const { View } = await import('react-native');
  return {
    PageBackground: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    Container: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    TopNav: () => null,
    Footer: () => null,
  };
});
vi.mock('react-native-svg', () => ({ default: () => null, Circle: () => null, Path: () => null }));
vi.mock('../../../lib/research', () => ({
  piecesLabelledResearch: () => [
    { slug: 'example', title: 'Example research', dek: 'A sample piece' },
  ],
  researchDatesLine: () => 'PUBLISHED AUG 20 2026 · RECORDS THROUGH JUL 20 2026',
}));

import type { MoneyFilingsFeed, MoneyLandingSummary } from '../../../data/types';
import { MoneyLandingScreen } from '../MoneyLandingScreen';

const summary: MoneyLandingSummary = {
  register: { state: 'reported', filerCount: 1603 },
  confirmations: {
    state: 'reported',
    confirmedMemberCount: 200,
    sittingMemberCount: 200,
    newestConfirmationAt: null,
  },
  contests: { state: 'reported', contestCount: 222 },
  independentExpenditureRows: { state: 'reported', rowCount: 41130 },
  freshness: { downloadsFetchedAt: '2026-09-01T18:00:00Z' },
};

function feed(): MoneyFilingsFeed {
  return {
    state: 'reported',
    orderedBy: 'filed_date_then_period_end',
    newestPeriod: { periodEnd: '2026-07-20', filingCount: 1203 },
    filings: [
      {
        registrationNumber: '00123',
        filerName: 'Example Political Fund',
        reportName: '2026 Pre-Primary Report',
        periodStart: '2026-01-01',
        periodEnd: '2026-07-20',
        filedDate: '2026-08-11',
      },
      {
        registrationNumber: null,
        filerName: 'Unidentified Filer',
        reportName: '2025 Year-End Report',
        periodStart: '2025-01-01',
        periodEnd: '2025-12-31',
        filedDate: null,
      },
    ],
  };
}

let root: Root;
beforeEach(() => {
  queries.summary.mockReturnValue({ data: summary, isLoading: false, isPending: false });
  queries.filings.mockReturnValue({ data: feed(), isLoading: false, isPending: false });
  queries.lobbying.mockReturnValue({ data: undefined });
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const navigate = vi.fn();
  act(() =>
    root.render(<MoneyLandingScreen navigation={{ navigate } as never} route={{} as never} />),
  );
  return { host, navigate };
}

function exactText(host: HTMLElement, words: string) {
  const element = [...host.querySelectorAll<HTMLElement>('*')].find(
    (node) => node.children.length === 0 && node.textContent === words,
  );
  expect(element, `Missing rendered text: ${words}`).toBeDefined();
  return element!;
}

describe('the money landing makes the reporting periods and destinations explicit', () => {
  it('labels a mixed-period list separately from the dated newest-period count', () => {
    const { host } = mount();
    const words = host.textContent!;
    expect(words).toContain('RECENTLY FILED REPORTS');
    expect(words).not.toContain('THE MOST RECENT COMPLETED FILING PERIOD');
    expect(words).toContain('Newest completed period: 1,203 reports cover through Jul 20, 2026');
    expect(words).toContain('covers Jan 1, 2025 – Dec 31, 2025');
    expect(words).toContain('covers Jan 1, 2026 – Jul 20, 2026');
    expect(words.match(/Never by amount/g)).toHaveLength(1);
    expect(words).not.toContain('reports cover this period');
  });

  it('links a known registration number without inventing a link or received date for another name', () => {
    const { host, navigate } = mount();
    const link = exactText(host, 'Example Political Fund').closest('a')!;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/money/committees/example-political-fund-00123');
    act(() => link.click());
    expect(navigate).toHaveBeenCalledWith('CommitteeMoney', {
      slug: 'example-political-fund-00123',
    });
    expect(exactText(host, 'Unidentified Filer').closest('a,[role="link"]')).toBeNull();
    expect(host.textContent).toContain('FILED AUG 11, 2026');
    expect(host.textContent).not.toContain('FILED DEC 31, 2025');
  });

  it('does not publish a latest-period count without a known cutoff', () => {
    queries.filings.mockReturnValue({
      data: { ...feed(), newestPeriod: { periodEnd: null, filingCount: 1203 } },
      isLoading: false,
      isPending: false,
    });
    const { host } = mount();
    expect(host.textContent).not.toContain('Newest completed period');
    expect(host.textContent).not.toContain('1,203');
    expect(host.textContent).toContain('Example Political Fund');
  });

  it('keeps the search examples visible outside the short phone-friendly field', () => {
    const { host } = mount();
    expect(host.querySelector('input')?.placeholder).toBe('Search a name');
    expect(host.textContent).toContain(
      'Try all or part of a name: a person, committee, payee, or lobbyist',
    );
  });

  it('uses Libre Franklin with tabular digits for counts and each kind of date', () => {
    const { host } = mount();
    for (const words of [
      '200 MEMBERS',
      'Sep 1, 2026',
      'PUBLISHED AUG 20 2026 · RECORDS THROUGH JUL 20 2026',
      'FILED AUG 11, 2026',
    ]) {
      const style = getComputedStyle(exactText(host, words));
      expect(style.fontFamily, words).toContain('Libre Franklin');
      expect(style.fontVariant, words).toContain('tabular-nums');
    }
  });
});
