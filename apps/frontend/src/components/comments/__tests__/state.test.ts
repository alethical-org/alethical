import { describe, expect, it } from 'vitest';
import type { CommentSettings, ReaderComment } from '../../../data/comments';
import {
  characterCount,
  commentDateLine,
  DiscussionStore,
  mergeComments,
  visibleComments,
} from '../state';

const comment = (id: string, fields: Partial<ReaderComment> = {}): ReaderComment => ({
  id,
  article_id: 'article',
  author_id: 'reader',
  name: 'R',
  body: 'Text',
  root_id: null,
  reply_to_id: null,
  reply_to_name: null,
  posted_at: '2026-09-26T14:30:00Z',
  edited_at: null,
  status: 'live',
  version: 1,
  ...fields,
});
const settings = (fields: Partial<CommentSettings> = {}): CommentSettings => ({
  account_id: 'reader',
  public_name: 'R',
  reply_emails: true,
  article_updates: false,
  profile_version: 1,
  follow_version: 0,
  is_admin: false,
  ...fields,
});

describe('comment state safety', () => {
  it('keeps replies when deleting a parent, erases reply-target names, and clears orphan placeholders', () => {
    const root = comment('root', { status: 'deleted', body: null, name: null, author_id: null });
    const intermediate = comment('middle', {
      root_id: 'root',
      reply_to_id: 'root',
      status: 'removed',
      body: null,
      name: null,
    });
    const leaf = comment('leaf', {
      root_id: 'root',
      reply_to_id: 'middle',
      reply_to_name: 'Old identity',
    });
    expect(visibleComments([root, intermediate, leaf]).map((item) => item.id)).toEqual([
      'root',
      'leaf',
      'middle',
    ]);
    expect(
      visibleComments([root, intermediate, leaf]).find((item) => item.id === 'leaf')?.reply_to_name,
    ).toBeNull();
    expect(visibleComments([root, intermediate, { ...leaf, status: 'deleted' }])).toEqual([]);
  });

  it('does not restore deleted text from an older read or duplicate an already posted item', () => {
    const live = comment('root');
    const deleted = comment('root', {
      status: 'deleted',
      body: null,
      author_id: null,
      name: null,
      version: 2,
    });
    expect(mergeComments([deleted], [live, live])).toEqual([deleted]);
  });

  it('counts Unicode code points and prints both same-day dates without a time', () => {
    expect(characterCount('a😀')).toBe(2);
    expect(commentDateLine(comment('root', { edited_at: '2026-09-26T15:00:00Z' }))).toBe(
      'Posted Sep 26, 2026 · Edited Sep 26, 2026',
    );
  });

  it('renames earlier contributions on every cached article and retains independent follows', () => {
    const store = new DiscussionStore('reader');
    store.patch('a', { items: [comment('a')] });
    store.patch('b', { items: [comment('b', { article_id: 'b' })] });
    store.acceptSettings('a', settings({ article_updates: true, follow_version: 3 }));
    store.acceptSettings('b', settings({ article_updates: false, follow_version: 1 }));
    store.acceptSettings(
      'b',
      settings({ public_name: 'A new name', profile_version: 2, follow_version: 2 }),
    );
    expect(store.get('a').items[0].name).toBe('A new name');
    expect(store.get('a').settings?.article_updates).toBe(true);
    expect(store.get('b').settings?.article_updates).toBe(false);
    store.acceptSettings(
      'a',
      settings({
        public_name: 'Old response',
        profile_version: 1,
        article_updates: false,
        follow_version: 1,
      }),
    );
    expect(store.get('a').settings?.public_name).toBe('A new name');
    expect(store.get('a').settings?.article_updates).toBe(true);
    store.get('c');
    store.acceptSettings('c', settings({ public_name: 'Old response', profile_version: 1 }));
    expect(store.get('c').settings?.public_name).toBe('A new name');
  });
});
