import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGuardedWebHistory } from '../guardedWebHistory';
import { createWebNavigationHistory } from '../webNavigationHistory';
import {
  currentWebHistoryEntry,
  initializeWebHistory,
  markNextWebHistoryChangeAsReplace,
  pushWebHistory,
  readCurrentScrollPosition,
  saveCurrentScrollPosition,
} from '../webHistory';

const profile = '/candidates/candidate-a';
const editor = `${profile}/manage`;
let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM('', { url: `https://alethical.org${profile}` });
  vi.stubGlobal('window', dom.window);
  initializeWebHistory();
});

afterEach(() => {
  dom.window.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountHistory() {
  let path = profile;
  let dirty = false;
  let pendingPath: string | undefined;
  const reset = vi.fn((nextPath: string) => {
    if (path === editor && dirty) pendingPath = nextPath;
    else navigate(nextPath);
  });
  const history = createWebNavigationHistory({
    getNavigationPath: () => path,
    resetNavigationToPath: reset,
    shouldGuardCurrentRoute: () => path === editor,
  });
  window.addEventListener('popstate', history.onPopState);
  function navigate(nextPath: string) {
    path = nextPath;
    history.onStateChange(nextPath);
  }
  return {
    history,
    navigate,
    reset,
    setDirty: () => {
      dirty = true;
    },
    get path() {
      return path;
    },
    get pendingPath() {
      return pendingPath;
    },
    discard() {
      dirty = false;
      reset(pendingPath!);
      pendingPath = undefined;
    },
  };
}

it('keeps ordinary navigation, canonical replacements, and Back working before an editor loads', async () => {
  const state = mountHistory();
  const originalLength = window.history.length;
  state.navigate('/money/committees/old-name');
  const entry = currentWebHistoryEntry();
  markNextWebHistoryChangeAsReplace();
  state.navigate('/money/committees/current-name');
  expect(window.history.length).toBe(originalLength + 1);
  expect(currentWebHistoryEntry()).toEqual(entry);
  expect(window.location.pathname).toBe('/money/committees/current-name');
  window.history.back();
  await vi.waitFor(() => expect(state.path).toBe(profile));
  expect(window.history.length).toBe(originalLength + 1);
  window.history.forward();
  await vi.waitFor(() => expect(state.path).toBe('/money/committees/current-name'));
});

it.each([false, true])(
  'keeps the debate screen mounted between timestamp entries, installed guard=%s',
  async (installed) => {
    const event = '/blog/events/forward-debate-2026';
    const state = mountHistory();
    state.navigate(event);
    if (installed) state.history.installHistoryGuard(createGuardedWebHistory);
    const initial = currentWebHistoryEntry();
    pushWebHistory(`${event}?t=20#watch`);
    const selected = currentWebHistoryEntry();
    window.history.back();
    await vi.waitFor(() => expect(currentWebHistoryEntry()).toEqual(initial));
    expect(state.reset).not.toHaveBeenCalled();
    window.history.forward();
    await vi.waitFor(() => expect(currentWebHistoryEntry()).toEqual(selected));
    expect(state.reset).not.toHaveBeenCalled();
    state.navigate('/money');
    window.history.back();
    await vi.waitFor(() => expect(state.reset).toHaveBeenCalledWith(`${event}?t=20`));
  },
);

it('installs one guard synchronously and delegates cancellation and navigation to it', () => {
  const state = mountHistory();
  const guard = {
    onPopState: vi.fn(),
    onStateChange: vi.fn(),
    cancelPendingNavigation: vi.fn(),
    dispose: vi.fn(),
  };
  const install = vi.fn(() => guard);
  const repeatedInstall = vi.fn(() => guard);
  expect(install).not.toHaveBeenCalled();
  state.history.cancelPendingNavigation();
  state.history.installHistoryGuard(install);
  state.history.installHistoryGuard(repeatedInstall);
  state.history.onPopState();
  state.history.onStateChange('/money');
  state.history.cancelPendingNavigation();
  expect(install).toHaveBeenCalledTimes(1);
  expect(repeatedInstall).not.toHaveBeenCalled();
  expect(guard.onPopState).toHaveBeenCalledTimes(1);
  expect(guard.onStateChange).toHaveBeenCalledWith('/money');
  expect(guard.cancelPendingNavigation).toHaveBeenCalledTimes(1);
  expect(window.location.pathname).toBe(profile);
});

it('keeps the installed guard while a confirmed editor departure finishes in browser history', async () => {
  const state = mountHistory();
  state.navigate(editor);
  state.history.installHistoryGuard(createGuardedWebHistory);
  state.setDirty();
  const editorEntry = currentWebHistoryEntry();
  const originalLength = window.history.length;
  window.history.back();
  await vi.waitFor(() => expect(state.pendingPath).toBe(profile));
  expect(currentWebHistoryEntry()).toEqual(editorEntry);
  // StrictMode remounts and later editor visits must not replace a live guard.
  state.history.installHistoryGuard(createGuardedWebHistory);
  state.discard();
  expect(state.path).toBe(profile);
  await vi.waitFor(() => expect(window.location.pathname).toBe(profile));
  expect(window.history.length).toBe(originalLength);
  window.history.forward();
  await vi.waitFor(() => expect(state.path).toBe(editor));
  expect(currentWebHistoryEntry()).toEqual(editorEntry);
});

it('can install during editor layout before Root records the editor address', async () => {
  const state = mountHistory();
  state.history.installHistoryGuard(createGuardedWebHistory);
  state.navigate(editor);
  state.setDirty();
  const editorEntry = currentWebHistoryEntry();
  window.history.back();
  await vi.waitFor(() => expect(state.pendingPath).toBe(profile));
  expect(state.path).toBe(editor);
  expect(currentWebHistoryEntry()).toEqual(editorEntry);
  state.history.cancelPendingNavigation();
  state.navigate('/money');
  expect(window.location.pathname).toBe('/money');
});

it.each([false, true])(
  'keeps original entry and scroll on Back to reordered filter queries, installed guard=%s',
  async (installed) => {
    const raw = '/bills?q=schools&page=2&chamber=house';
    const canonical = '/bills?q=schools&chamber=house&page=2';
    window.history.replaceState(window.history.state, '', raw);
    const sourceEntry = currentWebHistoryEntry();
    saveCurrentScrollPosition(731);
    let navigationPath = canonical;
    const history = createWebNavigationHistory({
      getNavigationPath: () => navigationPath,
      resetNavigationToPath: (path) => {
        navigationPath = path === raw ? canonical : path;
        history.onStateChange(navigationPath);
      },
      shouldGuardCurrentRoute: () => false,
    });
    if (installed) history.installHistoryGuard(createGuardedWebHistory);
    window.addEventListener('popstate', history.onPopState);
    history.onStateChange(canonical);
    expect(currentWebHistoryEntry()).toEqual(sourceEntry);
    navigationPath = '/bills/example-bill';
    history.onStateChange(navigationPath);
    const detailEntry = currentWebHistoryEntry();
    const length = window.history.length;
    window.history.back();
    await vi.waitFor(() => expect(currentWebHistoryEntry()).toEqual(sourceEntry));
    expect(window.location.pathname + window.location.search).toBe(raw);
    expect(readCurrentScrollPosition()).toBe(731);
    expect(window.history.length).toBe(length);
    window.history.forward();
    await vi.waitFor(() => expect(currentWebHistoryEntry()).toEqual(detailEntry));
    expect(window.history.length).toBe(length);
  },
);

it('still records a different selected filter as a new visit', () => {
  window.history.replaceState(window.history.state, '', '/bills?q=schools&page=2&chamber=house');
  const history = createWebNavigationHistory({
    getNavigationPath: () => '',
    resetNavigationToPath: () => {},
    shouldGuardCurrentRoute: () => false,
  });
  const before = currentWebHistoryEntry();
  history.onStateChange('/bills?q=parks&chamber=house&page=2');
  expect(currentWebHistoryEntry()?.entryId).not.toBe(before?.entryId);
  expect(window.location.search).toContain('q=parks');
});

it('honors an explicit replacement between equivalent route aliases and consumes its mark', () => {
  const state = mountHistory();
  state.navigate('/search?q=schools');
  const entry = currentWebHistoryEntry();
  const length = window.history.length;
  markNextWebHistoryChangeAsReplace();
  state.navigate('/bills?q=schools');
  expect(window.location.pathname).toBe('/bills');
  expect(currentWebHistoryEntry()).toEqual(entry);
  expect(window.history.length).toBe(length);
  state.navigate('/money');
  expect(window.history.length).toBe(length + 1);
});
