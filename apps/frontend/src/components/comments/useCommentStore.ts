import { useContext } from 'react';
import { CommentStateContext } from './CommentStateProvider';
import { DiscussionStore } from './state';

export function useCommentStore(): DiscussionStore {
  const scope = useContext(CommentStateContext);
  if (!scope) throw new Error('ReaderComments requires CommentStateProvider');
  // This hook is loaded with the article route. Retired account scopes are never
  // reused, including when sign-out happens away from an article.
  scope.store ??= new DiscussionStore(scope.accountId);
  return scope.store;
}
