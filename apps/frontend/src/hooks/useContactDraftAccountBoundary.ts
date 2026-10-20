import { useLayoutEffect } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { updateContactDraftAccount } from '../lib/contactDraftAccount';

/** Observe confirmed account changes above the navigator, including while the form is closed. */
export function useContactDraftAccountBoundary() {
  const { isLoading, isSignedIn, user } = useAuth();
  const id = isSignedIn ? user?.id : undefined;
  const email = isSignedIn ? user?.email : undefined;
  useLayoutEffect(() => {
    if (isLoading) return;
    updateContactDraftAccount(id && email ? { id, email } : null);
  }, [isLoading, id, email]);
}
