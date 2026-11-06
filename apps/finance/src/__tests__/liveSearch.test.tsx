// @vitest-environment jsdom

import { act, type FormEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { navigate, useLocation } from '../router';
import { useLiveSearch } from '../search/useLiveSearch';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function type(value: string) {
  const input = container.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

async function pause(ms = 250) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

function SearchBox({ commit }: { commit: (query: string, tab: string | null) => void }) {
  const { pathname, search, searchParams } = useLocation();
  const applied = decodeURIComponent(pathname.split('/')[2] ?? '');
  const [draft, setDraft, apply] = useLiveSearch(applied, pathname + search, (query) =>
    commit(query, searchParams.get('tab')),
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    apply();
  }
  return (
    <form onSubmit={submit}>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button type="submit">Search</button>
    </form>
  );
}

async function show(commit: (query: string, tab: string | null) => void, to = '/search/held') {
  window.history.replaceState(null, '', to);
  await act(async () => root.render(<SearchBox commit={commit} />));
}

it('keeps raw spacing when a debounced name search updates the path', async () => {
  const commit = vi.fn((query: string) => navigate('/search/' + encodeURIComponent(query)));
  await show(commit);
  const input = await type('lisa ');
  await pause();
  expect(commit).toHaveBeenCalledExactlyOnceWith('lisa', null);
  expect(input.value).toBe('lisa ');
  await type(input.value + 'demuth');
  await pause();
  expect(commit).toHaveBeenLastCalledWith('lisa demuth', null);
});

it('uses the latest filters without restarting a pending typing delay', async () => {
  const commit = vi.fn();
  await show(commit, '/search/held?tab=first');
  await type('new');
  await pause(100);
  await act(async () => navigate('/search/held?tab=second', { replace: true }));
  expect(commit).not.toHaveBeenCalled();
  await pause(150);
  expect(commit).toHaveBeenCalledExactlyOnceWith('new', 'second');
});

it('applies a submitted draft immediately only once', async () => {
  const commit = vi.fn();
  await show(commit);
  await type('new');
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(commit).toHaveBeenCalledExactlyOnceWith('new', null);
  await pause();
  expect(commit).toHaveBeenCalledTimes(1);
});

it('restores an identical address on history navigation and cancels an abandoned draft', async () => {
  const commit = vi.fn();
  await show(commit);
  const input = await type('unfinished');
  await act(async () => window.dispatchEvent(new PopStateEvent('popstate')));
  expect(input.value).toBe('held');
  await pause();
  expect(commit).not.toHaveBeenCalled();
  await type('leaving');
  await act(async () => root.render(null));
  await pause();
  expect(commit).not.toHaveBeenCalled();
});

it('keeps an untouched linked spelling intact', async () => {
  const commit = vi.fn();
  await show(commit, '/search/%20Schmidt%2C%20Steven');
  await pause();
  expect(container.querySelector('input')?.value).toBe(' Schmidt, Steven');
  expect(commit).not.toHaveBeenCalled();
  await type('Schmidt, Steven');
  await pause();
  expect(commit).toHaveBeenCalledExactlyOnceWith('Schmidt, Steven', null);
});
