// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommentEmailStopState } from '../../../data/comments';

vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const mocks = vi.hoisted(() => ({ inspect: vi.fn(), stop: vi.fn() }));
vi.mock('../../../data/comments', () => ({
  inspectCommentEmailStop: mocks.inspect,
  stopCommentEmails: mocks.stop,
}));
vi.mock('../../../data/api', () => ({
  ApiError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));
import { CommentEmailsScreen } from '../../../screens/redesign/CommentEmailsScreen';
import { ApiError } from '../../../data/api';

const state = (changes: Partial<CommentEmailStopState> = {}): CommentEmailStopState => ({
  article_id: 'a',
  article_title: 'Article A',
  article_path: '/read/guides/a',
  link_choice: 'replies',
  reply_emails: true,
  article_updates: true,
  ...changes,
});
let root: Root;
let host: HTMLDivElement;
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.querySelector('.rc-button-labels>span')?.textContent === label,
  )!;
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(
    null,
    '',
    '/comment-emails#token=private-example-token&choice=replies',
  );
  mocks.inspect.mockResolvedValue(state());
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('opens without changing any choice and removes the token from browser history', async () => {
  await act(async () => root.render(<CommentEmailsScreen />));
  expect(mocks.inspect).toHaveBeenCalledWith('private-example-token');
  expect(mocks.stop).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('');
  expect(host.innerHTML).not.toContain('private-example-token');
  expect(button('Stop reply emails')).toBeTruthy();
  expect(button('Stop updates for this article')).toBeTruthy();
});

it('shows what remains enabled and lets the reader stop the other choice separately', async () => {
  mocks.stop
    .mockResolvedValueOnce(state({ reply_emails: false }))
    .mockResolvedValueOnce(state({ reply_emails: false, article_updates: false }));
  await act(async () => root.render(<CommentEmailsScreen />));
  await act(async () => button('Stop reply emails').click());
  expect(host.querySelector('h1')?.textContent).toBe('Reply emails stopped');
  expect(host.textContent).toContain(
    'You still receive updates for this article, including replies to you',
  );
  expect(button('Stop updates for this article')).toBeTruthy();
  await act(async () => button('Stop updates for this article').click());
  expect(host.querySelector('h1')?.textContent).toBe('Updates for this article stopped');
  expect(host.textContent).toContain('Reply emails stopped');
  expect(host.textContent).toContain(
    'You can turn these emails back on beside the comments after signing in',
  );
  expect(mocks.stop.mock.calls).toEqual([
    ['private-example-token', 'replies'],
    ['private-example-token', 'article'],
  ]);
});

it('keeps the current choices and offers retry when saving fails', async () => {
  mocks.stop.mockRejectedValue(new Error('timeout'));
  await act(async () => root.render(<CommentEmailsScreen />));
  await act(async () => button('Stop reply emails').click());
  expect(host.querySelector('h1')?.textContent).toBe('Comment emails');
  expect(host.textContent).toContain('Couldn’t save your email choices. Try again.');
  expect(button('Stop reply emails').getAttribute('aria-disabled')).toBe('false');
});

it('opens directly on the stopped heading when the link choice is already off', async () => {
  mocks.inspect.mockResolvedValue(state({ link_choice: 'article', article_updates: false }));
  await act(async () => root.render(<CommentEmailsScreen />));
  expect(host.querySelector('h1')?.textContent).toBe('Updates for this article stopped');
  expect(host.textContent).toContain('You still receive emails when someone replies to you');
  expect(mocks.stop).not.toHaveBeenCalled();
});

it.each([400, 404, 422])('shows an invalid-link message for response %s', async (status) => {
  mocks.inspect.mockRejectedValue(new ApiError(status, 'Invalid email link'));
  await act(async () => root.render(<CommentEmailsScreen />));
  expect(host.textContent).toContain('This email link could not be opened');
  expect(host.querySelector('a[href="mailto:ask@alethical.com"]')).toBeTruthy();
  expect(button('Try again')).toBeUndefined();
  expect(mocks.stop).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('');
});

it('offers retry when loading email choices temporarily fails', async () => {
  mocks.inspect.mockRejectedValueOnce(new ApiError(503, 'Temporarily unavailable'));
  await act(async () => root.render(<CommentEmailsScreen />));
  expect(host.textContent).toContain('Email choices could not be loaded');
  expect(button('Try again')).toBeTruthy();
  await act(async () => button('Try again').click());
  expect(button('Stop reply emails')).toBeTruthy();
  expect(mocks.stop).not.toHaveBeenCalled();
});
