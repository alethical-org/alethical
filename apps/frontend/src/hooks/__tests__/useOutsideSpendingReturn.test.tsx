// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  outsideSpendingReturnContext,
  useOutsideSpendingReturn,
} from '../useOutsideSpendingReturn';
import type { OutsideSpendingBrowseAddress } from '../../lib/outsideSpendingBrowse';
import {
  currentWebHistoryEntry,
  initializeWebHistory,
  pushWebHistory,
} from '../../navigation/webHistory';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Navigation = Parameters<typeof useOutsideSpendingReturn>[1];
type ReturnLink = ReturnType<typeof useOutsideSpendingReturn>;

let latest: ReturnLink | null = null;

function Harness({
  address,
  navigation,
}: {
  address: OutsideSpendingBrowseAddress;
  navigation: Navigation;
}) {
  latest = useOutsideSpendingReturn(address, navigation);
  return null;
}

function renderHook(root: Root, address: OutsideSpendingBrowseAddress, navigation: Navigation) {
  act(() => root.render(<Harness address={address} navigation={navigation} />));
  return latest!;
}

beforeEach(() => {
  latest = null;
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('outside-spending subject return', () => {
  it('captures the browsing history depth before a subject opens', () => {
    initializeWebHistory();
    pushWebHistory('/money/outside-spending?browse=groups&q=ma&page=2');

    const context = outsideSpendingReturnContext(
      '/money/outside-spending?browse=groups&q=ma&page=2',
      { spender: '41207', year: '2024' },
    );

    expect(context).toMatchObject({
      href: '/money/outside-spending?browse=groups&q=ma&page=2',
      depth: currentWebHistoryEntry()?.depth,
      sessionId: currentWebHistoryEntry()?.sessionId,
      subject: 'spender:41207',
    });
  });

  it('returns to the original search after several subject year and page changes', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    const navigation = { replace: vi.fn() } as unknown as Navigation;

    initializeWebHistory();
    pushWebHistory('/money/outside-spending?browse=groups&year=2024&q=ma&page=2');
    const browseDepth = currentWebHistoryEntry()!.depth;
    const returnContext = outsideSpendingReturnContext(
      '/money/outside-spending?browse=groups&year=2024&q=ma&page=2',
      { spender: '41207', year: '2024' },
    )!;
    pushWebHistory('/money/outside-spending?spender=41207&year=2024');

    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    renderHook(root, { spender: '41207', year: '2024', returnContext }, navigation);

    pushWebHistory('/money/outside-spending?spender=41207&year=2025');
    const afterYear = renderHook(
      root,
      { spender: '41207', year: '2025', returnContext },
      navigation,
    );
    pushWebHistory('/money/outside-spending?spender=41207&year=2025&page=3');
    const afterPage = renderHook(
      root,
      { spender: '41207', year: '2025', page: '3', returnContext },
      navigation,
    );

    expect(afterYear.href).toBe('/money/outside-spending?browse=groups&year=2024&q=ma&page=2');
    expect(afterPage.href).toBe('/money/outside-spending?browse=groups&year=2024&q=ma&page=2');
    act(() => afterPage.onReturn());
    expect(go).toHaveBeenCalledWith(browseDepth - currentWebHistoryEntry()!.depth);
    expect(go).toHaveBeenCalledWith(-3);
    expect((navigation.replace as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);

    act(() => root.unmount());
  });

  it('restores a saved bookmark after a remount with no return state in the address', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const navigation = { replace: vi.fn() } as unknown as Navigation;

    initializeWebHistory();
    const href = '/money/outside-spending?browse=committees&year=2024&q=house&page=4';
    const returnContext = outsideSpendingReturnContext(href, { about: '18129', year: '2024' })!;
    pushWebHistory('/money/outside-spending?about=18129&year=2024');

    const firstMount = document.createElement('div');
    document.body.append(firstMount);
    const firstRoot = createRoot(firstMount);
    renderHook(firstRoot, { about: '18129', year: '2024', returnContext }, navigation);
    act(() => frames.splice(0).forEach((frame) => frame(0)));
    act(() => firstRoot.unmount());

    const cleanMount = document.createElement('div');
    document.body.append(cleanMount);
    const cleanRoot = createRoot(cleanMount);
    const restored = renderHook(cleanRoot, { about: '18129', year: '2024' }, navigation);

    expect(restored.href).toBe(href);
    act(() => cleanRoot.unmount());
  });

  it('falls back to the matching browsing mode and year for a direct subject address', () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const replace = vi.fn();
    const navigation = { replace } as unknown as Navigation;
    initializeWebHistory();

    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    const spender = renderHook(root, { spender: '-9', year: '2024' }, navigation);
    expect(spender.href).toBe('/money/outside-spending?browse=groups&year=2024');
    act(() => spender.onReturn());
    expect(replace).toHaveBeenLastCalledWith('OutsideSpending', {
      browse: 'groups',
      year: '2024',
    });

    const committee = renderHook(root, { about: '18129', year: '2025' }, navigation);
    expect(committee.href).toBe('/money/outside-spending?browse=committees&year=2025');
    act(() => committee.onReturn());
    expect(replace).toHaveBeenLastCalledWith('OutsideSpending', {
      browse: 'committees',
      year: '2025',
    });

    act(() => root.unmount());
  });
});
