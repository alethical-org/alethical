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
  research: vi.fn(),
}));
const viewport = vi.hoisted(() => ({ width: 1600 }));
vi.mock('../../../hooks/useAppQueries', () => ({
  useCampaignFinanceSummary: queries.summary,
  useCampaignFinanceFilings: queries.filings,
  useWarmMoneyDestinations: () => {},
}));
vi.mock('../../../hooks/useLobbying', () => ({ useLobbyingSummary: queries.lobbying }));
vi.mock('@react-navigation/native', async () => {
  const { useEffect } = await import('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({
    width: viewport.width,
    isMobile: viewport.width < 768,
    isTablet: viewport.width >= 768 && viewport.width < 1100,
    isDesktop: viewport.width >= 1100,
  }),
}));
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
vi.mock('../../../lib/research', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/research')>()),
  piecesLabelledResearch: queries.research,
}));

import type { MoneyFilingsFeed, MoneyLandingSummary } from '../../../data/types';
import type { LobbyingSummary } from '../../../lib/lobbyingTypes';
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

const lobbying: LobbyingSummary = {
  state: 'reported',
  registered_lobbyists: 1665,
  principals_reporting: 1250,
  latest_reported_year: 2025,
  first_year: 2014,
  last_year: 2025,
  release_id: 'test-release',
  copied_at: '2026-09-13T18:00:00Z',
  sources: { expenditures: null, lobbyists: null },
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
  viewport.width = 1600;
  queries.summary.mockReturnValue({ data: summary, isLoading: false, isPending: false });
  queries.filings.mockReturnValue({ data: feed(), isLoading: false, isPending: false });
  queries.lobbying.mockReturnValue({ data: lobbying, isLoading: false, isPending: false });
  queries.research.mockReturnValue([
    {
      slug: 'example',
      title: 'Example research',
      dek: 'A sample piece',
      publishedOn: '2026-08-20',
      recordsThrough: '2026-07-20',
    },
  ]);
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

function sourceToggle(host: HTMLElement, label = 'View source links') {
  const button = [...host.querySelectorAll<HTMLElement>('button,[role="button"]')].find((node) =>
    node.textContent?.includes(label),
  );
  expect(button, `Missing source disclosure button: ${label}`).toBeDefined();
  return button!;
}

function pressKey(element: HTMLElement, key: string, code: string) {
  act(() => {
    element.focus();
    element.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true }));
    // jsdom does not perform the browser's default keyboard click on a native
    // button. Non-native Pressables must supply their own key handling instead.
    if (element.tagName === 'BUTTON') element.click();
  });
}

describe('the money landing makes the reporting periods and destinations explicit', () => {
  it('names the destination exactly as the menu and homepage button do', () => {
    const { host } = mount();
    expect(host.querySelector('[role="heading"][aria-level="1"]')?.textContent).toBe(
      'Money in politics',
    );
    expect(host.textContent).not.toContain('Follow the money');
  });

  it('labels a mixed-period list separately from the dated newest-period count', () => {
    const { host } = mount();
    const words = host.textContent!;
    const periodLine = exactText(
      host,
      'Latest completed period: 1,203 reports cover through Jul 20, 2026',
    );
    const periodColumn = periodLine.parentElement!;
    const orderingLine = exactText(
      host,
      'Newest first by received date.\nIf missing, we use the reporting period’s end.',
    );
    expect(words).toContain('RECENTLY FILED REPORTS');
    expect(words).not.toContain('THE MOST RECENT COMPLETED FILING PERIOD');
    expect(words).toContain('Latest completed period: 1,203 reports cover through Jul 20, 2026');
    expect(words).toContain('covers Jan 1, 2025 – Dec 31, 2025');
    expect(words).toContain('covers Jan 1, 2026 – Jul 20, 2026');
    expect(words).toContain(
      'Newest first by received date.\nIf missing, we use the reporting period’s end.',
    );
    expect(getComputedStyle(orderingLine).textAlign).toBe('right');
    expect(getComputedStyle(periodColumn).flexGrow).toBe('1.26');
    expect(getComputedStyle(orderingLine).flexGrow).toBe('0.74');
    expect(getComputedStyle(periodLine).marginTop).toBe('23px');
    expect(words).not.toContain('Never by amount');
    expect(words).not.toContain('reports cover this period');
  });

  it('restores the compact heading spacing when the report heading stacks', () => {
    viewport.width = 900;
    const { host } = mount();
    const periodLine = exactText(
      host,
      'Latest completed period: 1,203 reports cover through Jul 20, 2026',
    );
    expect(getComputedStyle(periodLine).marginTop).toBe('14px');
  });

  it('links a known registration number without inventing a link or received date for another name', () => {
    const { host, navigate } = mount();
    const link = exactText(host, 'Example Political Fund').closest('a')!;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/money/committees/example-political-fund-00123');
    expect(link.textContent).toContain('2026 Pre-Primary Report');
    expect(link.textContent).toContain('covers Jan 1, 2026 – Jul 20, 2026');
    expect(link.textContent).toContain('Filed Aug 11, 2026');
    expect(link.querySelector('a')).toBeNull();
    act(() => link.click());
    expect(navigate).toHaveBeenCalledWith('CommitteeMoney', {
      slug: 'example-political-fund-00123',
    });
    expect(exactText(host, 'Unidentified Filer').closest('a,[role="link"]')).toBeNull();
    expect(host.textContent).toContain('Filed Aug 11, 2026');
    expect(host.textContent).not.toContain('Filed Dec 31, 2025');
  });

  it('does not publish a latest-period count without a known cutoff', () => {
    queries.filings.mockReturnValue({
      data: { ...feed(), newestPeriod: { periodEnd: null, filingCount: 1203 } },
      isLoading: false,
      isPending: false,
    });
    const { host } = mount();
    expect(host.textContent).not.toContain('Latest completed period');
    expect(host.textContent).not.toContain('1,203');
    expect(host.textContent).toContain('Example Political Fund');
  });

  it('keeps the search examples visible outside the short phone-friendly field', () => {
    const { host } = mount();
    expect(host.querySelector('input')?.placeholder).toBe('Search a name');
    expect(host.textContent).toContain(
      'Try all or part of a name: a person, committee, payee, or lobbyist',
    );
    expect(host.textContent).toContain(
      'Search Minnesota’s published campaign donations, payments, and lobbying records',
    );
    expect(host.textContent).not.toContain('lobbying records by name');
    expect(host.textContent).not.toContain('Spelling must match the filing');
  });

  it('uses Libre Franklin with tabular digits for counts and each kind of date', () => {
    const { host } = mount();
    for (const words of [
      '200 MEMBERS',
      '1,665 REGISTERED LOBBYISTS',
      'Sep 1, 2026',
      'Sep 13, 2026',
      'PUBLISHED AUG 20 2026',
      'Filed Aug 11, 2026',
    ]) {
      const style = getComputedStyle(exactText(host, words));
      expect(style.fontFamily, words).toContain('Libre Franklin');
      expect(style.fontVariant, words).toContain('tabular-nums');
    }
  });

  it.each([1600, 1280, 900, 375])(
    'keeps all destinations and the source disclosure at %ipx',
    (width) => {
      viewport.width = width;
      const { host } = mount();
      for (const href of [
        '/legislators',
        '/money/committees',
        '/money/search',
        '/money/races',
        '/money/outside-spending',
        '/money/lobbying',
      ]) {
        expect(host.querySelector(`a[href="${href}"]`), href).not.toBeNull();
      }
      expect(sourceToggle(host).getAttribute('aria-expanded')).toBe('false');
      expect(host.querySelector('a[href^="https://cfb.mn.gov/"]')).toBeNull();
      expect(host.textContent).toContain('Sep 1, 2026');
      expect(host.textContent).toContain('Sep 13, 2026');
    },
  );

  it.each([
    { width: 1600, columns: 6, gutter: 56, gap: 16, titleHeight: 50 },
    { width: 1280, columns: 3, gutter: 56, gap: 16, titleHeight: 32 },
    { width: 900, columns: 2, gutter: 32, gap: 14, titleHeight: 30 },
    { width: 375, columns: 1, gutter: 20, gap: 12, titleHeight: 0 },
  ])('sizes the navigation cards for $columns columns at $width px', (layout) => {
    viewport.width = layout.width;
    const { host } = mount();
    const grid = host.querySelector<HTMLElement>('[data-testid="money-lanes"]')!;
    const cards = [...grid.children] as HTMLElement[];
    expect(cards).toHaveLength(6);
    const expectedWidth =
      (layout.width - layout.gutter * 2 - layout.gap * (layout.columns - 1)) / layout.columns;
    expect(getComputedStyle(grid).gap).toBe(`${layout.gap}px`);
    for (const card of cards) {
      expect(parseFloat(getComputedStyle(card).width)).toBeCloseTo(expectedWidth, 2);
      const titleRow = card.firstElementChild as HTMLElement;
      expect(parseFloat(getComputedStyle(titleRow).minHeight)).toBe(layout.titleHeight);
    }
    const sourceBox = host.querySelector<HTMLElement>('[data-testid="money-sources"]')!;
    const sourceGroup = sourceBox.parentElement!;
    expect(getComputedStyle(sourceGroup).flexDirection).toBe(
      layout.width < 1100 ? 'column' : 'row',
    );
    const researchGroup = exactText(host, 'RESEARCH').parentElement!;
    const reportGroup = host.querySelector<HTMLElement>(
      'a[href="/money/committees/example-political-fund-00123"]',
    )!.parentElement!.parentElement!;
    for (const group of [researchGroup, sourceGroup, reportGroup]) {
      expect(getComputedStyle(group).borderTopWidth).toBe('1px');
    }
    expect(new Set([researchGroup, sourceGroup, reportGroup]).size).toBe(3);
  });

  it('puts research before the source and limits boxes, then the reports', () => {
    const { host } = mount();
    const words = host.textContent!;
    const sections = [
      '1,665 REGISTERED LOBBYISTS',
      'RESEARCH',
      'SOURCES AND COPY DATES',
      'LIMITS OF THE CAMPAIGN RECORDS',
      'RECENTLY FILED REPORTS',
    ];
    const positions = sections.map((label) => words.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(words).toContain('PUBLISHED AUG 20 2026');
    expect(words).not.toContain('RECORDS THROUGH');
  });

  it('expands source groups with specific links and removes them when closed', () => {
    const { host } = mount();
    const button = sourceToggle(host);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    act(() => button.click());
    expect(sourceToggle(host, 'Hide source links').getAttribute('aria-expanded')).toBe('true');
    const controlledId = sourceToggle(host, 'Hide source links').getAttribute('aria-controls');
    expect(controlledId).toBeTruthy();
    expect(document.getElementById(controlledId!)).not.toBeNull();
    for (const [label, href] of [
      ['Candidate reports', 'viewers/campaign-finance/candidates/'],
      ['candidate committees', 'viewers/campaign-finance/candidates/'],
      ['committees and funds', 'viewers/campaign-finance/political-committee-fund/'],
      ['party units', 'viewers/campaign-finance/party-unit/'],
      ['Campaign finance downloads', 'self-help/data-downloads/campaign-finance/'],
      ['Lobbying downloads', 'self-help/data-downloads/lobbying/'],
    ]) {
      const link = exactText(host, label).closest('a')!;
      expect(link.getAttribute('href')).toBe(`https://cfb.mn.gov/reports-and-data/${href}`);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    }
    expect(host.textContent).toContain('Legislators, Candidate committees and Money by race');
    expect(host.textContent).toContain('Committees and Party units');
    expect(host.textContent).toContain('Donations, Who got paid and Outside spending');
    act(() => sourceToggle(host, 'Hide source links').click());
    expect(host.querySelector('a[href^="https://cfb.mn.gov/"]')).toBeNull();
    expect(host.textContent).not.toContain('Candidate reports');
    expect(sourceToggle(host).getAttribute('aria-expanded')).toBe('false');
  });

  it('lets the keyboard open and close the disclosure', () => {
    const { host } = mount();
    const button = sourceToggle(host);
    expect(button.tabIndex).toBe(0);
    pressKey(button, 'Enter', 'Enter');
    expect(sourceToggle(host, 'Hide source links').getAttribute('aria-expanded')).toBe('true');
    pressKey(sourceToggle(host, 'Hide source links'), ' ', 'Space');
    expect(sourceToggle(host).getAttribute('aria-expanded')).toBe('false');
  });

  it('starts a new visit with the source links closed', () => {
    const firstVisit = mount();
    act(() => sourceToggle(firstVisit.host).click());
    expect(sourceToggle(firstVisit.host, 'Hide source links').getAttribute('aria-expanded')).toBe(
      'true',
    );
    act(() => root.unmount());
    const { host } = mount();
    expect(sourceToggle(host).getAttribute('aria-expanded')).toBe('false');
  });

  it('uses each source’s own date instead of a hard-coded or shared date', () => {
    queries.summary.mockReturnValue({
      data: { ...summary, freshness: { downloadsFetchedAt: '2026-09-09T02:00:00Z' } },
    });
    queries.lobbying.mockReturnValue({ data: { ...lobbying, copied_at: '2026-09-15T18:00:00Z' } });
    const { host } = mount();
    expect(host.textContent).toContain('Campaign payment files last copied: Sep 8, 2026');
    expect(host.textContent).toContain('Lobbying files last copied: Sep 15, 2026');
    expect(host.textContent).not.toContain('Sep 1, 2026');
    expect(host.textContent).not.toContain('Sep 13, 2026');
    expect(host.textContent).not.toContain('REGISTERED TODAY');
  });

  it('does not claim every committee match is confirmed when only some are', () => {
    queries.summary.mockReturnValue({
      data: {
        ...summary,
        confirmations: { ...summary.confirmations, confirmedMemberCount: 150 },
      },
    });
    const { host } = mount();
    expect(host.textContent).toContain("150 of Minnesota's 200 sitting legislators");
    expect(host.textContent).not.toContain('with their committee match confirmed');
  });

  it('does not claim committee matches when confirmation data is unavailable', () => {
    queries.summary.mockReturnValue({
      data: { ...summary, confirmations: { ...summary.confirmations, state: 'unavailable' } },
    });
    const { host } = mount();
    expect(host.textContent).not.toContain('with their committee match confirmed');
    expect(host.textContent).not.toContain('200 MEMBERS');
  });

  it.each(['campaign', 'lobbying', 'both'])('keeps sources when %s data is missing', (missing) => {
    if (missing !== 'lobbying') queries.summary.mockReturnValue({ data: undefined });
    if (missing !== 'campaign') queries.lobbying.mockReturnValue({ data: undefined });
    const { host } = mount();
    expect(host.textContent).toContain('SOURCES AND COPY DATES');
    expect(host.textContent).toContain(
      'Records from the Minnesota Campaign Finance and Public Disclosure Board',
    );
    expect(host.textContent).toContain('Copy date unavailable');
    expect(host.textContent).not.toMatch(/(?:^|\D)0 MEMBERS/);
    expect(host.textContent).not.toMatch(/(?:^|\D)0 REGISTERED LOBBYISTS/);
    if (missing !== 'lobbying') expect(host.textContent).not.toContain('Sep 1, 2026');
    if (missing !== 'campaign') expect(host.textContent).not.toContain('Sep 13, 2026');
    expect(sourceToggle(host)).toBeDefined();
  });

  it('keeps the empty research message in the green card without a made-up count', () => {
    queries.research.mockReturnValue([]);
    const { host } = mount();
    let card: HTMLElement | null = exactText(host, 'Nothing is published yet');
    while (card && getComputedStyle(card).backgroundColor !== 'rgb(234, 246, 239)') {
      card = card.parentElement;
    }
    expect(card).not.toBeNull();
    expect(host.textContent).not.toContain('PUBLISHED AUG');
    expect(host.textContent).not.toContain('0 pieces');
  });

  it('preserves the report loading state without making up rows', () => {
    queries.filings.mockReturnValue({ data: undefined, isLoading: true, isPending: true });
    const { host } = mount();
    expect(host.querySelector('[aria-label="Loading filed reports"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Example Political Fund');
    expect(host.textContent).not.toContain('Latest completed period');
  });

  it('does not invent recent reports for an empty response', () => {
    queries.filings.mockReturnValue({ data: { ...feed(), filings: [], newestPeriod: null } });
    const { host } = mount();
    expect(host.textContent).not.toContain('Example Political Fund');
    expect(host.textContent).not.toContain('Latest completed period');
    expect(
      host.querySelector('a[href="/money/committees/example-political-fund-00123"]'),
    ).toBeNull();
  });

  it('does not treat an unavailable feed as reported filings', () => {
    queries.filings.mockReturnValue({ data: { ...feed(), state: 'unavailable' } });
    const { host } = mount();
    expect(host.textContent).not.toContain('Example Political Fund');
    expect(host.textContent).not.toContain('Latest completed period');
  });

  it('describes period ordering honestly when received dates are absent', () => {
    queries.filings.mockReturnValue({
      data: {
        ...feed(),
        orderedBy: 'period_end',
        filings: feed().filings.map((filing) => ({ ...filing, filedDate: null })),
      },
    });
    const { host } = mount();
    expect(host.textContent).not.toContain('Most recently received first');
    expect(host.textContent).not.toContain('Never by amount');
    expect(host.textContent).not.toContain('Filed Aug 11, 2026');
    expect(host.textContent).toContain('reporting periods first');
  });

  it('keeps served reports visible while a background refresh is running', () => {
    queries.filings.mockReturnValue({
      data: feed(),
      isLoading: false,
      isPending: false,
      isFetching: true,
    });
    const { host } = mount();
    expect(host.textContent).toContain('Example Political Fund');
    expect(host.textContent).toContain('Filed Aug 11, 2026');
  });
});
