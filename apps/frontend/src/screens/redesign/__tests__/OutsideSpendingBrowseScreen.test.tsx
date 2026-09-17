// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RootScreenProps } from '../../../navigation/types';
import type { OutsideSpendingRecordPage } from '../../../lib/outsideSpending';
import type { OutsideSpendingNamesPage } from '../../../lib/outsideSpendingBrowse';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const state = vi.hoisted(() => ({
  record: undefined as OutsideSpendingRecordPage | undefined,
  names: undefined as OutsideSpendingNamesPage | undefined,
  error: false,
  namesError: false,
  mobile: false,
  placeholder: false,
}));
const fetchNames = vi.hoisted(() => vi.fn());
const restoreScroll = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useAppQueries', () => ({
  useOutsideSpendingRecord: () => ({
    data: state.record,
    isError: state.error,
    isPending: !state.record && !state.error,
    isPlaceholderData: state.placeholder,
    refetch,
  }),
}));
vi.mock('../../../hooks/useOutsideSpendingNames', () => ({
  useOutsideSpendingNames: (options: unknown) => {
    fetchNames(options);
    return { data: state.names, isError: state.namesError, refetch };
  },
}));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: state.mobile, isDesktop: !state.mobile, isTablet: false }),
}));
vi.mock('../../../hooks/useHistoryScrollRestoration', () => ({
  useHistoryScrollRestoration: (ready: boolean) => {
    restoreScroll(ready);
    return {};
  },
}));
vi.mock('../../../navigation/documentTitle', () => ({ useDocumentTitle: () => {} }));
vi.mock('../../../theme/primitives', () => ({
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PageBackground: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TopNav: () => null,
  Footer: () => null,
}));
vi.mock('react-native-svg', () => ({
  default: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  Path: () => null,
  Circle: () => null,
}));

import { OutsideSpendingBrowseScreen } from '../OutsideSpendingBrowseScreen';
import { outsideSpendingRecordPageFromPayload } from '../../../lib/outsideSpending';
import { OUTSIDE_BROWSE_SCOPE } from '../../../lib/outsideSpendingBrowse';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const navigation = { setParams: vi.fn(), push: vi.fn(), navigate: vi.fn() };
async function render(params: RootScreenProps<'OutsideSpending'>['route']['params'] = {}) {
  await act(async () => {
    root.render(
      <OutsideSpendingBrowseScreen
        navigation={navigation as never}
        route={{ key: 'test', name: 'OutsideSpending', params }}
      />,
    );
  });
}
function press(text: string) {
  const el = [...host.querySelectorAll<HTMLElement>('a,[role="button"]')].find(
    (e) => e.textContent === text,
  );
  expect(el, `control ${text}`).toBeTruthy();
  act(() => el!.click());
}
beforeEach(() => {
  vi.clearAllMocks();
  state.error = false;
  state.namesError = false;
  state.mobile = false;
  state.placeholder = false;
  state.record = outsideSpendingRecordPageFromPayload({
    state: 'reported',
    snapshot_id: 'snapshot',
    year: null,
    fetched_at: '2026-09-01T12:00:00Z',
    figures: {
      row_count: 30,
      amount_total: '1000',
      supporting_count: 20,
      opposing_count: 9,
      direction_not_recorded_count: 1,
      in_kind_count: 3,
      first_year: 2024,
      last_year: 2026,
    },
  });
  state.names = {
    state: 'reported',
    browse: 'groups',
    query: '',
    year: null,
    names: [
      { name: 'Example A', registration_number: '-25', in_register: false },
      { name: 'Example without ID', registration_number: null, in_register: false },
    ],
    years: [2026, 2024],
    page: { number: 1, size: 12, total_names: 14, has_more: true },
    snapshot_id: 'snapshot',
    release_id: 'release',
    source_url: null,
    fetched_at: '2026-09-01T12:00:00Z',
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('outside spending browsing', () => {
  it('opens filed IDs in outside spending and leaves missing IDs visible without links', async () => {
    await render({ year: '2024' });
    state.record = { ...state.record!, year: 2024 };
    state.names = { ...state.names!, year: 2024 };
    await render({ year: '2024' });
    expect(host.querySelector('a[href*="spender=-25"]')?.getAttribute('href')).toContain(
      'year=2024',
    );
    expect(
      [...host.querySelectorAll('a')].some((a) => a.textContent === 'Example without ID'),
    ).toBe(false);
    expect(host.textContent).toContain('We cannot open a separate spending record for this name');
    expect(host.querySelector('a[href="/money/search"]')).toBeNull();
    press('Example A');
    expect(navigation.push).toHaveBeenCalledWith(
      'OutsideSpending',
      expect.objectContaining({
        spender: '-25',
        year: '2024',
        returnTo: '/money/outside-spending?year=2024',
      }),
    );
  });
  it('uses the approved centered pagination order and does not activate an end button', async () => {
    await render();
    const pages = host.querySelector('[aria-label="Pages"]')!;
    expect(pages.textContent).toBe('PreviousPage 1 of 2Next');
    press('Previous');
    expect(navigation.setParams).not.toHaveBeenCalled();
    press('Next');
    expect(navigation.setParams).toHaveBeenCalledWith(expect.objectContaining({ page: '2' }));
    const numeric = host.querySelector('[aria-live="polite"]');
    expect(numeric).toBeTruthy();
  });
  it('changes browsing mode while clearing name and page, preserving year', async () => {
    state.record = { ...state.record!, year: 2024 };
    await render({ q: 'Example', page: '2', year: '2024' });
    const choice = host.querySelectorAll<HTMLElement>('[aria-pressed]');
    const committees = [...choice].find((e) =>
      e.textContent?.includes('Who was supported or opposed?'),
    )!;
    act(() => committees.click());
    expect(navigation.setParams).toHaveBeenCalledWith(
      expect.objectContaining({
        browse: 'committees',
        q: undefined,
        page: undefined,
        year: '2024',
      }),
    );
  });
  it('keeps period figures when names fail or no name matches and gives 1 clear action', async () => {
    state.names = undefined;
    state.namesError = true;
    await render({ q: 'nothing' });
    expect(host.textContent).toContain('$1,000');
    expect(host.textContent).toContain('We could not load the names');
    state.namesError = false;
    state.names = {
      state: 'reported',
      browse: 'groups',
      year: null,
      query: 'nothing',
      names: [],
      years: [2026],
      page: { number: 1, size: 12, total_names: 0, has_more: false },
      snapshot_id: 'snapshot',
      release_id: 'r',
      source_url: null,
      fetched_at: null,
    };
    await render({ q: 'nothing' });
    expect(host.textContent).toContain('No matching groups');
    expect(host.textContent).toContain(OUTSIDE_BROWSE_SCOPE);
    expect(
      [...host.querySelectorAll('[role="button"]')].filter((e) => e.textContent === 'Clear search'),
    ).toHaveLength(1);
    expect(fetchNames).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'nothing', snapshotId: 'snapshot' }),
    );
  });
  it('waits for the names before restoring a cold return position', async () => {
    const names = state.names;
    state.names = undefined;
    await render();
    expect(restoreScroll).toHaveBeenLastCalledWith(false);
    state.names = names;
    await render();
    expect(restoreScroll).toHaveBeenLastCalledWith(true);
  });
  it('keeps counts when a total is incomplete and prints unstated direction separately', async () => {
    state.record!.figures!.amountTotal = null;
    await render();
    expect(host.textContent).not.toContain('$1,000');
    expect(host.textContent).toContain('30 payments');
    expect(host.textContent).toContain('1 payment with no direction stated');
    expect(host.textContent).toContain('Some payments have no amount recorded');
  });
  it('does not label previous-year figures with the newly requested year after a failure', async () => {
    state.record = { ...state.record!, year: 2024 };
    await render({ year: '2024' });
    state.record = undefined;
    state.error = true;
    await render({ year: '2026' });
    expect(host.textContent).toContain('already loaded for 2024');
    expect(fetchNames).toHaveBeenLastCalledWith(expect.objectContaining({ year: 2024 }));
  });
  it('keeps All years when a newly requested year fails', async () => {
    await render();
    state.record = undefined;
    state.error = true;
    await render({ year: '2026' });
    expect(fetchNames).toHaveBeenLastCalledWith(expect.objectContaining({ year: null }));
    expect(host.textContent).toContain('$1,000');
  });
  it('offers retry when the held source is replaced during a names request', async () => {
    state.names = { ...state.names!, state: 'unavailable', snapshot_id: 'new-source', names: [] };
    await render();
    expect(host.textContent).not.toContain('Loading names');
    expect(host.textContent).toContain('Try again');
  });
  it('shows refresh failure even when the cached search had no matches', async () => {
    state.names = {
      ...state.names!,
      names: [],
      page: { number: 1, size: 12, total_names: 0, has_more: false },
    };
    state.namesError = true;
    state.names.query = 'nothing';
    await render({ q: 'nothing' });
    expect(host.textContent).toContain('Try again');
    expect(host.textContent).toContain('No matching groups');
  });
  it('uses a labelled year menu on phones and keeps the bottom explanations', async () => {
    state.mobile = true;
    await render();
    const select = host.querySelector('select[aria-label="Year"]') as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(['All years', '2026', '2024']);
    act(() => {
      select.value = '2024';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(navigation.setParams).toHaveBeenCalledWith(
      expect.objectContaining({ year: '2024', page: undefined }),
    );
    expect(host.textContent).toContain('How to read these records');
    expect(host.textContent).toContain('Limits of these records');
    expect(host.textContent).toContain('Records copied Sep 1, 2026');
  });
  it('never prints figures from an initial failure or a missing source', async () => {
    state.record = undefined;
    state.error = true;
    await render();
    expect(host.textContent).toContain('We could not load these records');
    expect(host.textContent).not.toContain('$0');
    expect(host.textContent).not.toContain('0 payments');
  });
});
