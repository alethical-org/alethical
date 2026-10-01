import { useLayoutEffect, useRef } from 'react';
import { resetCandidatePrivacy } from '../lib/candidatePrivacy';
import { useAuth } from '../providers/AuthProvider';

/** Clear and cancel private searches before painting an account transition. */
export function useCandidatePrivacyBoundary() {
  const { isSignedIn, user } = useAuth();
  const accountId = isSignedIn ? (user?.id ?? null) : null;
  const previous = useRef(accountId);
  useLayoutEffect(() => {
    if (previous.current === accountId) return;
    previous.current = accountId;
    resetCandidatePrivacy();
  }, [accountId]);
}
