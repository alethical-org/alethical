// @vitest-environment jsdom

import { act, createContext, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentSettings, CommentWriteResult, ReaderComment } from '../../../data/comments';

vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const mocks = vi.hoisted(() => ({
  user: { id: 'reader' } as { id: string } | null,
  settings: vi.fn(),
  list: vi.fn(),
  conversation: vi.fn(),
  post: vi.fn(),
  change: vi.fn(),
  check: vi.fn(),
  name: vi.fn(),
  preferences: vi.fn(),
  signIn: vi.fn(),
}));
const RouteFocus = createContext(true);
vi.mock('@react-navigation/native', () => ({
  useIsFocused: () => useContext(RouteFocus),
}));
vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({
    user: mocks.user,
    accessToken: mocks.user ? `token-${mocks.user.id}` : null,
    isLoading: false,
  }),
}));
vi.mock('../../../providers/signInModalContext', () => ({
  useSignInModal: () => ({ openSignIn: mocks.signIn }),
}));
vi.mock('../../../data/comments', () => ({
  readComments: mocks.list,
  readCommentConversation: mocks.conversation,
  readCommentSettings: mocks.settings,
  postComment: mocks.post,
  changeComment: mocks.change,
  checkCommentRequest: mocks.check,
  saveCommentName: mocks.name,
  saveCommentPreferences: mocks.preferences,
  commentOutcomeUnknown: (error: { known?: boolean }) => !error.known,
}));
import { ReaderComments } from '../ReaderComments';
import { CommentStateProvider } from '../CommentStateProvider';

const settings = (fields: Partial<CommentSettings> = {}): CommentSettings => ({
  account_id: mocks.user?.id ?? 'reader',
  public_name: 'R',
  reply_emails: true,
  article_updates: false,
  profile_version: 1,
  follow_version: 0,
  is_admin: false,
  ...fields,
});
const item = (id: string, fields: Partial<ReaderComment> = {}): ReaderComment => ({
  id,
  article_id: 'a',
  author_id: 'reader',
  name: 'R',
  body: `Body ${id}`,
  root_id: null,
  reply_to_id: null,
  reply_to_name: null,
  posted_at: '2026-09-26T14:00:00Z',
  edited_at: null,
  status: 'live',
  version: 1,
  ...fields,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
let root: Root;
let host: HTMLDivElement;
const render = async (articleId = 'a') => {
  await act(async () => {
    root.render(
      <CommentStateProvider>
        <ReaderComments articleId={articleId} />
      </CommentStateProvider>,
    );
  });
};
const button = (label: string, within: ParentNode = host) =>
  [...within.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) =>
      node.querySelector('.rc-button-labels>span')?.textContent === label ||
      node.getAttribute('aria-label') === label,
  )!;
const click = async (label: string, within: ParentNode = host) => {
  const target = button(label, within);
  expect(target).toBeTruthy();
  await act(async () => {
    target.click();
  });
};
const type = async (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 'reader' };
  mocks.settings.mockImplementation(async () => settings());
  mocks.list.mockResolvedValue({ items: [], next_cursor: null });
  mocks.conversation.mockResolvedValue({ items: [], next_cursor: null });
  mocks.post.mockResolvedValue({
    comment: item('posted', { body: 'A comment' }),
    settings: settings(),
  });
  window.history.replaceState(null, '', '/read/guides/a');
  window.sessionStorage.clear();
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

describe('reader comments', () => {
  it('keeps fragment targets and focus inside the active discussion when old routes remain mounted', async () => {
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    mocks.list.mockResolvedValue({ items: [item(id)], next_cursor: null });
    mocks.conversation.mockResolvedValue({ items: [item(id)], next_cursor: null });
    window.history.replaceState(null, '', `/read/guides/a#comment-${id}`);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    await act(async () => {
      root.render(
        <CommentStateProvider>
          <div hidden>
            <RouteFocus.Provider value={false}>
              <ReaderComments articleId="a" />
            </RouteFocus.Provider>
          </div>
          <div data-active-route>
            <RouteFocus.Provider value={true}>
              <ReaderComments articleId="a" />
            </RouteFocus.Provider>
          </div>
        </CommentStateProvider>,
      );
    });
    await act(async () => frames.splice(0).forEach((frame) => frame(0)));
    expect(host.querySelectorAll('#reader-comments')).toHaveLength(1);
    expect(host.querySelectorAll(`#comment-${id}`)).toHaveLength(1);
    expect(mocks.conversation).toHaveBeenCalledExactlyOnceWith('a', id);
    expect(document.activeElement).toBe(host.querySelector(`[data-active-route] #comment-${id}`));
  });

  it('ignores a fragment response after its route loses focus', async () => {
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const loading = deferred<{ items: ReaderComment[]; next_cursor: null }>();
    mocks.conversation.mockReturnValue(loading.promise);
    window.history.replaceState(null, '', `/read/guides/a#comment-${id}`);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    const renderRoutes = async (focused: boolean) => {
      await act(async () => {
        root.render(
          <CommentStateProvider>
            <RouteFocus.Provider value={focused}>
              <ReaderComments articleId="a" />
            </RouteFocus.Provider>
            <button id="current-route-control">Read another article</button>
          </CommentStateProvider>,
        );
      });
    };
    await renderRoutes(true);
    await renderRoutes(false);
    const currentControl = host.querySelector<HTMLButtonElement>('#current-route-control')!;
    currentControl.focus();
    await act(async () => loading.resolve({ items: [item(id)], next_cursor: null }));
    await act(async () => frames.splice(0).forEach((frame) => frame(0)));
    expect(document.activeElement).toBe(currentControl);
    expect(host.querySelector('#reader-comments')).toBeNull();
  });

  it('lets signed-out readers read and preserves the exact reply target for the existing sign-in flow', async () => {
    mocks.user = null;
    mocks.list.mockResolvedValue({ items: [item('root')], next_cursor: null });
    await render();
    expect(host.textContent).toContain('Body root');
    expect(mocks.settings).not.toHaveBeenCalled();
    await click('Sign in to reply');
    expect(mocks.signIn).toHaveBeenCalledWith({
      intent: 'nav',
      returnTo: '/read/guides/a',
      scrollY: 0,
    });
    expect(
      JSON.parse(window.sessionStorage.getItem('alethical.comments.signInTarget')!),
    ).toMatchObject({ articleId: 'a', target: 'root' });
  });

  it('accepts a single initial, sends one post, and keeps fields read-only while posting', async () => {
    mocks.settings.mockResolvedValue(settings({ public_name: null }));
    const saving = deferred<CommentWriteResult>();
    mocks.post.mockReturnValue(saving.promise);
    await render();
    await type(host.querySelector('input[type="text"]')!, 'L');
    await type(host.querySelector('textarea')!, 'A comment');
    await click('Post comment');
    await click('Post comment');
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0][2]).toMatchObject({
      public_name: 'L',
      body: 'A comment',
      expected_profile_version: 1,
      expected_account_id: 'reader',
    });
    expect(host.querySelector('textarea')?.readOnly).toBe(true);
    await act(async () =>
      saving.resolve({
        comment: item('posted', { name: 'L' }),
        settings: settings({ public_name: 'L', profile_version: 2 }),
      }),
    );
    expect(host.querySelector('textarea')?.value).toBe('');
    expect(host.textContent).toContain('Comment posted');
    expect(host.textContent).not.toContain('This name appears on your comments and replies.');
  });

  it('checks an unknown post once and preserves text changed while its outcome was unknown', async () => {
    mocks.post.mockRejectedValue(new Error('timeout'));
    const checking = deferred<{ state: 'saved'; result: CommentWriteResult }>();
    mocks.check.mockReturnValue(checking.promise);
    await render();
    await type(host.querySelector('textarea')!, 'Original');
    await click('Post comment');
    expect(host.textContent).toContain('We couldn’t confirm whether your comment was posted');
    await type(host.querySelector('textarea')!, 'Newer draft');
    await click('Check submission');
    await click('Check submission');
    await click('Post comment');
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await act(async () =>
      checking.resolve({
        state: 'saved',
        result: { comment: item('posted', { body: 'Original' }), settings: settings() },
      }),
    );
    expect(host.querySelector('textarea')?.value).toBe('Newer draft');
    expect(host.querySelectorAll('#comment-posted')).toHaveLength(1);
    expect(host.textContent).toContain('Your comment was posted');
  });

  it('does not apply a delayed post to a different article or account', async () => {
    const saving = deferred<CommentWriteResult>();
    mocks.post.mockReturnValue(saving.promise);
    await render();
    await type(host.querySelector('textarea')!, 'First article draft');
    await click('Post comment');
    await render('b');
    await type(host.querySelector('textarea')!, 'Second article draft');
    await act(async () => saving.resolve({ comment: item('posted'), settings: settings() }));
    expect(host.querySelector('#comment-posted')).toBeNull();
    expect(host.querySelector('textarea')?.value).toBe('Second article draft');
    await render('a');
    expect(host.querySelector('#comment-posted')).not.toBeNull();
    await render('b');
    mocks.user = { id: 'different-reader' };
    await render('b');
    expect(host.querySelector('textarea')?.value).toBe('');
  });

  it('shows the new root after Load more and merges it only once when its page arrives', async () => {
    mocks.list.mockResolvedValueOnce({
      items: [item('older', { posted_at: '2026-09-25T00:00:00Z' })],
      next_cursor: 'page-two',
    });
    mocks.post.mockResolvedValue({
      comment: item('posted', { body: 'Latest' }),
      settings: settings(),
    });
    await render();
    await type(host.querySelector('textarea')!, 'Latest');
    await click('Post comment');
    const more = button('Load more');
    const newest = host.querySelector('#comment-posted')!;
    expect(more.compareDocumentPosition(newest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    mocks.list.mockResolvedValueOnce({
      items: [
        item('middle', { posted_at: '2026-09-25T20:00:00Z' }),
        item('posted', { body: 'Latest' }),
      ],
      next_cursor: null,
    });
    await click('Load more');
    expect(host.querySelectorAll('#comment-posted')).toHaveLength(1);
    expect([...host.querySelectorAll('article')].map((node) => node.id)).toEqual([
      'comment-older',
      'comment-middle',
      'comment-posted',
    ]);
  });

  it('keeps replies when deleting a parent and removes the parent identity', async () => {
    const rootItem = item('root');
    const reply = item('reply', {
      author_id: 'another',
      name: 'Other',
      root_id: 'root',
      reply_to_id: 'root',
      reply_to_name: 'R',
    });
    mocks.list.mockResolvedValue({ items: [rootItem, reply], next_cursor: null });
    const tombstone = {
      ...rootItem,
      status: 'deleted' as const,
      name: null,
      author_id: null,
      body: null,
      version: 2,
    };
    mocks.change.mockResolvedValue({ comment: tombstone, settings: settings() });
    mocks.conversation.mockResolvedValue({
      items: [tombstone, { ...reply, reply_to_name: null }],
      next_cursor: null,
    });
    await render();
    await click('Delete');
    const modal = document.querySelector('[role="dialog"]')!;
    expect(modal.textContent).toContain('Delete comment?');
    await click('Delete', modal);
    expect(host.querySelector('#comment-root')?.textContent).toBe('Comment deleted');
    expect(host.querySelector('#comment-reply')?.textContent).toContain('Body reply');
    expect(host.textContent).not.toContain('Replying to R');
  });

  it('cancels edits without losing the saved text when Edit is opened again', async () => {
    mocks.list.mockResolvedValue({ items: [item('root')], next_cursor: null });
    await render();
    await click('Edit');
    let fields = host.querySelectorAll('textarea');
    await type(fields[1], 'Unsent edit');
    await click('Cancel');
    await click('Edit');
    fields = host.querySelectorAll('textarea');
    expect(fields[1].value).toBe('Body root');
    expect(mocks.change).not.toHaveBeenCalled();
  });

  it('keeps a reply-to-reply at one depth and sends the exact answered contribution', async () => {
    const reply = item('reply', {
      root_id: 'root',
      reply_to_id: 'root',
      name: 'Other',
      author_id: 'another',
    });
    mocks.list.mockResolvedValue({ items: [item('root'), reply], next_cursor: null });
    mocks.post.mockResolvedValue({
      comment: item('second-reply', {
        root_id: 'root',
        reply_to_id: 'reply',
        reply_to_name: 'Other',
      }),
      settings: settings(),
    });
    await render();
    await click('Reply', host.querySelector('#comment-reply')!);
    await type(host.querySelectorAll('textarea')[1], 'Reply to Other');
    await click('Post reply');
    expect(mocks.post.mock.calls[0][2].reply_to_id).toBe('reply');
    expect(host.querySelectorAll('.rc-reply-inner .rc-reply-inner')).toHaveLength(0);
    expect(host.querySelector('#comment-second-reply')?.textContent).toContain('Replying to Other');
  });

  it('drops private outcomes that arrive after switching accounts', async () => {
    const saving = deferred<CommentWriteResult>();
    mocks.post.mockReturnValue(saving.promise);
    await render();
    await type(host.querySelector('textarea')!, 'Previous reader draft');
    await click('Post comment');
    mocks.user = { id: 'different-reader' };
    await render();
    await type(host.querySelector('textarea')!, 'New reader draft');
    await act(async () =>
      saving.resolve({
        comment: item('old-reader-post'),
        settings: settings({ account_id: 'reader', public_name: 'Old reader name' }),
      }),
    );
    expect(host.querySelector('textarea')?.value).toBe('New reader draft');
    expect(host.textContent).not.toContain('Old reader name');
    expect(host.textContent).not.toContain('Comment posted');
    expect(host.querySelector('#comment-old-reader-post')).toBeNull();
  });

  it('restores article drafts across screen unmounts and clears them after sign-out elsewhere', async () => {
    await render();
    await type(host.querySelector('textarea')!, 'Saved in this browser view');
    await act(async () =>
      root.render(
        <CommentStateProvider>
          <div>Another page</div>
        </CommentStateProvider>,
      ),
    );
    await render('b');
    await type(host.querySelector('textarea')!, 'Article B draft');
    await render('a');
    expect(host.querySelector('textarea')?.value).toBe('Saved in this browser view');
    mocks.user = null;
    await act(async () =>
      root.render(
        <CommentStateProvider>
          <div>Signed out on another page</div>
        </CommentStateProvider>,
      ),
    );
    mocks.user = { id: 'reader' };
    await act(async () =>
      root.render(
        <CommentStateProvider>
          <div>Signed back in</div>
        </CommentStateProvider>,
      ),
    );
    await render();
    expect(host.querySelector('textarea')?.value).toBe('');
    await render('b');
    expect(host.querySelector('textarea')?.value).toBe('');
  });

  it('keeps an unknown request attached to its draft across screen unmounts', async () => {
    mocks.post.mockRejectedValue(new Error('timeout'));
    await render();
    await type(host.querySelector('textarea')!, 'Unknown post');
    await click('Post comment');
    const originalKey = mocks.post.mock.calls[0][2].request_key;
    await act(async () =>
      root.render(
        <CommentStateProvider>
          <div>Another page</div>
        </CommentStateProvider>,
      ),
    );
    await render();
    expect(host.textContent).toContain('Check submission');
    mocks.check.mockResolvedValue({ state: 'not_found', result: null });
    await click('Check submission');
    expect(mocks.check).toHaveBeenCalledWith('token-reader', 'a', originalKey);
    expect(host.querySelector('textarea')?.value).toBe('Unknown post');
    mocks.post.mockResolvedValue({ comment: item('posted'), settings: settings() });
    await click('Post comment');
    expect(mocks.post.mock.calls[1][2].request_key).not.toBe(originalKey);
  });

  it('resolves an unknown preference request before sending a different email choice', async () => {
    mocks.preferences.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({
      comment: null,
      settings: settings({
        reply_emails: false,
        article_updates: true,
        profile_version: 2,
        follow_version: 1,
      }),
    });
    mocks.check.mockResolvedValue({
      state: 'saved',
      result: { comment: null, settings: settings({ reply_emails: false, profile_version: 2 }) },
    });
    await render();
    await act(async () =>
      host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0].click(),
    );
    expect(host.textContent).toContain(
      'We couldn’t confirm whether your email choices were saved. Try again.',
    );
    const originalKey = mocks.preferences.mock.calls[0][1].request_key;
    await act(async () =>
      host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click(),
    );
    expect(mocks.check).toHaveBeenCalledWith('token-reader', 'a', originalKey);
    expect(mocks.preferences.mock.calls[1][1]).toMatchObject({
      article_updates: true,
      expected_profile_version: 2,
    });
    expect(mocks.preferences.mock.calls[1][1].request_key).not.toBe(originalKey);
    expect(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0].checked).toBe(
      false,
    );
    expect(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].checked).toBe(true);
  });

  it('keeps over-limit text, shows its error, and never sends it', async () => {
    await render();
    const text = '😀'.repeat(2001);
    await type(host.querySelector('textarea')!, text);
    await click('Post comment');
    expect(host.textContent).toContain('Keep your comment to 2,000 characters');
    expect(host.querySelector('textarea')?.value).toBe(text);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(host.textContent).toContain('2,001 of 2,000');
  });

  it('allows an admin to remove another reader’s words without offering an edit', async () => {
    mocks.settings.mockResolvedValue(settings({ is_admin: true }));
    mocks.list.mockResolvedValue({
      items: [item('other', { author_id: 'someone-else', name: 'Another reader' })],
      next_cursor: null,
    });
    await render();
    expect(button('Remove')).toBeTruthy();
    expect(button('Edit')).toBeUndefined();
    expect(button('Delete')).toBeUndefined();
    await click('Remove');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Remove comment?');
    expect(document.querySelector('[role="dialog"] select')).toBeNull();
  });

  it('keeps the original date and shows the same-day edited date without moving the comment', async () => {
    mocks.list.mockResolvedValue({
      items: [item('earlier', { posted_at: '2026-09-25T00:00:00Z' }), item('root')],
      next_cursor: null,
    });
    mocks.change.mockResolvedValue({
      comment: item('root', {
        body: 'Edited words',
        edited_at: '2026-09-26T18:00:00Z',
        version: 2,
      }),
      settings: settings(),
    });
    await render();
    await click('Edit', host.querySelector('#comment-root')!);
    await type(host.querySelectorAll('textarea')[1], 'Edited words');
    await click('Save changes');
    expect(host.querySelector('#comment-root')?.textContent).toContain(
      'Posted Sep 26, 2026 · Edited Sep 26, 2026',
    );
    expect([...host.querySelectorAll('article')].map((node) => node.id)).toEqual([
      'comment-earlier',
      'comment-root',
    ]);
    await click('Edit', host.querySelector('#comment-root')!);
    expect(host.querySelectorAll('textarea')[1].value).toBe('Edited words');
  });
});
