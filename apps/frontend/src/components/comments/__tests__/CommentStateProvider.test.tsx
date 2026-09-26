// @vitest-environment jsdom

import { act, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DiscussionStore } from '../state';

vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const auth = vi.hoisted(() => ({ user: { id: 'reader' } as { id: string } | null }));
vi.mock('../../../providers/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('../state', () => {
  throw new Error('The global provider must not load the discussion module');
});
import { CommentStateProvider, CommentStateContext } from '../CommentStateProvider';

const createStore = vi.fn((accountId: string | null) => ({ accountId }) as DiscussionStore);
let currentStore: DiscussionStore;
function Consumer() {
  const scope = useContext(CommentStateContext)!;
  scope.store ??= createStore(scope.accountId);
  currentStore = scope.store;
  return <span>{currentStore.accountId}</span>;
}

let root: Root;
let host: HTMLDivElement;
const render = async (commentsVisible: boolean) => {
  await act(async () => {
    root.render(
      <CommentStateProvider>{commentsVisible ? <Consumer /> : <div />}</CommentStateProvider>,
    );
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'reader' };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('creates the cache only on first use and shares it across screen remounts', async () => {
  await render(false);
  expect(createStore).not.toHaveBeenCalled();
  await render(true);
  expect(createStore).toHaveBeenCalledExactlyOnceWith('reader');
  const firstStore = currentStore;
  await render(false);
  await render(true);
  expect(currentStore).toBe(firstStore);
  expect(createStore).toHaveBeenCalledTimes(1);
});

it('discards the cache through account changes while no comments are mounted', async () => {
  await render(true);
  const firstStore = currentStore;
  await render(false);
  auth.user = null;
  await render(false);
  auth.user = { id: 'reader' };
  await render(false);
  expect(createStore).toHaveBeenCalledTimes(1);
  await render(true);
  expect(currentStore).not.toBe(firstStore);
  expect(createStore).toHaveBeenCalledTimes(2);
  const secondStore = currentStore;
  auth.user = { id: 'another-reader' };
  await render(true);
  expect(currentStore).not.toBe(secondStore);
  expect(currentStore.accountId).toBe('another-reader');
});
