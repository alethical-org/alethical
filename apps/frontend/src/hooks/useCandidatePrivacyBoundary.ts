import { useLayoutEffect, useRef } from 'react';
import { resetCandidatePrivacy } from '../lib/candidatePrivacy';
import { useAuth } from '../providers/AuthProvider';

/** Clear and cancel private searches before painting an account transition. */
export function useCandidatePrivacyBoundary() {
  const { isLoading, isSignedIn, user } = useAuth();
  const accountId = isSignedIn ? (user?.id ?? null) : null;
  // Unknown during initial restoration is different from established signed-out.
  const previous = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (previous.current === undefined) {
      if (!isLoading) previous.current = accountId;
      return;
    }
    // Later loading must not exempt a genuine sign-in, rejection or account switch.
    if (previous.current === accountId) return;
    previous.current = accountId;
    resetCandidatePrivacy();
  }, [accountId, isLoading]);
}
