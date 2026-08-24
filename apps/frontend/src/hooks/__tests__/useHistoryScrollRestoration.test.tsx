// @vitest-environment jsdom

import { act, type Ref } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useHistoryScrollRestoration } from '../useHistoryScrollRestoration';
import {
  initializeWebHistory,
  pushWebHistory,
  readCurrentScrollPosition,
  saveCurrentScrollPosition,
} from '../../navigation/webHistory';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function ScrollHarness() {
  const scroll = useHistoryScrollRestoration();
  return <div data-testid="page-scroller" ref={scroll.ref as unknown as Ref<HTMLDivElement>} />;
}

afterEach(() => {
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

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
});
