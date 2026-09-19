// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return {
    width: 1440,
    summary: {} as Record<string, unknown>,
    lobbyists: {} as Record<string, unknown>,
    principals: {} as Record<string, unknown>,
  };
});
vi.mock('../../../hooks/useLobbyingNameSearch', () => ({
  useLobbyingNameSearch: () => ({
    lobbyists: { isPending: true },
    principals: { isPending: true },
  }),
}));
vi.mock('../../../hooks/useLobbying', () => ({
  useLobbyingSummary: () => state.summary,
  useLobbyingLobbyists: () => state.lobbyists,
  useLobbyingPrincipals: () => state.principals,
}));
vi.mock('../../../hooks/useAppQueries', () => ({
  useCampaignFinanceSummary: () => ({ data: undefined, isPending: false, isLoading: false }),
  useCampaignFinanceFilings: () => ({ data: undefined, isPending: false, isLoading: false }),
  useWarmMoneyDestinations: () => {},
}));
vi.mock('../../../lib/research', () => ({
  piecesLabelledResearch: () => [],
  researchDatesLine: () => '',
}));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({
    width: state.width,
    isMobile: state.width < 768,
    isTablet: state.width >= 768 && state.width < 1100,
    isDesktop: state.width >= 1100,
  }),
}));
vi.mock('../../../navigation/documentTitle', () => ({ useDocumentTitle: vi.fn() }));
vi.mock('../../../theme/primitives', async () => {
  const { View } = await import('react-native');
  return { PageBackground: View, Container: View, TopNav: () => null, Footer: () => null };
});
vi.mock('react-native-svg', () => ({
  default: () => null,
  Path: () => null,
  Circle: () => null,
  Polygon: () => null,
}));
vi.mock('@react-navigation/native', async () => {
  const { useEffect } = await import('react');
  return {
    useNavigation: () => ({}),
    useRoute: () => ({}),
    useIsFocused: () => true,
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});

import { Pagination } from '../../../components/search/searchPieces';
import { MoneyNameSearchField } from '../../../components/campaignMoney/MoneyNameSearchField';
import { theme } from '../../../theme/tokens';
import { MoneyLandingScreen } from '../MoneyLandingScreen';
import { LobbyingLandingScreen } from '../LobbyingLandingScreen';
import { LobbyingLobbyistsScreen } from '../LobbyingLobbyistsScreen';
import { LobbyingPrincipalsScreen } from '../LobbyingPrincipalsScreen';
import { LOBBYING_DIRECTORY_COPY as copy } from '../../../lib/lobbyingDirectoryCopy';
import { directoryRowWebCss } from '../../../theme/directoryRows';
import { lobbyingPageMetadata } from '../../../lib/lobbyingMetadata';
import { useDocumentTitle } from '../../../navigation/documentTitle';
import fixture from './fixtures/lobbying-directories-live.json';

let root: Root;
let host: HTMLDivElement;
const navigation = { navigate: vi.fn(), push: vi.fn(), replace: vi.fn(), setParams: vi.fn() };
const success = (data: unknown) => ({
  data,
  isPending: false,
  isSuccess: true,
  isError: false,
  refetch: vi.fn(),
});
const route = (name: string, params: object = {}) => ({ key: name, name, params }) as never;
const render = (element: ReactNode) => act(() => root.render(element));
const words = () => host.textContent ?? '';
const listRows = () => [...host.querySelectorAll('[role="listitem"]')];
// The directory's 2 choice controls are drawn, so a test opens the list and
// presses an option exactly as a reader does.
const menus = () => [...host.querySelectorAll('[role="combobox"]')] as HTMLElement[];
const openMenu = (which: number) => act(() => menus()[which].click());
const listedOptions = () => [...host.querySelectorAll('[role="option"]')] as HTMLElement[];
const pick = (which: number, text: string) => {
  openMenu(which);
  const choice = listedOptions().find((item) => item.textContent === text)!;
  act(() => choice.click());
};
const press = (which: number, key: string) =>
  act(() => {
    menus()[which].dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });

// jsdom does not compute the modern font-variant shorthand. Read the CSS rule
// attached to the rendered element so the check still covers the shipped style.
function renderedFontVariant(element: Element): string {
  return (
    [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .filter(
        (rule): rule is CSSStyleRule =>
          rule instanceof CSSStyleRule &&
          Boolean(rule.style.getPropertyValue('font-variant')) &&
          element.matches(rule.selectorText),
      )
      .map((rule) => rule.style.getPropertyValue('font-variant'))
      .filter(Boolean)
      .at(-1) ?? ''
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state.width = 1440;
  state.summary = success(fixture.summary);
  state.lobbyists = success(fixture.lobbyists_page_2);
  state.principals = success(fixture.principals_page_2);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('lobbying landing', () => {
  it('draws the real counts and corrected coverage without an invented amount', () => {
    render(
      <LobbyingLandingScreen navigation={navigation as never} route={route('LobbyingLanding')} />,
    );
    expect(words()).toContain('1,665 LOBBYISTS LISTED');
    expect(words()).toContain('1,748 ORGANISATIONS REPORTED SPENDING FOR 2025');
    expect(words()).toContain('Sep 13, 2026');
    expect(words()).toContain(copy.annual);
    expect(words()).toContain('The spending records shown here begin in 2014');
    expect(words()).toContain('Minnesota Campaign Finance and Public Disclosure Board');
    expect(words()).toContain('RECORDS LAST COPIED');
    expect(words()).toContain(
      'People registered to influence government decisions on behalf of others',
    );
    expect(words()).toContain(
      'People or organisations that fund lobbying and must report their spending under Minnesota law',
    );
    const source = host.querySelector(
      'a[href="https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/"]',
    );
    expect(source?.textContent).toContain('Minnesota’s lobbying source files');
    expect(source?.getAttribute('target')).toBe('_blank');
    expect(words()).not.toContain('registered to lobby today');
    expect(words()).not.toContain('properties of the record itself');
    expect(words()).not.toContain('$');
    expect(host.querySelector('a[href="/money/lobbying/principals"]')).not.toBeNull();
    expect(host.querySelector('a[href="/money/lobbying/lobbyists"]')).not.toBeNull();
    expect(
      getComputedStyle(host.querySelector('[data-testid="lobbying-main"]')!).paddingBottom,
    ).toBe('88px');
    expect(useDocumentTitle).toHaveBeenCalledWith(
      '/money/lobbying',
      lobbyingPageMetadata('/money/lobbying', 'Lobbying').title,
    );
  });
  it('keeps the lanes reachable when the source cannot load and invents no zero', () => {
    state.summary = { isPending: false, isError: true, refetch: vi.fn() };
    render(
      <LobbyingLandingScreen navigation={navigation as never} route={route('LobbyingLanding')} />,
    );
    expect(words()).toContain(copy.unavailable);
    expect(words()).toContain('Try again');
    expect(words()).not.toContain('0 REGISTERED');
    expect(words()).not.toContain('2014');
    expect(host.querySelector('a[href="/money/lobbying/lobbyists"]')).not.toBeNull();
  });
  it('stacks the full-width search button below its 52px phone field', () => {
    state.width = 375;
    render(
      <LobbyingLandingScreen navigation={navigation as never} route={route('LobbyingLanding')} />,
    );
    const input = host.querySelector('input')!;
    const button = host.querySelector('[role="button"]')!;
    expect(input.getAttribute('placeholder')).toBe('Search by name');
    expect(words()).toContain('Find lobbyists or organisations using all or part of a name.');
    expect(getComputedStyle(input.parentElement!).height).toBe('52px');
    expect(getComputedStyle(input).height).toBe('100%');
    expect(getComputedStyle(input.parentElement!.parentElement!).flexDirection).toBe('column');
    expect(getComputedStyle(button).width).toBe('100%');
    expect(getComputedStyle(button).minHeight).toBe('52px');
    expect(
      getComputedStyle(host.querySelector('[data-testid="lobbying-main"]')!).paddingBottom,
    ).toBe('56px');
  });
});

describe('optional lobbying control styles', () => {
  it('leaves the existing pagination size unchanged without the variant', () => {
    render(
      <Pagination page={2} totalPages={5} hasPrev hasNext onPrev={() => {}} onNext={() => {}} />,
    );
    const label = host.querySelector('[aria-live="polite"]')!;
    expect(getComputedStyle(label).fontSize).toBe(`${theme.fontSizes.small}px`);
    expect(renderedFontVariant(label)).not.toBe('tabular-nums');
  });
  it('keeps the existing name field in a row unless stacking was requested', () => {
    render(
      <MoneyNameSearchField
        value=""
        onChangeText={() => {}}
        onSubmit={() => {}}
        placeholder="Name"
        showSubmitButton
      />,
    );
    const input = host.querySelector('input')!;
    expect(getComputedStyle(input.parentElement!.parentElement!).flexDirection).toBe('row');
    expect(getComputedStyle(input.parentElement!).height).not.toBe('52px');
    expect(getComputedStyle(input).height).not.toBe('100%');
  });
});

describe('the sixth /money lane', () => {
  it('opens lobbying, uses the served count and removes the old notice', () => {
    render(<MoneyLandingScreen navigation={navigation as never} route={route('MoneyLanding')} />);
    const lane = host.querySelector('a[href="/money/lobbying"]')!;
    expect(lane.textContent).toContain('1,665 REGISTERED LOBBYISTS');
    expect(words()).toContain('LIMITS OF THE CAMPAIGN RECORDS');
    expect(words()).toContain('Payment records start in 2015');
    expect(words()).not.toContain('Under development');
    act(() => (lane as HTMLElement).click());
    expect(navigation.navigate).toHaveBeenCalledWith('LobbyingLanding');
  });
  it('shows the lobbying destination with no remembered count after an unavailable read', () => {
    state.summary = success({
      ...fixture.summary,
      state: 'unavailable',
      registered_lobbyists: null,
    });
    render(<MoneyLandingScreen navigation={navigation as never} route={route('MoneyLanding')} />);
    const lane = host.querySelector('a[href="/money/lobbying"]')!;
    expect(lane).not.toBeNull();
    expect(lane.textContent).not.toContain('REGISTERED LOBBYISTS');
  });
});

describe('lobbying directories', () => {
  it('keeps year and dollar order in links and resets the page when a control changes', () => {
    state.lobbyists = success({
      ...fixture.lobbyists_page_2,
      q: 'Ann',
      requested_year: 2025,
      sort: 'donations_desc',
      donations: {
        state: 'reported',
        year: 2025,
        available_years: [2025, 2024],
        eligible_count: 2,
        copied_at: '2026-09-01T12:00:00Z',
        source_url: 'https://cfb.mn.gov/source.csv',
      },
      lobbyists: fixture.lobbyists_page_2.lobbyists.slice(0, 3).map((row, index) => ({
        ...row,
        donation_state: index === 0 ? 'reported' : index === 1 ? 'no_records' : 'unavailable',
        donation_amount: index === 0 ? '1200.0000' : null,
      })),
    });
    render(
      <LobbyingLobbyistsScreen
        navigation={navigation as never}
        route={route('LobbyingLobbyists', {
          q: 'Ann',
          page: '2',
          year: '2025',
          sort: 'donations_desc',
        })}
      />,
    );
    expect(words()).toContain('$1,200 recorded in 2025');
    expect(words()).toContain('No matching donation records');
    expect(words()).toContain('Amount unavailable');
    expect(words()).not.toContain('$0');
    expect(listRows()[0].querySelector('a')?.getAttribute('href')).toContain('?year=2025');
    const next = new URL(
      host.querySelector('a[aria-label="Next page"]')!.getAttribute('href')!,
      'https://test',
    );
    // The opening dollar order is left out of the address; every other value stays.
    expect(Object.fromEntries(next.searchParams)).toEqual({
      q: 'Ann',
      page: '3',
      year: '2025',
    });
    pick(0, '2024');
    expect(navigation.setParams).toHaveBeenCalledWith({ year: '2024', page: undefined });
    pick(1, 'Recorded amount: lowest first');
    expect(navigation.setParams).toHaveBeenCalledWith({
      sort: 'donations_asc',
      page: undefined,
      year: '2025',
    });
    pick(1, 'Recorded amount: highest first');
    expect(navigation.setParams).toHaveBeenCalledWith({
      sort: undefined,
      page: undefined,
      year: '2025',
    });
    const disclosure = [...host.querySelectorAll('[role="button"]')].find(
      (item) => item.textContent === 'How these amounts are counted',
    ) as HTMLElement;
    act(() => disclosure.click());
    expect(words()).toContain('Campaign contribution file copied Sep 1, 2026');
    expect(words()).toContain(
      'Finding no matching records does not mean the lobbyist gave nothing.',
    );
  });
  it('hides a previous year’s amounts while the requested year loads', () => {
    state.lobbyists = success({ ...fixture.lobbyists_page_2, requested_year: 2025, sort: 'name' });
    render(
      <LobbyingLobbyistsScreen
        navigation={navigation as never}
        route={route('LobbyingLobbyists', { page: '2', year: '2024' })}
      />,
    );
    expect(listRows()).toHaveLength(0);
    expect(words()).toContain(copy.lobbyists.loading);
  });
  it('puts phone donation amounts beneath the name and client count', () => {
    state.width = 390;
    state.lobbyists = success({
      ...fixture.lobbyists_page_2,
      donations: { year: 2025, available_years: [2025], eligible_count: 1 },
      lobbyists: [
        {
          ...fixture.lobbyists_page_2.lobbyists[0],
          donation_state: 'reported',
          donation_amount: '50',
        },
      ],
    });
    render(
      <LobbyingLobbyistsScreen
        navigation={navigation as never}
        route={route('LobbyingLobbyists', { page: '2' })}
      />,
    );
    expect(getComputedStyle(listRows()[0].querySelector('a')!).flexDirection).toBe('column');
  });

  it('draws page 2 of real registered lobbyists with ordinary next/previous links', () => {
    render(
      <LobbyingLobbyistsScreen
        navigation={navigation as never}
        route={route('LobbyingLobbyists', { page: '2' })}
      />,
    );
    expect(words()).toContain('Showing 51–100 of 1,665 registered lobbyists');
    expect(listRows()).toHaveLength(50);
    expect(words()).toContain('Askelin, Laura');
    expect(words()).toContain('1 client listed');
    expect(words()).toContain('Search lobbyists by name');
    expect(words()).not.toContain(copy.directoryLabel);
    expect(getComputedStyle(host.querySelector('[aria-level="1"]')!).marginTop).toBe('14px');
    expect(words()).toContain('You can enter a full or partial name');
    expect(words()).toContain('Lobbyist registration list copied Sep 13, 2026');
    expect(host.querySelector('a[href="/money/lobbying/lobbyists?page=3"]')).not.toBeNull();
    expect(host.querySelector('a[aria-label="Previous page"]')?.getAttribute('href')).toBe(
      '/money/lobbying/lobbyists',
    );
    // The results heading is polite too, so pick the pagination label by its words.
    const pageLabel = [...host.querySelectorAll('[aria-live="polite"]')].find((item) =>
      /^Page /.test(item.textContent ?? ''),
    )!;
    expect(getComputedStyle(pageLabel).fontSize).toBe('15px');
    expect(renderedFontVariant(pageLabel)).toBe('tabular-nums');
    expect(
      [...host.querySelectorAll('a')].some((a) => /^Page \d+$/.test(a.textContent ?? '')),
    ).toBe(false);
    expect(words()).not.toContain('Show the next 50');
    expect(words()).not.toContain('Jump to a letter');
    expect(useDocumentTitle).toHaveBeenCalledWith(
      '/money/lobbying/lobbyists',
      lobbyingPageMetadata('/money/lobbying/lobbyists?page=2', 'Lobbyists', {
        kind: 'directory',
        page: 2,
      }).title,
    );
  });
  it('counts principals from both files and gives active-only names no link', () => {
    render(
      <LobbyingPrincipalsScreen
        navigation={navigation as never}
        route={route('LobbyingPrincipals', { page: '2' })}
      />,
    );
    expect(words()).toContain('Showing 51–100 of 3,443 principals');
    expect(words()).toContain(copy.principals.intro);
    expect(words()).toContain(copy.principals.definition);
    expect(words()).toContain(copy.directoryLabel);
    expect(words()).toContain('Search organisations by name');
    expect(words()).toContain('The Lobbying page’s spending count covers 2025 only.');
    expect(listRows()).toHaveLength(50);
    const plain = fixture.principals_page_2.principals.find((row) => !row.linkable)!;
    expect(plain).toBeDefined();
    const rendered = listRows().find((row) => row.textContent?.includes(plain.name))!;
    expect(rendered.querySelector('a')).toBeNull();
    expect(rendered.textContent).toContain(
      "No spending rows in the Board's file through 2025, so no page to open",
    );
  });
  it('preserves q in numbered links and does not show a previous query’s empty state', () => {
    state.principals = success({ ...fixture.principals_page_2, q: 'Assn' });
    render(
      <LobbyingPrincipalsScreen
        navigation={navigation as never}
        route={route('LobbyingPrincipals', { q: 'Assn', page: '2' })}
      />,
    );
    const next = new URL(
      host.querySelector('a[aria-label="Next page"]')!.getAttribute('href')!,
      'https://test',
    );
    expect(next.searchParams.get('q')).toBe('Assn');
    expect(next.searchParams.get('page')).toBe('3');
    expect(useDocumentTitle).toHaveBeenCalledWith(
      '/money/lobbying/principals',
      lobbyingPageMetadata('/money/lobbying/principals?q=Assn&page=2', 'Principals', {
        kind: 'directory',
        page: 2,
        noindex: true,
      }).title,
    );
    state.principals = success({
      ...fixture.principals_page_2,
      q: 'Old name',
      offset: 0,
      state: 'not_reported',
      total: 0,
      principals: [],
    });
    render(
      <LobbyingPrincipalsScreen
        navigation={navigation as never}
        route={route('LobbyingPrincipals', { q: 'New name' })}
      />,
    );
    expect(words()).toContain(copy.principals.loading);
    expect(words()).not.toContain(copy.principals.empty);
    expect(host.querySelector('input')?.value).toBe('New name');
  });
  it.each(['lobbyists', 'principals'] as const)(
    'never calls a failed %s read an absence',
    (kind) => {
      state[kind] = { isPending: false, isSuccess: false, isError: true, refetch: vi.fn() };
      const Screen = kind === 'lobbyists' ? LobbyingLobbyistsScreen : LobbyingPrincipalsScreen;
      render(<Screen navigation={navigation as never} route={route(kind)} />);
      expect(words()).toContain(copy[kind].unavailable);
      expect(words()).not.toContain(copy[kind].empty);
      const retry = [...host.querySelectorAll('[role="button"]')].find(
        (button) => button.textContent === 'Try again',
      )!;
      act(() => (retry as HTMLElement).click());
      expect(state[kind].refetch).toHaveBeenCalledOnce();
    },
  );
  it('shows a completed empty search with its own filed-name caveat', () => {
    state.principals = success({
      ...fixture.principals_page_2,
      q: 'No match',
      offset: 0,
      state: 'not_reported',
      total: 0,
      principals: [],
    });
    render(
      <LobbyingPrincipalsScreen
        navigation={navigation as never}
        route={route('LobbyingPrincipals', { q: 'No match' })}
      />,
    );
    expect(words()).toContain(copy.principals.empty);
    expect(words()).toContain(copy.noMatchWhy);
    expect(words()).toContain('0 principals');
    expect(words()).not.toContain('reported spending under');
  });
  it('does not call a later empty filtered page an absence of matching names', () => {
    state.principals = success({
      ...fixture.principals_page_2,
      q: 'Assn',
      offset: 50,
      total: 8,
      principals: [],
    });
    render(
      <LobbyingPrincipalsScreen
        navigation={navigation as never}
        route={route('LobbyingPrincipals', { q: 'Assn', page: '2' })}
      />,
    );
    expect(words()).toContain('8 principals');
    expect(words()).toContain(copy.emptyPage);
    expect(words()).not.toContain(copy.principals.empty);
    expect(words()).not.toContain('51–50');
    const first = [...host.querySelectorAll('a')].find((a) => a.textContent === copy.firstPage)!;
    expect(new URL(first.href).searchParams.get('q')).toBe('Assn');
  });
  it('sends a completed out-of-range directory to the not-found screen', () => {
    state.lobbyists = success({ ...fixture.lobbyists_page_2, offset: 49950, lobbyists: [] });
    render(
      <LobbyingLobbyistsScreen
        navigation={navigation as never}
        route={route('LobbyingLobbyists', { page: '1000' })}
      />,
    );
    expect(navigation.replace).toHaveBeenCalledWith('NotFound', {
      path: '/money/lobbying/lobbyists?page=1000',
    });
  });
});

it('explains when no completed year supports an amount without printing a blank year', () => {
  state.lobbyists = success({
    ...fixture.lobbyists_page_2,
    requested_year: null,
    sort: 'donations_desc',
    donations: { state: 'reported', year: null, available_years: [], eligible_count: 0 },
  });
  render(
    <LobbyingLobbyistsScreen
      navigation={navigation as never}
      route={route('LobbyingLobbyists', { page: '2' })}
    />,
  );
  expect(words()).toContain('Donation amounts are unavailable.');
  expect(words()).not.toContain('amount available for .');
});

it('counts supported amounts against every match, not the visible page', () => {
  state.lobbyists = success({
    ...fixture.lobbyists_page_2,
    requested_year: null,
    sort: 'donations_desc',
    donations: { state: 'reported', year: 2025, available_years: [2025], eligible_count: 1 },
  });
  render(
    <LobbyingLobbyistsScreen
      navigation={navigation as never}
      route={route('LobbyingLobbyists', { page: '2' })}
    />,
  );
  // 50 rows are on screen and the line still speaks for all 1,665 matches.
  expect(words()).toContain(
    '2025 campaign contribution amounts are available for 1 of the 1,665 lobbyists in these results',
  );
});

describe('the lobbyist results card', () => {
  const lobbyists = (over: object = {}) =>
    success({
      ...fixture.lobbyists_page_2,
      offset: 0,
      requested_year: 2025,
      sort: 'donations_desc',
      donations: {
        state: 'reported',
        year: 2025,
        available_years: [2025, 2024],
        eligible_count: 2,
        copied_at: '2026-09-01T12:00:00Z',
        source_url: 'https://cfb.mn.gov/source.csv',
      },
      ...over,
    });
  const screen = (params: object = {}) => (
    <LobbyingLobbyistsScreen
      navigation={navigation as never}
      route={route('LobbyingLobbyists', { year: '2025', sort: 'donations_desc', ...params })}
    />
  );

  it('puts the count and both controls in one card header and drops the repeated caption', () => {
    state.lobbyists = lobbyists();
    render(screen());
    const heading = [...host.querySelectorAll('[aria-level="2"]')][0];
    expect(heading.textContent).toContain('registered lobbyists');
    expect(heading.getAttribute('aria-live')).toBe('polite');
    const header = heading.parentElement!;
    const boxes = [...header.querySelectorAll('[role="combobox"]')];
    expect(boxes).toHaveLength(2);
    expect(boxes.map((box) => box.textContent)).toEqual(['2025', 'Recorded amount: highest first']);
    // The Sort by control names the order, so nothing repeats it as a caption.
    const captions = [...host.querySelectorAll('*')].filter(
      (item) => item.children.length === 0 && item.textContent === 'Name A–Z',
    );
    expect(captions).toHaveLength(0);
    expect(words()).not.toContain(copy.order);
  });

  it('claims no count after a failed read and keeps the chosen order available', () => {
    state.lobbyists = { isPending: false, isSuccess: false, isError: true, refetch: vi.fn() };
    render(screen());
    expect(words()).toContain(copy.lobbyists.unavailable);
    expect(words()).not.toContain('registered lobbyists');
    expect(words()).not.toContain('Donation amounts are unavailable');
    expect(words()).not.toContain('amount available for');
    expect(menus()[1].textContent).toBe('Recorded amount: highest first');
    expect(menus()[1].getAttribute('aria-disabled')).toBeNull();
    // A year the reader chose survives the failure; only a directory with no year
    // at all falls back to the unavailable label.
    expect(menus()[0].getAttribute('aria-disabled')).toBeNull();
    expect(menus()[0].textContent).toBe('2025');
    render(
      <LobbyingLobbyistsScreen
        navigation={navigation as never}
        route={route('LobbyingLobbyists')}
      />,
    );
    expect(menus()[0].getAttribute('aria-disabled')).toBe('true');
    expect(menus()[0].textContent).toBe('Unavailable');
  });

  it('names the loading list in the count slot and counts nothing while it waits', () => {
    state.lobbyists = { isPending: true, isSuccess: false, isError: false, refetch: vi.fn() };
    render(screen());
    expect([...host.querySelectorAll('[aria-level="2"]')][0].textContent).toBe(
      copy.lobbyists.loading,
    );
    expect(words()).not.toContain('amount available for');
    expect(words()).not.toContain('Donation amounts are unavailable');
    // A year already chosen in the address is never blanked while the list reloads.
    expect(menus()[0].textContent).toBe('2025');
    render(
      <LobbyingLobbyistsScreen
        navigation={navigation as never}
        route={route('LobbyingLobbyists')}
      />,
    );
    expect(menus()[0].textContent).toBe('Loading years');
    expect(menus()[0].getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps a real space between the dollar figure and its year', () => {
    state.lobbyists = lobbyists({
      lobbyists: [
        {
          ...fixture.lobbyists_page_2.lobbyists[0],
          donation_state: 'reported',
          donation_amount: '14600',
        },
      ],
    });
    render(screen());
    expect(listRows()[0].textContent).toContain('$14,600 recorded in 2025');
  });

  it('offers a clear control on the lobbyist field only once something is typed', () => {
    state.lobbyists = lobbyists();
    render(screen());
    expect(host.querySelector('[aria-label="Clear the field"]')).toBeNull();
    render(screen({ q: 'hynes' }));
    expect(host.querySelector('[aria-label="Clear the field"]')).not.toBeNull();
  });

  it('leaves the principals directory with its own caption and no donation controls', () => {
    render(
      <LobbyingPrincipalsScreen
        navigation={navigation as never}
        route={route('LobbyingPrincipals', { page: '2' })}
      />,
    );
    expect(words()).toContain(copy.order);
    expect(host.querySelector('select')).toBeNull();
    expect(menus()).toHaveLength(0);
    expect(host.querySelectorAll('[aria-level="2"]')).toHaveLength(0);
  });
});

describe('the lobbyist card’s drawn controls', () => {
  const served = (over: object = {}) =>
    success({
      ...fixture.lobbyists_page_2,
      offset: 0,
      requested_year: 2025,
      sort: 'donations_desc',
      donations: {
        state: 'reported',
        year: 2025,
        available_years: [2025, 2024],
        eligible_count: 2,
        copied_at: '2026-09-01T12:00:00Z',
        source_url: 'https://cfb.mn.gov/source.csv',
      },
      ...over,
    });
  const screen = () => (
    <LobbyingLobbyistsScreen
      navigation={navigation as never}
      route={route('LobbyingLobbyists', { year: '2025' })}
    />
  );
  it('draws its own closed box, and its own open list rather than the browser’s', () => {
    state.lobbyists = served();
    render(screen());
    const sort = menus()[1];
    expect(sort.tagName).toBe('BUTTON');
    expect(sort.getAttribute('aria-haspopup')).toBe('listbox');
    expect(sort.getAttribute('aria-expanded')).toBe('false');
    expect(sort.style.fontWeight).toBe('700');
    expect(sort.style.cursor).toBe('pointer');
    expect(sort.style.borderRadius).toBe('12px');
    expect(sort.style.padding).toBe('9px 16px 9px 14px');
    // The visible label beside the box is what names the control, never a
    // placeholder standing in for one.
    const named = host.querySelector(`#${CSS.escape(sort.getAttribute('aria-labelledby')!)}`);
    expect(named?.textContent).toBe('Sort by');
    expect(listedOptions()).toHaveLength(0);

    openMenu(1);
    expect(menus()[1].getAttribute('aria-expanded')).toBe('true');
    const panel = host.querySelector('[role="listbox"]') as HTMLElement;
    expect(panel.getAttribute('aria-label')).toBe('Sort by');
    expect(panel.style.borderRadius).toBe('14px');
    expect(panel.style.padding).toBe('6px');
    expect(panel.style.boxShadow).toBe('0 14px 34px rgba(17,21,15,0.14)');
    const options = listedOptions();
    expect(options.map((item) => item.textContent)).toEqual([
      'Name A–Z',
      'Recorded amount: highest first',
      'Recorded amount: lowest first',
    ]);
    // The chosen option carries 3 marks, so its state never rests on colour alone.
    const chosen = options[1];
    expect(chosen.getAttribute('aria-selected')).toBe('true');
    expect(chosen.style.fontWeight).toBe('700');
    expect(chosen.style.background).toBe('rgb(242, 251, 246)');
    expect(options[0].getAttribute('aria-selected')).toBe('false');
    expect(options[0].style.fontWeight).toBe('500');
    expect(options[0].style.minHeight).toBe('44px');
  });

  it('opens on the chosen option, moves without wrapping, and returns the choice', () => {
    state.lobbyists = served();
    render(screen());
    press(1, 'Enter');
    const sort = menus()[1];
    // The control keeps focus and names the option a reader is on, which is the
    // only place assistive technology reads that attribute.
    expect(sort.getAttribute('aria-expanded')).toBe('true');
    const onOpen = sort.getAttribute('aria-activedescendant')!;
    expect(document.getElementById(onOpen)?.textContent).toBe('Recorded amount: highest first');
    press(1, 'ArrowDown');
    expect(
      document.getElementById(menus()[1].getAttribute('aria-activedescendant')!)?.textContent,
    ).toBe('Recorded amount: lowest first');
    // Movement stops at the end rather than wrapping round to the top.
    press(1, 'ArrowDown');
    expect(
      document.getElementById(menus()[1].getAttribute('aria-activedescendant')!)?.textContent,
    ).toBe('Recorded amount: lowest first');
    press(1, 'Home');
    expect(
      document.getElementById(menus()[1].getAttribute('aria-activedescendant')!)?.textContent,
    ).toBe('Name A–Z');
    press(1, 'Enter');
    expect(navigation.setParams).toHaveBeenCalledWith({
      sort: 'name',
      page: undefined,
      year: '2025',
    });
    expect(menus()[1].getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves the value alone when a reader presses Escape', () => {
    state.lobbyists = served();
    render(screen());
    press(1, 'ArrowDown');
    press(1, 'ArrowDown');
    press(1, 'Escape');
    expect(menus()[1].getAttribute('aria-expanded')).toBe('false');
    expect(menus()[1].textContent).toBe('Recorded amount: highest first');
    expect(navigation.setParams).not.toHaveBeenCalled();
    // Tab closes it the same way and lets focus carry on out of the control.
    press(1, 'ArrowDown');
    press(1, 'Tab');
    expect(menus()[1].getAttribute('aria-expanded')).toBe('false');
    expect(navigation.setParams).not.toHaveBeenCalled();
  });

  it('sizes each box to its own longest choice, widening only while disabled', () => {
    state.lobbyists = served();
    render(screen());
    const wrapper = (which: number) => menus()[which].parentElement as HTMLElement;
    expect(wrapper(0).style.width).toBe('104px');
    // It is the open list that sets this figure, not the closed box.
    expect(wrapper(1).style.width).toBe('304px');
    state.lobbyists = { isPending: true, isSuccess: false, isError: false, refetch: vi.fn() };
    render(
      <LobbyingLobbyistsScreen
        navigation={navigation as never}
        route={route('LobbyingLobbyists')}
      />,
    );
    // A replacement retains available years and the box width.
    expect(menus()[0].textContent).toBe('2025');
    expect(wrapper(0).style.width).toBe('104px');
  });

  it('marks a dropdown it cannot offer, and dims its label with it', () => {
    state.lobbyists = { isPending: false, isSuccess: false, isError: true, refetch: vi.fn() };
    render(
      <LobbyingLobbyistsScreen
        navigation={navigation as never}
        route={route('LobbyingLobbyists')}
      />,
    );
    const year = menus()[0];
    expect(year.getAttribute('aria-disabled')).toBe('true');
    expect(year.style.cursor).toBe('not-allowed');
    expect(year.style.color).toBe('rgb(138, 144, 138)');
    openMenu(0);
    expect(listedOptions()).toHaveLength(0);
    const label = [...host.querySelectorAll('div')].find(
      (item) => item.children.length === 0 && item.textContent === 'Year',
    )!;
    expect(getComputedStyle(label).color).toBe('rgb(138, 144, 138)');
  });

  it('lets the open list leave the card, and keeps the last row inside its corner', () => {
    state.lobbyists = served();
    render(screen());
    const card = [...host.querySelectorAll('[tabindex="-1"]')].at(-1) as HTMLElement;
    // A card that hid its own overflow would cut the open list off.
    expect(getComputedStyle(card).overflow).not.toBe('hidden');
    const header = host.querySelector('[aria-level="2"]')!.parentElement!;
    expect(Number(getComputedStyle(header).zIndex)).toBeGreaterThan(0);
    // So the bottom row rounds its own corners instead, and no other row does.
    const rows = listRows().map((row) => row.firstElementChild as HTMLElement);
    expect(getComputedStyle(rows[rows.length - 1]).borderBottomLeftRadius).toBe('15px');
    expect(parseFloat(getComputedStyle(rows[0]).borderBottomLeftRadius) || 0).toBe(0);
  });

  it('closes on a press outside and leaves the value untouched', () => {
    state.lobbyists = served();
    render(screen());
    openMenu(1);
    expect(menus()[1].getAttribute('aria-expanded')).toBe('true');
    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(menus()[1].getAttribute('aria-expanded')).toBe('false');
    expect(menus()[1].textContent).toBe('Recorded amount: highest first');
    expect(navigation.setParams).not.toHaveBeenCalled();
  });

  it('draws a row’s keyboard ring inside the card rather than outside it', () => {
    state.lobbyists = served();
    render(screen());
    const row = listRows()[0].querySelector('a')!;
    expect(row.getAttribute('data-alethical-directory-row')).toBe('true');
    // The sitewide ring sits 2px outside; a full-width row needs it inside.
    expect(row.getAttribute('data-arrow-focus')).toBe('true');
    expect(directoryRowWebCss).toContain('outline-offset:-2px');
  });
});

describe('the lobbyist card’s two record dates and its page jump', () => {
  const served = (over: object = {}) =>
    success({
      ...fixture.lobbyists_page_2,
      offset: 0,
      requested_year: 2025,
      sort: 'donations_desc',
      donations: {
        state: 'reported',
        year: 2025,
        available_years: [2025, 2024],
        eligible_count: 136,
        copied_at: '2026-09-01T12:00:00Z',
        source_url: 'https://cfb.mn.gov/source.csv',
      },
      ...over,
    });
  const screen = (params: object = {}) => (
    <LobbyingLobbyistsScreen
      navigation={navigation as never}
      route={route('LobbyingLobbyists', { year: '2025', sort: 'donations_desc', ...params })}
    />
  );
  // The search field's clear button also carries tabindex -1 and draws first.
  const card = () => [...host.querySelectorAll('[tabindex="-1"]')].at(-1) as HTMLElement;

  it('dates each record against the thing it dates, in the drawn reading order', () => {
    state.lobbyists = served();
    render(screen());
    const page = words();
    // The registration date sits above the search field; the contribution date
    // sits inside the card, under the paragraph the dollars belong to.
    expect(page.indexOf('Lobbyist registration list copied Sep 13, 2026')).toBeLessThan(
      page.indexOf('Search lobbyists by name'),
    );
    const paragraph = page.indexOf('Each amount totals campaign contributions');
    const contributionDate = page.indexOf('Campaign contribution file copied Sep 1, 2026');
    const available = page.indexOf('campaign contribution amounts are available for');
    const control = page.indexOf('How these amounts are counted');
    expect(paragraph).toBeLessThan(contributionDate);
    expect(contributionDate).toBeLessThan(available);
    expect(available).toBeLessThan(control);
    // Closed explanation, and the contribution date is still on screen.
    expect(page).not.toContain('This list shows the lobbyists who were registered');
  });

  it('prints neither date when its own source date is missing', () => {
    state.lobbyists = served({
      copied_at: null,
      donations: {
        state: 'reported',
        year: 2025,
        available_years: [2025],
        eligible_count: 136,
        copied_at: null,
      },
    });
    render(screen());
    expect(words()).not.toContain('Lobbyist registration list copied');
    expect(words()).not.toContain('Campaign contribution file copied');
  });

  it('keeps the availability count for a search that matched one lobbyist', () => {
    state.lobbyists = served({
      total: 1,
      has_more: false,
      lobbyists: fixture.lobbyists_page_2.lobbyists.slice(0, 1),
      q: 'bakk',
      donations: {
        state: 'reported',
        year: 2025,
        available_years: [2025],
        eligible_count: 0,
        copied_at: '2026-09-01T12:00:00Z',
      },
    });
    render(screen({ q: 'bakk' }));
    expect(words()).toContain(
      '2025 campaign contribution amounts are available for 0 of the 1 lobbyist in these results',
    );
  });

  it('states no ratio when the name matched nothing, and keeps the explanation', () => {
    state.lobbyists = served({
      total: 0,
      has_more: false,
      lobbyists: [],
      q: 'zzzzqq',
      donations: {
        state: 'reported',
        year: 2025,
        available_years: [2025],
        eligible_count: 0,
        copied_at: '2026-09-01T12:00:00Z',
      },
    });
    render(screen({ q: 'zzzzqq' }));
    expect(words()).not.toContain('are available for 0 of the 0');
    expect(words()).not.toContain('Donation amounts are unavailable');
    expect(words()).toContain('Each amount totals campaign contributions');
    expect(words()).toContain('No lobbyist is listed under that spelling in these records');
  });

  it('brings the results back into view when the reader changes the numbered page', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    state.lobbyists = served();
    render(screen());
    const next = host.querySelector('a[aria-label="Next page"]') as HTMLElement;
    act(() => next.click());
    // A new page of rows arrives; only then is there something to scroll to.
    state.lobbyists = served({ offset: 50 });
    render(screen({ page: '2' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    // Focus follows the view, so a keyboard reader is not left on a control that
    // has scrolled off the screen.
    expect(focus.mock.contexts).toContain(card());
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });

  it('does not complete an abandoned pagination jump after a year change', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    state.lobbyists = served();
    render(screen());
    act(() => (host.querySelector('a[aria-label="Next page"]') as HTMLElement).click());
    state.lobbyists = { isPending: true, isSuccess: false, isError: false, refetch: vi.fn() };
    render(screen({ page: '2' }));
    render(screen({ year: '2024' }));
    state.lobbyists = served({ requested_year: 2024 });
    render(screen({ year: '2024' }));
    expect(scrollIntoView).not.toHaveBeenCalled();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });

  it('leaves the reader where they are when a control, not the page, changes', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    state.lobbyists = served();
    render(screen());
    pick(1, 'Name A–Z');
    state.lobbyists = served({ sort: 'name' });
    render(screen({ sort: 'name' }));
    // Opening the list scrolls its own active option into view; what must not
    // move is the reader's place in the results.
    expect(scrollIntoView.mock.contexts).not.toContain(card());
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });
});

describe('stable lobbyist result replacement', () => {
  it('keeps rows, dates, count and links through a year change and failure, then replaces them together', () => {
    const data = {
      ...fixture.lobbyists_page_2,
      offset: 0,
      requested_year: 2025,
      sort: 'donations_desc',
      donations: {
        state: 'reported',
        year: 2025,
        available_years: [2025, 2024],
        eligible_count: 2,
        copied_at: '2026-09-01T12:00:00Z',
        source_url: 'https://cfb.mn.gov/source.csv',
      },
      lobbyists: [
        {
          ...fixture.lobbyists_page_2.lobbyists[0],
          donation_state: 'reported',
          donation_amount: '14600',
        },
      ],
    };
    const screen = (year: string) => (
      <LobbyingLobbyistsScreen
        navigation={navigation as never}
        route={route('LobbyingLobbyists', { year })}
      />
    );
    state.lobbyists = success(data);
    render(screen('2025'));
    const priorRow = listRows()[0].textContent;
    const priorHref = listRows()[0].querySelector('a')!.getAttribute('href');
    const priorCount = host.querySelector('[aria-level="2"]')!.textContent;
    state.lobbyists = { isPending: true, isSuccess: false, isError: false, refetch: vi.fn() };
    render(screen('2024'));
    expect(listRows()[0]?.textContent).toBe(priorRow);
    expect(listRows()[0]?.querySelector('a')?.getAttribute('href')).toBe(priorHref);
    expect(host.querySelector('[aria-level="2"]')!.textContent).toBe(priorCount);
    expect(words()).toContain('Updating results');
    expect(words()).toContain('Campaign contribution file copied Sep 1, 2026');
    expect(menus()[0].textContent).toBe('2024');
    state.lobbyists = { isPending: false, isSuccess: false, isError: true, refetch: vi.fn() };
    render(screen('2024'));
    expect(listRows()[0]?.textContent).toBe(priorRow);
    expect(words()).toContain('Couldn’t update results');
    expect(words()).toContain('Try again');
    state.lobbyists = success({
      ...data,
      requested_year: 2024,
      donations: { ...data.donations, year: 2024 },
      lobbyists: [{ ...data.lobbyists[0], donation_amount: '8000' }],
    });
    render(screen('2024'));
    expect(words()).toContain('$8,000 recorded in 2024');
    expect(words()).not.toContain('$14,600');
    expect(words()).not.toContain('Updating results');
  });
});
