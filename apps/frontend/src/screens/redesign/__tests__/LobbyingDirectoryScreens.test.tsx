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
    const year = host.querySelector('select[aria-label="Year"]') as HTMLSelectElement;
    act(() => {
      year.value = '2024';
      year.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(navigation.setParams).toHaveBeenCalledWith({ year: '2024', page: undefined });
    const sort = host.querySelector('select[aria-label="Sort by"]') as HTMLSelectElement;
    act(() => {
      sort.value = 'donations_asc';
      sort.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(navigation.setParams).toHaveBeenCalledWith({
      sort: 'donations_asc',
      page: undefined,
      year: '2025',
    });
    act(() => {
      sort.value = 'donations_desc';
      sort.dispatchEvent(new Event('change', { bubbles: true }));
    });
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
    expect(words()).toContain('No matching records does not mean the lobbyist gave nothing.');
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
    expect(words()).toContain('Enter all or part of a name');
    expect(words()).toContain('Registrations shown as listed in records copied Sep 13, 2026');
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

it('uses singular wording for 1 supported donation amount', () => {
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
  expect(words()).toContain('1 lobbyist in these results has an amount available for 2025');
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
    expect(header.querySelector('select[aria-label="Year"]')).not.toBeNull();
    expect(header.querySelector('select[aria-label="Sort by"]')).not.toBeNull();
    // The Sort by control names the order, so nothing repeats it as a caption.
    const captions = [...host.querySelectorAll('*')].filter(
      (item) =>
        item.children.length === 0 && item.tagName !== 'OPTION' && item.textContent === 'Name A–Z',
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
    const sort = host.querySelector('select[aria-label="Sort by"]') as HTMLSelectElement;
    expect(sort.value).toBe('donations_desc');
    expect(sort.disabled).toBe(false);
    // A year the reader chose survives the failure; only a directory with no year
    // at all falls back to the unavailable label.
    const kept = host.querySelector('select[aria-label="Year"]') as HTMLSelectElement;
    expect(kept.disabled).toBe(false);
    expect(kept.value).toBe('2025');
    render(
      <LobbyingLobbyistsScreen
        navigation={navigation as never}
        route={route('LobbyingLobbyists')}
      />,
    );
    const none = host.querySelector('select[aria-label="Year"]') as HTMLSelectElement;
    expect(none.disabled).toBe(true);
    expect(none.textContent).toBe('Unavailable');
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
    const chosen = host.querySelector('select[aria-label="Year"]') as HTMLSelectElement;
    expect(chosen.textContent).toBe('2025');
    render(
      <LobbyingLobbyistsScreen
        navigation={navigation as never}
        route={route('LobbyingLobbyists')}
      />,
    );
    const empty = host.querySelector('select[aria-label="Year"]') as HTMLSelectElement;
    expect(empty.textContent).toBe('Loading years');
    expect(empty.disabled).toBe(true);
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
  const selects = () => [...host.querySelectorAll('select')];

  it('strips the browser’s own box and draws the chevron itself', () => {
    state.lobbyists = served();
    render(screen());
    for (const box of selects()) {
      expect(box.style.appearance).toBe('none');
      expect(box.style.fontWeight).toBe('700');
      expect(box.style.cursor).toBe('pointer');
      // The right pad is the drawn chevron's room.
      expect(box.style.padding).toBe('0px 40px 0px 14px');
      // react-native-svg is mocked away here, so assert the wrapper the drawn
      // chevron is positioned against; the browser check covers the glyph itself.
      expect(getComputedStyle(box.parentElement!).position).toBe('relative');
    }
  });

  it('sizes each box to its own longest choice, widening only while disabled', () => {
    state.lobbyists = served();
    render(screen());
    expect(selects()[0].style.width).toBe('128px');
    expect(selects()[1].style.width).toBe('240px');
    state.lobbyists = { isPending: true, isSuccess: false, isError: false, refetch: vi.fn() };
    render(
      <LobbyingLobbyistsScreen
        navigation={navigation as never}
        route={route('LobbyingLobbyists')}
      />,
    );
    // `Loading years` is longer than any year, so the box grows while it shows it.
    expect(selects()[0].textContent).toBe('Loading years');
    expect(selects()[0].style.width).toBe('168px');
  });

  it('marks a dropdown it cannot offer, and dims its label with it', () => {
    state.lobbyists = { isPending: false, isSuccess: false, isError: true, refetch: vi.fn() };
    render(
      <LobbyingLobbyistsScreen
        navigation={navigation as never}
        route={route('LobbyingLobbyists')}
      />,
    );
    const year = selects()[0];
    expect(year.disabled).toBe(true);
    expect(year.style.cursor).toBe('not-allowed');
    expect(year.style.color).toBe('rgb(138, 144, 138)');
    const label = [...host.querySelectorAll('div')].find(
      (item) => item.children.length === 0 && item.textContent === 'Year',
    )!;
    expect(getComputedStyle(label).color).toBe('rgb(138, 144, 138)');
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
