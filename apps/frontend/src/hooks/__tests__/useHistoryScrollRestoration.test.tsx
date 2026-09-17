// @vitest-environment jsdom

import { act, type Ref } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHistoryScrollRestoration } from '../useHistoryScrollRestoration';
import {
  initializeWebHistory,
  pushWebHistory,
  readCurrentScrollPosition,
  saveCurrentScrollPosition,
} from '../../navigation/webHistory';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let currentScroll: ReturnType<typeof useHistoryScrollRestoration>;
function ScrollHarness({ ready = true }: { ready?: boolean }) {
  const scroll = useHistoryScrollRestoration(ready);
  currentScroll = scroll;
  return <div data-testid="page-scroller" ref={scroll.ref as unknown as Ref<HTMLDivElement>} />;
}

beforeEach(() => {
  // jsdom has no layout. Model a connected visible scroller and a hidden stack screen.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (
    this: HTMLElement,
  ) {
    return (this.hidden ? [] : [{}]) as unknown as DOMRectList;
  });
});

afterEach(() => {
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountScroll(ready = true) {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const flush = () =>
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((frame) => frame(0));
    });
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  const render = (ready: boolean) => act(() => root.render(<ScrollHarness ready={ready} />));
  render(ready);
  const node = mount.querySelector<HTMLDivElement>('[data-testid="page-scroller"]')!;
  return { root, node, flush, render };
}

function scrollEvent(y: number): Parameters<typeof currentScroll.onScroll>[0] {
  return { nativeEvent: { contentOffset: { y } } } as Parameters<typeof currentScroll.onScroll>[0];
}

describe('browser-history scroll restoration', () => {
  it('opens a new page at the top instead of copying the prior page position', () => {
    window.history.replaceState({}, '', '/bills');
    initializeWebHistory();
    saveCurrentScrollPosition(640);
    expect(readCurrentScrollPosition()).toBe(640);

    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    act(() => root.render(<ScrollHarness />));

    const scroller = document.querySelector<HTMLDivElement>('[data-testid="page-scroller"]');
    expect(scroller).not.toBeNull();
    scroller!.scrollTop = 640;

    pushWebHistory('/bills/94-2025-HF719');
    expect(readCurrentScrollPosition()).toBe(0);
    act(() => frames.splice(0).forEach((frame) => frame(0)));

    expect(scroller?.scrollTop).toBe(0);
    act(() => root.unmount());
  });

  it('restores the saved position after Back returns to an earlier page', () => {
    window.history.replaceState({}, '', '/bills');
    initializeWebHistory();
    saveCurrentScrollPosition(640);
    const billListEntry = window.history.state;

    pushWebHistory('/bills/94-2025-HF719');
    window.history.replaceState(billListEntry, '', '/bills');
    expect(readCurrentScrollPosition()).toBe(640);

    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    act(() => root.render(<ScrollHarness />));

    const scroller = document.querySelector<HTMLDivElement>('[data-testid="page-scroller"]');
    act(() => frames.splice(0).forEach((frame) => frame(0)));

    expect(scroller?.scrollTop).toBe(640);
    act(() => root.unmount());
  });

  it('does not let a departing screen overwrite the destination history entry', () => {
    initializeWebHistory();
    saveCurrentScrollPosition(699);
    const browseEntry = window.history.state;
    pushWebHistory('/money/outside-spending?about=25');
    const screen = mountScroll();
    screen.flush();
    const departingScroll = currentScroll.onScroll;

    // Back changes the browser entry before the old screen finishes its last callback.
    window.history.replaceState(browseEntry, '', '/money/outside-spending?page=3');
    departingScroll(scrollEvent(377));
    expect(readCurrentScrollPosition()).toBe(699);
    act(() => screen.root.unmount());
  });

  it('ignores trailing callbacks after unmount', () => {
    initializeWebHistory();
    saveCurrentScrollPosition(699);
    const screen = mountScroll();
    screen.flush();
    const trailingScroll = currentScroll.onScroll;
    act(() => screen.root.unmount());
    trailingScroll(scrollEvent(377));
    expect(readCurrentScrollPosition()).toBe(699);
  });

  it('does not save or adopt a new entry from a hidden stack screen', () => {
    initializeWebHistory();
    const screen = mountScroll();
    screen.flush();
    screen.node.hidden = true;
    currentScroll.onScroll(scrollEvent(377));
    expect(readCurrentScrollPosition()).toBe(0);

    pushWebHistory('/money/outside-spending?about=25');
    saveCurrentScrollPosition(699);
    screen.render(true);
    screen.flush();
    // If the hidden render adopted the destination, this callback would corrupt it.
    screen.node.hidden = false;
    currentScroll.onScroll(scrollEvent(377));
    expect(readCurrentScrollPosition()).toBe(699);
    act(() => screen.root.unmount());
  });

  it('adopts a filter entry after rendering without remounting the scroller', () => {
    initializeWebHistory();
    saveCurrentScrollPosition(640);
    const originalEntry = window.history.state;
    const screen = mountScroll();
    screen.flush();

    pushWebHistory('/money/outside-spending?page=3');
    currentScroll.onScroll(scrollEvent(377));
    expect(readCurrentScrollPosition()).toBe(0);
    screen.render(true);
    screen.flush();
    currentScroll.onScroll(scrollEvent(699));
    expect(readCurrentScrollPosition()).toBe(699);
    window.history.replaceState(originalEntry, '', '/money/outside-spending');
    expect(readCurrentScrollPosition()).toBe(640);
    act(() => screen.root.unmount());
  });

  it('waits for loaded content before restoring and ignores loading-time scrolls', () => {
    initializeWebHistory();
    saveCurrentScrollPosition(699);
    const screen = mountScroll(false);
    screen.flush();
    expect(screen.node.scrollTop).toBe(0);
    currentScroll.onScroll(scrollEvent(377));
    expect(readCurrentScrollPosition()).toBe(699);

    screen.render(true);
    screen.flush();
    expect(screen.node.scrollTop).toBe(699);
    act(() => screen.root.unmount());
  });
});
