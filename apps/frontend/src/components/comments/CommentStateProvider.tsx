import { createContext, useMemo, type PropsWithChildren } from 'react';
import { useAuth } from '../../providers/AuthProvider';
import type { DiscussionStore } from './state';

export const CommentStateContext = createContext<{
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
