// @vitest-environment jsdom
import { act, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const state = vi.hoisted(() => ({
  query: vi.fn(),
  refetch: vi.fn(),
  replace: vi.fn(),
  mobile: false,
  tablet: false,
}));
vi.mock('../../../hooks/useAppQueries', () => ({
  useCampaignFinanceRaces: state.query,
  usePrefetchCommitteeMoney: () => () => {},
}));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: state.mobile, isTablet: state.tablet }),
}));
vi.mock('../../../hooks/useHistoryScrollRestoration', () => ({
  useHistoryScrollRestoration: () => ({}),
}));
vi.mock('../../../navigation/webHistory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../navigation/webHistory')>()),
  markNextWebHistoryChangeAsReplace: state.replace,
  hasInAppBackEntry: () => false,
}));
vi.mock('../../../navigation/documentTitle', () => ({ useDocumentTitle: () => {} }));
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

import { MoneyByRaceScreen } from '../MoneyByRaceScreen';
import type { MoneyByRacePage, RaceCommittee, RaceContest } from '../../../data/types';
import type { RootStackParamList } from '../../../navigation/types';

const reported: RaceCommittee = {
  registrationNumber: '1',
  name: 'Long-Committee-Name-With-No-Spaces-Until-Here House Committee',
  isClosed: false,
  terminationDate: null,
  reportedTotal: '100',
  reportedThrough: '2026-03-31',
  reportedPeriodStart: '2026-01-01',
  named: {
    state: 'reported',
    total: '200',
    payments: 1,
    firstPaymentOn: '2026-07-20',
    lastPaymentOn: '2026-07-20',
  },
};
const missing: RaceCommittee = {
  ...reported,
  registrationNumber: '2',
  name: 'Second House Committee',
  reportedTotal: null,
  reportedThrough: null,
  reportedPeriodStart: null,
  named: {
    state: 'not_reported',
    total: null,
    payments: null,
    firstPaymentOn: null,
    lastPaymentOn: null,
  },
};
const house: RaceContest = {
  office: 'House',
  district: '1A',
  anchor: 'house-1a',
  committeeCount: 2,
  periodsDiffer: true,
  committees: [reported, missing],
};
const senate: RaceContest = {
  office: 'Senate',
  district: '1',
  anchor: 'senate-1',
  committeeCount: 1,
  periodsDiffer: false,
  committees: [
    {
      ...reported,
      registrationNumber: '3',
      name: 'Zero Senate Committee',
      reportedTotal: '0',
      named: { ...reported.named, total: '0' },
    },
  ],
};
const governor: RaceContest = {
  office: 'Governor',
  district: null,
  anchor: 'governor',
  committeeCount: 28,
  periodsDiffer: false,
  committees: Array.from({ length: 28 }, (_, index) => ({
    ...missing,
    registrationNumber: String(100 + index),
    name: `Governor Committee ${String(index + 1).padStart(2, '0')}`,
  })),
};
const court: RaceContest = {
  office: 'District Court',
  district: '4-12',
  anchor: 'district-court-4-12',
  committeeCount: 1,
  periodsDiffer: false,
  committees: [{ ...reported, registrationNumber: '4', name: 'District Court Committee' }],
};
const page: MoneyByRacePage = {
  state: 'reported',
  orderedBy: 'district_then_name',
  year: 2026,
  office: null,
  offices: [
    { office: 'House', committeeCount: 2 },
    { office: 'Senate', committeeCount: 1 },
    { office: 'Governor', committeeCount: 28 },
    { office: 'District Court', committeeCount: 1 },
  ],
  committeeCount: 32,
  contestCount: 4,
  contests: [house, senate, governor, court],
  asOf: '2026-08-12',
  fetchedAt: '2026-09-01T18:00:00Z',
};
type Params = NonNullable<RootStackParamList['MoneyByRace']>;
let root: Root;
let host: HTMLDivElement;
let params: Params;
let updateParams: Dispatch<SetStateAction<Params>>;
const navigation = {
  navigate: vi.fn(),
  push: vi.fn(),
  setParams: vi.fn(),
  isFocused: vi.fn(() => true),
};
function Harness({ initial }: { initial: Params }) {
  const [value, setValue] = useState(initial);
  params = value;
  updateParams = setValue;
  return <MoneyByRaceScreen navigation={navigation as never} route={{ params: value } as never} />;
}
function render(initial: Params = { year: '2026' }) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Harness initial={initial} />));
}
function respond(data: MoneyByRacePage | undefined, options: Record<string, unknown> = {}) {
  state.query.mockReturnValue({
    data,
    isPending: false,
    isPlaceholderData: false,
    isError: false,
    refetch: state.refetch,
    ...options,
  });
}
function type(value: string) {
  const input = host.querySelector('input')!;
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
function key(input: HTMLElement, value: string) {
  act(() =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
    ),
  );
}
function click(element: HTMLElement) {
  expect(element).toBeTruthy();
  act(() => element.click());
}
function button(label: string) {
  return [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(
    (element) => element.textContent === label || element.getAttribute('aria-label') === label,
  )!;
}
function groupLink(label: string) {
  return host.querySelector<HTMLAnchorElement>(`a[aria-label="View committees for ${label}"]`)!;
}
function groups() {
  return [...host.querySelectorAll<HTMLAnchorElement>('a[aria-label^="View committees for"]')];
}
function committees() {
  return [...host.querySelectorAll<HTMLAnchorElement>('a[href^="/money/committees/"]')];
}
function leaf(text: string) {
  return [...host.querySelectorAll<HTMLElement>('*')].find(
    (element) => element.children.length === 0 && element.textContent === text,
  )!;
}
function queryOf(link: HTMLAnchorElement) {
  return Object.fromEntries(new URL(link.href).searchParams);
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

beforeEach(() => {
  state.mobile = false;
  state.tablet = false;
  state.query.mockReset();
  state.refetch.mockReset();
  state.replace.mockReset();
  navigation.isFocused.mockReset().mockReturnValue(true);
  navigation.navigate.mockReset();
  navigation.push.mockReset();
  // Match React Navigation's merge, so choosing, typing and going back rerender.
  navigation.setParams
    .mockReset()
    .mockImplementation((patch: Partial<Params>) => updateParams((old) => ({ ...old, ...patch })));
  respond(page);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  window.history.replaceState({}, '', '/money/races?year=2026');
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('Money by race directory and focused group', () => {
  it('starts with group links, without money or committee rows', () => {
    render();
    expect(host.textContent).not.toContain('CAMPAIGN MONEY');
    expect(state.query).toHaveBeenLastCalledWith({ year: 2026 });
    expect(groups()).toHaveLength(4);
    const directoryAction = [...groups()[0].querySelectorAll('div')].find(
      (node) => node.textContent === 'View committees',
    )!;
    expect(getComputedStyle(directoryAction).color).toBe('rgb(17, 21, 15)');
    expect(committees()).toHaveLength(0);
    expect(host.textContent).not.toContain(reported.name);
    expect(host.textContent).not.toContain('$100');
    expect(host.textContent).not.toContain('Campaign contributions for 2026');
    expect(host.textContent).not.toContain('4 contests');
    expect(leaf('32 candidate committees')).toBeTruthy();
    expect(leaf('By office, then district or court seat')).toBeTruthy();
  });
  it('shows a plain ballot sentence and a copy date directly below the count', () => {
    render();
    const note = leaf('These records do not confirm who is on the ballot');
    const count = leaf('32 candidate committees');
    const date = leaf('Committee list copied Aug 12, 2026');
    expect(note.closest('a, button, [role="button"]')).toBeNull();
    expect(getComputedStyle(note).borderTopWidth).not.toMatch(/^[1-9]/);
    expect(note.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(count.nextElementSibling).toBe(date);
    expect(getComputedStyle(count.parentElement!).flexDirection).not.toBe('row');
    expect(host.textContent?.match(/Committee list copied/g)).toHaveLength(1);
    expect(leaf('Limits of the campaign records').getAttribute('aria-level')).toBe('2');
  });
  it('narrows directory headings by office while preserving global button counts', () => {
    render();
    click(button('Governor28'));
    expect(params).toEqual({ year: '2026', office: 'Governor', group: undefined, q: undefined });
    expect(state.query).toHaveBeenLastCalledWith({ year: 2026 });
    expect(groups()).toHaveLength(1);
    expect(groupLink('Governor · Statewide')).toBeTruthy();
    expect(button('All offices32')).toBeTruthy();
    expect(button('House2')).toBeTruthy();
    expect(button('Governor28').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('input')).toBeTruthy();
    expect(committees()).toHaveLength(0);
    click(button('All offices32'));
    expect(groups()).toHaveLength(4);
  });
  it('provides native group links carrying the served anchor, office and year', () => {
    render({ year: '2025', q: 'district' });
    const link = groupLink('District Court · District 4 · Seat 12');
    expect(queryOf(link)).toEqual({ office: 'District Court', year: '2025', group: court.anchor });
    click(link);
    expect(leaf('Money by race')).toBeTruthy();
    expect(params).toEqual({
      year: '2025',
      q: undefined,
      office: 'District Court',
      group: court.anchor,
    });
    expect(host.querySelector('h1')?.textContent).toBe('District Court · District 4 · Seat 12');
    expect(committees().map((entry) => entry.textContent)).toEqual(['District Court Committee']);
  });
  it('shows all 28 committees of a selected group, with no extra reveal step', () => {
    render();
    click(groupLink('Governor · Statewide'));
    expect(committees().map((entry) => entry.textContent)).toEqual(
      governor.committees.map((entry) => entry.name),
    );
    expect(host.textContent).not.toContain(reported.name);
    expect(host.textContent).not.toContain('Show more');
    expect(groups()).toHaveLength(0);
  });
  it('opens shared groups directly, focuses the heading and links back to the directory', async () => {
    render({ group: house.anchor, office: 'House', year: '2026' });
    await settle();
    expect(document.activeElement).toBe(host.querySelector('h1'));
    expect(committees().map((entry) => entry.textContent)).toEqual(
      house.committees.map((entry) => entry.name),
    );
    expect(host.querySelector('input')).toBeTruthy();
    const back = host.querySelector<HTMLAnchorElement>('a[aria-label="Go back"]')!;
    expect(queryOf(back)).toEqual({ year: '2026' });
    // GoBackLink follows this native href on a fresh visit. Browser-history
    // behavior has its own tests; this harness models the destination route.
    act(() => updateParams({ year: '2026' }));
    expect(groups()).toHaveLength(4);
    expect(committees()).toHaveLength(0);
  });
  it('recovers from an unknown group without showing a different group', () => {
    render({ group: 'house-999', year: '2025' });
    expect(host.textContent).toContain(
      'We couldn’t find this office, district or court seat in our records',
    );
    expect(committees()).toHaveLength(0);
    expect(host.textContent).not.toContain('$100');
    const recovery = [...host.querySelectorAll<HTMLAnchorElement>('a')].find(
      (entry) => entry.textContent === 'Choose another office, district or court seat',
    )!;
    expect(queryOf(recovery)).toEqual({ year: '2025' });
    click(recovery);
    expect(params.group).toBeUndefined();
    expect(groups()).toHaveLength(4);
  });
  it('normalizes an unknown office while keeping the year and search', () => {
    render({ office: 'Mayor', year: '2025', q: 'House' });
    expect(navigation.setParams).toHaveBeenCalledWith({ office: undefined });
    expect(state.replace).toHaveBeenCalled();
    expect(params).toEqual({ office: undefined, year: '2025', q: 'House' });
    expect(groups()).toHaveLength(4);
  });
  it.each(['inactive race screen', 'article address'])(
    'does not migrate a hash from an %s',
    (source) => {
      if (source === 'inactive race screen') navigation.isFocused.mockReturnValue(false);
      window.history.replaceState(
        {},
        '',
        source === 'article address' ? '/read/guides/example#section' : '/money/races#house-1a',
      );
      render();
      expect(navigation.setParams).not.toHaveBeenCalled();
      expect(state.replace).not.toHaveBeenCalled();
      expect(params.group).toBeUndefined();
      expect(committees()).toHaveLength(0);
    },
  );

  it('migrates legacy group hashes by replacing the route and preserving the year', () => {
    window.history.replaceState({}, '', '/money/races?year=2025#governor');
    render({ year: '2025' });
    expect(navigation.setParams).toHaveBeenCalledWith({ group: 'governor' });
    expect(state.replace).toHaveBeenCalledTimes(1);
    expect(params).toEqual({ year: '2025', group: 'governor' });
    expect(host.querySelector('h1')?.textContent).toBe('Governor · Statewide');
    expect(committees()).toHaveLength(28);
  });
});

describe('Money by race finder', () => {
  it('keeps an ambiguous Enter focused without selecting a default, then accepts arrow selection', async () => {
    render();
    const input = type('district 1');
    expect(params.q).toBe('district 1');
    expect(state.replace).toHaveBeenCalled();
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(3);
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    key(input, 'Enter');
    await settle();
    expect(params.group).toBeUndefined();
    expect(document.activeElement).toBe(input);
    expect(host.querySelector('[role="listbox"]')).toBeTruthy();
    click(button('View committees'));
    expect(params.group).toBeUndefined();
    key(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toMatch(/option-0$/);
    key(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toMatch(/option-1$/);
    key(input, 'Enter');
    expect(params).toEqual({ year: '2026', q: undefined, group: 'senate-1', office: 'Senate' });
    expect(committees().map((entry) => entry.textContent)).toEqual(['Zero Senate Committee']);
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });
  it('searches all offices including Governor even with House selected', () => {
    render({ office: 'House', year: '2026' });
    const input = type('Governor');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(host.querySelector('[role="option"]')?.textContent).toBe(
      'Governor · Statewide28 candidate committees',
    );
    key(input, 'Enter');
    expect(params.group).toBe('governor');
    expect(params.office).toBe('Governor');
    expect(committees()).toHaveLength(28);
  });
  it('opens a clicked suggestion in 1 action and replaces the previously selected group', () => {
    render({ group: house.anchor, year: '2026' });
    type('Senate');
    click(host.querySelector<HTMLElement>('[role="option"]')!);
    expect(host.querySelector('h1')?.textContent).toBe('Senate District 1');
    expect(committees().map((entry) => entry.textContent)).toEqual(['Zero Senate Committee']);
    expect(host.textContent).not.toContain(reported.name);
  });
  it('closes on Escape and keeps no-match Enter focused until search is cleared', async () => {
    render();
    const input = type('district 1');
    key(input, 'ArrowDown');
    key(input, 'Escape');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    expect(params.q).toBe('district 1');
    type('9999');
    key(input, 'Enter');
    await settle();
    expect(document.activeElement).toBe(input);
    expect(params.group).toBeUndefined();
    expect(host.textContent).toContain('No matching office, district or court seat in our records');
    expect(host.textContent).toContain('Try another name or clear your search.');
    click(button('Clear search'));
    expect(params.q).toBeUndefined();
    expect(host.querySelector('input')?.value).toBe('');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('input'));
  });
  it('restores a shared query without choosing it and clears it on office change', () => {
    render({ year: '2025', q: 'Governor' });
    const input = host.querySelector('input')!;
    expect(input.value).toBe('Governor');
    expect(params.group).toBeUndefined();
    act(() => input.focus());
    expect(host.querySelector('[role="option"]')?.textContent).toContain('Governor · Statewide');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    click(button('Senate1'));
    expect(params).toEqual({ year: '2025', q: undefined, group: undefined, office: 'Senate' });
    expect(host.querySelector('input')?.value).toBe('');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });
});

describe('Money by race figures and unavailable records', () => {
  it.each(['phone', 'tablet', 'computer'])(
    'keeps each figure with its own dates and truthful gaps on %s',
    (band) => {
      state.mobile = band === 'phone';
      state.tablet = band === 'tablet';
      render({ group: house.anchor, year: '2026' });
      expect(host.textContent).toContain('Campaign contributions for 2026');
      expect(host.textContent).toContain('Figures for Jan 1, 2026 to Mar 31, 2026');
      expect(host.textContent).toContain('Payment dated Jul 20, 2026');
      expect(host.textContent).toContain('No usable official total in our records for 2026');
      expect(host.textContent).toContain('No itemized contributions in our records for 2026');
      expect(host.textContent).toContain(
        'The reported totals in this group cover different periods. Each total shows its own dates.',
      );
      expect(host.textContent).not.toContain('$0');
      expect(host.textContent).not.toContain('Not reported');
      expect(host.textContent?.match(/A candidate committee must name a donor/g)).toHaveLength(1);
      expect(host.textContent?.match(/Payment files copied Sep 1, 2026/g)).toHaveLength(1);
      const amount = leaf('$100');
      expect(amount.parentElement?.textContent).toContain('Total contributions');
      expect(amount.parentElement?.textContent).not.toContain('Jul 20');
      expect(getComputedStyle(amount).fontFamily).toContain('Libre Franklin');
      // jsdom does not cascade RN Web’s atomic font-variant over Text’s reset.
      const variants = [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .filter(
          (rule): rule is CSSStyleRule =>
            rule instanceof CSSStyleRule &&
            Boolean(rule.style.getPropertyValue('font-variant')) &&
            amount.matches(rule.selectorText),
        )
        .map((rule) => rule.style.getPropertyValue('font-variant'));
      expect(variants.at(-1)).toBe('tabular-nums');
      expect(committees()[0].textContent).toBe(reported.name);
    },
  );
  it('distinguishes reported zeros from unavailable totals and figures in the selected year', () => {
    respond({
      ...page,
      contests: [
        {
          ...senate,
          committeeCount: 2,
          committees: [
            senate.committees[0],
            { ...missing, named: { ...missing.named, state: 'unavailable' } },
          ],
        },
      ],
    });
    render({ group: senate.anchor, year: '2025' });
    expect(
      [...host.querySelectorAll('*')].filter(
        (entry) => entry.children.length === 0 && entry.textContent === '$0',
      ),
    ).toHaveLength(2);
    expect(host.textContent).toContain('No usable official total in our records for 2025');
    expect(host.textContent).toContain('We couldn’t load this figure');
    expect(host.textContent).not.toContain('No itemized contributions in our records');
  });
  it('never borrows dates for undated totals or attaches dates to missing figures', () => {
    respond({
      ...page,
      contests: [
        {
          ...house,
          committees: [
            { ...reported, reportedThrough: null, reportedPeriodStart: null },
            {
              ...missing,
              reportedThrough: '2026-03-31',
              reportedPeriodStart: '2026-01-01',
              named: {
                ...missing.named,
                firstPaymentOn: '2026-07-20',
                lastPaymentOn: '2026-07-20',
              },
            },
          ],
        },
      ],
    });
    render({ group: house.anchor, year: '2026' });
    expect(leaf('$100').parentElement?.textContent).toBe('Total contributions$100');
    expect(leaf('$200').parentElement?.textContent).toContain('Payment dated Jul 20, 2026');
    expect(
      leaf('No usable official total in our records for 2026').parentElement?.textContent,
    ).not.toContain('Mar 31');
    expect(
      leaf('No itemized contributions in our records for 2026').parentElement?.textContent,
    ).not.toContain('Jul 20');
  });
  it('preserves the year in native committee links and ordinary committee navigation', () => {
    render({ group: house.anchor, year: '2025' });
    const link = committees()[0];
    expect(new URL(link.href).searchParams.get('year')).toBe('2025');
    click(link);
    expect(navigation.push).toHaveBeenCalledWith(
      'CommitteeMoney',
      expect.objectContaining({ year: '2025' }),
    );
  });
  it('withholds stale rows and counts while a new year is loading', () => {
    render({ group: house.anchor, year: '2026' });
    expect(host.textContent).toContain('$100');
    respond(page, { isPlaceholderData: true });
    act(() => updateParams({ year: '2025', office: 'Governor' }));
    expect(host.textContent).toContain('Loading committee records');
    expect(host.textContent).toContain('Loading committees');
    expect(host.textContent).not.toContain('House District 1A');
    expect(host.textContent).not.toContain('$100');
    expect(host.textContent).not.toContain('32 candidate committees');
    expect(host.textContent).not.toContain('Committee list copied');
    expect(button('Governor').textContent).toBe('Governor');
    expect(button('All offices').textContent).toBe('All offices');
  });
  it.each(['failed request', 'unavailable records'])(
    'offers a real retry for %s without calling it an empty list',
    (failure) => {
      respond(
        failure === 'failed request' ? undefined : { ...page, state: 'unavailable', contests: [] },
        { isError: failure === 'failed request' },
      );
      render();
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        'Committee records unavailable',
      );
      expect(host.textContent).toContain(
        'We couldn’t load the committee list. This does not tell us who is running.',
      );
      expect(host.textContent).not.toContain('No candidate committees');
      expect(committees()).toHaveLength(0);
      click(button('Try again'));
      expect(state.refetch).toHaveBeenCalledTimes(1);
    },
  );
  it('does not repeat Money by race when a shared group cannot be loaded', () => {
    respond(undefined, { isError: true });
    render({ group: house.anchor, office: 'House', year: '2026' });
    expect(host.textContent?.match(/Money by race/g)).toHaveLength(1);
    expect(host.textContent).not.toContain('CAMPAIGN MONEY');
  });
});
