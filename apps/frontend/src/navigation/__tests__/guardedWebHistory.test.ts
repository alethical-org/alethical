import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGuardedWebHistory } from '../guardedWebHistory';
import {
  currentWebHistoryEntry,
  initializeWebHistory,
  markNextWebHistoryChangeAsReplace,
  pushWebHistory,
} from '../webHistory';

const profile = '/candidates/candidate-a';
const editor = `${profile}/manage`;
let dom: JSDOM;
let dispose: (() => void) | undefined;

beforeEach(() => {
  dom = new JSDOM('', { url: 'https://alethical.org/' });
  vi.stubGlobal('window', dom.window);
  initializeWebHistory();
  pushWebHistory(profile);
  pushWebHistory(editor);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  dom.window.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountHistory(dirty = true) {
  let navigationPath = editor;
  let pendingPath: string | undefined;
  const reset = vi.fn((path: string) => {
    if (dirty && navigationPath === editor) pendingPath = path;
    else {
      navigationPath = path;
      history.onStateChange(path);
    }
  });
  const history = createGuardedWebHistory({
    getNavigationPath: () => navigationPath,
    resetNavigationToPath: reset,
    shouldGuardCurrentRoute: () => navigationPath === editor,
  });
  window.addEventListener('popstate', history.onPopState);
  dispose = () => {
    window.removeEventListener('popstate', history.onPopState);
    history.dispose();
  };
  return {
    history,
    reset,
    get path() {
      return navigationPath;
    },
    get pendingPath() {
      return pendingPath;
    },
    keep() {
      history.cancelPendingNavigation();
      pendingPath = undefined;
    },
    discard() {
      dirty = false;
      reset(pendingPath!);
      pendingPath = undefined;
    },
    navigate(path: string) {
      dirty = false;
      navigationPath = path;
      history.onStateChange(path);
    },
  };
}

it('restores the editor entry before the warning and preserves Back after Keep editing', async () => {
  const history = mountHistory();
  const originalEntry = currentWebHistoryEntry();
  const originalLength = window.history.length;
  window.history.back();
  await vi.waitFor(() => expect(history.pendingPath).toBe(profile));
  expect(window.location.pathname).toBe(editor);
  expect(currentWebHistoryEntry()).toEqual(originalEntry);
  expect(history.path).toBe(editor);
  history.keep();
  expect(window.history.length).toBe(originalLength);
  window.history.back();
  await vi.waitFor(() => expect(history.pendingPath).toBe(profile));
  expect(window.location.pathname).toBe(editor);
});

it('completes Back after Discard without adding an entry and keeps Forward available', async () => {
  const history = mountHistory();
  const originalLength = window.history.length;
  window.history.back();
  await vi.waitFor(() => expect(history.pendingPath).toBe(profile));
  history.discard();
  await vi.waitFor(() => expect(window.location.pathname).toBe(profile));
  expect(history.path).toBe(profile);
  expect(window.history.length).toBe(originalLength);
  window.history.forward();
  await vi.waitFor(() => expect(history.path).toBe(editor));
  expect(window.location.pathname).toBe(editor);
  expect(window.history.length).toBe(originalLength);
});

it('keeps clean-editor Back and Forward as traversals rather than new visits', async () => {
  const history = mountHistory(false);
  const originalLength = window.history.length;
  const originalEntry = currentWebHistoryEntry();
  window.history.back();
  await vi.waitFor(() => {
    expect(history.path).toBe(profile);
    expect(window.location.pathname).toBe(profile);
  });
  window.history.forward();
  await vi.waitFor(() => expect(history.path).toBe(editor));
  expect(currentWebHistoryEntry()).toEqual(originalEntry);
  expect(window.history.length).toBe(originalLength);
});

it('does not reuse a cancelled Back for a later ordinary link to the same address', async () => {
  const history = mountHistory();
  const originalLength = window.history.length;
  window.history.back();
  await vi.waitFor(() => expect(history.pendingPath).toBe(profile));
  history.keep();
  history.navigate(profile);
  expect(window.history.length).toBe(originalLength + 1);
  expect(window.location.pathname).toBe(profile);
  window.history.back();
  await vi.waitFor(() => expect(history.path).toBe(editor));
});

it('supersedes a pending Back with a different accepted destination', async () => {
  const history = mountHistory();
  const originalLength = window.history.length;
  window.history.back();
  await vi.waitFor(() => expect(history.pendingPath).toBe(profile));
  history.navigate('/money');
  expect(window.location.pathname).toBe('/money');
  expect(window.history.length).toBe(originalLength + 1);
  window.history.back();
  await vi.waitFor(() => expect(history.path).toBe(editor));
  expect(window.location.pathname).toBe(editor);
});

it('does not erase the editor entry when accepted navigation arrives during restoration', async () => {
  const history = mountHistory();
  const originalEntry = currentWebHistoryEntry();
  const navigate = () => {
    if (window.location.pathname === profile) history.navigate('/money');
  };
  window.addEventListener('popstate', navigate, { once: true });
  window.history.back();
  await vi.waitFor(() => expect(window.location.pathname).toBe('/money'));
  expect(history.reset).not.toHaveBeenCalled();
  window.history.back();
  await vi.waitFor(() => expect(history.path).toBe(editor));
  expect(currentWebHistoryEntry()).toEqual(originalEntry);
});

it('cancels an account-change history intent even before the restoration arrives', async () => {
  const history = mountHistory();
  const originalEntry = currentWebHistoryEntry();
  let cancelled = false;
  const cancel = () => {
    history.history.cancelPendingNavigation();
    cancelled = true;
  };
  window.addEventListener('popstate', cancel, { once: true });
  window.history.back();
  await vi.waitFor(() => {
    expect(cancelled).toBe(true);
    expect(window.location.pathname).toBe(editor);
    expect(currentWebHistoryEntry()).toEqual(originalEntry);
  });
  expect(history.reset).not.toHaveBeenCalled();
  history.navigate(profile);
  expect(window.location.pathname).toBe(profile);
});

it('coalesces rapid Back presses without overwriting either earlier entry', async () => {
  const history = mountHistory();
  const originalEntry = currentWebHistoryEntry();
  const originalLength = window.history.length;
  window.addEventListener('popstate', () => window.history.back(), { once: true });
  window.history.back();
  await vi.waitFor(() => expect(history.pendingPath).toBe('/'));
  expect(window.location.pathname).toBe(editor);
  expect(currentWebHistoryEntry()).toEqual(originalEntry);
  history.discard();
  await vi.waitFor(() => expect(window.location.pathname).toBe('/'));
  expect(window.history.length).toBe(originalLength);
  window.history.forward();
  await vi.waitFor(() => expect(history.path).toBe(profile));
  window.history.forward();
  await vi.waitFor(() => expect(history.path).toBe(editor));
});

it('distinguishes separate visits to the same editor address', async () => {
  const earlierEditor = currentWebHistoryEntry();
  pushWebHistory(profile);
  pushWebHistory(editor);
  const latestEditor = currentWebHistoryEntry();
  const originalLength = window.history.length;
  const history = mountHistory();
  window.history.go(-2);
  await vi.waitFor(() => expect(history.pendingPath).toBe(editor));
  expect(currentWebHistoryEntry()).toEqual(latestEditor);
  history.discard();
  await vi.waitFor(() => expect(currentWebHistoryEntry()).toEqual(earlierEditor));
  expect(window.history.length).toBe(originalLength);
  window.history.forward();
  await vi.waitFor(() => expect(history.path).toBe(profile));
  window.history.forward();
  await vi.waitFor(() => expect(currentWebHistoryEntry()).toEqual(latestEditor));
});

it('preserves ordinary canonical address replacements', () => {
  const history = mountHistory(false);
  history.navigate('/money/committees/old-name');
  const entry = currentWebHistoryEntry();
  const length = window.history.length;
  markNextWebHistoryChangeAsReplace();
  history.navigate('/money/committees/current-name');
  expect(window.location.pathname).toBe('/money/committees/current-name');
  expect(currentWebHistoryEntry()).toEqual(entry);
  expect(window.history.length).toBe(length);
});

it('uses the original history entry when the accepted destination is canonicalized', async () => {
  const history = mountHistory();
  const originalLength = window.history.length;
  window.history.back();
  await vi.waitFor(() => expect(history.pendingPath).toBe(profile));
  markNextWebHistoryChangeAsReplace();
  history.navigate('/candidates/corrected-name');
  await vi.waitFor(() => expect(window.location.pathname).toBe('/candidates/corrected-name'));
  expect(window.history.length).toBe(originalLength);
  window.history.forward();
  await vi.waitFor(() => expect(history.path).toBe(editor));
});

it('guards Forward as well as Back and retains the selected destination entry', async () => {
  pushWebHistory('/money');
  window.history.back();
  await vi.waitFor(() => expect(window.location.pathname).toBe(editor));
  const history = mountHistory();
  const originalEntry = currentWebHistoryEntry();
  const originalLength = window.history.length;
  window.history.forward();
  await vi.waitFor(() => expect(history.pendingPath).toBe('/money'));
  expect(currentWebHistoryEntry()).toEqual(originalEntry);
  history.discard();
  await vi.waitFor(() => expect(window.location.pathname).toBe('/money'));
  expect(window.history.length).toBe(originalLength);
  window.history.back();
  await vi.waitFor(() => expect(history.path).toBe(editor));
});
