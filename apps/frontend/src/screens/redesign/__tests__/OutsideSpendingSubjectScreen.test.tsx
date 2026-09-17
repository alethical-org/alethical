// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RootScreenProps } from '../../../navigation/types';
import type { OutsideSpendingRecordPage } from '../../../lib/outsideSpending';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const state = vi.hoisted(() => ({ record: undefined as OutsideSpendingRecordPage | undefined }));
vi.mock('../../../hooks/useAppQueries', () => ({
  useOutsideSpendingRecord: () => ({ data: state.record, isError: false, isPending: false }),
  usePrefetchCommitteeMoney: () => vi.fn(),
}));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false, isDesktop: true, isTablet: false }),
}));
vi.mock('../../../hooks/useHistoryScrollRestoration', () => ({
  useHistoryScrollRestoration: () => ({}),
}));
vi.mock('../../../hooks/useOutsideSpendingReturn', () => ({
  useOutsideSpendingReturn: () => ({ href: '/money/outside-spending', onReturn: vi.fn() }),
}));
vi.mock('../../../navigation/documentTitle', () => ({ useDocumentTitle: () => {} }));
vi.mock('../OutsideSpendingBrowseScreen', () => ({ OutsideSpendingBrowseScreen: () => null }));
vi.mock('../../../theme/primitives', () => ({
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PageBackground: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TopNav: () => null,
  Footer: () => null,
}));
vi.mock('react-native-svg', () => ({
  default: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  Path: () => null,
}));

import { OutsideSpendingScreen } from '../OutsideSpendingScreen';
import { outsideSpendingRecordPageFromPayload, SORT_LABELS } from '../../../lib/outsideSpending';
import { campaignMoneyYears } from '../../../lib/legislatorCampaignMoney';

type Address = NonNullable<RootScreenProps<'OutsideSpending'>['route']['params']>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const navigation = { setParams: vi.fn(), push: vi.fn(), navigate: vi.fn() };

async function render(params: Address) {
  state.record = outsideSpendingRecordPageFromPayload({
    state: 'reported',
    year: Number(params.year),
    sort: params.sort,
    [params.spender ? 'spender' : 'about']: {
      registration_number: params.spender ?? params.about,
      name: 'Example filed name',
    },
    page: { number: 2, size: 50, total_rows: 75, has_more: false },
  });
  await act(async () => {
    root.render(
      <OutsideSpendingScreen
        navigation={navigation as never}
        route={{ key: 'subject', name: 'OutsideSpending', params }}
      />,
    );
  });
}

function press(label: string): Address {
  const anchor = [...host.querySelectorAll<HTMLAnchorElement>('a')].find(
    (element) => element.textContent === label,
  );
  expect(anchor, `control ${label}`).toBeTruthy();
  act(() => anchor!.click());
  expect(navigation.setParams).toHaveBeenCalledTimes(1);
  return navigation.setParams.mock.calls[0][0] as Address;
}

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe.each(['spender', 'about'] as const)('outside-spending %s filters', (subject) => {
  const original: Address = { [subject]: '-25', year: '2015', sort: 'largest', page: '2' };

  it('clears a historical year and payment page when All years is pressed', async () => {
    await render(original);
    const change = press('All years');
    expect(Object.hasOwn(change, 'year')).toBe(true);
    expect(Object.hasOwn(change, 'page')).toBe(true);
    // React Navigation merges these fields; omission would retain the old filters.
    expect({ ...original, ...change }).toMatchObject({
      [subject]: '-25',
      year: undefined,
      page: undefined,
      sort: 'largest',
    });
  });

  it('returns to payment page 1 when the year changes, keeping the subject and sort', async () => {
    await render(original);
    const nextYear = String(campaignMoneyYears()[0]);
    const change = press(nextYear);
    expect(Object.hasOwn(change, 'page')).toBe(true);
    expect({ ...original, ...change }).toMatchObject({
      [subject]: '-25',
      year: nextYear,
      page: undefined,
      sort: 'largest',
    });
  });

  it('clears largest-first sorting and payment page when newest-first is pressed', async () => {
    await render(original);
    const change = press(SORT_LABELS.newest);
    expect(Object.hasOwn(change, 'sort')).toBe(true);
    expect(Object.hasOwn(change, 'page')).toBe(true);
    expect({ ...original, ...change }).toMatchObject({
      [subject]: '-25',
      year: '2015',
      page: undefined,
      sort: undefined,
    });
  });

  it('returns to payment page 1 when largest-first is pressed, keeping subject and year', async () => {
    await render({ ...original, sort: undefined });
    const change = press(SORT_LABELS.largest);
    expect(Object.hasOwn(change, 'page')).toBe(true);
    expect({ ...original, ...change }).toMatchObject({
      [subject]: '-25',
      year: '2015',
      page: undefined,
      sort: 'largest',
    });
  });
});
