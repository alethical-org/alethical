// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const state = vi.hoisted(() => ({ query: vi.fn(), mobile: false, tablet: false }));
vi.mock('../../../hooks/useAppQueries', () => ({
  useCampaignFinanceRaces: state.query,
  usePrefetchCommitteeMoney: () => () => {},
}));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: state.mobile, isTablet: state.tablet }),
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
import { moneyByRacePageSnapshot } from '../../../lib/pageSnapshot';
import type { MoneyByRacePage, RaceContest } from '../../../data/types';

const house: RaceContest = {
  office: 'House',
  district: '1A',
  anchor: 'house-1a',
  committeeCount: 2,
  periodsDiffer: true,
  committees: [
    {
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
    },
    {
      registrationNumber: '2',
      name: 'Second House Committee',
      isClosed: false,
      terminationDate: null,
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
    },
  ],
};
const senate = {
  ...house,
  office: 'Senate',
  district: '1',
  anchor: 'senate-1',
  committees: [],
  committeeCount: 0,
};
const governor = {
  ...house,
  office: 'Governor',
  district: null,
  anchor: 'governor-statewide',
  committees: [],
  committeeCount: 28,
};
const page: MoneyByRacePage = {
  state: 'reported',
  orderedBy: 'district_then_name',
  year: 2026,
  office: null,
  offices: [
    { office: 'House', committeeCount: 478 },
    { office: 'Senate', committeeCount: 232 },
    { office: 'Governor', committeeCount: 28 },
  ],
  committeeCount: 778,
  contestCount: 2,
  contests: [house, senate],
  asOf: '2026-08-12',
  fetchedAt: '2026-09-01T18:00:00Z',
};
let root: Root;
let host: HTMLDivElement;
const setParams = vi.fn();
function render(office?: string, year = 2026) {
  if (!host) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  act(() =>
    root.render(
      <MoneyByRaceScreen
        navigation={{ navigate: vi.fn(), push: vi.fn(), setParams } as never}
        route={{ params: { office, year } } as never}
      />,
    ),
  );
}
function type(value: string) {
  const input = host.querySelector('input')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
function key(input: HTMLElement, value: string) {
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
    );
  });
}
beforeEach(() => {
  state.mobile = false;
  state.tablet = false;
  state.query.mockReturnValue({
    data: page,
    isPending: false,
    isPlaceholderData: false,
    isError: false,
  });
  setParams.mockClear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.history.replaceState({}, '', '/money/races?year=2026');
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  host = undefined as never;
});

describe('Money by race reader behavior', () => {
  it('uses scoped counts while office buttons keep global counts', () => {
    state.query.mockReturnValue({
      data: { ...page, office: 'Governor', contestCount: 1, contests: [governor] },
    });
    render('Governor');
    expect(host.textContent).toContain('1 contest · 28 candidate committees');
    expect(host.querySelector('[aria-label="Filter by office"]')?.textContent).toContain(
      'All offices778',
    );
    expect(host.querySelector('input')).toBeNull();
  });
  it('withholds the previous office or year records until new data arrives', () => {
    state.query.mockReturnValue({ data: page, isPlaceholderData: true });
    render('Governor', 2025);
    expect(host.textContent).not.toContain('House District 1A');
    expect(host.textContent).not.toContain('$100');
    expect(host.textContent).not.toContain('2 contests');
    expect(host.textContent).toContain('Loading contests');
    expect(host.querySelector('[aria-label="Filter by office"]')?.textContent).toContain(
      'Governor28',
    );
  });
  it('shows separate labels, dates, and truthful missing states at every band', () => {
    for (const band of ['phone', 'tablet', 'computer']) {
      state.mobile = band === 'phone';
      state.tablet = band === 'tablet';
      render();
      expect(host.textContent).toContain('Figures for Jan 1, 2026 to Mar 31, 2026');
      expect(host.textContent).toContain('Payment dated Jul 20, 2026');
      expect(host.textContent).toContain('We do not hold a usable official total');
      expect(host.textContent).toContain('No named contributions in our payment records');
      expect(host.textContent).toContain(
        'a committee may name a smaller donor but does not have to.',
      );
      expect(host.textContent).not.toContain('$0');
      const amount = [...host.querySelectorAll<HTMLElement>('*')].find(
        (e) => e.children.length === 0 && e.textContent === '$100',
      );
      expect(getComputedStyle(amount!).fontFamily).toContain('Libre Franklin');
      // jsdom does not cascade RN Web's atomic font-variant over Text's reset.
      // Inspect the applied CSS rule here; a real browser also checks computed digits.
      const variants = [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .filter(
          (rule): rule is CSSStyleRule =>
            rule instanceof CSSStyleRule &&
            Boolean(rule.style.getPropertyValue('font-variant')) &&
            amount!.matches(rule.selectorText),
        )
        .map((rule) => rule.style.getPropertyValue('font-variant'))
        .filter(Boolean);
      expect(variants.at(-1)).toBe('tabular-nums');
    }
  });
  it('jumps by keyboard, focuses a heading, preserves the query, and leaves every committee visible', () => {
    render();
    const input = type('district 1');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(2);
    key(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toMatch(/option-1$/);
    key(input, 'Enter');
    expect(window.location.hash).toBe('#senate-1');
    expect(window.location.search).toBe('?year=2026');
    expect(document.activeElement?.id).toBe('senate-1');
    expect(host.textContent).toContain('Second House Committee');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });
  it('can repeat Go after choosing a later suggestion, and keeps figure labels readable', () => {
    render();
    const input = type('district 1');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    const go = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(
      (e) => e.textContent === 'Go to district or seat',
    )!;
    act(() => go.click());
    expect(document.activeElement?.id).toBe('senate-1');
    expect(window.location.hash).toBe('#senate-1');
    expect(host.querySelector('input')?.getAttribute('aria-expanded')).toBe('false');
    const amount = [...host.querySelectorAll<HTMLElement>('*')].find(
      (e) => e.children.length === 0 && e.textContent === '$100',
    )!;
    expect(amount.parentElement?.textContent).toContain('Total contributions');
  });
  it('preserves the current group address before navigating to another office', () => {
    window.history.replaceState({}, '', '/money/races?year=2026#house-1a');
    render();
    const senateButton = [...host.querySelectorAll<HTMLElement>('[aria-pressed]')].find(
      (e) => e.textContent === 'Senate232',
    )!;
    act(() => senateButton.click());
    expect(setParams).toHaveBeenCalledWith({ office: 'Senate' });
    // RootNavigator makes the new entry; the screen must not erase the old hash.
    expect(window.location.hash).toBe('#house-1a');
  });
  it('focuses a shared group and restores heading focus through browser history', async () => {
    window.history.replaceState({}, '', '/money/races?year=2026#house-1a');
    render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(document.activeElement?.id).toBe('house-1a');
    act(() => {
      window.history.replaceState({}, '', '/money/races?year=2026#senate-1');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(document.activeElement?.id).toBe('senate-1');
  });
  it('closes on Escape, explains no match, and never moves to an invented target', () => {
    render();
    const input = type('House');
    key(input, 'Escape');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    type('500');
    key(input, 'Enter');
    expect(host.textContent).toContain('It does not mean the district has no candidates.');
    expect(window.location.hash).toBe('');
    expect(host.textContent).toContain('Second House Committee');
  });
  it('resets the finder and limits matches to a newly selected office', () => {
    render();
    type('House');
    state.query.mockReturnValue({
      data: { ...page, office: 'Senate', contests: [senate], contestCount: 1 },
    });
    render('Senate');
    expect(host.querySelector('input')?.value).toBe('');
    type('House');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);
  });
  it('normalizes a stale office address to the complete register', () => {
    state.query.mockReturnValue({
      data: { ...page, office: 'Mayor', contests: [], contestCount: 0 },
    });
    render('Mayor');
    expect(setParams).toHaveBeenCalledWith({ office: undefined });
  });
  it('shares the explanations with the first response before the app loads', () => {
    const text = JSON.stringify(moneyByRacePageSnapshot(page));
    for (const words of [
      'Registration does not show who is on the ballot',
      'Register dated Aug 12, 2026',
      'Payment files copied Sep 1, 2026',
      'The contribution total from the committee’s filed report',
      'No named contributions in our payment records',
      'What these records do not cover',
    ])
      expect(text).toContain(words);
    expect(text).not.toContain('Union finances');
  });
});
