import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { useAuth } from '../../providers/AuthProvider';
import type { DiscussionStore } from './state';

const CommentStateContext = createContext<{
  accountId: string | null;
  store: DiscussionStore | null;
} | null>(null);

export function CommentStateProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  // This provider stays mounted above the navigator, including on pages without
  // comments. A sign-out therefore clears drafts even when no discussion is open.
  const scope = useMemo(() => ({ accountId: user?.id ?? null, store: null }), [user?.id]);
  return <CommentStateContext.Provider value={scope}>{children}</CommentStateContext.Provider>;
}

export function useCommentStore(
  createStore: (accountId: string | null) => DiscussionStore,
): DiscussionStore {
  const scope = useContext(CommentStateContext);
  if (!scope) throw new Error('ReaderComments requires CommentStateProvider');
  // The article route supplies the constructor so discussion code stays out of
  // the startup bundle. Retired account scopes are never reused.
  scope.store ??= createStore(scope.accountId);
  return scope.store;
}
